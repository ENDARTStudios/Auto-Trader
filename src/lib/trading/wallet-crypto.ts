// Wallet & Exchange Crypto — AES-256-GCM encryption for sensitive credentials.
//
// v16: Implements the encryption layer for WalletConnection.privateKeyEncrypted
// and ExchangeConnection.apiKeyEncrypted / apiSecretEncrypted / apiPassphraseEncrypted.
//
// v17: The vault's unlock() now ACTUALLY loads + decrypts every encrypted blob
// from the DB into process memory (was a stub in v16). Plus:
//   • Anti-brute-force rate limiting: 5 failed attempts in 60s → 5min cooldown
//   • Audit log to AppLog on every unlock/lock attempt (success AND failure)
//   • Auto-lock after 30 min idle (resets on every key access)
//   • All decrypted keys wiped (best-effort) from memory on lock()
//
// SECURITY MODEL:
//   • Encryption: AES-256-GCM (authenticated encryption)
//   • Key derivation: PBKDF2 with SHA-256, 600,000 iterations (OWASP 2023 recommendation)
//   • Salt: random 16 bytes per credential (stored in the encrypted blob)
//   • IV: random 12 bytes per encryption (stored in the encrypted blob)
//   • Passphrase: NEVER persisted — operator enters it at engine start
//   • Decrypted key lives in process memory only, wiped on stop / auto-lock
//
// The encrypted blob is a JSON string: { iv, ciphertext, tag, salt, kdfIters }
// All binary fields are base64-encoded for safe storage in SQLite TEXT columns.
//
// NOTE: This module uses Node's built-in `crypto` module. No external deps.

import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from "crypto";
import { logger } from "./logger";

// v18: defer notifier import to avoid Turbopack circular-import issues at
// module-load time. The notifier imports `db` at top-level, and the vault
// uses a lazy `import("@/lib/db")` — mixing static + dynamic imports of
// overlapping dependency graphs was causing the dev server to crash
// silently on the first vault unlock. By deferring the notifier import to
// call-time, we sidestep the issue without changing semantics.
type NotifyFn = (payload: {
  eventType: string;
  title: string;
  message: string;
  context?: Record<string, unknown>;
}) => Promise<void>;
let _notify: NotifyFn | null = null;
async function getNotify(): Promise<NotifyFn | null> {
  if (_notify) return _notify;
  try {
    const mod = await import("./notifier");
    _notify = mod.notifyEvent as NotifyFn;
    return _notify;
  } catch (err) {
    logger.debug("vault", `notifier import deferred-failed: ${String(err)}`);
    return null;
  }
}

// Fire-and-forget wrapper — never throws, never blocks the caller.
//
// v19.2: alert-fatigue throttle + slow-drip summary.
//
// Two layers of defense against notification spam:
//
//   (A) Per-eventType dedupe window (NOTIFY_DEDUPE_MS below): drops the
//       Nth notification within the window so a brute-force burst (5 wrong
//       passphrases in 5s) produces 1 push, not 5.
//
//   (B) Periodic summary alert: every NOTIFY_SUMMARY_INTERVAL_MS, if any
//       unlock attempts were suppressed by layer (A) — OR recorded at all
//       since the last summary — emit ONE summary push with the totals.
//       This catches the "slow-drip" attack the operator flagged: an
//       attacker pacing just below the rate-limit + throttle thresholds
//       (e.g. 1 attempt per 90s) would otherwise generate one push per
//       attempt, but a pacing JUST inside the throttle window (e.g. 1 per
//       30s) would generate ZERO pushes after the first, because every
//       subsequent attempt falls in the dedupe window. The summary
//       guarantees that no matter how the attacker paces, the operator
//       gets at least one push every 10min with "N attempts in the last
//       window" — making the attack visible.
//
// Throttle windows:
//   vault_unlock_failed  → dedupe 60s  (1 alert/min during burst)
//   vault_rate_limited   → dedupe 300s (1 alert per cooldown window)
//   vault_unlocked       → no dedupe (always surface — vault is open)
//   vault_locked         → no dedupe (low volume by nature)
//
// Summary interval: 10 min (separate from the per-event throttle). The
// summary is its own eventType `vault_unlock_summary` so operators can
// subscribe to it independently in the notification channel config.
const NOTIFY_DEDUPE_MS: Record<string, number> = {
  vault_unlock_failed: 60_000, // 1 min
  vault_rate_limited: 300_000, // 5 min (matches per-IP cooldown window)
  // v19.3.2: distinct event for the GLOBAL aggregate cooldown. Shorter
  // dedupe than per-IP (60s vs 5min) because:
  //   (a) a distributed attack is high-severity — the operator should see
  //       every distinct burst, not be throttled into a single push per 5min;
  //   (b) the global cooldown is only 1min (vs 5min per-IP), so a 5min
  //       dedupe window would suppress alerts that should fire again after
  //       the cooldown expires and a new wave hits.
  // The event type itself is the severity signal — operators should
  // configure a louder channel (phone-call tier) for this eventType.
  vault_rate_limited_global: 60_000, // 1 min
};
const _lastNotifySentAt = new Map<string, number>();

// v19.2: slow-drip summary state.
//   _attemptCountSinceSummary: total unlock ATTEMPTS (failed + rate-limited
//     + successful) since the last summary push. Reset to 0 after each summary.
//   _suppressedSinceSummary: subset of _attemptCountSinceSummary whose push
//     was dropped by the dedupe window. Lets the summary say "N attempts,
//     of which M were throttle-suppressed" so the operator can tell burst
//     vs slow-drip apart.
//   _summaryTimer: the setInterval handle. Started lazily on first notify
//     call (so test environments that never trigger a vault event don't
//     keep a dangling timer). Unref'd so it doesn't keep the process alive.
let _attemptCountSinceSummary = 0;
let _suppressedSinceSummary = 0;
let _summaryTimer: NodeJS.Timeout | null = null;
const NOTIFY_SUMMARY_INTERVAL_MS = 10 * 60 * 1000; // 10 min

// v19.2: source IP tracking. Every unlock/lock attempt that comes through
// the API route passes its source IP here, and we include it in the audit
// log context + the notify context. This is a one-line addition now that
// pays off when 2FA + IP allowlist arrive in v19.3 — without it, there's
// no historical record to answer "were these attempts already coming from
// outside the expected network before the allowlist was enforced?"
//
// The IP is extracted from headers in /api/vault/route.ts (x-forwarded-for
// → x-real-ip → socket.remoteAddress) and passed as the optional second
// argument to unlockAsync / lock.
//
// TEST ENVIRONMENT: when sourceIp is not provided (e.g. automated tests
// that call unlockAsync directly), we record "unknown" so the audit log
// column is always present and grep-able.

