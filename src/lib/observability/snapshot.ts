// src/lib/observability/snapshot.ts
//
// M5.5 — Snapshot serialization.
//
// Converts the Registry's live metrics into a plain JSON-serializable
// object. This is the SHAPE consumed by:
//   - GET /api/runtime/status  (the operator-facing HTTP endpoint)
//   - Long-Duration runner's checkpoint printer
//   - Shadow Mode's comparison report
//   - The test harnesses' final summary
//
// Per the operator's M5 directive, the snapshot shape is:
//
//   {
//     runtime: "RUNNING",
//     uptime: 18233,
//     rounds: { ok: 1524, failed: 2 },
//     latency: { pipelineP95, signerP95, broadcasterP95 },
//     lease: { owner, renews, failures },
//     canary: { pct, accepted, skipped },
//     rpc: { quorumHealthy, unhealthy }
//   }
//
// We extend this minimal shape with additional fields that the M5
// harnesses need (gate-level rejects, p50/p99, mean, etc.) — but we
// PRESERVE the operator's field names exactly so the API contract
// is stable.

import type { Registry } from "./registry";

// -------------------------------------------------------------------------
// Snapshot types
// -------------------------------------------------------------------------

export interface RuntimeSnapshot {
  // Top-level status
  runtime: "RUNNING" | "STOPPED" | "DEGRADED";
  uptime: number; // seconds

  // Round-level counters
  rounds: {
    started: number;
    ok: number;
    failed: number;
  };

  // Latency percentiles (ms)
  latency: {
    pipelineP50: number;
    pipelineP95: number;
    pipelineP99: number;
    signerP50: number;
    signerP95: number;
    signerP99: number;
    broadcasterP50: number;
    broadcasterP95: number;
    broadcasterP99: number;
    leaseAcquireP50: number;
    leaseAcquireP95: number;
    leaseAcquireP99: number;
  };

  // Lease state
  lease: {
    active: boolean;       // true if active_lease_owner gauge == 1
    renews: number;        // roundsStarted (proxy for renew attempts — actual renew count tracked elsewhere if needed)
    failures: number;      // roundsFailed where failedGate == "signer" && error includes "LEASE"
  };

  // Canary state
  canary: {
    pct: number;           // current canary percentage (0-100)
    accepted: number;
    skipped: number;
  };

  // RPC quorum health
  rpc: {
    quorumHealthy: number; // count of healthy endpoints (from QuorumRpcClient)
    unhealthy: number;
    errors: number;        // total rpc_errors counter
  };

  // Per-gate rejections
  gateRejects: {
    liquidity: number;
    authority: number;
    simulation: number;
    mev: number;
    approval: number;
  };

  // Error counters
  errors: {
    rpc: number;
    signer: number;
    broadcast: number;
  };

  // Shadow comparison
  shadow: {
    diffs: number;
  };

  // Timestamp of this snapshot
  ts: number; // epoch ms
}

// -------------------------------------------------------------------------
// Snapshot builder
// -------------------------------------------------------------------------

/**
 * Build a RuntimeSnapshot from a Registry.
 *
 * Some fields require EXTERNAL state that the Registry doesn't own:
 *   - `lease.renews`    — needs the WriterLease's renew count
 *   - `lease.failures`  — needs to scan failed rounds for LEASE_ prefix
 *   - `canary.pct`      — needs the CanaryBroadcaster's current pct
 *   - `rpc.quorumHealthy` / `rpc.unhealthy` — needs the QuorumRpcClient
 *
 * These are passed in via `extra`. The snapshot builder merges them
 * with the Registry's data. If `extra` is omitted, the snapshot uses
 * sensible defaults (0, false, etc.).
 */
export interface SnapshotExtras {
  /** Current canary percentage (0-100). Default: 0. */
  canaryPct?: number;
  /** Whether the lease is currently held by this process. Default: false. */
  leaseActive?: boolean;
  /** Number of healthy RPC endpoints. Default: 0. */
  rpcHealthy?: number;
  /** Number of unhealthy RPC endpoints. Default: 0. */
  rpcUnhealthy?: number;
  /** Number of lease renewals observed. Default: 0. */
  leaseRenews?: number;
  /** Number of lease failures (LEASE_ACQUIRE_FAILED, LEASE_FENCING_TOKEN_STALE). Default: 0. */
  leaseFailures?: number;
  /** Runtime status override. Default: "RUNNING". */
  status?: "RUNNING" | "STOPPED" | "DEGRADED";
}

export function buildSnapshot(
  registry: Registry,
  extra: SnapshotExtras = {},
): RuntimeSnapshot {
  const m = registry.metrics;
  registry.refreshUptime();

  return {
    runtime: extra.status ?? "RUNNING",
    uptime: m.uptimeSeconds.get(),
    ts: Date.now(),

    rounds: {
      started: m.roundsStarted.get(),
      ok: m.roundsSucceeded.get(),
      failed: m.roundsFailed.get(),
    },

    latency: {
      pipelineP50:   m.pipelineLatencyMs.p50(),
      pipelineP95:   m.pipelineLatencyMs.p95(),
      pipelineP99:   m.pipelineLatencyMs.p99(),
      signerP50:     m.signerLatencyMs.p50(),
      signerP95:     m.signerLatencyMs.p95(),
      signerP99:     m.signerLatencyMs.p99(),
      broadcasterP50: m.broadcastLatencyMs.p50(),
      broadcasterP95: m.broadcastLatencyMs.p95(),
      broadcasterP99: m.broadcastLatencyMs.p99(),
      leaseAcquireP50: m.leaseAcquireMs.p50(),
      leaseAcquireP95: m.leaseAcquireMs.p95(),
      leaseAcquireP99: m.leaseAcquireMs.p99(),
    },

    lease: {
      active: extra.leaseActive ?? false,
      renews: extra.leaseRenews ?? 0,
      failures: extra.leaseFailures ?? 0,
    },

    canary: {
      pct: extra.canaryPct ?? 0,
      accepted: m.canaryAccepted.get(),
      skipped: m.canarySkipped.get(),
    },

    rpc: {
      quorumHealthy: extra.rpcHealthy ?? 0,
      unhealthy: extra.rpcUnhealthy ?? 0,
      errors: m.rpcErrors.get(),
    },

    gateRejects: {
      liquidity:  m.gateRejects.liquidity.get(),
      authority:  m.gateRejects.authority.get(),
      simulation: m.gateRejects.simulation.get(),
      mev:        m.gateRejects.mev.get(),
      approval:   m.gateRejects.approval.get(),
    },

    errors: {
      rpc: m.rpcErrors.get(),
      signer: m.signerErrors.get(),
      broadcast: m.broadcastErrors.get(),
    },

    shadow: {
      diffs: m.shadowDiffs.get(),
    },
  };
}
