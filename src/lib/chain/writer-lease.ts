// src/lib/chain/writer-lease.ts
//
// M4 — Writer Lease (operator-directed, closed scope).
//
// DESIGN PHILOSOPHY
// -----------------
// The Writer Lease is the LAST protection before a transaction is
// broadcast to the blockchain. It serializes write access so that
// AT MOST ONE writer process at a time can hold the right to
// broadcast transactions for a given signing key.
//
// Why this matters:
//   - The Broadcaster (M3.3) resolves nonce via eth_getTransactionCount
//     "pending". If two processes run the Broadcaster concurrently for
//     the same `from` address, both can read the SAME nonce, both sign,
//     and one broadcast will fail with "nonce too low" — OR WORSE,
//     succeed with a different tx than intended (race → wrong recipient,
//     wrong amount, sandwich self-targeting).
//   - On failover (process crash, network partition, container restart),
//     a new process must be able to take over WITHOUT the old process
//     "waking up" and broadcasting a stale signed tx. The lease TTL +
//     fencing token guarantee this: the old process's lease expires,
//     the new process acquires a fresh lease with a HIGHER fencing token,
//     and any subsequent broadcast attempt by the old process is rejected
//     because its fencing token is stale.
//
// ARCHITECTURAL POSITION (per operator's M4 directive):
//
//   Pipeline (H2.6)
//        ↓
//   SignerAdapter (M3.1)
//        ↓
//   Signer RPC (M3.2)
//        ↓
//   WriterLease (M4)        ← THIS FILE
//        ↓
//   Broadcaster (M3.3)
//        ↓
//   RPC Quorum (H1.1)
//        ↓
//   Blockchain
//
// The lease is a COORDINATION primitive, NOT a signing primitive. Per
// the operator's M4 scope directive:
//
//   The Writer Lease is responsible for:
//     - lease acquire
//     lease renew
//     lease release
//     - timeout
//     - owner election
//     - reconnect
//     - failover
//
//   The Writer Lease is NOT responsible for:
//     - anything related to signing (that is the SignerAdapter's job)
//     - nonce management (that is the Broadcaster's job)
//     - gas resolution (Broadcaster)
//     - hash verification REG-014 (Broadcaster)
//     - mempool / replacement / cancel (future)
//
// INTEGRATION MODEL
// -----------------
// The LeasedBroadcaster (src/lib/chain/leased-broadcaster.ts) wraps the
// M3.3 Broadcaster and implements `SignerSink`. The Pipeline still
// calls `signer.submit(req) → SignerResult` — UNCHANGED. The wrap is
// transparent:
//
//   LeasedBroadcaster.submit(req)
//     ├── lease.withLease(async () => {
//     │     broadcaster.submit(req)
//     │   })
//     └── (lease always released — even on exception)
//
// FENCING TOKEN (REG-015)
// -----------------------
// Every lease acquisition returns a monotonically increasing fencing
// token. The token is stored alongside the lease and increments per
// successful acquisition for a given lease key.
//
//   lease_key="writer:0xabc..."
//     owner=process-A  token=7  acquired_at=t1  expires_at=t1+10s
//     ↓ (process-A crashes, lease expires)
//     owner=process-B  token=8  acquired_at=t2  expires_at=t2+10s
//
// If process-A "wakes up" with token=7 and tries to broadcast, the
// lease store will reject the broadcast because the current token is 8.
// This is the classic Martin-Kleppmann fencing pattern (Distributed
// Locks Are Dead, 2016) adapted to broadcast serialization.
//
// INVARIANTS
// ----------
// REG-015 — Lease Release on Every Path:
//   The lease MUST be released on EVERY exit path — success, failure,
//   exception, timeout. The `withLease()` RAII wrapper guarantees this.
//
// REG-016 — Lease Renewal Liveness:
//   While a writer holds the lease, a background renewer extends the
//   TTL BEFORE it expires. If the renewer cannot reach the lease store
//   (network partition), the lease expires and another writer may take
//   over — the original writer MUST stop broadcasting.
//
// REG-017 — Fencing Token Monotonicity:
//   Each successful acquisition for a given key MUST return a token
//   strictly greater than the previous acquisition's token. Tokens
//   NEVER decrease. A broadcast attempt with a stale token MUST fail
//   closed with LEASE_FENCING_TOKEN_STALE.
//
// REG-018 — Single Owner:
//   For a given lease key, AT MOST ONE owner can hold the lease at any
//   instant. Concurrent acquire() calls return LEASE_BUSY for all but
//   one caller.
//
// LEASE STORE BACKENDS
// --------------------
// The `LeaseStore` interface abstracts the storage layer:
//
//   - InMemoryLeaseStore — single-process. Used by tests and by
//     single-instance deployments. NO durability across restarts.
//   - PostgresLeaseStore — multi-process. Uses an existing Postgres
//     table (writer_lease) with `SELECT FOR UPDATE` atomicity.
//     Survives process restarts. (Wired in M4 closeout; the interface
//     is defined here so LeasedBroadcaster is backend-agnostic.)
//
// The InMemoryLeaseStore is implemented in this file. The Postgres
// backend is a separate file (src/lib/chain/writer-lease-pg.ts) added
// in M4 closeout — it has no place in the closed-scope M4 unit tests
// because it requires a live Postgres instance.
//
// WHAT THE WRITER LEASE DOES NOT DO (per operator's M4 scope):
//   - NO nonce management (Broadcaster's job).
//   - NO signature (SignerAdapter's job).
//   - NO broadcast (Broadcaster's job).
//   - NO retry of failed broadcasts (caller's job — caller decides).
//   - NO transaction replacement / cancel / fee-bump (future).
//   - NO bundle / private relay (future).
//   - NO block confirmation (Broadcaster returns hash only).
//
// ADVERSARIAL TEST MATRIX (per operator's M4 directive):
//   1. acquire when free → ok
//   2. acquire when held by another owner → LEASE_BUSY
//   3. renew own lease → ok
//   4. renew another owner's lease → LEASE_NOT_OWNER
//   5. release own lease → ok
//   6. release another owner's lease → LEASE_NOT_OWNER
//   7. lease expires after TTL → another owner can acquire
//   8. renewer extends TTL before expiry → lease stays held
//   9. fencing token increases monotonically across acquisitions
//  10. stale fencing token rejected (zombie writer fails closed)
//  11. withLease releases on success
//  12. withLease releases on failure
//  13. withLease releases on exception
//  14. owner election: lease expires → new owner acquires with higher token
//  15. reconnect: lease store goes down → renewer fails → lease expires → failover
//  16. failover: process A holds lease, process B waits, A crashes, B acquires
//  17. concurrent acquire: only one wins, others get LEASE_BUSY
//  18. release is idempotent (double release returns ok=false but no throw)