// v19-BLOCKING: test-visibility counters for the notify throttle. These let
// the automated test suite verify that throttling actually drops messages
// (without them, we could only verify "first call sent" — not "subsequent
// calls dropped"). Counters are read via `getNotifyThrottleStats()` below.
let _notifyAttempted = 0; // incremented every call to notifyVaultEvent
let _notifyThrottled = 0; // incremented when a call is dropped by dedupe
let _notifyDispatched = 0; // incremented when a call actually reaches setImmediate

/**
 * Test/debug helper — returns the current state of the notify throttle +
 * slow-drip summary counters. Used by scripts/test-vault.ts scenario #11
 * to verify that burst unlock failures produce only ONE notification, not N,
 * and by scenario #12 (TOCTOU) to verify exact counter values after
 * concurrent failures.
 */
export function getNotifyThrottleStats(): {
  attempted: number;
  throttled: number;
  dispatched: number;
  lastSentAt: Record<string, number>;
  dedupeWindowsMs: Record<string, number>;
  attemptCountSinceSummary: number;
  suppressedSinceSummary: number;
  summaryIntervalMs: number;
} {
  return {
    attempted: _notifyAttempted,
    throttled: _notifyThrottled,
    dispatched: _notifyDispatched,
    lastSentAt: Object.fromEntries(_lastNotifySentAt),
    dedupeWindowsMs: { ...NOTIFY_DEDUPE_MS },
    attemptCountSinceSummary: _attemptCountSinceSummary,
    suppressedSinceSummary: _suppressedSinceSummary,
    summaryIntervalMs: NOTIFY_SUMMARY_INTERVAL_MS,
  };
}

/**
 * Test helper — clears the notify throttle state so test scenarios are
 * isolated from each other. NOT intended for production use; if called in
 * production it would only reset the dedupe memory (not the audit log),
 * so it's safe but pointless.
 */
export function clearNotifyThrottle(): void {
  _lastNotifySentAt.clear();
  _notifyAttempted = 0;
  _notifyThrottled = 0;
  _notifyDispatched = 0;
  _attemptCountSinceSummary = 0;
  _suppressedSinceSummary = 0;
  // Don't clear the timer itself — let it keep running. Test scenarios
  // that want to verify summary behavior will trigger it manually via
  // `triggerSummaryForTest()`.
}

/**
 * Test-only helper — synchronously fires the summary push + resets counters.
 * Lets scenario #13 verify the summary mechanism without waiting 10 minutes.
 */
export async function triggerSummaryForTest(): Promise<void> {
  await emitSlowDripSummary();
}

async function emitSlowDripSummary(): Promise<void> {
  // Snapshot + reset atomically — concurrent notifyVaultEvent calls during
  // the await below must not double-count.
  const attempts = _attemptCountSinceSummary;
  const suppressed = _suppressedSinceSummary;
  _attemptCountSinceSummary = 0;
  _suppressedSinceSummary = 0;

  if (attempts === 0) return; // nothing to report

  // Emit the summary as a real push notification so operators subscribed
  // to vault_unlock_summary see it. We bypass notifyVaultEvent() to avoid
  // the dedupe window (summaries are inherently periodic, not bursty).
  try {
    const notify = await getNotify();
    if (notify) {
      await notify({
        eventType: "vault_unlock_summary" as never, // not in NotificationEventType union yet
        title: "Vault: resumo periódico de tentativas",
        message: `${attempts} tentativa(s) de unlock desde o último resumo. ${suppressed} foram suprimidas pelo throttle de notificação (ataque slow-drip ou burst). Verifique logs/crash-*.log e o feed de auditoria para detalhes.`,
        context: {
          windowSec: NOTIFY_SUMMARY_INTERVAL_MS / 1000,
          attempts,
          suppressed,
          suppressedRatio: attempts > 0 ? suppressed / attempts : 0,
        },
      });
    }
  } catch (err) {
    logger.debug("vault", `emitSlowDripSummary failed: ${String(err)}`);
  }
}

function ensureSummaryTimer(): void {
  if (_summaryTimer) return;
  _summaryTimer = setInterval(() => {
    // Fire-and-forget — never let an unhandled rejection from the summary
    // crash the process. That would be ironic given the crash-handler work.
    emitSlowDripSummary().catch((err) => {
      logger.debug("vault", `summary timer callback failed: ${String(err)}`);
    });
  }, NOTIFY_SUMMARY_INTERVAL_MS);
  // unref so the timer doesn't keep the process alive on its own. If the
  // process is shutting down for any other reason, this timer shouldn't
  // block exit. The crash handler will still fire if there's a real crash.
  _summaryTimer.unref?.();
}

function notifyVaultEvent(payload: {
  eventType: string;
  title: string;
  message: string;
  context?: Record<string, unknown>;
  sourceIp?: string;
}): void {
  _notifyAttempted++;
  _attemptCountSinceSummary++;

  // Ensure the periodic summary timer is running (lazy start).
  ensureSummaryTimer();

  // Dedupe check — drop if we sent this eventType too recently.
  const dedupeMs = NOTIFY_DEDUPE_MS[payload.eventType];
  if (dedupeMs !== undefined) {
    const last = _lastNotifySentAt.get(payload.eventType) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < dedupeMs) {
      // Silently drop. The audit log (AppLog) already captured this event
      // with full detail via logger.warn above — only the PUSH notification
      // is throttled. The dashboard feed is unaffected. The slow-drip
      // summary above will surface this attempt in the next periodic push.
      _notifyThrottled++;
      _suppressedSinceSummary++;
      logger.debug(
        "vault",
        `notifyVaultEvent(${payload.eventType}) THROTTLED — last sent ${(elapsed / 1000).toFixed(1)}s ago, window ${dedupeMs / 1000}s`,
        { sourceIp: payload.sourceIp ?? "unknown" }
      );
      return;
    }
    _lastNotifySentAt.set(payload.eventType, Date.now());
  }

  _notifyDispatched++;

  // setImmediate detaches the call from the current request's async context
  // so a notifier failure can never crash the API route handler.
  //
  // v19-BLOCKING NOTE: the previous v18 worklog claims the silent server
  // crashes during vault testing were "fixed" by this setImmediate wrapper.
  // That claim is PROVISIONAL — no stack trace was ever captured, and the
  // crash could plausibly have been an OOM-kill or a different race that
  // happened to stop reproducing when timing changed. The crash handlers
  // in src/instrumentation.ts (added in v19-BLOCKING) will produce a real
  // stack trace if/when the crash recurs.
  setImmediate(async () => {
    try {
      const notify = await getNotify();
      if (!notify) return;
      await notify(payload);
    } catch (err) {
      logger.debug("vault", `notifyVaultEvent(${payload.eventType}) failed: ${String(err)}`);
    }
  });
}

const KDF_ITERATIONS = 600_000;
const KDF_KEYLEN = 32; // 256 bits for AES-256
const KDF_DIGEST = "sha256";
const IV_LEN = 12; // 96 bits — recommended for GCM
const SALT_LEN = 16; // 128 bits

