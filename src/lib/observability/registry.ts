// src/lib/observability/registry.ts
//
// M5.5 — The single Registry.
//
// All M5 infrastructure (Chaos, Shadow, Canary, Long-Duration, the
// /api/runtime/status endpoint) consumes THIS Registry. No harness
// implements its own metrics collection — they all call
// `registry.runtime.signerLatencyMs.observe(...)` etc.
//
// Per the operator's M5 directive:
//
//   "Before Shadow, expose a single Registry.
//    All M5 infrastructure consumes only this Registry."
//
// The Registry is a SINGLETON per process. It's constructed once at
// module load + reset-able for tests. The runtime factory
// (src/lib/runtime/runtime.ts) accepts an optional Registry; if
// none provided, it uses the global singleton.
//
// Metric naming convention:
//   - Counters: snake_case nouns (rounds_started, signer_errors)
//   - Gauges:   snake_case states (active_lease_owner, uptime_seconds)
//   - Histograms: snake_case with _ms suffix (signer_latency_ms)
//
// All metrics are exposed via /api/runtime/status as JSON.

import { Counter, Gauge, Histogram, DEFAULT_LATENCY_BUCKETS_MS } from "./metrics";

// -------------------------------------------------------------------------
// RuntimeMetrics — the operator's specified shape.
// -------------------------------------------------------------------------

/**
 * The complete set of runtime metrics. Every field is a primitive
// metric type (Counter, Gauge, Histogram). The Registry exposes this
 * as a single readonly object.
 *
 * Per the operator's M5 directive, this includes:
 *   - round counters (started/succeeded/failed)
 *   - latency histograms (signer, pipeline, broadcast, lease acquire)
 *   - error counters (rpc, signer, broadcast)
 *   - gate reject counters (one per gate)
 *   - canary counters (accepted, skipped)
 *   - shadow diff counter
 *   - active lease owner gauge
 *   - uptime seconds gauge
 */
export interface RuntimeMetrics {
  // Round-level counters
  roundsStarted: Counter;
  roundsSucceeded: Counter;
  roundsFailed: Counter;

  // Latency histograms (ms)
  signerLatencyMs: Histogram;
  pipelineLatencyMs: Histogram;
  broadcastLatencyMs: Histogram;
  leaseAcquireMs: Histogram;

  // Error counters
  rpcErrors: Counter;
  signerErrors: Counter;
  broadcastErrors: Counter;

  // Per-gate reject counters
  gateRejects: {
    liquidity: Counter;
    authority: Counter;
    simulation: Counter;
    mev: Counter;
    approval: Counter;
  };

  // Canary counters
  canaryAccepted: Counter;
  canarySkipped: Counter;

  // Shadow comparison counter
  shadowDiffs: Counter;

  // Lease state gauge (1 if held, 0 if not)
  activeLeaseOwner: Gauge;

  // Uptime gauge (seconds since registry creation)
  uptimeSeconds: Gauge;
}

// -------------------------------------------------------------------------
// Registry — owns the RuntimeMetrics + provides snapshot/export.
// -------------------------------------------------------------------------

/**
 * The singleton Registry. Owns all metric instances.
 *
 * Construction:
 *   - `Registry.create()` — creates a fresh Registry (for tests).
 *   - `Registry.global()` — returns the process-wide singleton.
 *
 * Snapshot:
 *   - `registry.snapshot()` — returns a plain JSON-serializable object
 *     with all current metric values.
 *
 * Reset:
 *   - `registry.reset()` — zeroes every metric. Used by tests.
 */
export class Registry {
  readonly metrics: RuntimeMetrics;
  readonly startedAt: number;