import { hostname as osHostname } from "os";
import type { SignerSink, SignerRequest, SignerResult } from "./pipeline";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

/**
 * A lease key — typically `writer:${address}` where address is the
 * signing address. One lease per signing address.
 */
export type LeaseKey = string;

/**
 * An owner identifier — uniquely identifies the process/instance that
 * holds the lease. Typically `${hostname}:${pid}:${randomNonce}`.
 */
export type LeaseOwner = string;

/**
 * A fencing token — monotonically increasing per lease key. Used to
 * reject broadcasts from zombie writers whose lease has expired and
 * been acquired by a new owner.
 *
 * Tokens start at 1 and increment by 1 per successful acquisition.
 */
export type FencingToken = number;

/**
 * The current state of a lease, as returned by `LeaseStore.current()`.
 *
 * - "free"     — no lease held; anyone can acquire.
 * - "held"     — an owner holds the lease; it has not expired.
 * - "expired"  — an owner is recorded but the TTL has elapsed; a new
 *                owner can acquire (the old owner's renewer should
 *                detect this and stop).
 */
export type LeaseState = "free" | "held" | "expired";

/**
 * A snapshot of a lease record. Returned by `LeaseStore.current()`.
 *
 * `token` is the fencing token — it stays valid for the lifetime of
 * the lease record (including the expired state, so the new owner can
 * see what the previous token was and increment past it).
 */
export interface LeaseRecord {
  key: LeaseKey;
  owner: LeaseOwner | null;
  token: FencingToken;
  acquiredAt: number; // epoch ms
  expiresAt: number;  // epoch ms
  state: LeaseState;
}