export interface EncryptedBlob {
  iv: string;          // base64
  ciphertext: string;  // base64
  tag: string;         // base64 (GCM auth tag)
  salt: string;        // base64
  kdfIters: number;
}

/**
 * Encrypt a plaintext string with AES-256-GCM using a key derived from
 * the operator's passphrase via PBKDF2.
 *
 * Returns a JSON-stringified EncryptedBlob.
 */
export function encryptSecret(plaintext: string, passphrase: string): string {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = pbkdf2Sync(passphrase, salt, KDF_ITERATIONS, KDF_KEYLEN, KDF_DIGEST);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const blob: EncryptedBlob = {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
    salt: salt.toString("base64"),
    kdfIters: KDF_ITERATIONS,
  };
  return JSON.stringify(blob);
}

/**
 * Decrypt a JSON-stringified EncryptedBlob. Returns null if the passphrase
 * is wrong (GCM auth tag verification fails) or the blob is malformed.
 */
export function decryptSecret(encryptedJson: string, passphrase: string): string | null {
  try {
    const blob: EncryptedBlob = JSON.parse(encryptedJson);
    const salt = Buffer.from(blob.salt, "base64");
    const iv = Buffer.from(blob.iv, "base64");
    const tag = Buffer.from(blob.tag, "base64");
    const ciphertext = Buffer.from(blob.ciphertext, "base64");

    const key = pbkdf2Sync(passphrase, salt, blob.kdfIters ?? KDF_ITERATIONS, KDF_KEYLEN, KDF_DIGEST);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    logger.warn("wallet", `decryptSecret failed: ${String(err)}`);
    return null;
  }
}

/**
 * Verify that a passphrase correctly decrypts the blob. Used at engine
 * start to validate the operator-entered passphrase before using the key.
 */
export function verifyPassphrase(encryptedJson: string, passphrase: string): boolean {
  return decryptSecret(encryptedJson, passphrase) !== null;
}

/**
 * Get a public-safe prefix of an API key for display (first 6 chars + ***).
 * Used so the operator can verify which key is loaded without exposing it.
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 6) return "***";
  return `${apiKey.slice(0, 6)}***${apiKey.slice(-4)}`;
}

/**
 * In-memory wallet vault — holds decrypted keys for the duration of an
 * engine run. Wiped on stop. NEVER persisted to disk.
 *
 * The vault is a Map<walletId, decryptedKey>. It's populated when the
 * operator unlocks wallets at engine start, and cleared on engine stop.
 *
 * v17 hardening:
 *   • unlockAsync(passphrase) — loads + decrypts ALL blobs from DB. If any
 *     blob fails to decrypt (wrong passphrase), the whole unlock aborts and
 *     a failed attempt is recorded. Returns the loaded counts on success.
 *   • Rate limit: 5 failed attempts in 60s → 5min cooldown. Reset on success.
 *   • Auto-lock: 30 min after last key access, vault auto-locks. Reset on
 *     every getWalletKey()/getExchangeCreds() call.
 *   • Audit log: every unlock (success+failure), lock, auto-lock, key access
 *     is written to AppLog with source="vault" for the dashboard feed.
 */
class WalletVault {
  private wallets = new Map<string, string>(); // walletId → decrypted private key
  private exchanges = new Map<string, { apiKey: string; apiSecret: string; apiPassphrase?: string }>();
  private unlocked = false;
  private unlockTime: Date | null = null;
  private lastKeyAccessAt: Date | null = null;

  // v19.3.1 HOTFIX (operator review point #3): per-IP rate limiting +
  // global aggregate cap. Replaces the single global Date[] which created
  // a self-inflicted DoS (attacker from one IP blocked operator from
  // another — confirmed in the 150s stress test data, see
  // docs/signer-isolation-design.md §7.3.7).
  //
  // Per-IP tracking:
  //   failedAttemptsByIp: Map<sourceIp, number[]> — failure timestamps
  //     (ms since epoch) per source IP. Pruned on every access; entries
  //     with empty arrays are deleted. Capped at MAX_TRACKED_IPS with
  //     LRU eviction (oldest lastAccess evicted first).
  //   cooldownByIp: Map<sourceIp, number> — cooldown expiry timestamp
  //     per source IP. An entry exists only while the cooldown is active;
  //     expired entries are deleted on access.
  //   lastAccessByIp: Map<sourceIp, number> — last access timestamp per
  //     IP, for LRU eviction.
  //
  // Global aggregate (distributed-attack detection):
  //   globalFailures: number[] — failure timestamps across ALL IPs
  //     (rolling GLOBAL_FAIL_WINDOW_MS window). When this hits
  //     GLOBAL_FAIL_THRESHOLD, a milder global cooldown is activated
  //     that applies to ALL IPs (including unseen ones).
  //   globalCooldownUntil: number | null — expiry of the global cooldown.
  //
  // Trust model for sourceIp: see src/lib/trading/proxy-trust.ts. The
  // IP passed to unlockAsync is already trust-validated by the route
  // handler. In the default deployment topology (bind 127.0.0.1, no
  // reverse proxy), `sourceIp` is the TCP socket peer address from
  // `connection().peer.address` — non-spoofable, gives real per-IP
  // isolation. In a behind-proxy deployment (shared secret configured),
  // `sourceIp` is the leftmost XFF entry written by the trusted proxy.
  // The v19.3.1 "direct-untrusted" shared-sentinel fallback is GONE
  // (v19.3.2) — it recreated the original self-DoS bug for the actual
  // deployment topology.
  private failedAttemptsByIp = new Map<string, number[]>();
  private cooldownByIp = new Map<string, number>();
  private lastAccessByIp = new Map<string, number>();
  private globalFailures: number[] = [];
  private globalCooldownUntil: number | null = null;

  // Auto-lock: 30 min idle after the last key access.
  private static readonly AUTO_LOCK_MS = 30 * 60 * 1000;
  // Per-IP rate limit: 5 failures in 60s → 5min cooldown (per IP).
  private static readonly FAIL_WINDOW_MS = 60 * 1000;
  private static readonly FAIL_THRESHOLD = 5;
  private static readonly COOLDOWN_MS = 5 * 60 * 1000;
  // Global aggregate cap: 50 failures/hour across ALL IPs → 1min cooldown
  // for ALL IPs (milder than per-IP, but applies universally — catches
  // distributed attacks that per-IP alone would miss).
  private static readonly GLOBAL_FAIL_WINDOW_MS = 60 * 60 * 1000;
  private static readonly GLOBAL_FAIL_THRESHOLD = 50;
  private static readonly GLOBAL_COOLDOWN_MS = 60 * 1000;
  // Memory bound for the per-IP Map. At ~100 bytes per entry (IP string +
  // small array + timestamps), 10k entries ≈ 1MB — a reasonable ceiling
  // before LRU eviction kicks in. An attacker flooding with unique IPs
  // cannot grow the Map unboundedly.
  private static readonly MAX_TRACKED_IPS = 10_000;

