// src/lib/chain/leased-broadcaster.ts
//
// M4 — LeasedBroadcaster (operator-directed, closed scope).
//
// DESIGN PHILOSOPHY
// -----------------
// LeasedBroadcaster wraps the M3.3 Broadcaster with the M4 WriterLease.
// It implements `SignerSink` — the SAME interface the H2.6 Pipeline
// calls. So the Pipeline remains UNCHANGED:
//
//   Pipeline.process(req)
//     ├── ... (H1/H2 gates) ...
//     └── signer.submit(req)   ← still the same call
//
//   Where `signer` was:
//     H2.6:  mock
//     M3.1:  SignerAdapter     (sign-only, no broadcast)
//     M3.3:  Broadcaster       (sign + broadcast, no lease)
//     M4:    LeasedBroadcaster (sign + broadcast + lease)  ← THIS FILE
//
// The wrap is TRANSPARENT to the Pipeline. The contract
// (`submit(req) → SignerResult`) is preserved. The only behavioral
// change is: before delegating to the inner Broadcaster, the
// LeasedBroadcaster acquires the lease; after delegation (success OR
// failure), it releases the lease.
//
// FENCING (REG-015 / REG-017)
// ---------------------------
// The lease's fencing token is checked TWICE:
//
//   1. PRE-BROADCAST — after acquire, before delegating to the
//      Broadcaster. The LeasedBroadcaster calls `lease.verifyToken()`
//      to confirm the lease is still held by THIS owner with the SAME
//      token. If verifyToken returns false, the broadcast is aborted
//      with `LEASE_FENCING_TOKEN_STALE`.
//
//   2. (Future) POST-BROADCAST — after the Broadcaster returns, the
//      LeasedBroadcaster could re-verify the token before returning
//      success to the Pipeline. This guards against the case where the
//      lease was lost DURING the broadcast (e.g., the renewer failed
//      and the TTL expired mid-broadcast). For M4 closed scope, we
//      only implement the PRE-BROADCAST check — the post-broadcast
//      check is deferred to a future hardening pass.
//
// WHAT LEASEDBROADCASTER DOES NOT DO
// ----------------------------------
// Per the operator's M4 scope:
//   - NO signing (delegated to Broadcaster → SignerAdapter).
//   - NO nonce/gas resolution (delegated to Broadcaster).
//   - NO broadcast (delegated to Broadcaster).
//   - NO hash verification REG-014 (delegated to Broadcaster).
//   - NO retry of failed broadcasts (caller's responsibility).
//   - NO transaction replacement / cancel / fee-bump (future).
//
// LeasedBroadcaster is purely a LEASE GATE around the Broadcaster.
//
// ERROR CODES
// -----------
// LeasedBroadcasterError adds two new error codes to the SignerSink
// vocabulary:
//
//   LEASE_ACQUIRE_FAILED — the lease could not be acquired (busy or
//     store unavailable). The Pipeline sees this as a signer failure
//     with `failedGate: "signer"`.
//
//   LEASE_FENCING_TOKEN_STALE — the lease was acquired but the
//     pre-broadcast verifyToken check returned false (the lease was
//     lost between acquire and delegate). The broadcast was NOT
//     attempted. This is a critical safety event — it means another
//     writer may have taken over and we must NOT broadcast.
//
// INTEGRATION LIFECYCLE
// ----------------------
// The LeasedBroadcaster is constructed ONCE at engine startup with a
// shared LeaseStore (so multiple LeasedBroadcasters in the same
// process share lease state). The lease key is derived from the
// signing address; the owner is generated per-process.
//
//   const store = new InMemoryLeaseStore();      // or PostgresLeaseStore
//   const leased = new LeasedBroadcaster({
//     broadcaster: new Broadcaster({ ... }),
//     lease: new WriterLease({
//       store,
//       key: buildLeaseKey(signingAddress),
//       owner: generateOwnerId(),
//       ttlMs: 10_000,
//     }),
//   });
//
//   // The Pipeline consumes `leased` as its `signer`:
//   new Pipeline({ signer: leased, ... });
//
// ADVERSARIAL TEST MATRIX (per operator's M4 directive — delegated
// to scripts/test-m4-writer-lease.ts):
//   L.1 — acquire ok → broadcast ok → release ok → returns SignerResult
//   L.2 — acquire busy → returns LEASE_ACQUIRE_FAILED, no broadcast
//   L.3 — acquire ok, fencing token stale pre-broadcast → returns
//         LEASE_FENCING_TOKEN_STALE, no broadcast
//   L.4 — acquire ok, broadcast fails → returns broadcaster error,
//         lease released (REG-015)
//   L.5 — acquire ok, broadcast throws → returns LEASE_CALLBACK_EXCEPTION,
//         lease released (REG-015)
//   L.6 — lease store unavailable → returns LEASE_ACQUIRE_FAILED
//   L.7 — lease released on every exit path (REG-015 invariant)
//   L.8 — renewer extends lease during long broadcast
//   L.9 — concurrent LeasedBroadcaster.submit() calls serialize via lease

