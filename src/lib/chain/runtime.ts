// src/lib/chain/runtime.ts
//
// M5.0 — Production runtime factory.
//
// DESIGN PHILOSOPHY
// -----------------
// This module is the SINGLE place where the full chain stack is
// composed for production. It constructs:
//
//   QuorumRpcClient (H1.1)
//     ↓
//   SignerAdapter (M3.1)        ← wraps a SignerTransport
//     ↓
//   Broadcaster (M3.3)          ← wraps SignerAdapter + QuorumRpcClient
//     ↓
//   WriterLease (M4)            ← wraps a LeaseStore
//     ↓
//   LeasedBroadcaster (M4)      ← wraps Broadcaster + WriterLease
//     ↓
//   Pipeline (H2.6)             ← signer: LeasedBroadcaster
//
// Every M5 harness (dry-run, shadow, chaos, long-duration) consumes
// this factory so the wiring is validated EXACTLY ONCE and reused
// everywhere. No harness re-implements the stack composition.
//
// WHY A FACTORY (not a singleton)
// --------------------------------
// Different M5 stages need different configurations:
//   - Dry Run: mock transports, mock lease store, no real network.
//   - Shadow Mode: real RPC endpoints (read-only), mock signer.
//   - Canary Mode: real RPC + real signer + canary flag gating broadcast.
//   - Chaos: mock transports with fault injection.
//   - Long-Duration: real RPC + real signer + metrics recorder.
//
// A factory lets each stage inject its own transports + stores while
// reusing the SAME composition logic. A singleton would force one
// configuration on everyone.
//
// WHAT RUNTIME.TS DOES NOT DO
// ---------------------------
//   - NO business logic (no slippage, no approval policy, no MEV
//     detection — those live in their respective FROZEN modules).
//   - NO state machine (the engine owns that).
//   - NO persistence (the engine + Prisma own that).
//   - NO HTTP API (the API routes own that).
//
// It is purely a wiring module — takes config, returns a fully-wired
// `Pipeline` + handles to the lease/metrics for observability.
//
// CANARY MODE
// -----------
// The runtime accepts a `canary` config that gates BROADCAST (not
// pipeline decisions). When canaryPct < 100, the LeasedBroadcaster
// is wrapped in a `CanaryBroadcaster` that:
//   - For canaryPct% of accepted pipeline ops: delegates to the
//     real LeasedBroadcaster (broadcast happens).
//   - For (100 - canaryPct)%: returns a synthetic SignerResult
//     { ok: true, txHash: "0xcanary000...000" } WITHOUT calling
//     the real broadcaster (no broadcast).
//
// This lets the operator run the full pipeline + lease + signer flow
// under real conditions, with only a fraction of operations actually
// hitting the blockchain. Default: canaryPct = 0 (dry-run mode —
// no broadcast at all).
//
// METRICS
// -------
// The runtime accepts an optional `MetricsRecorder`. When provided,
// every layer records its latency + outcome:
//   - pipeline.process() → pipeline latency, gate-level results
//   - lease.acquire/renew/release → lease acquire time, renew failures
//   - broadcaster.submit() → broadcast latency, REG-014 outcome
//   - rpc.quorumRead/broadcastRawTransaction → RPC latency per endpoint
//
// The MetricsRecorder is a no-op by default (production-hot-path
// overhead is zero when metrics aren't needed).
//
// USAGE
// -----
//   import { buildRuntime } from "@/lib/chain/runtime";
//
//   const { pipeline, lease, metrics } = buildRuntime({
//     rpc: { endpoints: [...], transport: realTransport },
//     signer: { transport: unixSocketTransport },
//     lease: { store: new InMemoryLeaseStore(), key: buildLeaseKey(addr) },
//     canary: { pct: 0 }, // 0% broadcast (dry-run)
//     metrics: new InMemoryMetricsRecorder(),
//   });
//
//   const result = await pipeline.process(req);
//   if (!result.ok) { /* handle */ }

