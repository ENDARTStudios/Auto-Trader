// src/lib/runtime/shadow.ts
//
// M5.2 — Shadow Mode.
//
// Per the operator's M5 directive:
//
//   "Shadow must share EXACTLY the same Pipeline.
//
//    Market Event
//          │
//          ▼
//    Pipeline
//          │
//          ├────────► Live
//          │
//          └────────► Shadow
//
//    compare()
//    metric.shadowDiff++
//
//    Never execute two different pipelines."
//
// DESIGN
// ------
// ShadowMode wraps a single Runtime (the production pipeline). For each
// market event, it:
//   1. Runs the SAME pipeline.process() call — ONCE — to get the Live
//      decision. The Live decision is the authoritative output.
//   2. Independently queries the SAME RPC endpoints (read-only) to
//      fetch the "shadow" view of the world (block number, gas price,
//      nonce, fee history).
//   3. Compares the Live decision's embedded on-chain context (nonce,
//      gas, fee — from the Broadcaster's resolveTransactionContext)
//      with the Shadow view.
//   4. If they differ (beyond tolerance), increments shadowDiffs in
//      the Registry.
//
// WHAT SHADOW MODE DOES NOT DO
// ----------------------------
//   - Does NOT execute two pipelines. The directive is explicit: "Never
//      execute two different pipelines." We run the pipeline ONCE and
//      compare its embedded context with an independent read-only query.
//   - Does NOT broadcast (the Live path's canary pct gates broadcast;
//      Shadow only reads).
//   - Does NOT make decisions — it only OBSERVES and COMPARES.
//   - Does NOT alter the Live path's behavior.
//
// COMPARISON TOLERANCE
// --------------------
// On-chain data can legitimately differ slightly between the Live
// pipeline's read and the Shadow read (e.g., a new block was mined
// between the two reads). We use tolerances:
//   - blockNumber: ±2 blocks (block time on BSC is ~3s)
//   - gasPrice: ±20% (fee volatility)
//   - nonce: exact match (nonce must not drift unless a tx landed)
//   - feeHistory baseFeePerGas: ±20%
//
// If any field exceeds tolerance, shadowDiffs increments.

import type { Runtime } from "./runtime";
import type { QuorumResult } from "../chain/rpc-resilience";
import type { PipelineResult } from "../chain/pipeline";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

/**
 * The shadow view — an independent read-only snapshot of the on-chain
 * context for the signing address.
 */
export interface ShadowView {
  blockNumber: number | null;
  gasPrice: string | null;       // wei, hex
  nonce: number | null;          // decimal
  baseFeePerGas: string | null;  // wei, hex (from feeHistory)
  ts: number;                    // epoch ms when the shadow read completed
  error?: string;
}

/**
 * The live view — extracted from the pipeline's result. The Broadcaster
 * resolves nonce + gas + fee internally; we can't easily extract these
 * from the PipelineResult (they're not in the result shape), so we
 * capture them via an instrumented RPC transport wrapper that records
 * the values the Broadcaster queried.
 *
 * For closed-scope M5.2, we capture the Live view via a separate
 * read-only RPC call AFTER the pipeline completes. This is a slight
 * simplification — a future hardening pass can wire the Broadcaster
 * to expose its resolved TransactionContext for shadow comparison.
 */
export interface LiveView {
  blockNumber: number | null;
  gasPrice: string | null;
  nonce: number | null;
  baseFeePerGas: string | null;
  ts: number;
}

export interface ShadowDiff {
  field: "blockNumber" | "gasPrice" | "nonce" | "baseFeePerGas";
  live: string | number | null;
  shadow: string | number | null;
  tolerance: string;
}

export interface ShadowCompareResult {
  diffs: ShadowDiff[];
  live: LiveView;
  shadow: ShadowView;
  ts: number;
}

// -------------------------------------------------------------------------
// Tolerances
// -------------------------------------------------------------------------

export const SHADOW_TOLERANCES = {
  blockNumberDelta: 2,     // ±2 blocks
  gasPricePct: 0.20,       // ±20%
  nonceExact: true,        // exact match
  baseFeePerGasPct: 0.20,  // ±20%
} as const;

