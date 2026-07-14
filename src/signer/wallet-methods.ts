// src/signer/wallet-methods.ts
//
// Phase 1 (M2.3): Wallet RPC handlers for the signer process.
//
// This module wires the 5 wallet methods (unlock, lock, getVaultStatus,
// clearRateLimit, getRateLimitStatus) to the existing WalletVault instance
// from src/lib/trading/wallet-crypto.ts. The dispatcher in main.ts calls
// `handleWalletMethod` for any allowlisted wallet method.
//
// CONTRACT (from signer-protocol.ts MethodHandler):
//   - Application errors (wrong passphrase, rate limited, vault locked,
//     empty vault) are RETURNED as `{ ok: false, ... }` objects. The
//     dispatcher never sees them.
//   - UNEXPECTED exceptions (TypeError, OOM, DB connection lost) PROPAGATE
//     out of the handler. The dispatcher never catches them — they reach
//     Node's `uncaughtException` handler → crash-logger.ts writes the
//     stack → process exits + restarts.
//
// The distinction: "the operator typed the wrong passphrase" is a normal
// application error (return -32000); "the vault's Map access threw a
// TypeError" is a bug (let it propagate).
//
// All handlers are ASYNC because they may touch the DB (wallet-crypto.ts
// uses `await import("@/lib/db")` lazily to avoid circular imports).

import { walletVault } from "@/lib/trading/wallet-crypto";
import type { MethodHandlerResult } from "@/lib/signer-protocol";

// ---------------------------------------------------------------------------
// Helper: serialize Date | null → ISO string | null
// ---------------------------------------------------------------------------

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

// ---------------------------------------------------------------------------
// Wallet handlers
// ---------------------------------------------------------------------------

/**
 * `unlock` — decrypt all wallet/exchange blobs with the given passphrase.
 *
 * Returns the count of wallets + exchanges that were successfully decrypted
 * and loaded into the in-memory vault. If ANY blob fails to decrypt, the
 * whole unlock aborts (atomicity — wallet-crypto.ts handles this internally
 * and throws nothing; it returns a failure count instead).
 *
 * Application errors returned as `{ ok: false, ... }`:
 *   - -32007 RATE_LIMITED: per-IP or global cooldown is active.
 *   - -32000 EMPTY_VAULT: 0 wallets + 0 exchanges in DB (can't validate
 *     passphrase against nothing).
 *   - -32000 WRONG_PASSPHRASE: at least one blob failed to decrypt.
 *
 * Unexpected exceptions (DB connection lost, etc.) propagate.
 */
async function handleUnlock(params: unknown): Promise<MethodHandlerResult> {
  if (
    typeof params !== "object" ||
    params === null ||
    Array.isArray(params)
  ) {
    return {
      ok: false,
      code: -32602, // INVALID_PARAMS
      message: "unlock params must be an object",
    };
  }
  const p = params as { passphrase?: unknown; sourceIp?: unknown };
  if (typeof p.passphrase !== "string" || p.passphrase.length === 0) {
    return {
      ok: false,
      code: -32602,
      message: "unlock params.passphrase must be a non-empty string",
    };
  }
  if (typeof p.sourceIp !== "string") {
    return {
      ok: false,
      code: -32602,
      message: "unlock params.sourceIp must be a string",
    };
  }

  // walletVault.unlockAsync returns { wallets, exchanges } on success,
  // or throws a typed error on rate-limit / empty-vault / wrong-passphrase.
  // We catch the EXPECTED application errors here and convert them to
  // `{ ok: false, ... }`. Unexpected errors propagate.
  //
  // The error messages from wallet-crypto.ts (verified against the source):
  //   - Rate-limited:  "Rate limited: tentar novamente em Ns (per-IP|global)"
  //   - Empty vault:   "Vault vazio — adicione wallets antes de tentar unlock."
  //   - Wrong pass:    "Passphrase incorreta ou blob corrompido (N falha(s))..."
  //
  // We use case-insensitive substring matching for robustness against
  // minor wording changes. Anything that doesn't match these three
  // known application errors is treated as an unexpected exception and
  // PROPAGATES (so crash-logger captures the stack).
  try {
    const result = await walletVault.unlockAsync(p.passphrase, p.sourceIp);
    return {
      ok: true,
      result: {
        unlocked: true,
        walletCount: result.wallets,
        exchangeCount: result.exchanges,
        unlockTime: new Date().toISOString(),
      },
    };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (msg.startsWith("rate limited")) {
      return {
        ok: false,
        code: -32007, // RATE_LIMITED
        message: err instanceof Error ? err.message : String(err),
        data: { sourceIp: p.sourceIp },
      };
    }
    if (msg.includes("vault vazio") || msg.includes("vault empty")) {
      return {
        ok: false,
        code: -32000,
        message: "Vault is empty — add wallets before attempting unlock",
      };
    }
    if (msg.includes("passphrase incorreta") || msg.includes("blob corrompido")) {
      return {
        ok: false,
        code: -32000,
        message: "Wrong passphrase — at least one blob failed to decrypt",
        data: { sourceIp: p.sourceIp },
      };
    }
    // Unknown error from unlockAsync — could be a bug. Propagate so
    // crash-logger captures the stack.
    throw err;
  }
}