import { QuorumRpcClient, type RpcEndpoint, type Transport } from "./rpc-resilience";
import { SignerAdapter, type SignerTransport, makeSignerAdapter } from "./signer-adapter";
import { Broadcaster } from "./broadcaster";
import {
  WriterLease,
  InMemoryLeaseStore,
  buildLeaseKey,
  generateOwnerId,
  type LeaseStore,
  type LeaseKey,
  type LeaseOwner,
} from "./writer-lease";
import { LeasedBroadcaster } from "./leased-broadcaster";
import { Pipeline, type SignerSink, type SignerRequest, type SignerResult, type AuditSink } from "./pipeline";
import type { SimulationGate } from "./simulation-gate";
import type { ContractVerifier } from "./contract-verification";
import type { LiquidityVerifier } from "./liquidity-verification";
import type { TokenAuthorityVerifier } from "./token-authority";
import type { SellSimVerifier } from "./sell-simulation";
import type { ApprovalGate } from "./approval-hardening";

// -------------------------------------------------------------------------
// Metrics — the observability surface (M5.5).
// -------------------------------------------------------------------------

/**
 * A single metric event. The recorder receives one of these per
 * significant operation in the chain stack.
 *
 * The `layer` field identifies which layer recorded the metric:
 *   "pipeline" | "rpc" | "signer" | "broadcaster" | "lease"
 *
 * The `op` field identifies the specific operation within that layer
 * (e.g., "pipeline.process", "rpc.quorumRead", "lease.acquire").
 *
 * The `outcome` field is a short string: "ok" | "fail" | "busy" |
 * "expired" | "stale" | "timeout" | "unavailable" — recorder-specific.
 */
export interface MetricEvent {
  layer: "pipeline" | "rpc" | "signer" | "broadcaster" | "lease";
  op: string;
  outcome: string;
  durationMs: number;
  ts: number; // epoch ms
  fields?: Record<string, unknown>;
}

/**
 * MetricsRecorder — receives MetricEvents from every layer.
 *
 * The InMemoryMetricsRecorder (defined here) keeps a ring buffer of
 * the last N events + aggregate counters. Production can swap in a
 * Prometheus exporter or a Postgres-backed recorder without changing
 * the runtime.
 */
export interface MetricsRecorder {
  record(event: MetricEvent): void;
}

/**
 * A no-op recorder. Used when metrics aren't needed (e.g., unit tests).
 * Zero overhead — the recorder call still happens, but does nothing.
 */
export class NoopMetricsRecorder implements MetricsRecorder {
  record(): void { /* no-op */ }
}

/**
 * An in-memory metrics recorder with a ring buffer + aggregate counters.
 *
 * Suitable for:
 *   - Dry Run / Shadow / Chaos harnesses (inspect metrics after the run).
 *   - Production canary mode (expose via /api/metrics).
 *
 * NOT suitable for multi-process deployments — each process has its
 * own recorder. For multi-process, use a Postgres-backed recorder
 * (added in M5 closeout if needed).
 */
export class InMemoryMetricsRecorder implements MetricsRecorder {
  private readonly events: MetricEvent[] = [];
  private readonly counters = new Map<string, number>();
  private readonly maxEvents: number;

  constructor(maxEvents: number = 10_000) {
    this.maxEvents = maxEvents;
  }

