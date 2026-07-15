// src/lib/observability/exporter.ts
//
// M5.5 — Registry exporter.
//
// Bridges the Registry (pure data) to the runtime (which owns the
// live state — CanaryBroadcaster pct, QuorumRpcClient health, etc.)
// and provides a single function the HTTP endpoint calls.
//
// The exporter is a LIVE VIEW — it queries the runtime each time
// `export()` is called, then merges with the Registry snapshot.
// This means the HTTP endpoint always returns current state, not a
// stale cache.
//
// Per the operator's M5 directive:
//
//   "The API must be read-only.
//    No business logic.
//    Only exposure of the Registry."
//
// The exporter honors this: it does NOT mutate state, does NOT
// trigger operations, does NOT make decisions. It only READS the
// Registry + queries the runtime for current canary pct / RPC health
// / lease state.

import { Registry } from "./registry";
import { buildSnapshot, type RuntimeSnapshot, type SnapshotExtras } from "./snapshot";

// -------------------------------------------------------------------------
// Exporter — reads Registry + runtime, returns snapshot.
// -------------------------------------------------------------------------

/**
 * A handle to the live runtime that the exporter queries for current
 * state (canary pct, RPC health, lease state). The runtime factory
// provides this; tests can mock it.
 */
export interface RuntimeHandle {
  /** Current canary percentage (0-100). 0 if no canary wrapper. */
  getCanaryPct(): number;
  /** Whether the lease is currently held by this process. */
  isLeaseActive(): boolean;
  /** Number of healthy RPC endpoints (from QuorumRpcClient). */
  getRpcHealthy(): number;
  /** Number of unhealthy RPC endpoints. */
  getRpcUnhealthy(): number;
  /** Number of lease renewals observed so far. */
  getLeaseRenews(): number;
  /** Number of lease failures observed so far. */
  getLeaseFailures(): number;
  /** Runtime status: "RUNNING" | "STOPPED" | "DEGRADED". */
  getStatus(): "RUNNING" | "STOPPED" | "DEGRADED";
}

/**
 * A null runtime handle — returns defaults. Used when no runtime is
 * attached (e.g., the API is queried before the engine starts).
 */
export class NullRuntimeHandle implements RuntimeHandle {
  getCanaryPct(): number { return 0; }
  isLeaseActive(): boolean { return false; }
  getRpcHealthy(): number { return 0; }
  getRpcUnhealthy(): number { return 0; }
  getLeaseRenews(): number { return 0; }
  getLeaseFailures(): number { return 0; }
  getStatus(): "RUNNING" | "STOPPED" | "DEGRADED" { return "STOPPED"; }
}

/**
 * The exporter. Holds a reference to the global Registry + an optional
 * RuntimeHandle. Calling `export()` returns the current snapshot.
 *
 * Construction:
 *   - `Exporter.global()` — uses the global Registry + NullRuntimeHandle.
 *   - `new Exporter(registry, handle)` — for tests / custom wiring.
 */
export class Exporter {
  constructor(
    private readonly registry: Registry,
    // Mutable so setHandle() can update it after construction.
    private handle: RuntimeHandle = new NullRuntimeHandle(),
  ) {}

  static global(): Exporter {
    return new Exporter(Registry.global(), new NullRuntimeHandle());
  }

  /**
   * Set the runtime handle. Called by the runtime factory when the
   * runtime is constructed. Allows the exporter to query live state.
   */
  setHandle(handle: RuntimeHandle): void {
    this.handle = handle;
  }

  /**
   * Build and return the current snapshot. Pure read — no side effects.
   */
  export(): RuntimeSnapshot {
    const extra: SnapshotExtras = {
      canaryPct: this.handle.getCanaryPct(),
      leaseActive: this.handle.isLeaseActive(),
      rpcHealthy: this.handle.getRpcHealthy(),
      rpcUnhealthy: this.handle.getRpcUnhealthy(),
      leaseRenews: this.handle.getLeaseRenews(),
      leaseFailures: this.handle.getLeaseFailures(),
      status: this.handle.getStatus(),
    };
    return buildSnapshot(this.registry, extra);
  }
}