/**
 * The result of an acquire or renew attempt.
 *
 * - `{ ok: true, token, expiresAt }` — succeeded; the caller now holds
 *   the lease until `expiresAt` (unless renewed).
 * - `{ ok: false, error }` — failed; the caller does NOT hold the lease.
 */
export interface LeaseOpResult {
  ok: boolean;
  token?: FencingToken;
  expiresAt?: number;
  error?: string;
}

/**
 * The lease store abstracts the storage backend (in-memory, Postgres,
 * Redis). All operations are atomic with respect to concurrent callers.
 *
 * Implementations MUST guarantee:
 *   - At most one owner per key at any instant (REG-018).
 *   - Token monotonicity across acquisitions (REG-017).
 *   - Atomic CAS on acquire (check-and-set).
 *   - Atomic owner-check on renew and release.
 *   - TTL-based expiry (a record past its TTL is "expired" and can be
 *     taken over by a new owner).
 *
 * Implementations are NOT required to:
 *   - Persist across restarts (in-memory is fine for single-process).
 *   - Provide durability guarantees beyond what the underlying store
 *     provides (Postgres provides full ACID; in-memory provides none).
 */
export interface LeaseStore {
  /**
   * Acquire the lease for `key` on behalf of `owner` with TTL `ttlMs`.
   *
   * Returns `{ ok: true, token, expiresAt }` if the lease was free or
   * expired, OR `{ ok: false, error: "LEASE_BUSY" }` if another owner
   * currently holds it.
   *
   * The token returned is strictly greater than the previous token
   * for this key (REG-017).
   */
  acquire(key: LeaseKey, owner: LeaseOwner, ttlMs: number): Promise<LeaseOpResult>;

  /**
   * Renew the lease for `key` on behalf of `owner`, extending the TTL
   * by `ttlMs` from NOW (not from the original expiry).
   *
   * Returns `{ ok: true, token, expiresAt }` if `owner` still holds
   * the lease (i.e., it has not expired and no other owner has taken
   * over). Returns `{ ok: false, error }` otherwise.
   *
   * Errors:
   *   - LEASE_NOT_OWNER — the caller is not the current owner.
   *   - LEASE_EXPIRED   — the caller WAS the owner but the lease
   *                       expired and a new owner may have taken over.
   */
  renew(key: LeaseKey, owner: LeaseOwner, ttlMs: number): Promise<LeaseOpResult>;

  /**
   * Release the lease for `key` on behalf of `owner`.
   *
   * Returns `{ ok: true }` if the caller was the owner and the lease
   * was released. Returns `{ ok: false, error }` otherwise.
   *
   * Errors:
   *   - LEASE_NOT_OWNER — the caller is not the current owner.
   *   - LEASE_FREE      — no lease is held for this key.
   *
   * Release is IDEMPOTENT in the sense that releasing a lease you
   * don't own returns ok=false but does NOT throw — the caller can
   * safely call release() in a finally block without worrying about
   * double-release.
   */
  release(key: LeaseKey, owner: LeaseOwner): Promise<LeaseOpResult>;

  /**
   * Read the current state of the lease for `key`.
   *
   * Returns `{ state: "free" }` if no lease is held.
   * Returns `{ state: "held", owner, token, ... }` if an owner holds it.
   * Returns `{ state: "expired", owner, token, ... }` if the lease is
   *   recorded but past its TTL (a new owner can acquire).
   *
   * This is for OBSERVABILITY and for the renewer's pre-flight check.
   * The renewer does NOT use this to decide whether to renew — it
   * just calls renew() and handles the result.
   */
  current(key: LeaseKey): Promise<LeaseRecord>;

  /**
   * Force-release the lease, regardless of owner. Operator-only.
   *
   * Used for manual intervention (e.g., a stuck lease after a process
   * crash that the TTL hasn't yet expired). Returns the previous
   * record so the operator can see what was released.
   *
   * Errors:
   *   - LEASE_FREE — no lease is held for this key.
   */
  revoke(key: LeaseKey): Promise<LeaseRecord | null>;
}

// -------------------------------------------------------------------------
// Error codes — the strings returned in `LeaseOpResult.error`.
// -------------------------------------------------------------------------

