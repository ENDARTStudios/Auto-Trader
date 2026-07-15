// src/lib/runtime/chaos.ts
//
// M5.4 — Chaos injectors (independent, composable).
//
// Per the operator's M5 directive:
//
//   "The injectors must be independent.
//
//    LatencyInjector
//    RpcFailureInjector
//    LeaseFailureInjector
//    SignerFailureInjector
//    BroadcastFailureInjector
//    NetworkPartitionInjector
//
//    Each implementing ChaosInjector with:
//      before()
//      after()
//      cleanup()
//
//    No `if (chaos)` scattered through the code."
//
// DESIGN
// ------
// Each injector is a self-contained class that:
//   1. `before()` — installs the fault (e.g., makes an RPC endpoint
//      throw, makes the signer transport hang, makes the lease store
//      return LEASE_BUSY).
//   2. The test runs the operation under fault.
//   3. `after()` — optional post-op assertion hook (e.g., verify
//      the operation failed with the expected error prefix).
//   4. `cleanup()` — removes the fault, restores healthy state.
//
// Composability:
//   Injectors can be stacked (e.g., LatencyInjector + RpcFailureInjector).
//   Each operates independently on its target. The test harness does
//   NOT need `if (chaos)` branches — it just calls `before()` on each
//   injector, runs the op, calls `after()`, then `cleanup()`.
//
// WHAT CHAOS.TS DOES NOT DO
// -------------------------
//   - NO business logic (no decisions about whether to fail).
//   - NO metrics recording (the Registry handles that — chaos injectors
//      just throw/delay, the runtime records the resulting errors).
//   - NO test assertions (the `after()` hook is optional and for
//      injector-internal state checks only; test assertions live in
//      the test file).
//
// INJECTOR TARGETS
// ----------------
// Each injector operates on a specific mock object (MockRpcTransport,
// MockSignerTransport, InMemoryLeaseStore, etc.). The injector holds
// a reference to its target and mutates its fault-injection fields.
// The mock classes must expose fault-injection knobs (they already do
// in test-m5-chaos.ts).

import type { LeaseStore } from "../chain/writer-lease";
// Note: SignerTransport + RpcResponse are imported from signer-adapter
// (the signer-protocol module doesn't export them directly in this codebase).
import type { SignerTransport, RpcResponse } from "../chain/signer-adapter";

// -------------------------------------------------------------------------
// ChaosInjector interface — the contract every injector implements.
// -------------------------------------------------------------------------

/**
 * A chaos injector. Each injector installs ONE kind of fault.
 *
 * Lifecycle:
 *   1. `before()` — install the fault. Called BEFORE the operation
 *      under test runs.
 *   2. (operation runs)
 *   3. `after()` — optional post-op hook. Can be used to verify
 *      injector-internal state (e.g., "the fault was actually
 *      triggered"). Returns true if the injector's expectations
 *      were met, false otherwise.
 *   4. `cleanup()` — remove the fault, restore healthy state. Called
 *      in a `finally` block by the test harness.
 *
 * Composability: multiple injectors can be stacked. Each operates
 * independently on its target. Order matters for `before()` (outer
 * injector's before() runs first) and `cleanup()` (reverse order —
 * inner injector's cleanup() runs first, like stack unwinding).
 */
export interface ChaosInjector {
  /** Human-readable name (for logging). */
  readonly name: string;
  /** Install the fault. MUST be idempotent (safe to call twice). */
  before(): void;
  /**
   * Post-op hook. Returns true if the injector's internal expectations
   * were met (e.g., the fault was actually triggered). Default: true.
   */
  after(): boolean;
  /** Remove the fault. MUST restore the target to healthy state. */
  cleanup(): void;
}

// -------------------------------------------------------------------------
// Mock interfaces — the fault-injection knobs each injector needs.
// -------------------------------------------------------------------------

/**
 * The fault-injection surface of a mock RPC transport.
 * The test's MockRpcTransport implements this.
 */