import type { SignerSink, SignerRequest, SignerResult } from "./pipeline";
import type { Broadcaster } from "./broadcaster";
import { WriterLease, LeaseError, type FencingToken } from "./writer-lease";

// -------------------------------------------------------------------------
// Error codes — the prefixes returned in `SignerResult.error`.
// -------------------------------------------------------------------------

export const LeasedBroadcasterError = {
  ACQUIRE_FAILED: "LEASE_ACQUIRE_FAILED",
  FENCING_TOKEN_STALE: "LEASE_FENCING_TOKEN_STALE",
} as const;

// -------------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------------

export interface LeasedBroadcasterConfig {
  /**
   * The M3.3 Broadcaster to wrap. The LeasedBroadcaster delegates
   * `submit()` to this instance after acquiring the lease.
   */
  broadcaster: Broadcaster;
  /**
   * The M4 WriterLease that serializes access to the broadcaster.
   * The LeasedBroadcaster calls `lease.withLease()` around the
   * delegated `submit()` call.
   */
  lease: WriterLease;
  /**
   * Whether to perform the PRE-BROADCAST fencing check. Default: true.
   *
   * When true, after acquiring the lease and BEFORE delegating to the
   * Broadcaster, the LeasedBroadcaster calls `lease.verifyToken()` to
   * confirm the lease is still held with the same token. If verifyToken
   * returns false, the broadcast is aborted with
   * LEASE_FENCING_TOKEN_STALE.
   *
   * Can be disabled for tests that don't need the fencing check, but
   * SHOULD be true in production.
   */
  enableFencingCheck?: boolean;
  /**
   * Logger — defaults to no-op. Observability only; does not affect
   * decisions.
   */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

// -------------------------------------------------------------------------
// LeasedBroadcaster
// -------------------------------------------------------------------------

/**
 * LeasedBroadcaster — wraps the M3.3 Broadcaster with the M4 WriterLease.
 *
 * Implements `SignerSink` — the interface the H2.6 Pipeline calls.
 * The Pipeline remains UNCHANGED.
 *
 * Behavior of `submit(req)`:
 *
 *   1. Acquire the lease (via lease.withLease).
 *      - If acquire fails, return SignerResult with ok=false and
 *        error="LEASE_ACQUIRE_FAILED: <reason>".
 *      - If acquire succeeds, proceed.
 *
 *   2. (Optional, default ON) PRE-BROADCAST fencing check.
 *      - Call lease.verifyToken().
 *      - If false, abort: return SignerResult with ok=false and
 *        error="LEASE_FENCING_TOKEN_STALE". The lease is released by
 *        withLease's finally block.
 *
 *   3. Delegate to Broadcaster.submit(req).
 *      - The Broadcaster resolves nonce + gas, signs, computes hash,
 *        broadcasts, verifies hash (REG-014), returns SignerResult.
 *
 *   4. Return the Broadcaster's SignerResult.
 *      - The lease is released by withLease's finally block regardless
 *        of outcome (REG-015).
 *
 * The LeasedBroadcaster NEVER throws — like the Broadcaster and the
 * SignerAdapter, it converts every error into a SignerResult with
 * ok=false and a descriptive error string.
 */
export class LeasedBroadcaster implements SignerSink {
  private readonly cfg: Required<LeasedBroadcasterConfig>;