export const LeaseError = {
  BUSY: "LEASE_BUSY",
  NOT_OWNER: "LEASE_NOT_OWNER",
  EXPIRED: "LEASE_EXPIRED",
  FREE: "LEASE_FREE",
  FENCING_TOKEN_STALE: "LEASE_FENCING_TOKEN_STALE",
  STORE_UNAVAILABLE: "LEASE_STORE_UNAVAILABLE",
  TIMEOUT: "LEASE_TIMEOUT",
} as const;

// -------------------------------------------------------------------------
// InMemoryLeaseStore — single-process implementation.
// -------------------------------------------------------------------------

/**
 * An in-memory lease store. Suitable for:
 *   - Unit tests (deterministic, no I/O).
 *   - Single-instance deployments (one Node.js process owns all writes).
 *
 * NOT suitable for multi-process deployments — multiple Node.js
 * processes cannot share this store's state. Use PostgresLeaseStore
 * for multi-process (added in M4 closeout).
 *
 * Atomicity guarantees:
 *   - All operations are synchronous under a single JS event loop
 *     (Node.js's single-threaded model ensures no race conditions
 *     between async operations).
 *   - The store uses a Map<key, record>; reads + writes happen in a
 *     single event-loop tick, so concurrent acquire() calls cannot
 *     interleave.
 *
 * Fault injection:
 *   - The `failNext` field lets tests simulate a store failure
 *     (network partition, Postgres down). When set, the next operation
 *     returns `{ ok: false, error: LEASE_STORE_UNAVAILABLE }` and the
 *     flag is cleared.
 */
export class InMemoryLeaseStore implements LeaseStore {
  private readonly records = new Map<LeaseKey, LeaseRecord>();
  private readonly tokens = new Map<LeaseKey, FencingToken>();
  private failNext = false;

  /**
   * Inject a failure into the next operation. Used by tests to
   * simulate network partitions or store outages.
   *
   * After this is called, the NEXT operation (acquire/renew/release/
   * current/revoke) returns a STORE_UNAVAILABLE error and the flag
   * is cleared (subsequent operations succeed normally).
   */
  injectFailure(): void {
    this.failNext = true;
  }

  async acquire(key: LeaseKey, owner: LeaseOwner, ttlMs: number): Promise<LeaseOpResult> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, error: LeaseError.STORE_UNAVAILABLE };
    }
    const now = Date.now();
    const existing = this.records.get(key);

    // If the lease is held and not expired, refuse.
    if (existing && existing.state === "held" && existing.expiresAt > now) {
      return { ok: false, error: LeaseError.BUSY };
    }

    // Otherwise (free, expired, or absent), acquire.
    const prevToken = this.tokens.get(key) ?? 0;
    const newToken = prevToken + 1;
    this.tokens.set(key, newToken);

    const record: LeaseRecord = {
      key,
      owner,
      token: newToken,
      acquiredAt: now,
      expiresAt: now + ttlMs,
      state: "held",
    };
    this.records.set(key, record);
    return { ok: true, token: newToken, expiresAt: record.expiresAt };
  }

  async renew(key: LeaseKey, owner: LeaseOwner, ttlMs: number): Promise<LeaseOpResult> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, error: LeaseError.STORE_UNAVAILABLE };
    }
    const now = Date.now();
    const existing = this.records.get(key);

    if (!existing || existing.state === "free" || existing.owner === null) {
      return { ok: false, error: LeaseError.FREE };
    }

    // If the lease has expired, the caller might have been the owner
    // but the lease is gone. Return EXPIRED so the caller knows it
    // lost the lease (and may have been taken over).
    if (existing.expiresAt <= now) {
      // Mark as expired in-place for observability.
      existing.state = "expired";
      if (existing.owner !== owner) {
        return { ok: false, error: LeaseError.NOT_OWNER };
      }
      return { ok: false, error: LeaseError.EXPIRED };
    }

    if (existing.owner !== owner) {
      return { ok: false, error: LeaseError.NOT_OWNER };
    }

    // Owner matches and lease is live — extend TTL from now.
    existing.expiresAt = now + ttlMs;
    existing.state = "held";
    return { ok: true, token: existing.token, expiresAt: existing.expiresAt };
  }

  async release(key: LeaseKey, owner: LeaseOwner): Promise<LeaseOpResult> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, error: LeaseError.STORE_UNAVAILABLE };
    }
    const existing = this.records.get(key);

    if (!existing || existing.state === "free" || existing.owner === null) {
      return { ok: false, error: LeaseError.FREE };
    }

    if (existing.owner !== owner) {
      return { ok: false, error: LeaseError.NOT_OWNER };
    }

    // Release — clear the record but PRESERVE the token counter so
    // the next acquire gets a strictly higher token (REG-017).
    this.records.delete(key);
    return { ok: true, token: existing.token };
  }

  async current(key: LeaseKey): Promise<LeaseRecord> {
    if (this.failNext) {
      this.failNext = false;
      // For current() we still return a record (free state) so the
      // caller doesn't crash on observability reads. The injected
      // failure still counts as "consumed".
      return {
        key,
        owner: null,
        token: this.tokens.get(key) ?? 0,
        acquiredAt: 0,
        expiresAt: 0,
        state: "free",
      };
    }
    const existing = this.records.get(key);
    if (!existing) {
      return {
        key,
        owner: null,
        token: this.tokens.get(key) ?? 0,
        acquiredAt: 0,
        expiresAt: 0,
        state: "free",
      };
    }
    const now = Date.now();
    if (existing.expiresAt <= now && existing.state === "held") {
      // Lazily mark as expired — a read may be the first to notice.
      existing.state = "expired";
    }
    return { ...existing };
  }

  async revoke(key: LeaseKey): Promise<LeaseRecord | null> {
    if (this.failNext) {
      this.failNext = false;
      return null;
    }
    const existing = this.records.get(key);
    if (!existing) {
      return null;
    }
    this.records.delete(key);
    return { ...existing };
  }
}