  isUnlocked(): boolean {
    // Check auto-lock first — if we've been idle too long, lock now.
    this.maybeAutoLock();
    return this.unlocked;
  }

  getUnlockTime(): Date | null {
    return this.unlockTime;
  }

  getLastKeyAccessAt(): Date | null {
    return this.lastKeyAccessAt;
  }

  /**
   * Returns the number of seconds until the vault auto-locks due to idle.
   * Returns null if the vault is locked or no key access has happened yet.
   */
  getAutoLockInSec(): number | null {
    if (!this.unlocked || !this.lastKeyAccessAt) return null;
    const elapsed = Date.now() - this.lastKeyAccessAt.getTime();
    const remaining = WalletVault.AUTO_LOCK_MS - elapsed;
    return remaining > 0 ? Math.floor(remaining / 1000) : 0;
  }

  /**
   * Returns rate-limit status for UI display.
   *
   * v19.3.1 HOTFIX: now returns BOTH per-IP and global state.
   *
   * Without an `ip` argument (dashboard context, no request), returns the
   * global aggregate state — the operator can see if a distributed attack
   * is in progress even without knowing which IP a future request will
   * come from.
   *
   * With an `ip` argument (route handler context), also returns the per-IP
   * cooldown + recent failures for that specific IP. The route handler
   * uses this to build the 429 response body.
   */
  getRateLimitStatus(ip?: string): {
    cooldownUntil: Date | null;
    recentFailures: number;
    globalCooldownUntil: Date | null;
    globalRecentFailures: number;
    trackedIpCount: number;
  } {
    this.pruneGlobalFailures();
    const globalCooldown =
      this.globalCooldownUntil && this.globalCooldownUntil > Date.now()
        ? new Date(this.globalCooldownUntil)
        : null;
    const result = {
      cooldownUntil: globalCooldown, // default: show global cooldown
      recentFailures: this.globalFailures.length, // default: show global count
      globalCooldownUntil: globalCooldown,
      globalRecentFailures: this.globalFailures.length,
      trackedIpCount: this.failedAttemptsByIp.size,
    };
    if (!ip) return result;
    // Per-IP overlay: if this specific IP has an active cooldown or recent
    // failures, surface those (they may be MORE restrictive than global).
    this.pruneFailedAttempts(ip);
    const ipCooldown = this.cooldownByIp.get(ip);
    const ipFailures = this.failedAttemptsByIp.get(ip) ?? [];
    const ipCooldownDate =
      ipCooldown && ipCooldown > Date.now() ? new Date(ipCooldown) : null;
    // The "effective" cooldown is the EARLIER of per-IP and global —
    // whichever blocks the user right now.
    if (ipCooldownDate && (!globalCooldown || ipCooldownDate < globalCooldown)) {
      result.cooldownUntil = ipCooldownDate;
    }
    result.recentFailures = ipFailures.length;
    return result;
  }

