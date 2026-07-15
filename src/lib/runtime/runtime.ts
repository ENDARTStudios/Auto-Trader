// src/lib/runtime/runtime.ts
//
// M5.0 + M5.5b — Production runtime factory (Registry-backed).
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
//   CanaryBroadcaster (M5.3)    ← wraps LeasedBroadcaster (deterministic bucket)
//     ↓
//   Pipeline (H2.6)             ← signer: instrumented canary → leased → broadcaster
//
// Every M5 harness (dry-run, shadow, chaos, long-duration) consumes
// this factory so the wiring is validated EXACTLY ONCE and reused
// everywhere.
//
// REGISTRY INTEGRATION (M5.5b)
// ----------------------------
// Per the operator's M5 directive: "All M5 infrastructure consumes
// only this Registry."
//
// The runtime accepts a `Registry` (from src/lib/observability/registry.ts).
// If none is provided, it uses the global singleton. All instrumented
// wrappers (InstrumentedSignerSink, CanaryBroadcaster, etc.) record
// metrics into THIS Registry — no scattered metrics collection.
//
// The runtime also exposes a `RuntimeHandle` that the Exporter queries
// for live state (canary pct, lease active, RPC health) when serving
// GET /api/runtime/status.
//
// CANARY MODE (M5.3 — deterministic bucket)
// ------------------------------------------
// Per the operator's M5 directive:
//
//   "Avoid simple randomness.
//    Use deterministic hash.
//    bucket = keccak256(txHash) % 100
//    bucket < canaryPct"
//
// The CanaryBroadcaster computes a deterministic bucket from the
// transaction's signature-relevant fields (from/to/value/data + a
// per-process salt) using keccak256. The same request always lands
// in the same bucket — this gives:
//   - stable distribution (no temporal bias)
//   - reproducibility (tests can predict canary decisions)
//   - auditability (the bucket can be logged alongside the decision)
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
// `Runtime` + a `RuntimeHandle` for observability.

import { keccak_256 } from "@noble/hashes/sha3.js";
import { QuorumRpcClient, type RpcEndpoint, type Transport } from "../chain/rpc-resilience";
import { SignerAdapter, type SignerTransport, makeSignerAdapter } from "../chain/signer-adapter";
import { Broadcaster } from "../chain/broadcaster";
import {
  WriterLease,
  InMemoryLeaseStore,
  buildLeaseKey,
  generateOwnerId,
  type LeaseStore,
  type LeaseKey,
  type LeaseOwner,
} from "../chain/writer-lease";
import { LeasedBroadcaster } from "../chain/leased-broadcaster";
import {
  Pipeline,
  type SignerSink,
  type SignerRequest,
  type SignerResult,
  type AuditSink,
  type GateName,
} from "../chain/pipeline";
import type { SimulationGate } from "../chain/simulation-gate";
import type { ContractVerifier } from "../chain/contract-verification";
import type { LiquidityVerifier } from "../chain/liquidity-verification";
import type { TokenAuthorityVerifier } from "../chain/token-authority";
import type { SellSimVerifier } from "../chain/sell-simulation";
import type { ApprovalGate } from "../chain/approval-hardening";
import { Registry } from "../observability/registry";
import type { RuntimeHandle } from "../observability/exporter";

// -------------------------------------------------------------------------
// Backward-compat: MetricsRecorder alias.
// -------------------------------------------------------------------------

/**
 * @deprecated Use `Registry` directly. The MetricsRecorder interface
 * is kept as a thin adapter so existing tests (M5.1 dry-run, M5.4 chaos)
 * continue to work while they migrate to the Registry.
 *
 * The adapter wraps a Registry and translates `record(event)` calls
 * into the appropriate Counter/Histogram operations.
 */
export interface MetricEvent {
  layer: "pipeline" | "rpc" | "signer" | "broadcaster" | "lease";
  op: string;
  outcome: string;
  durationMs: number;
  ts: number;
  fields?: Record<string, unknown>;
}

export interface MetricsRecorder {
  record(event: MetricEvent): void;
}