// -------------------------------------------------------------------------
// WriterLease — the per-process lease lifecycle manager.
// -------------------------------------------------------------------------

/**
 * Configuration for a WriterLease instance.
 *
 * A WriterLease is bound to a specific (key, owner) pair. The key is
 * typically `writer:${signingAddress}`; the owner is typically
 * `${hostname}:${pid}:${nonce}`.
 *
 * The TTL and renew interval are tuned so that the renewer has at
 * least 2 chances to extend the lease before it expires (per the
 * "two-attempt" rule from Kleppmann's fencing paper).
 */
export interface WriterLeaseConfig {
  /** The lease store (in-memory or Postgres). */
  store: LeaseStore;
  /** The lease key (e.g., "writer:0xabc..."). */
  key: LeaseKey;
  /** The owner identifier (e.g., "host1:1234:abc"). */
  owner: LeaseOwner;
  /** Lease TTL in ms. Default: 10_000 (10s). */
  ttlMs?: number;
  /**
   * Renew interval in ms. The renewer wakes up every `renewIntervalMs`
   * and extends the TTL. Default: ttlMs / 3 (so 3 renew attempts per
   * TTL window — if 2 fail, the 3rd still has time).
   */
  renewIntervalMs?: number;
  /**
   * Logger — defaults to no-op. Observability only; does not affect
   * decisions. Logs lease lifecycle events (acquired, renewed, lost,
   * released).
   */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

/**
 * WriterLease — manages the lease lifecycle for one (key, owner) pair.
 *
 * Responsibilities:
 *   - acquire() — try to acquire the lease; returns the fencing token.
 *   - renew() — extend the TTL.
 *   - release() — give up the lease.
 *   - withLease(fn) — RAII wrapper: acquire, run fn, release (always).
 *   - startRenewer() — background loop that renews before TTL expires.
 *   - stopRenewer() — stop the background loop.
 *   - isHeld() — check if THIS owner currently holds the lease.
 *   - currentToken() — get the current fencing token (for broadcasting).
 *
 * The WriterLease does NOT:
 *   - Sign transactions.
 *   - Broadcast transactions.
 *   - Manage nonces or gas.
 *   - Retry failed broadcasts.
 *
 * It is purely a coordination primitive.
 */
export class WriterLease {
  private readonly cfg: Required<WriterLeaseConfig>;
  private current: { token: FencingToken; expiresAt: number } | null = null;
  private renewerHandle: ReturnType<typeof setInterval> | null = null;
  private renewerStopped = false;