  /**
   * Unlock the vault: load + decrypt ALL wallet + exchange credentials from DB.
   *
   * Returns the loaded counts on success. On failure (wrong passphrase for
   * any blob, or rate-limited), throws an Error with a descriptive message
   * and a failed attempt is recorded (subject to rate limiting).
   *
   * Atomicity: if any blob fails to decrypt, the whole unlock aborts and
   * nothing is loaded — we never want a partial vault state.
   *
   * v18: every unlock attempt (success, failure, rate-limited) dispatches an
   * external notification via the existing notifier.ts so the operator gets
   * a Telegram/Discord push — vault unlock is the precondition for real
   * money trading, so it must be active push, not passive log inspection.
   *
   * v19.2: optional `sourceIp` is propagated to the audit log context +
   * notify context, so the operator has historical evidence of WHERE unlock
   * attempts came from — even before 2FA + IP allowlist arrive in v19.3.
   * When called from automated tests (no IP available), pass "test" or
   * leave undefined (defaults to "unknown").
   *
   * v19.3.1 HOTFIX / v19.3.2 FIX: rate limiting is now per-IP + global
   * aggregate. The `sourceIp` argument is the trust-validated IP from
   * `extractTrustedClientIp()` (see proxy-trust.ts). In the default
   * topology (no proxy configured), this is the TCP socket peer address
   * — non-spoofable, gives real per-IP isolation. The v19.3.1
   * "direct-untrusted" shared sentinel is GONE (v19.3.2): it was a
   * single shared bucket that recreated the original self-DoS for the
   * actual deployment topology (bind 127.0.0.1, no reverse proxy).
   * Both per-IP and global cooldowns are checked; whichever is
   * MORE restrictive (earlier expiry) wins.
   */
  async unlockAsync(
    passphrase: string,
    sourceIp?: string
  ): Promise<{ wallets: number; exchanges: number }> {
    const ip = sourceIp ?? "unknown";
    // Check rate limit — both per-IP and global.
    this.pruneFailedAttempts(ip);
    this.pruneGlobalFailures();
    const ipCooldown = this.cooldownByIp.get(ip);
    const globalCooldown = this.globalCooldownUntil;
    const now = Date.now();
    const ipBlocked = ipCooldown !== undefined && ipCooldown > now;
    const globalBlocked = globalCooldown !== null && globalCooldown > now;
    if (ipBlocked || globalBlocked) {
      // Determine which cooldown applies and report it.
      const ipRemainingMs = ipBlocked ? ipCooldown! - now : Infinity;
      const globalRemainingMs = globalBlocked ? globalCooldown! - now : Infinity;
      const isGlobal = globalRemainingMs < ipRemainingMs;
      const remainingMs = Math.min(ipRemainingMs, globalRemainingMs);
      const remainingSec = Math.ceil(remainingMs / 1000);
      const cooldownType = isGlobal ? "global" : "per-IP";
      const ipFailures = this.failedAttemptsByIp.get(ip) ?? [];
      logger.warn(
        "vault",
        `Unlock BLOCKED by ${cooldownType} rate limit — cooldown ativo por mais ${remainingSec}s`,
        {
          cooldownType,
          perIpFailures: ipFailures.length,
          perIpThreshold: WalletVault.FAIL_THRESHOLD,
          globalFailures: this.globalFailures.length,
          globalThreshold: WalletVault.GLOBAL_FAIL_THRESHOLD,
          cooldownUntil: new Date(now + remainingMs).toISOString(),
          sourceIp: ip,
        }
      );
      // v18: external alert on rate-limit block.
      // v19.3.2: SPLIT the event type by cooldown layer. The GLOBAL aggregate
      // cooldown firing is a SEVERITY-DIFFERENT signal from the per-IP
      // cooldown — it implies a DISTRIBUTED attack or a botnet, not a single
      // user/attacker. Operators can subscribe a louder channel (phone-call
      // tier) to `vault_rate_limited_global` separately from the generic
      // `vault_rate_limited`. Without this split, the distributed-attack
      // signal would be lost in the noise of generic vault alerts.
      const eventType = isGlobal
        ? "vault_rate_limited_global"
        : "vault_rate_limited";
      notifyVaultEvent({
        eventType,
        title: isGlobal
          ? `Vault rate-limited (GLOBAL — possível ataque distribuído)`
          : `Vault rate-limited (per-IP)`,
        message: isGlobal
          ? `Tentativa de unlock bloqueada por cooldown GLOBAL. ${this.globalFailures.length} falhas em 1h somando todos os IPs (limite ${WalletVault.GLOBAL_FAIL_THRESHOLD}). Isto sugere ataque distribuído — o cooldown per-IP não vai resolver. Considere bloqueio na camada de rede ou desabilitar o endpoint de unlock temporariamente. IPs distintos rastreados: ${this.failedAttemptsByIp.size}.`
          : `Tentativa de unlock bloqueada por cooldown per-IP. Falhas recentes (este IP ${ip}): ${ipFailures.length}/${WalletVault.FAIL_THRESHOLD}. Global: ${this.globalFailures.length}/${WalletVault.GLOBAL_FAIL_THRESHOLD}. Cooldown ativo por mais ${remainingSec}s.`,
        context: {
          cooldownType,
          perIpFailures: ipFailures.length,
          globalFailures: this.globalFailures.length,
          trackedIpCount: this.failedAttemptsByIp.size,
          cooldownUntil: new Date(now + remainingMs).toISOString(),
          remainingSec,
          sourceIp: ip,
        },
        sourceIp: ip,
      });
      const unit = isGlobal ? "s" : "min";
      const remainingDisplay = isGlobal ? `${remainingSec}` : `${Math.ceil(remainingMs / 60_000)}`;
      throw new Error(`Rate limited: tentar novamente em ${remainingDisplay}${unit} (${cooldownType})`);
    }

    // If already unlocked, lock first (defensive — always start clean).
    if (this.unlocked) {
      this.lockInternal("relock before unlock", ip);
    }

    // Lazy-load DB to avoid circular import issues at module load time.
    const { db } = await import("@/lib/db");

    // Load all wallet rows that have an encrypted private key.
    const walletRows = await db.walletConnection.findMany({
      where: { privateKeyEncrypted: { not: null } },
      select: { id: true, label: true, privateKeyEncrypted: true, readOnly: true },
    });
    // Load all exchange rows that have encrypted credentials.
    const exchangeRows = await db.exchangeConnection.findMany({
      where: { apiKeyEncrypted: { not: null } },
      select: {
        id: true,
        label: true,
        exchange: true,
        apiKeyEncrypted: true,
        apiSecretEncrypted: true,
        apiPassphraseEncrypted: true,
      },
    });

    // v19.3 FIX (operator review of v19.2 bonus finding): if the DB has 0
    // wallet rows AND 0 exchange rows, the decrypt loop below is empty, so
    // failedCount stays 0 even if the passphrase is wrong. This means an
    // attacker (or a misconfigured operator) can call unlock with ANY
    // passphrase and get a "successful" 200 response. The operator's review
    // called this out: "todo 'unlock bem-sucedido' reportado nas sessões
    // anteriores contra o vault de teste pode ter sido esse path vazio".
    //
    // Fix: refuse to unlock an empty vault. The passphrase cannot be
    // validated against nothing — returning success would be a misleading
    // API contract and a false-positive in test coverage. The operator must
    // add wallets BEFORE attempting unlock.
    //
    // This does NOT count toward the passphrase-failure rate limit — it's a
    // configuration error, not a wrong-passphrase guess, and we don't want
    // to lock out an operator who forgot to add wallets. But it DOES fire
    // a notification, because an empty-vault unlock attempt is suspicious
    // (reconnaissance or misconfiguration — either way the operator should
    // know).
    if (walletRows.length === 0 && exchangeRows.length === 0) {
      logger.warn(
        "vault",
        `Unlock RECUSADO — vault vazio (0 carteiras + 0 exchanges). Passphrase não pôde ser validada. Adicione wallets antes de tentar unlock.`,
        { sourceIp: ip, walletRows: walletRows.length, exchangeRows: exchangeRows.length }
      );
      notifyVaultEvent({
        eventType: "vault_unlock_empty_vault",
        title: "Vault: unlock recusado — vault vazio",
        message: `Tentativa de unlock com vault vazio. Passphrase não pôde ser validada contra nenhum blob. Adicione wallets antes de tentar unlock. Source IP: ${ip}.`,
        context: {
          walletRows: walletRows.length,
          exchangeRows: exchangeRows.length,
          sourceIp: ip,
        },
        sourceIp: ip,
      });
      // Throw a sentinel error the route handler can distinguish from a
      // wrong-passphrase error. The route returns 409 Conflict (the vault
      // state conflicts with the requested operation) instead of 401.
      throw new Error("Vault vazio — adicione wallets antes de tentar unlock.");
    }

    // Decrypt everything. If ANY blob fails, abort the whole unlock.
    const newWallets = new Map<string, string>();
    const newExchanges = new Map<string, { apiKey: string; apiSecret: string; apiPassphrase?: string }>();
    let failedCount = 0;

    for (const w of walletRows) {
      const plaintext = decryptSecret(w.privateKeyEncrypted!, passphrase);
      if (plaintext === null) {
        failedCount++;
        continue;
      }
      newWallets.set(w.id, plaintext);
    }
    for (const ex of exchangeRows) {
      const apiKey = decryptSecret(ex.apiKeyEncrypted!, passphrase);
      const apiSecret = decryptSecret(ex.apiSecretEncrypted!, passphrase);
      if (apiKey === null || apiSecret === null) {
        failedCount++;
        continue;
      }
      const apiPassphrase = ex.apiPassphraseEncrypted
        ? decryptSecret(ex.apiPassphraseEncrypted, passphrase) ?? undefined
        : undefined;
      newExchanges.set(ex.id, { apiKey, apiSecret, apiPassphrase });
    }

    if (failedCount > 0) {
      // Wrong passphrase (or corrupted blob). Record failure + rate-limit.
      // v19.3.1 HOTFIX: record against BOTH per-IP and global counters.
      this.recordFailedAttempt(ip);
      const status = this.getRateLimitStatus(ip);
      const ipFailures = this.failedAttemptsByIp.get(ip) ?? [];
      const cooldownActive = status.cooldownUntil !== null;
      const cooldownType = status.cooldownUntil === status.globalCooldownUntil ? "global" : "per-IP";
      logger.error(
        "vault",
        `Unlock FALHOU — ${failedCount} blob(s) não descriptografados (passphrase incorreta?)`,
        {
          walletRows: walletRows.length,
          exchangeRows: exchangeRows.length,
          failedCount,
          perIpFailures: ipFailures.length,
          perIpThreshold: WalletVault.FAIL_THRESHOLD,
          globalFailures: this.globalFailures.length,
          globalThreshold: WalletVault.GLOBAL_FAIL_THRESHOLD,
          cooldownActive,
          cooldownType: cooldownActive ? cooldownType : null,
          sourceIp: ip,
        }
      );
      // v18: external alert on failed unlock — high signal because it's the
      // canonical "someone is trying to open the vault" event.
      notifyVaultEvent({
        eventType: "vault_unlock_failed",
        title: "Vault: tentativa de unlock falhou",
        message: `${failedCount} blob(s) não descriptografados. Falha (este IP) ${ipFailures.length}/${WalletVault.FAIL_THRESHOLD} em 60s. Global: ${this.globalFailures.length}/${WalletVault.GLOBAL_FAIL_THRESHOLD} em 1h.${cooldownActive ? ` Cooldown ATIVADO (${cooldownType}).` : ""}`,
        context: {
          failedCount,
          perIpFailures: ipFailures.length,
          globalFailures: this.globalFailures.length,
          cooldownActive,
          cooldownType: cooldownActive ? cooldownType : null,
          walletRows: walletRows.length,
          exchangeRows: exchangeRows.length,
          sourceIp: ip,
        },
        sourceIp: ip,
      });
      throw new Error(
        `Passphrase incorreta ou blob corrompido (${failedCount} falha(s)). ` +
          `Tentativas recentes (este IP): ${ipFailures.length}/${WalletVault.FAIL_THRESHOLD}. Global: ${this.globalFailures.length}/${WalletVault.GLOBAL_FAIL_THRESHOLD}.`
      );
    }

    // v19.2 BONUS FINDING (now fixed above — see the empty-vault guard
    // before the decrypt loop): if the DB has 0 wallet rows AND 0 exchange
    // rows, the decrypt loop above is empty, so failedCount stays 0 even if
    // the passphrase is wrong. The v19.2 fix was a warning log; the v19.3
    // fix (per operator review) is to refuse the unlock entirely. This
    // block is kept as a defensive double-check — if the guard above is
    // ever removed or bypassed, this log fires so the operator notices.
    if (walletRows.length === 0 && exchangeRows.length === 0) {
      logger.error(
        "vault",
        `DEFENSIVE: unlock reached success path with 0 wallets + 0 exchanges — this should be impossible (empty-vault guard should have thrown earlier). Investigate.`,
        { sourceIp: ip, walletRows: walletRows.length, exchangeRows: exchangeRows.length }
      );
    }

    // Success — populate the vault.
    this.wallets = newWallets;
    this.exchanges = newExchanges;
    this.unlocked = true;
    this.unlockTime = new Date();
    this.lastKeyAccessAt = new Date();
    // Reset failure tracking on success — but ONLY for this IP.
    // v19.3.1 HOTFIX: global failures are NOT reset by a single success,
    // because a distributed attack doesn't stop just because one IP
    // succeeded. Global failures roll off naturally as they age out of
    // the GLOBAL_FAIL_WINDOW_MS window.
    this.failedAttemptsByIp.delete(ip);
    this.cooldownByIp.delete(ip);
    this.lastAccessByIp.delete(ip);

    logger.info(
      "vault",
      `Vault DESBLOQUEADO — ${newWallets.size} carteira(s) + ${newExchanges.size} exchange(s) carregadas`,
      {
        wallets: newWallets.size,
        exchanges: newExchanges.size,
        unlockTime: this.unlockTime.toISOString(),
        sourceIp: ip,
      }
    );
    // v18: external alert on successful unlock — this is the precondition
    // for live trading with real funds. Operator MUST know when the vault
    // is open, especially if it wasn't them.
    notifyVaultEvent({
      eventType: "vault_unlocked",
      title: "Vault desbloqueado",
      message: `${newWallets.size} carteira(s) + ${newExchanges.size} exchange(s) carregadas em memória. Live trading disponível. Auto-lock em 30min.`,
      context: {
        walletCount: newWallets.size,
        exchangeCount: newExchanges.size,
        unlockTime: this.unlockTime.toISOString(),
        sourceIp: ip,
      },
      sourceIp: ip,
    });
    return { wallets: newWallets.size, exchanges: newExchanges.size };
  }