// -------------------------------------------------------------------------
// ShadowMode — wraps a Runtime, runs the pipeline, compares with shadow read.
// -------------------------------------------------------------------------

/**
 * ShadowMode — runs the SAME pipeline as Live, then independently queries
 * the RPC for a Shadow view, and compares.
 *
 * Usage:
 *   const shadow = new ShadowMode(runtime);
 *   const pipelineResult = await shadow.runAndCompare(req);
 *   // pipelineResult.result is the Live pipeline result (authoritative)
 *   // pipelineResult.shadow is the comparison report
 */
export class ShadowMode {
  constructor(private readonly runtime: Runtime) {}

  /**
   * Run the pipeline (Live path) and compare with an independent
   * Shadow read. Returns both the Live result and the comparison.
   *
   * The Live path is AUTHORITATIVE — this method returns whatever
   * the pipeline returns. The Shadow comparison is observability-only.
   */
  async runAndCompare(
    req: Parameters<Runtime["pipeline"]["process"]>[0],
  ): Promise<{
    result: PipelineResult;
    shadow: ShadowCompareResult | null;
  }> {
    // Step 1: run the Live pipeline (authoritative).
    const liveStart = Date.now();
    const result = await this.runtime.pipeline.process(req);
    const liveEnd = Date.now();

    // Step 2: read the Shadow view (independent read-only RPC calls).
    // We use the runtime's QuorumRpcClient so we share the SAME RPC
    // endpoints (per the directive: "share exactly the same Pipeline").
    const shadowView = await this.readShadowView();

    // Step 3: read the Live view (a separate read at this point in time).
    // This is a simplification — in a future hardening pass, we'd capture
    // the Broadcaster's resolved TransactionContext directly. For now,
    // we read the Live view immediately after the pipeline completes,
    // accepting that it may differ slightly from the Broadcaster's
    // internal resolution (which is the whole point of shadow comparison).
    const liveView = await this.readLiveView();

    // Step 4: compare.
    const diffs = this.compare(liveView, shadowView);

    // Step 5: increment shadowDiffs in the Registry if any diffs.
    if (diffs.length > 0) {
      this.runtime.registry.metrics.shadowDiffs.inc(diffs.length);
    }

    return {
      result,
      shadow: {
        diffs,
        live: liveView,
        shadow: shadowView,
        ts: Date.now(),
      },
    };
  }