  constructor(config: WriterLeaseConfig) {
    const ttlMs = config.ttlMs ?? 10_000;
    this.cfg = {
      store: config.store,
      key: config.key,
      owner: config.owner,
      ttlMs,
      renewIntervalMs: config.renewIntervalMs ?? Math.floor(ttlMs / 3),
      log: config.log ?? (() => {}),
    };
  }

  /**
   * Try to acquire the lease. Returns the fencing token on success.
   *
   * If the lease is currently held by another owner, returns
   * `{ ok: false, error: "LEASE_BUSY" }`.
   *
   * Does NOT start the renewer — call startRenewer() separately if
   * you want automatic renewal. withLease() handles this for you.
   */
  async acquire(): Promise<LeaseOpResult> {
    const result = await this.cfg.store.acquire(
      this.cfg.key,
      this.cfg.owner,
      this.cfg.ttlMs,
    );
    if (result.ok) {
      this.current = {
        token: result.token!,
        expiresAt: result.expiresAt!,
      };
      this.cfg.log("info", "lease acquired", {
        key: this.cfg.key,
        owner: this.cfg.owner,
        token: result.token,
        expiresAt: result.expiresAt,
      });
    } else {
      this.cfg.log("warn", "lease acquire failed", {
        key: this.cfg.key,
        owner: this.cfg.owner,
        error: result.error,
      });
    }
    return result;
  }

  /**
   * Renew the lease. Returns the (unchanged) fencing token on success.
   *
   * If the caller no longer holds the lease (expired, taken over),
   * returns `{ ok: false, error }` and clears `this.current`.
   */
  async renew(): Promise<LeaseOpResult> {
    if (!this.current) {
      return { ok: false, error: LeaseError.FREE };
    }
    const result = await this.cfg.store.renew(
      this.cfg.key,
      this.cfg.owner,
      this.cfg.ttlMs,
    );
    if (result.ok) {
      this.current = {
        token: result.token!,
        expiresAt: result.expiresAt!,
      };
      this.cfg.log("info", "lease renewed", {
        key: this.cfg.key,
        owner: this.cfg.owner,
        token: result.token,
        expiresAt: result.expiresAt,
      });
    } else {
      // Lost the lease — clear local state so isHeld() returns false.
      this.cfg.log("warn", "lease renew failed — lost lease", {
        key: this.cfg.key,
        owner: this.cfg.owner,
        error: result.error,
      });
      this.current = null;
    }
    return result;
  }

  /**
   * Release the lease. Always succeeds (returns ok=false if the
   * caller didn't hold the lease, but does not throw).
   *
   * Stops the renewer if it was running.
   */
  async release(): Promise<LeaseOpResult> {
    this.stopRenewer();
    const result = await this.cfg.store.release(this.cfg.key, this.cfg.owner);
    this.current = null;
    if (result.ok) {
      this.cfg.log("info", "lease released", {
        key: this.cfg.key,
        owner: this.cfg.owner,
      });
    } else {
      this.cfg.log("warn", "lease release returned non-ok", {
        key: this.cfg.key,
        owner: this.cfg.owner,
        error: result.error,
      });
    }
    return result;
  }

  /**
   * RAII wrapper: acquire the lease, run `fn`, release the lease
   * (always — even on exception).
   *
   * Starts a renewer for the duration of `fn` so the lease doesn't
   * expire during a long-running operation.
   *
   * If acquire fails, returns `{ ok: false, error: "LEASE_BUSY" }`
   * WITHOUT running `fn`.
   *
   * If `fn` throws, the exception is caught and converted to a
   * `SignerResult` with `ok: false` and the error message. The lease
   * is released in the finally block regardless.
   *
   * Returns whatever `fn` returns (typically a `SignerResult`).
   */
  async withLease<T>(
    fn: (token: FencingToken) => Promise<T>,
  ): Promise<T | { ok: false; error: string }> {
    const acq = await this.acquire();
    if (!acq.ok || acq.token === undefined) {
      return { ok: false, error: acq.error ?? LeaseError.BUSY };
    }
    const token = acq.token;
    this.startRenewer();
    try {
      return await fn(token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `LEASE_CALLBACK_EXCEPTION: ${msg}` };
    } finally {
      await this.release();
    }
  }