/**
 * `lock` — wipe the in-memory decrypted keys and return the vault to locked
 * state. Always succeeds (even if already locked).
 *
 * Unexpected exceptions propagate.
 */
function handleLock(params: unknown): MethodHandlerResult {
  if (
    typeof params !== "object" ||
    params === null ||
    Array.isArray(params)
  ) {
    return {
      ok: false,
      code: -32602,
      message: "lock params must be an object",
    };
  }
  const p = params as { reason?: unknown; sourceIp?: unknown };
  const reason = typeof p.reason === "string" ? p.reason : "manual";
  const sourceIp = typeof p.sourceIp === "string" ? p.sourceIp : "unknown";

  walletVault.lock(reason, sourceIp);
  return {
    ok: true,
    result: { unlocked: false },
  };
}

/**
 * `getVaultStatus` — return the current vault state. Read-only, no params.
 *
 * The Date fields are serialized to ISO 8601 strings (JSON has no Date type).
 * Mirrors the shape returned by `walletVault.stats()` in wallet-crypto.ts.
 */
function handleGetVaultStatus(): MethodHandlerResult {
  const s = walletVault.stats();
  return {
    ok: true,
    result: {
      unlocked: s.unlocked,
      walletCount: s.walletCount,
      exchangeCount: s.exchangeCount,
      unlockTime: iso(s.unlockTime),
      lastKeyAccessAt: iso(s.lastKeyAccessAt),
      autoLockInSec: s.autoLockInSec,
      cooldownUntil: iso(s.cooldownUntil),
      recentFailures: s.recentFailures,
      globalCooldownUntil: iso(s.globalCooldownUntil),
      globalRecentFailures: s.globalRecentFailures,
      trackedIpCount: s.trackedIpCount,
    },
  };
}

/**
 * `clearRateLimit` — operator-only operation. Clears the per-IP rate-limit
 * state for a specific IP (or all IPs if `ip === "*"`).
 *
 * SECURITY: in M2 we rely on the Unix socket's 0600 permissions (only the
 * same user can connect). A future hardening (M3 or later) may add an
 * operator-auth token to this RPC.
 */
function handleClearRateLimit(params: unknown): MethodHandlerResult {
  if (
    typeof params !== "object" ||
    params === null ||
    Array.isArray(params)
  ) {
    return {
      ok: false,
      code: -32602,
      message: "clearRateLimit params must be an object",
    };
  }
  const p = params as { ip?: unknown };
  if (typeof p.ip !== "string") {
    return {
      ok: false,
      code: -32602,
      message: "clearRateLimit params.ip must be a string",
    };
  }

  // walletVault.clearRateLimit() clears ALL IPs (no per-IP variant exists
  // in M2). For the RPC, we accept a specific IP for forward-compatibility
  // but currently clear all. The audit log entry records the requested IP.
  const before = walletVault.stats();
  walletVault.clearRateLimit();
  const after = walletVault.stats();
  return {
    ok: true,
    result: {
      cleared: before.trackedIpCount,
      trackedIpCountAfter: after.trackedIpCount,
    },
  };
}

/**
 * `getRateLimitStatus` — return the rate-limit state for a specific IP.
 */