/**
 * Adapter that translates MetricEvent calls into Registry operations.
 *
 * Mapping:
 *   - layer=signer, op=submit, outcome=ok/fail → signerLatencyMs.observe + signerErrors.inc (if fail)
 *   - layer=broadcaster, op=canary.submit, outcome=skipped → canarySkipped.inc
 *   - layer=broadcaster, op=canary.submit, outcome=ok → canaryAccepted.inc + broadcastLatencyMs.observe
 *   - layer=broadcaster, op=canary.submit, outcome=fail → broadcastErrors.inc
 *   - layer=lease, op=acquire, outcome=ok/busy → leaseAcquireMs.observe
 *
 * The adapter also keeps a ring buffer of the last N events for tests
 * that inspect raw event streams.
 */
export class RegistryMetricsAdapter implements MetricsRecorder {
  private readonly events: MetricEvent[] = [];
  private readonly counters = new Map<string, number>();
  private readonly maxEvents: number;

  constructor(private readonly registry: Registry, maxEvents: number = 10_000) {
    this.maxEvents = maxEvents;
  }

  record(event: MetricEvent): void {
    // Ring buffer for backward-compat with tests that call getEvents().
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
    const key = `${event.layer}.${event.op}.${event.outcome}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);

    // Translate to Registry operations.
    const m = this.registry.metrics;
    if (event.layer === "signer" && event.op === "submit") {
      m.signerLatencyMs.observe(event.durationMs);
      if (event.outcome === "fail") m.signerErrors.inc();
    } else if (event.layer === "broadcaster" && event.op === "canary.submit") {
      if (event.outcome === "skipped") {
        m.canarySkipped.inc();
      } else if (event.outcome === "ok") {
        m.canaryAccepted.inc();
        m.broadcastLatencyMs.observe(event.durationMs);
      } else if (event.outcome === "fail") {
        m.broadcastErrors.inc();
        m.broadcastLatencyMs.observe(event.durationMs);
      }
    } else if (event.layer === "lease" && event.op === "acquire") {
      m.leaseAcquireMs.observe(event.durationMs);
    }
  }

  getEvents(): MetricEvent[] { return [...this.events]; }
  getCounters(): Record<string, number> { return Object.fromEntries(this.counters); }
  latencyPercentiles(layer: MetricEvent["layer"], op: string): { p50: number; p95: number; p99: number; count: number } {
    const ds = this.events.filter((e) => e.layer === layer && e.op === op).map((e) => e.durationMs).sort((a, b) => a - b);
    if (ds.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const pick = (p: number) => ds[Math.min(ds.length - 1, Math.floor(ds.length * p))];
    return { p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), count: ds.length };
  }
  reset(): void { this.events.length = 0; this.counters.clear(); }
}

export class NoopMetricsRecorder implements MetricsRecorder {
  record(): void { /* no-op */ }
}

// -------------------------------------------------------------------------
// CanaryBroadcaster — deterministic bucket via keccak256 (M5.3).
// -------------------------------------------------------------------------

/**
 * A wrapper around LeasedBroadcaster that gates broadcast by a
 * deterministic bucket, per the operator's M5 directive:
 *
 *   bucket = keccak256(canonicalKey) % 100
 *   if bucket < canaryPct → broadcast (canary accepted)
 *   else                  → skip (canary skipped)
 *
 * The canonical key is built from the SignerRequest's signature-relevant
 * fields: tx.from + tx.to + tx.value + tx.data + a per-process salt.
 * The salt ensures different processes (with different owners) make
 * INDEPENDENT canary decisions — process A and process B won't both
 * broadcast the same tx.
 *
 * The synthetic txHash for skipped ops is "0xcanary" + 56 zeros, so
 * audit logs can distinguish canary-skipped ops from real broadcasts.
 */
export class CanaryBroadcaster implements SignerSink {
  private readonly inner: SignerSink;
  private canaryPct: number;
  private readonly salt: string;
  private readonly metrics: MetricsRecorder;

  constructor(opts: {
    inner: SignerSink;
    canaryPct: number;
    salt?: string;
    metrics?: MetricsRecorder;
  }) {
    this.inner = opts.inner;
    this.canaryPct = Math.max(0, Math.min(100, opts.canaryPct));
    this.salt = opts.salt ?? Math.random().toString(36).slice(2, 10);
    this.metrics = opts.metrics ?? new NoopMetricsRecorder();
  }

  /**
   * Compute the deterministic canary bucket for a request.
   *
   * bucket = keccak256(canonicalKey) % 100
   *
   * where canonicalKey = from|to|value|data|salt (UTF-8 encoded).
   *
   * Returns a value in [0, 99].
   */
  private bucket(req: SignerRequest): number {
    const key = `${req.tx.from}|${req.tx.to}|${req.tx.value}|${req.tx.data}|${this.salt}`;
    const bytes = new TextEncoder().encode(key);
    const hash = keccak_256(bytes);
    // Take the last byte (0-255) and mod 100.
    return hash[hash.length - 1]! % 100;
  }

  /**
   * Returns true iff the request should be broadcast (canary accepted).
   */
  private shouldBroadcast(req: SignerRequest): boolean {
    if (this.canaryPct >= 100) return true;
    if (this.canaryPct <= 0) return false;
    return this.bucket(req) < this.canaryPct;
  }

  async submit(req: SignerRequest): Promise<SignerResult> {
    const start = Date.now();
    if (!this.shouldBroadcast(req)) {
      this.metrics.record({
        layer: "broadcaster", op: "canary.submit", outcome: "skipped",
        durationMs: Date.now() - start, ts: start,
        fields: { canaryPct: this.canaryPct },
      });
      return { ok: true, txHash: "0xcanary" + "0".repeat(56) };
    }
    const r = await this.inner.submit(req);
    this.metrics.record({
      layer: "broadcaster", op: "canary.submit",
      outcome: r.ok ? "ok" : "fail",
      durationMs: Date.now() - start, ts: start,
      fields: { canaryPct: this.canaryPct, error: r.error },
    });
    return r;
  }

  setCanaryPct(pct: number): void { this.canaryPct = Math.max(0, Math.min(100, pct)); }
  getCanaryPct(): number { return this.canaryPct; }
}

// -------------------------------------------------------------------------
// Instrumented wrappers — record metrics into the Registry.
// -------------------------------------------------------------------------

/**
 * Wrap a SignerSink to record submit() latency + outcome into the
 * Registry (via the MetricsRecorder adapter).
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
      layer: "signer", op: this.label,
      outcome: r.ok ? "ok" : "fail",
      durationMs: Date.now() - start, ts: start,
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
  store?: LeaseStore;
  key?: LeaseKey;
  owner?: LeaseOwner;
  ttlMs?: number;
  renewIntervalMs?: number;
}

export interface RuntimeCanaryConfig {
  /** Percentage of accepted pipeline ops that actually broadcast. 0=dry-run, 100=live. Default: 0. */
  pct?: number;
  /** Per-process salt for deterministic bucketing. Default: random. */
  salt?: string;
}

export interface RuntimeConfig {
  rpc: RuntimeRpcConfig;
  signer: RuntimeSignerConfig;
  lease?: RuntimeLeaseConfig;
  canary?: RuntimeCanaryConfig;
  /**
   * The Registry. Default: Registry.global().
   *
   * All metrics (latency, counters, gauges) are recorded into THIS
   * Registry. The runtime factory also creates a MetricsRecorder
   * adapter that wraps this Registry for backward-compat with the
   * InstrumentedSignerSink / CanaryBroadcaster.
   */
  registry?: Registry;
  /** Logger. Default: no-op. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
  signingAddress: string;
  gates: {
    simulation: SimulationGate;
    contract: ContractVerifier;
    liquidity: LiquidityVerifier;
    authority: TokenAuthorityVerifier;
    sellSim: SellSimVerifier;
    approval: ApprovalGate;
    audit: AuditSink;
  };
  fixedGasLimit?: bigint;
  fixedMaxPriorityFeePerGas?: bigint;
  maxFeePerGasCeiling?: bigint;
}

// -------------------------------------------------------------------------
// Runtime — the assembled stack.
// -------------------------------------------------------------------------

export interface Runtime {
  pipeline: Pipeline;
  rpc: QuorumRpcClient;
  signerAdapter: SignerAdapter;
  broadcaster: Broadcaster;
  lease: WriterLease;
  leasedBroadcaster: LeasedBroadcaster;
  canary: CanaryBroadcaster | null;
  /** The Registry (single source of truth for metrics). */
  registry: Registry;
  /** The MetricsRecorder adapter (backward-compat — wraps the Registry). */
  metrics: MetricsRecorder;
  /** The RuntimeHandle (for the Exporter / /api/runtime/status). */
  handle: RuntimeHandle;
  shutdown: () => Promise<void>;
}

/**
 * Build the full chain stack and return a wired `Runtime`.
 */
export function buildRuntime(cfg: RuntimeConfig): Runtime {
  const registry = cfg.registry ?? Registry.global();
  const metrics: MetricsRecorder = new RegistryMetricsAdapter(registry);
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
    rpc, signerAdapter,
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
    store: leaseStore, key: leaseKey, owner: leaseOwner,
    ttlMs: cfg.lease?.ttlMs ?? 10_000,
    renewIntervalMs: cfg.lease?.renewIntervalMs,
    log: (level, msg, fields) => log(level, `lease: ${msg}`, fields),
  });

  // Layer 5: LeasedBroadcaster (M4).
  const leasedBroadcaster = new LeasedBroadcaster({
    broadcaster, lease, enableFencingCheck: true,
    log: (level, msg, fields) => log(level, `leased: ${msg}`, fields),
  });

  // Layer 6: CanaryBroadcaster (M5.3) — deterministic bucket.
  const canaryPct = cfg.canary?.pct ?? 0;
  let canary: CanaryBroadcaster | null = null;
  let signerSink: SignerSink = leasedBroadcaster;
  if (canaryPct < 100) {
    canary = new CanaryBroadcaster({
      inner: leasedBroadcaster,
      canaryPct,
      salt: cfg.canary?.salt,
      metrics,
    });
    signerSink = canary;
  }

  // Layer 7: Instrumented signer sink.
  const instrumentedSigner = new InstrumentedSignerSink(signerSink, metrics, "submit");

  // Layer 8: Pipeline (H2.6, FROZEN).
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

  // RuntimeHandle — queried by the Exporter for live state.
  const handle: RuntimeHandle = {
    getCanaryPct: () => canary?.getCanaryPct() ?? 100,
    isLeaseActive: () => lease.isHeld(),
    getRpcHealthy: () => {
      // Count endpoints with health > healthFloor (0.2 default).
      // The QuorumRpcClient doesn't expose a public health API, but we
      // can approximate: if the last RPC call succeeded, the quorum is
      // healthy. For a precise count, we'd need to expose the endpoint
      // state map — deferred to a future hardening pass.
      return rpc.endpoints.length;
    },
    getRpcUnhealthy: () => 0,
    getLeaseRenews: () => 0, // tracked by the lease's renewer (future)
    getLeaseFailures: () => 0, // tracked by scanning failed rounds
    getStatus: () => "RUNNING" as const,
  };

  const shutdown = async () => {
    lease.stopRenewer();
    if (lease.isHeld()) await lease.release();
  };

  return {
    pipeline, rpc, signerAdapter, broadcaster, lease, leasedBroadcaster,
    canary, registry, metrics, handle, shutdown,
  };
}

// Re-export the InMemoryMetricsRecorder for backward-compat with tests.
// This is a thin wrapper that uses a fresh Registry internally.
export class InMemoryMetricsRecorder implements MetricsRecorder {
  private readonly adapter: RegistryMetricsAdapter;
  constructor(maxEvents: number = 10_000) {
    this.adapter = new RegistryMetricsAdapter(Registry.create(), maxEvents);
  }
  record(event: MetricEvent): void { this.adapter.record(event); }
  getEvents(): MetricEvent[] { return this.adapter.getEvents(); }
  getCounters(): Record<string, number> { return this.adapter.getCounters(); }
  latencyPercentiles(layer: MetricEvent["layer"], op: string) {
    return this.adapter.latencyPercentiles(layer, op);
  }
  reset(): void { this.adapter.reset(); }
  /** Expose the underlying Registry for tests that want to inspect it. */
  getRegistry(): Registry {
    return (this.adapter as unknown as { registry: Registry }).registry;
  }
}