  private constructor() {
    this.startedAt = Date.now();
    this.metrics = {
      roundsStarted:    new Counter("rounds_started",       "Total rounds started"),
      roundsSucceeded:  new Counter("rounds_succeeded",     "Rounds that completed ok=true"),
      roundsFailed:     new Counter("rounds_failed",        "Rounds that completed ok=false"),

      signerLatencyMs:    new Histogram("signer_latency_ms",    "SignerAdapter.submit latency"),
      pipelineLatencyMs:  new Histogram("pipeline_latency_ms",  "Pipeline.process latency"),
      broadcastLatencyMs: new Histogram("broadcast_latency_ms", "Broadcaster.submit latency (sign+verify+broadcast)"),
      leaseAcquireMs:     new Histogram("lease_acquire_ms",     "WriterLease.acquire latency"),

      rpcErrors:       new Counter("rpc_errors",       "RPC layer errors (quorum failures, timeouts)"),
      signerErrors:    new Counter("signer_errors",    "Signer layer errors (unavailable, reject, invalid)"),
      broadcastErrors: new Counter("broadcast_errors", "Broadcast layer errors (nonce, gas, immutability, send)"),

      gateRejects: {
        liquidity:  new Counter("gate_reject_liquidity",  "Liquidity gate rejections"),
        authority:  new Counter("gate_reject_authority",  "Authority gate rejections"),
        simulation: new Counter("gate_reject_simulation", "Simulation gate rejections"),
        mev:        new Counter("gate_reject_mev",        "MEV gate rejections"),
        approval:   new Counter("gate_reject_approval",   "Approval gate rejections"),
      },

      canaryAccepted: new Counter("canary_accepted", "Canary ops that were broadcast (bucket < canaryPct)"),
      canarySkipped:  new Counter("canary_skipped",  "Canary ops that were NOT broadcast (bucket >= canaryPct)"),

      shadowDiffs: new Counter("shadow_diffs", "Shadow vs live comparison differences"),

      activeLeaseOwner: new Gauge("active_lease_owner", "1 if lease is held by this process, 0 otherwise"),
      uptimeSeconds:    new Gauge("uptime_seconds",    "Seconds since registry creation"),
    };
  }

  // -------------------------------------------------------------------------
  // Singleton management
  // -------------------------------------------------------------------------

  private static _global: Registry | null = null;

  /**
   * Returns the process-wide singleton Registry.
   * Lazily constructed on first call.
   */
  static global(): Registry {
    if (Registry._global === null) {
      Registry._global = new Registry();
    }
    return Registry._global;
  }

  /**
   * Create a FRESH Registry (does NOT replace the global singleton).
   * Used by tests that want isolation.
   */
  static create(): Registry {
    return new Registry();
  }

  /**
   * Replace the global singleton (use sparingly — tests only).
   */
  static _setGlobal(r: Registry | null): void {
    Registry._global = r;
  }

  // -------------------------------------------------------------------------
  // Uptime tracking
  // -------------------------------------------------------------------------

  /**
   * Update the uptime gauge. Called by the snapshot() method and
   * can be called manually by the runtime on each tick.
   */
  refreshUptime(): void {
    this.metrics.uptimeSeconds.set(Math.floor((Date.now() - this.startedAt) / 1000));
  }

  // -------------------------------------------------------------------------
  // Reset — for tests
  // -------------------------------------------------------------------------

  /**
   * Zero every metric. Used between test runs to ensure isolation.
   */
  reset(): void {
    this.metrics.roundsStarted.reset();
    this.metrics.roundsSucceeded.reset();
    this.metrics.roundsFailed.reset();
    this.metrics.signerLatencyMs.reset();
    this.metrics.pipelineLatencyMs.reset();
    this.metrics.broadcastLatencyMs.reset();
    this.metrics.leaseAcquireMs.reset();
    this.metrics.rpcErrors.reset();
    this.metrics.signerErrors.reset();
    this.metrics.broadcastErrors.reset();
    this.metrics.gateRejects.liquidity.reset();
    this.metrics.gateRejects.authority.reset();
    this.metrics.gateRejects.simulation.reset();
    this.metrics.gateRejects.mev.reset();
    this.metrics.gateRejects.approval.reset();
    this.metrics.canaryAccepted.reset();
    this.metrics.canarySkipped.reset();
    this.metrics.shadowDiffs.reset();
    this.metrics.activeLeaseOwner.reset();
    this.metrics.uptimeSeconds.reset();
    // Note: startedAt is NOT reset — uptime continues across resets.
    // For full reset, use Registry.create() instead.
  }
}