export interface RpcTransportChaos {
  /** Make a specific URL's transport throw on every call. */
  failUrl: string | null;
  /** Make ALL URLs' transports throw. */
  failAllUrls: boolean;
  /** Delay every transport call by `delayMs` milliseconds. */
  delayMs: number;
  /** Make eth_sendRawTransaction return a wrong hash (REG-014 violation). */
  returnWrongHash: boolean;
  /** Make eth_getTransactionCount return a non-hex string. */
  malformedNonce: boolean;
  /** Reset all fault-injection knobs to healthy state. */
  resetChaos(): void;
}

/**
 * The fault-injection surface of a mock signer transport.
 */
export interface SignerTransportChaos {
  /**
   * Failure mode:
   *   - "ok"         — normal operation
   *   - "unavailable" — throw ECONNREFUSED on every call
   *   - "reject"     — return ok=false with SIGNER_SIGN_FAILED
   *   - "no-raw"     — return ok=true but omit rawSignedTx
   *   - "wrong-hash" — return ok=true but with a different txHash
   */
  failMode: "ok" | "unavailable" | "reject" | "no-raw" | "wrong-hash";
  /** Reset to healthy state. */
  resetChaos(): void;
}

/**
 * The fault-injection surface of a lease store (InMemoryLeaseStore
 * already provides `injectFailure()`; this interface standardizes it).
 */
export interface LeaseStoreChaos {
  /** Make the next operation fail with STORE_UNAVAILABLE. */
  injectFailure(): void;
  /** Reset to healthy state. */
  resetChaos(): void;
}

// -------------------------------------------------------------------------
// 1. LatencyInjector — adds artificial delay to RPC calls.
// -------------------------------------------------------------------------

export class LatencyInjector implements ChaosInjector {
  readonly name = "LatencyInjector";
  private triggered = false;

  constructor(
    private readonly target: RpcTransportChaos,
    private readonly delayMs: number,
  ) {}

  before(): void {
    this.target.delayMs = this.delayMs;
    this.triggered = false;
  }

  after(): boolean {
    // We can't easily verify the delay was applied without timing
    // the call — the test harness handles that. Just return true.
    return true;
  }

  cleanup(): void {
    this.target.delayMs = 0;
    this.triggered = false;
  }
}

// -------------------------------------------------------------------------
// 2. RpcFailureInjector — makes RPC endpoints fail.
// -------------------------------------------------------------------------

export class RpcFailureInjector implements ChaosInjector {
  readonly name = "RpcFailureInjector";
  private triggered = false;

  constructor(
    private readonly target: RpcTransportChaos,
    private readonly mode: "one-endpoint" | "all-endpoints" | "malformed-nonce" | "wrong-hash",
    private readonly url?: string,
  ) {}

  before(): void {
    switch (this.mode) {
      case "one-endpoint":
        if (!this.url) throw new Error("RpcFailureInjector(one-endpoint) requires a url");
        this.target.failUrl = this.url;
        break;
      case "all-endpoints":
        this.target.failAllUrls = true;
        break;
      case "malformed-nonce":
        this.target.malformedNonce = true;
        break;
      case "wrong-hash":
        this.target.returnWrongHash = true;
        break;
    }
    this.triggered = false;
  }

  after(): boolean {
    return true;
  }

  cleanup(): void {
    this.target.failUrl = null;
    this.target.failAllUrls = false;
    this.target.malformedNonce = false;
    this.target.returnWrongHash = false;
    this.triggered = false;
  }
}

// -------------------------------------------------------------------------
// 3. LeaseFailureInjector — makes the lease store fail.
// -------------------------------------------------------------------------

export class LeaseFailureInjector implements ChaosInjector {
  readonly name = "LeaseFailureInjector";

  constructor(private readonly target: LeaseStoreChaos) {}

  before(): void {
    this.target.injectFailure();
  }

  after(): boolean {
    return true;
  }

  cleanup(): void {
    this.target.resetChaos();
  }
}