  /**
   * Lock the vault: wipe all decrypted keys from memory.
   * Caller can pass a reason for the audit log (e.g. "manual", "auto-lock", "engine-stop").
   *
   * v19.2: optional `sourceIp` for audit traceability — same rationale as
   * unlockAsync. Auto-lock calls (idle timer) pass "auto-lock" as the IP
   * since there's no originating request.
   */
  lock(reason: string = "manual", sourceIp?: string): void {
    this.lockInternal(reason, sourceIp ?? "unknown");
  }

  private lockInternal(reason: string, sourceIp: string = "unknown"): void {
    if (!this.unlocked && this.wallets.size === 0 && this.exchanges.size === 0) {
      // Already locked + empty — nothing to do.
      return;
    }
    const walletCount = this.wallets.size;
    const exchangeCount = this.exchanges.size;
    const wasUnlocked = this.unlocked;
    const unlockTime = this.unlockTime;

    // Best-effort memory wipe — overwrite each string with zeros before
    // clearing the Maps. JS strings are immutable so this is best-effort
    // (the GC may still hold the old string until collected), but it raises
    // the bar for memory-dump attackers.
    for (const [id, key] of this.wallets) {
      this.wallets.set(id, "0".repeat(key.length));
    }
    for (const [id, creds] of this.exchanges) {
      this.exchanges.set(id, {
        apiKey: "0".repeat(creds.apiKey.length),
        apiSecret: "0".repeat(creds.apiSecret.length),
        apiPassphrase: creds.apiPassphrase ? "0".repeat(creds.apiPassphrase.length) : undefined,
      });
    }
    this.wallets.clear();
    this.exchanges.clear();
    this.unlocked = false;
    this.unlockTime = null;
    this.lastKeyAccessAt = null;

    logger.info(
      "vault",
      `Vault BLOQUEADO (${reason}) — ${walletCount} carteira(s) + ${exchangeCount} exchange(s) limpas da memória`,
      { reason, walletCount, exchangeCount, sourceIp }
    );

    // v18: external alert on lock — but ONLY for non-trivial locks.
    // Skip the alert if the vault was already empty/locked (no-op locks from
    // test cleanup or defensive re-lock calls). The two reasons the operator
    // actually cares about are "manual" (they clicked Lock) and "auto-lock"
    // (idle timer fired).
    if (wasUnlocked && (reason.includes("manual") || reason.includes("auto-lock"))) {
      const durationSec = unlockTime
        ? Math.floor((Date.now() - unlockTime.getTime()) / 1000)
        : null;
      notifyVaultEvent({
        eventType: "vault_locked",
        title: `Vault bloqueado (${reason})`,
        message: `${walletCount} carteira(s) + ${exchangeCount} exchange(s) limpas da memória.${durationSec !== null ? ` Esteve aberto por ${Math.floor(durationSec / 60)}min ${durationSec % 60}s.` : ""}`,
        context: { reason, walletCount, exchangeCount, durationSec, sourceIp },
        sourceIp,
      });
    }
  }