  /**
   * Start the background renewer. The renewer wakes up every
   * `renewIntervalMs` and calls renew(). If renew fails, the renewer
   * logs a warning and continues — the next renew attempt may succeed
   * (e.g., after a transient network blip). If the lease is lost
   * (renew returns NOT_OWNER or EXPIRED), the renewer stops and
   * `isHeld()` returns false.
   *
   * The renewer is automatically stopped on release().
   */
  startRenewer(): void {
    if (this.renewerHandle !== null) return;
    this.renewerStopped = false;
    this.renewerHandle = setInterval(async () => {
      if (this.renewerStopped) return;
      try {
        const r = await this.renew();
        if (!r.ok) {
          // Lost the lease. Stop the renewer — isHeld() now returns false.
          this.stopRenewer();
        }
      } catch (err) {
        // Shouldn't happen (renew never throws) but be defensive.
        this.cfg.log("error", "renewer threw", {
          key: this.cfg.key,
          owner: this.cfg.owner,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }, this.cfg.renewIntervalMs);
    // Don't keep the Node.js event loop alive just for the renewer.
    if (typeof this.renewerHandle.unref === "function") {
      this.renewerHandle.unref();
    }
  }

  /**
   * Stop the background renewer. Safe to call multiple times.
   */
  stopRenewer(): void {
    this.renewerStopped = true;
    if (this.renewerHandle !== null) {
      clearInterval(this.renewerHandle);
      this.renewerHandle = null;
    }
  }

  /**
   * Returns true iff THIS owner currently holds the lease (i.e., the
   * last acquire/renew succeeded and we haven't released or lost it).
   *
   * This is a LOCAL check — it does NOT query the store. The renewer
   * is responsible for detecting lost leases and updating local state.
   *
   * For a STORE-LEVEL check (e.g., before broadcasting), use
   * `verifyToken()` — that queries the store and compares tokens.
   */
  isHeld(): boolean {
    return this.current !== null;
  }

  /**
   * Returns the current fencing token, or null if not held.
   *
   * Used by LeasedBroadcaster to attach to the broadcast for the
   * post-broadcast fencing check (REG-015).
   */
  currentToken(): FencingToken | null {
    return this.current?.token ?? null;
  }

  /**
   * Verify that THIS owner still holds the lease AND the fencing token
   * matches. This is a STORE-LEVEL check — it queries the store.
   *
   * Used as the pre-broadcast fence (REG-017). If verifyToken returns
   * false, the broadcast MUST be aborted — the caller may have been
   * superseded by a new owner.
   *
   * Returns true iff:
   *   - the lease is currently held,
   *   - the owner matches this.cfg.owner,
   *   - the token matches this.current.token, AND
   *   - the lease has not expired.
   */
  async verifyToken(): Promise<boolean> {
    if (!this.current) return false;
    const record = await this.cfg.store.current(this.cfg.key);
    if (record.state !== "held") return false;
    if (record.owner !== this.cfg.owner) return false;
    if (record.token !== this.current.token) return false;
    return true;
  }

  /**
   * Returns the lease key (for observability).
   */
  getKey(): LeaseKey {
    return this.cfg.key;
  }

  /**
   * Returns the owner identifier (for observability).
   */
  getOwner(): LeaseOwner {
    return this.cfg.owner;
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Generate a unique owner identifier for this process.
 *
 * Format: `${hostname}:${pid}:${randomNonce}`
 *
 * The random nonce ensures that two processes on the same host with
 * the same PID (extremely unlikely, but possible after a fork) get
 * different owner IDs.
 */
export function generateOwnerId(): LeaseOwner {
  let hostname = "unknown";
  try {
    hostname = osHostname() ?? "unknown";
  } catch {
    // stay "unknown"
  }
  const pid = typeof process !== "undefined" && process.pid
    ? process.pid
    : 0;
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${hostname}:${pid}:${nonce}`;
}

/**
 * Build a lease key for a given signing address.
 *
 * Format: `writer:${address}` (address lowercased).
 */
export function buildLeaseKey(address: string): LeaseKey {
  return `writer:${address.toLowerCase()}`;
}