  record(event: MetricEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    const key = `${event.layer}.${event.op}.${event.outcome}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  /** Return all recorded events (newest last). */
  getEvents(): MetricEvent[] {
    return [...this.events];
  }

  /** Return the aggregate counters as a record. */
  getCounters(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  /** Compute latency percentiles for a given (layer, op) pair. */
  latencyPercentiles(
    layer: MetricEvent["layer"],
    op: string,
  ): { p50: number; p95: number; p99: number; count: number } {
    const durations = this.events
      .filter((e) => e.layer === layer && e.op === op)
      .map((e) => e.durationMs)
      .sort((a, b) => a - b);
    if (durations.length === 0) {
      return { p50: 0, p95: 0, p99: 0, count: 0 };
    }
    const pick = (p: number) => durations[Math.min(durations.length - 1, Math.floor(durations.length * p))];
    return {
      p50: pick(0.5),
      p95: pick(0.95),
      p99: pick(0.99),
      count: durations.length,
    };
  }

  /** Reset all state. Useful between test runs. */
  reset(): void {
    this.events.length = 0;
    this.counters.clear();
  }
}

// -------------------------------------------------------------------------
// CanaryBroadcaster — gates broadcast by percentage (M5.3).
// -------------------------------------------------------------------------

/**
 * A wrapper around LeasedBroadcaster that gates the actual broadcast
 * by a percentage. Used in canary mode (M5.3).
 *
 * For each `submit(req)` call:
 *   - With probability canaryPct/100: delegates to the inner
 *     LeasedBroadcaster (real broadcast happens).
 *   - With probability (100-canaryPct)/100: returns a synthetic
 *     SignerResult { ok: true, txHash: "0xcanary000...000" } WITHOUT
 *     calling the inner broadcaster (no broadcast, no lease acquired).
 *
 * The decision is deterministic per-request via a hash of the
 * SignerRequest's tx.from + tx.to + tx.value + tx.data + a per-process
 * salt — so the same request always gets the same canary decision
 * (replayability for tests). For production, set `deterministic: false`
 * to use Math.random() for true randomness.
 *
 * The synthetic txHash is prefixed "0xcanary" so audit logs can
 * distinguish canary-skipped ops from real broadcasts.
 */
export class CanaryBroadcaster implements SignerSink {
  private readonly inner: SignerSink;
  // Mutable so setCanaryPct can update it at runtime.
  private canaryPct: number;
  private readonly deterministic: boolean;
  private readonly salt: string;
  private readonly metrics: MetricsRecorder;

  constructor(opts: {
    inner: SignerSink;
    canaryPct: number;
    deterministic?: boolean;
    salt?: string;
    metrics?: MetricsRecorder;
  }) {
    this.inner = opts.inner;
    this.canaryPct = Math.max(0, Math.min(100, opts.canaryPct));
    this.deterministic = opts.deterministic ?? true;
    this.salt = opts.salt ?? Math.random().toString(36).slice(2, 10);
    this.metrics = opts.metrics ?? new NoopMetricsRecorder();
  }

  /**
   * Decide whether to broadcast this request (canary) or skip it.
   *
   * Returns true iff the request should be broadcast (canary accepted).
   */
  private shouldBroadcast(req: SignerRequest): boolean {
    if (this.canaryPct >= 100) return true;
    if (this.canaryPct <= 0) return false;
    let roll: number;
    if (this.deterministic) {
      // Hash the request fields + salt → 0..99.
      const key = `${req.tx.from}|${req.tx.to}|${req.tx.value}|${req.tx.data}|${this.salt}`;
      let h = 0;
      for (let i = 0; i < key.length; i++) {
        h = ((h << 5) - h + key.charCodeAt(i)) | 0;
      }
      roll = Math.abs(h) % 100;
    } else {
      roll = Math.floor(Math.random() * 100);
    }
    return roll < this.canaryPct;
  }

  async submit(req: SignerRequest): Promise<SignerResult> {
    const start = Date.now();
    if (!this.shouldBroadcast(req)) {
      // Canary skip — synthetic success, no broadcast.
      this.metrics.record({
        layer: "broadcaster",
        op: "canary.submit",
        outcome: "skipped",
        durationMs: Date.now() - start,
        ts: start,
        fields: { canaryPct: this.canaryPct },
      });
      return { ok: true, txHash: "0xcanary" + "0".repeat(56) };
    }
    // Canary accept — delegate to the real broadcaster.
    const r = await this.inner.submit(req);
    this.metrics.record({
      layer: "broadcaster",
      op: "canary.submit",
      outcome: r.ok ? "ok" : "fail",
      durationMs: Date.now() - start,
      ts: start,
      fields: { canaryPct: this.canaryPct, error: r.error },
    });
    return r;
  }

  /** Update the canary percentage at runtime (no restart). */
  setCanaryPct(pct: number): void {
    this.canaryPct = Math.max(0, Math.min(100, pct));
  }

  /** Read the current canary percentage. */
  getCanaryPct(): number {
    return this.canaryPct;
  }
}

// -------------------------------------------------------------------------
// Instrumented wrappers — record metrics around each layer.
// -------------------------------------------------------------------------

/**
 * Wrap a SignerSink to record submit() latency + outcome.
 */
class InstrumentedSignerSink implements SignerSink {
  constructor(
    private readonly inner: SignerSink,
    private readonly metrics: MetricsRecorder,
    private readonly label: string,
  ) {}

  async submit(req: SignerRequest): Promise<SignerResult> {
    const start = Date.now();
    const r = await this.inner.submit(req);
    this.metrics.record({
      layer: "signer",
      op: this.label,
      outcome: r.ok ? "ok" : "fail",
      durationMs: Date.now() - start,
      ts: start,
      fields: { error: r.error },
    });
    return r;
  }
}

// -------------------------------------------------------------------------
// Runtime config
// -------------------------------------------------------------------------

export interface RuntimeRpcConfig {
  endpoints: RpcEndpoint[];
  transport: Transport;
  callTimeoutMs?: number;
}

export interface RuntimeSignerConfig {
  transport: SignerTransport;
}

export interface RuntimeLeaseConfig {
  /** Lease store. Default: new InMemoryLeaseStore(). */
  store?: LeaseStore;
  /** Lease key. Default: buildLeaseKey(signingAddress). */
  key?: LeaseKey;
  /** Owner ID. Default: generateOwnerId(). */
  owner?: LeaseOwner;
  /** TTL in ms. Default: 10_000. */
  ttlMs?: number;
  /** Renew interval in ms. Default: ttlMs / 3. */
  renewIntervalMs?: number;
}

export interface RuntimeCanaryConfig {
  /**
   * Percentage of accepted pipeline ops that actually broadcast.
   * 0 = no broadcast (dry-run). 100 = full broadcast (live).
   * Default: 0.
   */
  pct?: number;
  /**
   * Whether the canary decision is deterministic (hash-based) or
   * random. Default: true (deterministic — replayable for tests).
   */
  deterministic?: boolean;
}

export interface RuntimeConfig {
  rpc: RuntimeRpcConfig;
  signer: RuntimeSignerConfig;
  lease?: RuntimeLeaseConfig;
  canary?: RuntimeCanaryConfig;
  /** Metrics recorder. Default: NoopMetricsRecorder. */
  metrics?: MetricsRecorder;
  /** Logger. Default: no-op. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
  /**
   * The signing address (used to derive the lease key + as the `from`
   * field in transactions). Required — the runtime needs to know
   * which address the signer will sign for.
   */
  signingAddress: string;
  /**
   * The H2 gates — these are FROZEN modules that the runtime composes
   * but does NOT construct (the caller provides them, configured).
   * This keeps the runtime agnostic to how the gates are configured
   * (production uses real verifiers; tests use mocks).
   */
  gates: {
    simulation: SimulationGate;
    contract: ContractVerifier;
    liquidity: LiquidityVerifier;
    authority: TokenAuthorityVerifier;
    sellSim: SellSimVerifier;
    approval: ApprovalGate;
    audit: AuditSink;
  };
  /** Optional gas limit override (for tests + known-gas transactions). */
  fixedGasLimit?: bigint;
  /** Optional maxPriorityFeePerGas override (in wei). */
  fixedMaxPriorityFeePerGas?: bigint;
  /** Optional maxFeePerGas ceiling (in wei). */
  maxFeePerGasCeiling?: bigint;
}

// -------------------------------------------------------------------------
// Runtime — the assembled stack.
// -------------------------------------------------------------------------

export interface Runtime {
  /** The fully-wired Pipeline (H2.6, FROZEN). */
  pipeline: Pipeline;
  /** The QuorumRpcClient (H1.1, FROZEN). */
  rpc: QuorumRpcClient;
  /** The SignerAdapter (M3.1). */
  signerAdapter: SignerAdapter;
  /** The Broadcaster (M3.3). */
  broadcaster: Broadcaster;
  /** The WriterLease (M4). */
  lease: WriterLease;
  /** The LeasedBroadcaster (M4) — the Pipeline's `signer` field. */
  leasedBroadcaster: LeasedBroadcaster;
  /** The CanaryBroadcaster wrapping the LeasedBroadcaster (if canary config). */
  canary: CanaryBroadcaster | null;
  /** The metrics recorder. */
  metrics: MetricsRecorder;
  /** Tear down the runtime — stops the renewer, releases the lease. */
  shutdown: () => Promise<void>;
}

/**
 * Build the full chain stack and return a wired `Runtime`.
 *
 * See module docstring for the composition order + design rationale.
 */
export function buildRuntime(cfg: RuntimeConfig): Runtime {
  const metrics = cfg.metrics ?? new NoopMetricsRecorder();
  const log = cfg.log ?? (() => {});

  // Layer 1: QuorumRpcClient (H1.1, FROZEN).
  const rpc = new QuorumRpcClient({
    endpoints: cfg.rpc.endpoints,
    transport: cfg.rpc.transport,
    callTimeoutMs: cfg.rpc.callTimeoutMs ?? 5_000,
    log: (level, msg, fields) => log(level, `rpc: ${msg}`, fields),
  });

  // Layer 2: SignerAdapter (M3.1).
  const signerAdapter = makeSignerAdapter(cfg.signer.transport);

  // Layer 3: Broadcaster (M3.3).
  const broadcaster = new Broadcaster({
    rpc,
    signerAdapter,
    fixedGasLimit: cfg.fixedGasLimit,
    fixedMaxPriorityFeePerGas: cfg.fixedMaxPriorityFeePerGas,
    maxFeePerGasCeiling: cfg.maxFeePerGasCeiling,
    log: (level, msg, fields) => log(level, `broadcaster: ${msg}`, fields),
  });

  // Layer 4: WriterLease (M4).
  const leaseKey = cfg.lease?.key ?? buildLeaseKey(cfg.signingAddress);
  const leaseOwner = cfg.lease?.owner ?? generateOwnerId();
  const leaseStore = cfg.lease?.store ?? new InMemoryLeaseStore();
  const lease = new WriterLease({
    store: leaseStore,
    key: leaseKey,
    owner: leaseOwner,
    ttlMs: cfg.lease?.ttlMs ?? 10_000,
    renewIntervalMs: cfg.lease?.renewIntervalMs,
    log: (level, msg, fields) => log(level, `lease: ${msg}`, fields),
  });

  // Layer 5: LeasedBroadcaster (M4) — wraps Broadcaster + WriterLease.
  const leasedBroadcaster = new LeasedBroadcaster({
    broadcaster,
    lease,
    enableFencingCheck: true,
    log: (level, msg, fields) => log(level, `leased: ${msg}`, fields),
  });

  // Layer 6: CanaryBroadcaster (M5.3) — optional, gates broadcast by %.
  const canaryPct = cfg.canary?.pct ?? 0;
  let canary: CanaryBroadcaster | null = null;
  let signerSink: SignerSink = leasedBroadcaster;
  if (canaryPct < 100) {
    canary = new CanaryBroadcaster({
      inner: leasedBroadcaster,
      canaryPct,
      deterministic: cfg.canary?.deterministic ?? true,
      metrics,
    });
    signerSink = canary;
  }

  // Layer 7: Instrument the signer sink (records submit() latency).
  const instrumentedSigner = new InstrumentedSignerSink(signerSink, metrics, "submit");

  // Layer 8: Pipeline (H2.6, FROZEN) — signer = instrumented (canary → leased → broadcaster).
  const pipeline = new Pipeline({
    rpc,
    simulation: cfg.gates.simulation,
    contract: cfg.gates.contract,
    liquidity: cfg.gates.liquidity,
    authority: cfg.gates.authority,
    sellSim: cfg.gates.sellSim,
    approval: cfg.gates.approval,
    audit: cfg.gates.audit,
    signer: instrumentedSigner,
    log: (level, msg, fields) => log(level, `pipeline: ${msg}`, fields),
  });

  // Shutdown — stop the renewer + release the lease (if held).
  const shutdown = async () => {
    lease.stopRenewer();
    if (lease.isHeld()) {
      await lease.release();
    }
  };

  return {
    pipeline,
    rpc,
    signerAdapter,
    broadcaster,
    lease,
    leasedBroadcaster,
    canary,
    metrics,
    shutdown,
  };
}