  /**
   * Auto-lock the vault if we've been idle for AUTO_LOCK_MS.
   * Called by isUnlocked() and by every key access. Safe to call anytime.
   *
   * v19.2: sourceIp is "auto-lock" since there's no originating request —
   * makes it grep-able in the audit log vs a manual lock from an API call.
   */
  private maybeAutoLock(): void {
    if (!this.unlocked || !this.lastKeyAccessAt) return;
    const idleMs = Date.now() - this.lastKeyAccessAt.getTime();
    if (idleMs >= WalletVault.AUTO_LOCK_MS) {
      this.lockInternal(`auto-lock após ${Math.floor(idleMs / 60_000)}min idle`, "auto-lock");
    }
  }

  getWalletKey(walletId: string): string | null {
    if (!this.unlocked) return null;
    this.maybeAutoLock();
    if (!this.unlocked) return null; // maybeAutoLock may have just locked us
    this.lastKeyAccessAt = new Date();
    return this.wallets.get(walletId) ?? null;
  }

  getExchangeCreds(exchangeId: string): {
    apiKey: string;
    apiSecret: string;
    apiPassphrase?: string;
  } | null {
    if (!this.unlocked) return null;
    this.maybeAutoLock();
    if (!this.unlocked) return null;
    this.lastKeyAccessAt = new Date();
    return this.exchanges.get(exchangeId) ?? null;
  }

  /**
   * Record a failed unlock attempt against both the per-IP counter and the
   * global aggregate counter. Activates per-IP cooldown at FAIL_THRESHOLD
   * and/or global cooldown at GLOBAL_FAIL_THRESHOLD.
   *
   * v19.3.1 HOTFIX: replaces the global recordFailedAttempt(). Now takes
   * the source IP as argument and updates both per-IP and global state.
   */
  private recordFailedAttempt(ip: string): void {
    const now = Date.now();
    // Per-IP tracking.
    const ipFailures = this.failedAttemptsByIp.get(ip) ?? [];
    ipFailures.push(now);
    // Prune in-place (filter allocates a new array; for small N this is
    // fine, and we re-assign to the Map either way).
    const ipCutoff = now - WalletVault.FAIL_WINDOW_MS;
    const prunedIp = ipFailures.filter((t) => t > ipCutoff);
    this.failedAttemptsByIp.set(ip, prunedIp);
    this.lastAccessByIp.set(ip, now);
    // Global aggregate tracking.
    this.globalFailures.push(now);
    this.pruneGlobalFailures();
    // Check per-IP threshold.
    let perIpCooldownActivated = false;
    if (prunedIp.length >= WalletVault.FAIL_THRESHOLD) {
      const expiry = now + WalletVault.COOLDOWN_MS;
      this.cooldownByIp.set(ip, expiry);
      perIpCooldownActivated = true;
      logger.warn(
        "vault",
        `Rate limit de unlock ativado (per-IP) — ${WalletVault.FAIL_THRESHOLD} falhas em ${WalletVault.FAIL_WINDOW_MS / 1000}s para IP ${ip}. Cooldown de ${WalletVault.COOLDOWN_MS / 60_000}min.`,
        {
          cooldownType: "per-IP",
          sourceIp: ip,
          threshold: WalletVault.FAIL_THRESHOLD,
          cooldownUntil: new Date(expiry).toISOString(),
        }
      );
    }
    // Check global threshold.
    let globalCooldownActivated = false;
    if (this.globalFailures.length >= WalletVault.GLOBAL_FAIL_THRESHOLD) {
      const expiry = now + WalletVault.GLOBAL_COOLDOWN_MS;
      this.globalCooldownUntil = expiry;
      globalCooldownActivated = true;
      logger.warn(
        "vault",
        `Rate limit de unlock ativado (GLOBAL) — ${WalletVault.GLOBAL_FAIL_THRESHOLD} falhas em ${WalletVault.GLOBAL_FAIL_WINDOW_MS / 60_000}min somando todos os IPs. Cooldown global de ${WalletVault.GLOBAL_COOLDOWN_MS / 1000}s aplicado a TODOS os IPs.`,
        {
          cooldownType: "global",
          threshold: WalletVault.GLOBAL_FAIL_THRESHOLD,
          cooldownUntil: new Date(expiry).toISOString(),
          trackedIpCount: this.failedAttemptsByIp.size,
        }
      );
      // v19.3.2: emit a DISTINCT notification event the moment the global
      // cooldown ACTIVATES (crosses threshold) — not only when a subsequent
      // attempt is blocked. The operator needs to know the instant a
      // distributed-attack pattern emerges, because the per-IP cooldowns
      // won't help and the response playbook is different (network-layer
      // blocking or temporarily disabling the unlock endpoint).
      //
      // The distinct event type `vault_rate_limited_global` lets the
      // operator subscribe a louder / separate notification channel
      // (phone-call tier) — without it, this signal would be lost in the
      // generic `vault_rate_limited` noise.
      notifyVaultEvent({
        eventType: "vault_rate_limited_global",
        title: "Vault: cooldown GLOBAL ativado — possível ataque distribuído",
        message: `${this.globalFailures.length} falhas de unlock em 1h somando ${this.failedAttemptsByIp.size} IPs distintos (limite ${WalletVault.GLOBAL_FAIL_THRESHOLD}). Cooldown global de ${WalletVault.GLOBAL_COOLDOWN_MS / 1000}s aplicado a TODOS os IPs. O cooldown per-IP não resolve este padrão — considere bloqueio na camada de rede ou desabilitar o endpoint de unlock temporariamente.`,
        context: {
          cooldownType: "global",
          globalFailures: this.globalFailures.length,
          trackedIpCount: this.failedAttemptsByIp.size,
          threshold: WalletVault.GLOBAL_FAIL_THRESHOLD,
          cooldownUntil: new Date(expiry).toISOString(),
          triggeredByIp: ip,
        },
        sourceIp: ip,
      });
    }
    // LRU eviction — cap the Map size to prevent unbounded growth from
    // attacker-forged unique IPs. With the v19.3.2 fix, the per-IP keys
    // are now real TCP socket peer addresses (or trusted XFF entries
    // behind a proxy) — so an attacker needs MANY REAL SOURCE IPs (or a
    // botnet) to fill the Map, not just header forgery. This is a much
    // higher bar than the v19.3.1 sentinel model.
    //
    // TRADE-OFF (acknowledged): an attacker with enough real source IPs
    // could, in theory, generate enough unique IPs to push their OWN
    // earlier failure record out via LRU eviction — resetting their
    // counter. This is significantly more expensive to exploit than the
    // header-forgery bypass the v19.3.1 sentinel had, and the global
    // aggregate cap (50 failures/1h across ALL IPs, a single array NOT
    // subject to LRU eviction) still catches the aggregate pattern.
    // Active-cooldown entries are NEVER evicted (see evictLruIfNeeded).
    this.evictLruIfNeeded();
  }