function handleGetRateLimitStatus(params: unknown): MethodHandlerResult {
  if (
    typeof params !== "object" ||
    params === null ||
    Array.isArray(params)
  ) {
    return {
      ok: false,
      code: -32602,
      message: "getRateLimitStatus params must be an object",
    };
  }
  const p = params as { ip?: unknown };
  if (typeof p.ip !== "string") {
    return {
      ok: false,
      code: -32602,
      message: "getRateLimitStatus params.ip must be a string",
    };
  }

  const s = walletVault.getRateLimitStatus(p.ip);
  const global = walletVault.stats();
  return {
    ok: true,
    result: {
      ip: p.ip,
      recentFailures: s.recentFailures,
      cooldownUntil: iso(s.cooldownUntil),
      globalRecentFailures: global.globalRecentFailures,
      globalCooldownUntil: iso(global.globalCooldownUntil),
      trackedIpCount: global.trackedIpCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch a wallet RPC to the appropriate handler.
 *
 * The `method` parameter is assumed to be in SIGNER_METHOD_ALLOWLIST (the
 * caller — `dispatchRpc` in main.ts — verifies this before calling).
 *
 * Returns the handler's result object. If the handler THROWS, the exception
 * propagates out of this function — the caller (dispatcher) MUST NOT catch
 * it (see LAYER 2 discipline in main.ts).
 */
export async function handleWalletMethod(
  method: string,
  params: unknown
): Promise<MethodHandlerResult> {
  switch (method) {
    case "unlock":
      return await handleUnlock(params);
    case "lock":
      return handleLock(params);
    case "getVaultStatus":
      return handleGetVaultStatus();
    case "clearRateLimit":
      return handleClearRateLimit(params);
    case "getRateLimitStatus":
      return handleGetRateLimitStatus(params);
    default:
      // Should never happen — the caller verified the method is in the
      // allowlist. If it does, it's a programming error; throw so
      // crash-logger captures it.
      throw new Error(
        `handleWalletMethod called with non-wallet method "${method}" — dispatcher routing bug`
      );
  }
}

/**
 * Check if a method name is one of the wallet methods handled by this module.
 */
export function isWalletMethod(method: string): boolean {
  return (
    method === "unlock" ||
    method === "lock" ||
    method === "getVaultStatus" ||
    method === "clearRateLimit" ||
    method === "getRateLimitStatus"
  );
}

/**
 * Inspect the vault state — used by the `__test_inspect_vault` test hook
 * in main.ts to verify the vault state without exposing the walletVault
 * instance directly.
 *
 * SECURITY: this function is only called when SIGNER_TEST_HOOKS=1 is set
 * at boot time. It is read-only — it does not modify the vault state.
 */
export function inspectVaultForTest(): {
  unlocked: boolean;
  walletCount: number;
  exchangeCount: number;
} {
  const s = walletVault.stats();
  return {
    unlocked: s.unlocked,
    walletCount: s.walletCount,
    exchangeCount: s.exchangeCount,
  };
}

/**
 * Zeroize the vault — called from the parent-disconnect handler in main.ts
 * before the signer exits. Wipes all in-memory decrypted keys.
 *
 * Writes an audit entry to the SIGNER_AUDIT_LOG file (if set) so post-mortem
 * review can confirm zeroization happened.
 */
export function zeroizeVaultForDisconnect(auditLogPath?: string): {
  walletsWiped: number;
  exchangesWiped: number;
} {
  const before = walletVault.stats();
  const walletCount = before.walletCount;
  const exchangeCount = before.exchangeCount;
  const wasUnlocked = before.unlocked;

  // walletVault.lock() wipes the in-memory Maps.
  walletVault.lock("parent-disconnect", "internal");

  const after = walletVault.stats();

  // Write audit entry if path is set.
  if (auditLogPath) {
    try {
      const { appendFileSync } = require("node:fs");
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "vault_zeroized_on_disconnect",
        wasUnlocked,
        walletsWiped: walletCount,
        exchangesWiped: exchangeCount,
        unlockedAfter: after.unlocked,
        pid: process.pid,
      }) + "\n";
      appendFileSync(auditLogPath, entry);
    } catch {
      // Best-effort — the zeroization itself already happened.
    }
  }

  return {
    walletsWiped: walletCount,
    exchangesWiped: exchangeCount,
  };
}