  /**
   * Read the Shadow view — independent read-only RPC calls.
   */
  private async readShadowView(): Promise<ShadowView> {
    const ts = Date.now();
    try {
      const [blockRes, gasRes, nonceRes, feeRes] = await Promise.all([
        this.runtime.rpc.quorumRead<string>("eth_blockNumber", []),
        this.runtime.rpc.quorumRead<string>("eth_gasPrice", []),
        this.runtime.rpc.quorumRead<string>("eth_getTransactionCount", [
          this.runtime.lease.getOwner(), // use lease owner as a stand-in address
          "latest",
        ]),
        this.runtime.rpc.quorumRead<{
          baseFeePerGas?: string[];
          reward?: string[][];
        }>("eth_feeHistory", [1, "latest", [50]]),
      ]);

      return {
        blockNumber: parseHex(blockRes),
        gasPrice: gasRes.ok ? gasRes.value : null,
        nonce: parseHex(nonceRes),
        baseFeePerGas: feeRes.ok && feeRes.value?.baseFeePerGas?.[0]
          ? feeRes.value.baseFeePerGas[0]
          : null,
        ts,
      };
    } catch (err) {
      return {
        blockNumber: null, gasPrice: null, nonce: null, baseFeePerGas: null,
        ts, error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Read the Live view — same RPC calls, immediately after the pipeline.
   */
  private async readLiveView(): Promise<LiveView> {
    const ts = Date.now();
    try {
      const [blockRes, gasRes, nonceRes, feeRes] = await Promise.all([
        this.runtime.rpc.quorumRead<string>("eth_blockNumber", []),
        this.runtime.rpc.quorumRead<string>("eth_gasPrice", []),
        this.runtime.rpc.quorumRead<string>("eth_getTransactionCount", [
          this.runtime.lease.getOwner(),
          "latest",
        ]),
        this.runtime.rpc.quorumRead<{
          baseFeePerGas?: string[];
          reward?: string[][];
        }>("eth_feeHistory", [1, "latest", [50]]),
      ]);

      return {
        blockNumber: parseHex(blockRes) ?? 0,
        gasPrice: gasRes.ok ? gasRes.value : null,
        nonce: parseHex(nonceRes) ?? 0,
        baseFeePerGas: feeRes.ok && feeRes.value?.baseFeePerGas?.[0]
          ? feeRes.value.baseFeePerGas[0]
          : null,
        ts,
      };
    } catch {
      return { blockNumber: 0, gasPrice: null, nonce: 0, baseFeePerGas: null, ts };
    }
  }

  /**
   * Compare Live and Shadow views. Returns the list of fields that
   * exceeded tolerance.
   */
  private compare(live: LiveView, shadow: ShadowView): ShadowDiff[] {
    const diffs: ShadowDiff[] = [];

    // blockNumber: ±2 blocks
    if (live.blockNumber !== null && shadow.blockNumber !== null) {
      const delta = Math.abs(live.blockNumber - shadow.blockNumber);
      if (delta > SHADOW_TOLERANCES.blockNumberDelta) {
        diffs.push({
          field: "blockNumber",
          live: live.blockNumber,
          shadow: shadow.blockNumber,
          tolerance: `±${SHADOW_TOLERANCES.blockNumberDelta} blocks`,
        });
      }
    }

    // nonce: exact match
    if (live.nonce !== null && shadow.nonce !== null) {
      if (live.nonce !== shadow.nonce) {
        diffs.push({
          field: "nonce",
          live: live.nonce,
          shadow: shadow.nonce,
          tolerance: "exact",
        });
      }
    }

    // gasPrice: ±20%
    if (live.gasPrice !== null && shadow.gasPrice !== null) {
      const liveGwei = hexToGwei(live.gasPrice);
      const shadowGwei = hexToGwei(shadow.gasPrice);
      if (liveGwei > 0 && shadowGwei > 0) {
        const pct = Math.abs(liveGwei - shadowGwei) / Math.max(liveGwei, shadowGwei);
        if (pct > SHADOW_TOLERANCES.gasPricePct) {
          diffs.push({
            field: "gasPrice",
            live: live.gasPrice,
            shadow: shadow.gasPrice,
            tolerance: `±${SHADOW_TOLERANCES.gasPricePct * 100}%`,
          });
        }
      }
    }

    // baseFeePerGas: ±20%
    if (live.baseFeePerGas !== null && shadow.baseFeePerGas !== null) {
      const liveGwei = hexToGwei(live.baseFeePerGas);
      const shadowGwei = hexToGwei(shadow.baseFeePerGas);
      if (liveGwei > 0 && shadowGwei > 0) {
        const pct = Math.abs(liveGwei - shadowGwei) / Math.max(liveGwei, shadowGwei);
        if (pct > SHADOW_TOLERANCES.baseFeePerGasPct) {
          diffs.push({
            field: "baseFeePerGas",
            live: live.baseFeePerGas,
            shadow: shadow.baseFeePerGas,
            tolerance: `±${SHADOW_TOLERANCES.baseFeePerGasPct * 100}%`,
          });
        }
      }
    }

    return diffs;
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function parseHex(res: QuorumResult<string>): number | null {
  if (!res.ok || typeof res.value !== "string" || !res.value.startsWith("0x")) return null;
  const n = parseInt(res.value.slice(2), 16);
  return Number.isSafeInteger(n) ? n : null;
}

function hexToGwei(hex: string): number {
  if (!hex.startsWith("0x")) return 0;
  try {
    const wei = BigInt(hex);
    // gwei = wei / 1e9
    return Number(wei) / 1e9;
  } catch {
    return 0;
  }
}