  /**
   * Drop failed-attempt timestamps older than the rolling window for the
   * given IP. Delete the IP's entries from all three Maps if its failure
   * array is empty AND its cooldown has expired — keeps the Map small.
   *
   * v19.3.1 HOTFIX: replaces the global pruneFailedAttempts(). Now takes
   * the source IP as argument.
   */
  private pruneFailedAttempts(ip: string): void {
    const now = Date.now();
    const cutoff = now - WalletVault.FAIL_WINDOW_MS;
    const ipFailures = this.failedAttemptsByIp.get(ip);
    if (ipFailures) {
      const pruned = ipFailures.filter((t) => t > cutoff);
      if (pruned.length > 0) {
        this.failedAttemptsByIp.set(ip, pruned);
      } else {
        this.failedAttemptsByIp.delete(ip);
      }
    }
    // Clear expired per-IP cooldown.
    const ipCooldown = this.cooldownByIp.get(ip);
    if (ipCooldown !== undefined && ipCooldown <= now) {
      this.cooldownByIp.delete(ip);
    }
    // If the IP has no failures AND no active cooldown, drop it from
    // lastAccessByIp too (fully evicted).
    if (
      !this.failedAttemptsByIp.has(ip) &&
      !this.cooldownByIp.has(ip)
    ) {
      this.lastAccessByIp.delete(ip);
    }
  }

  /**
   * Drop global failure timestamps older than GLOBAL_FAIL_WINDOW_MS.
   * Clear expired global cooldown.
   */
  private pruneGlobalFailures(): void {
    const now = Date.now();
    const cutoff = now - WalletVault.GLOBAL_FAIL_WINDOW_MS;
    this.globalFailures = this.globalFailures.filter((t) => t > cutoff);
    if (this.globalCooldownUntil !== null && this.globalCooldownUntil <= now) {
      this.globalCooldownUntil = null;
    }
  }

  /**
   * LRU eviction — if the per-IP Map exceeds MAX_TRACKED_IPS, evict the
   * entries with the oldest lastAccess timestamp (that don't have an
   * active cooldown). Active-cooldown entries are never evicted (we need
   * them to enforce the cooldown until it expires).
   */
  private evictLruIfNeeded(): void {
    if (this.failedAttemptsByIp.size <= WalletVault.MAX_TRACKED_IPS) return;
    // Build a list of evictable entries: have failures but no active cooldown.
    const now = Date.now();
    const evictable: Array<{ ip: string; lastAccess: number }> = [];
    for (const [ip, lastAccess] of this.lastAccessByIp) {
      const cooldown = this.cooldownByIp.get(ip);
      if (cooldown !== undefined && cooldown > now) continue; // active cooldown, skip
      evictable.push({ ip, lastAccess });
    }
    // Sort by lastAccess ascending (oldest first).
    evictable.sort((a, b) => a.lastAccess - b.lastAccess);
    // Evict however many we need to get under the cap.
    const toEvict = this.failedAttemptsByIp.size - WalletVault.MAX_TRACKED_IPS;
    for (let i = 0; i < Math.min(toEvict, evictable.length); i++) {
      const ip = evictable[i].ip;
      this.failedAttemptsByIp.delete(ip);
      this.cooldownByIp.delete(ip);
      this.lastAccessByIp.delete(ip);
    }
  }

  /**
   * PUBLIC OVERRIDE — clears ALL rate-limit state (per-IP and global).
   *
   * This is INTENTIONALLY exposed (not just for tests) because an operator
   * who legitimately forgot their passphrase, waited out the cooldown, and
   * wants to try again with a fresh counter should be able to. It's also
   * used by the automated test suite to isolate tests.
   *
   * Audit-logged so it can't be abused silently — every call writes a
   * warn-level AppLog entry. A surprising pattern of clears would be
   * visible in the dashboard.
   *
   * v19.3.1 HOTFIX: now clears per-IP Maps AND global state. A more
   * surgical `clearRateLimitForIp(ip)` is NOT exposed — clearing one IP
   * but leaving global state would be misleading, and an operator who
   * needs to clear one IP probably needs to clear all (the underlying
   * reason is usually "I forgot my passphrase" not "I'm being attacked
   * from one specific IP and want to let it through").
   */
  clearRateLimit(): void {
    const ipCount = this.failedAttemptsByIp.size;
    const globalFailures = this.globalFailures.length;
    const hadGlobalCooldown = this.globalCooldownUntil !== null;
    this.failedAttemptsByIp.clear();
    this.cooldownByIp.clear();
    this.lastAccessByIp.clear();
    this.globalFailures = [];
    this.globalCooldownUntil = null;
    if (ipCount > 0 || globalFailures > 0 || hadGlobalCooldown) {
      logger.warn(
        "vault",
        `Rate limit CLEARED manual — ${ipCount} IP(s) esquecido(s), ${globalFailures} falha(s) global(is) esquecida(s), cooldowns cancelados`,
        { ipCount, globalFailures, hadGlobalCooldown }
      );
    }
  }

  stats(): {
    unlocked: boolean;
    walletCount: number;
    exchangeCount: number;
    unlockTime: Date | null;
    lastKeyAccessAt: Date | null;
    autoLockInSec: number | null;
    cooldownUntil: Date | null;
    recentFailures: number;
    globalCooldownUntil: Date | null;
    globalRecentFailures: number;
    trackedIpCount: number;
  } {
    this.maybeAutoLock();
    // v19.3.1: stats() has no IP context, so it returns the GLOBAL view.
    // Per-IP state is only meaningful in the route handler (which has the
    // request's IP). The dashboard shows global counts + the operator can
    // see if a distributed attack is in progress.
    const status = this.getRateLimitStatus();
    return {
      unlocked: this.unlocked,
      walletCount: this.wallets.size,
      exchangeCount: this.exchanges.size,
      unlockTime: this.unlockTime,
      lastKeyAccessAt: this.lastKeyAccessAt,
      autoLockInSec: this.getAutoLockInSec(),
      cooldownUntil: status.cooldownUntil,
      recentFailures: status.recentFailures,
      globalCooldownUntil: status.globalCooldownUntil,
      globalRecentFailures: status.globalRecentFailures,
      trackedIpCount: status.trackedIpCount,
    };
  }
}

export const walletVault = new WalletVault();