  constructor(config: LeasedBroadcasterConfig) {
    this.cfg = {
      broadcaster: config.broadcaster,
      lease: config.lease,
      enableFencingCheck: config.enableFencingCheck ?? true,
      log: config.log ?? (() => {}),
    };
  }

  /**
   * Submit a sign+broadcast request through the lease gate.
   *
   * Implements `SignerSink.submit`. See class docstring for the
   * full flow.
   */
  async submit(req: SignerRequest): Promise<SignerResult> {
    // Step 1: acquire the lease via withLease (RAII).
    const result = await this.cfg.lease.withLease<SignerResult>(
      async (token: FencingToken): Promise<SignerResult> => {
        // Step 2: PRE-BROADCAST fencing check.
        if (this.cfg.enableFencingCheck) {
          const stillHeld = await this.cfg.lease.verifyToken();
          if (!stillHeld) {
            this.cfg.log("error", "fencing token stale pre-broadcast", {
              key: this.cfg.lease.getKey(),
              owner: this.cfg.lease.getOwner(),
              token,
            });
            return {
              ok: false,
              error: `${LeasedBroadcasterError.FENCING_TOKEN_STALE}: lease lost between acquire and broadcast`,
            };
          }
        }

        // Step 3: delegate to the Broadcaster.
        // The Broadcaster never throws — it returns a SignerResult.
        // If it DID throw (defensive), withLease's catch would convert
        // it to { ok: false, error: "LEASE_CALLBACK_EXCEPTION: ..." }.
        this.cfg.log("info", "broadcasting under lease", {
          key: this.cfg.lease.getKey(),
          owner: this.cfg.lease.getOwner(),
          token,
          from: req.tx.from,
          to: req.tx.to,
        });
        return await this.cfg.broadcaster.submit(req);
      },
    );

    // Step 4: withLease returned either the SignerResult (if the
    // callback ran) or { ok: false, error } (if acquire failed or the
    // callback threw). In both cases, the shape is compatible with
    // SignerResult (ok: boolean, error?: string, txHash?: string).
    //
    // Classification of errors:
    //   - LEASE_BUSY / LEASE_STORE_UNAVAILABLE  → acquire failed.
    //     Wrap with LEASE_ACQUIRE_FAILED so the Pipeline can branch
    //     on a single prefix.
    //   - LEASE_CALLBACK_EXCEPTION              → callback threw.
    //     Pass through unchanged (already prefixed).
    //   - LEASE_FENCING_TOKEN_STALE             → fencing check failed.
    //     Pass through unchanged (already prefixed).
    //   - BROADCAST_*                           → broadcaster failed.
    //     Pass through unchanged (already prefixed by Broadcaster).
    if (!result.ok) {
      const err = (result as { error?: string }).error ?? "";
      // Acquire-phase failures: wrap with LEASE_ACQUIRE_FAILED.
      if (
        err === LeaseError.BUSY ||
        err === LeaseError.STORE_UNAVAILABLE ||
        err.startsWith(LeaseError.BUSY) ||
        err.startsWith(LeaseError.STORE_UNAVAILABLE)
      ) {
        return {
          ok: false,
          error: `${LeasedBroadcasterError.ACQUIRE_FAILED}: ${err}`,
        };
      }
      // All other errors (BROADCAST_*, LEASE_FENCING_TOKEN_STALE,
      // LEASE_CALLBACK_EXCEPTION) are already prefixed — pass through.
      return { ok: false, error: err };
    }

    // Success — pass through the txHash.
    return {
      ok: true,
      txHash: (result as SignerResult).txHash,
    };
  }
}