// -------------------------------------------------------------------------
// 4. SignerFailureInjector — makes the signer transport fail.
// -------------------------------------------------------------------------

export class SignerFailureInjector implements ChaosInjector {
  readonly name = "SignerFailureInjector";

  constructor(
    private readonly target: SignerTransportChaos,
    private readonly mode: "unavailable" | "reject" | "no-raw" | "wrong-hash",
  ) {}

  before(): void {
    this.target.failMode = this.mode;
  }

  after(): boolean {
    return true;
  }

  cleanup(): void {
    this.target.failMode = "ok";
  }
}

// -------------------------------------------------------------------------
// 5. BroadcastFailureInjector — makes broadcasts fail.
// -------------------------------------------------------------------------

/**
 * BroadcastFailureInjector — makes the broadcast step fail.
 *
 * This is a thin wrapper around RpcFailureInjector with mode="wrong-hash"
 * (REG-014 violation) — the most common broadcast failure mode. For
 * other broadcast failures (timeout, partial), use RpcFailureInjector
 * directly with the appropriate mode.
 */
export class BroadcastFailureInjector implements ChaosInjector {
  readonly name = "BroadcastFailureInjector";
  private readonly inner: RpcFailureInjector;

  constructor(target: RpcTransportChaos, mode: "wrong-hash" | "all-endpoints" = "wrong-hash") {
    this.inner = new RpcFailureInjector(target, mode);
  }

  before(): void { this.inner.before(); }
  after(): boolean { return this.inner.after(); }
  cleanup(): void { this.inner.cleanup(); }
}

// -------------------------------------------------------------------------
// 6. NetworkPartitionInjector — simulates a network partition by
//    making BOTH the RPC and signer transports fail simultaneously.
// -------------------------------------------------------------------------

export class NetworkPartitionInjector implements ChaosInjector {
  readonly name = "NetworkPartitionInjector";
  private readonly rpc: RpcFailureInjector;
  private readonly signer: SignerFailureInjector;

  constructor(
    rpcTarget: RpcTransportChaos,
    signerTarget: SignerTransportChaos,
  ) {
    this.rpc = new RpcFailureInjector(rpcTarget, "all-endpoints");
    this.signer = new SignerFailureInjector(signerTarget, "unavailable");
  }

  before(): void {
    this.rpc.before();
    this.signer.before();
  }

  after(): boolean {
    return this.rpc.after() && this.signer.after();
  }

  cleanup(): void {
    // Unwind in reverse order.
    this.signer.cleanup();
    this.rpc.cleanup();
  }
}

// -------------------------------------------------------------------------
// Helper: run a list of injectors with proper lifecycle.
// -------------------------------------------------------------------------

/**
 * Run `fn` under the effect of `injectors`. Each injector's `before()`
 * is called in order, then `fn()` runs, then each injector's `after()`
 * is called (in order), then each injector's `cleanup()` is called in
 * REVERSE order (stack unwind).
 *
 * Returns `{ result, afterOk }` where `result` is the return value of
 * `fn()` and `afterOk` is true iff all injectors' `after()` returned true.
 *
 * `fn()` is awaited. If `fn()` throws, the exception propagates AFTER
 * cleanup runs (cleanup is in a `finally` block).
 */
export async function withInjectors<T>(
  injectors: ChaosInjector[],
  fn: () => Promise<T>,
): Promise<{ result: T; afterOk: boolean }> {
  // Install faults in order.
  for (const inj of injectors) inj.before();
  try {
    const result = await fn();
    // Run after() hooks in order.
    let afterOk = true;
    for (const inj of injectors) {
      if (!inj.after()) afterOk = false;
    }
    return { result, afterOk };
  } finally {
    // Cleanup in reverse order (stack unwind).
    for (let i = injectors.length - 1; i >= 0; i--) {
      try {
        injectors[i]!.cleanup();
      } catch {
        // Swallow cleanup errors — we don't want a cleanup failure
        // to mask the real test result.
      }
    }
  }
}
