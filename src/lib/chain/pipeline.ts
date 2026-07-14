// H2.6 — Integration Gate (operator-directed).
//
// DESIGN PHILOSOPHY
// -----------------
// H1 and H2 each validated hardened primitives in isolation: RPC
// resilience, simulation, contract verification, liquidity, authority,
// sell simulation, approval, MEV baseline. Each primitive has its own
// unit + adversarial tests. What was NOT demonstrated is that the
// composition of all primitives — when chained in the mandated order —
// preserves:
//
//   1. ORDER: gates run in the fixed sequence the operator drew:
//        RPC → Simulation → Contract Verification → Liquidity →
//        Authority → Sell Simulation → Approval → MEV → Signer
//      No reordering, no skipping.
//
//   2. SHORT-CIRCUIT: the first gate that fails stops the pipeline.
//      Subsequent gates are NEVER invoked. This is the "contract fails
//      H2.1 → H2.2 never executes" property.
//
//   3. ORIGINAL REASON PRESERVATION: the failing gate's reason is
//      propagated verbatim — not normalized, not truncated, not
//      rewritten. The caller can branch on the exact reason string
//      the gate produced.
//
//   4. AUDIT EXACTLY-ONCE: every process() call writes exactly one
//      audit entry. Success writes one entry; failure writes one
//      entry; exception writes one entry. There is no path that
//      writes zero entries, and no path that writes more than one.
//
//   5. SIGNER GATING: the signer is invoked iff every gate passes.
//      Any gate failure → signer is not called. The "LP invalid →
//      signer never receives request" property.
//
//   6. NO BYPASS: there is no skipGate / ignoreFailure / bypassOrder
//      option on PipelineConfig. The composer always runs every gate
//      in fixed order. An attacker who controls the request cannot
//      make the composer skip a gate.
//
// WHAT THIS MODULE DOES NOT DO
// ----------------------------
// H2.6 adds NO new functionality. It only composes existing primitives.
// Real signing, real broadcast, Flashbots, MEV Blocker, SUAVE, bundles,
// private mempool — all belong to M3/M4 when a real execution path
// exists. The SignerSink interface is the placeholder for M3 to plug
// in the real signer process.
//
// ADVERSARIAL SCOPE (per permanent principle)
// -------------------------------------------
//   - Bypass attempt: confirm PipelineConfig has no skip option.
//   - Double simultaneous failure: first-failure-wins; the second
//     failing gate is never reached, so its reason does NOT appear
//     in the result.
//   - Corrupted state between gates: each gate receives its own
//     manifest from the request; mutating one manifest after the
//     gate ran does not affect subsequent gates.
//   - Audit exactly-once on exception path: a gate that throws (not
//     just returns ok=false) still produces exactly one audit entry.

import type { QuorumRpcClient, QuorumResult } from "./rpc-resilience";
import type {
  SimulationGate,
  GateResult,
  ExpectedDiff,
} from "./simulation-gate";
import type {
  ContractVerifier,
  ContractManifest,
  VerificationResult,
} from "./contract-verification";
import type {
  LiquidityVerifier,
  LiquidityManifest,
  LiquidityReport,
} from "./liquidity-verification";
import type {
  TokenAuthorityVerifier,
  TokenAuthorityManifest,
  AuthorityReport,
} from "./token-authority";
import type {
  SellSimVerifier,
  SellSimManifest,
  SellSimResult,
} from "./sell-simulation";
import type {
  ApprovalGate,
  ApprovalRequest,
  ApprovalDecision,
} from "./approval-hardening";
import type {
  SlippageInputs,
  SlippageCheck,
  SandwichAnalysis,
  PoolStateSnapshot,
  AddressActivity,
} from "./mev-baseline";
import { checkSlippage, detectSandwich } from "./mev-baseline";

// -------------------------------------------------------------------------
// Gate names — the canonical order, exported for the "no bypass" test.
// -------------------------------------------------------------------------

export const GATE_ORDER = [
  "rpc",
  "simulation",
  "contract",
  "liquidity",
  "authority",
  "sell-sim",
  "approval",
  "mev",
  "signer",
] as const;

export type GateName = (typeof GATE_ORDER)[number];

// -------------------------------------------------------------------------
// Audit sink — wraps AuditLog for testability. Production wraps the H0.3
// AuditLog instance; tests use an in-memory recorder.
// -------------------------------------------------------------------------

export interface AuditSink {
  append(
    event: string,
    payload: Record<string, unknown>,
  ): { seq: number; hash: string };
}

// -------------------------------------------------------------------------
// Signer sink — the placeholder for M3's real signer. The composer
// constructs a SignerRequest and calls signer.submit() iff every gate
// passes. In H2.6 tests this is a mock that records the call.
// -------------------------------------------------------------------------

export interface SignerRequest {
  /** The fully-formed transaction the signer is asked to sign + broadcast. */
  tx: { from: string; to: string; value: string; data: string };
  /** The caller's expected state diff (carried from the request). */
  expectedDiff: ExpectedDiff;
  /** The approval gate's approvedAmount (after cap). */
  approvedAmount: string;
  /** The MEV gate's slippage limit in bps. */
  slippageLimitBps: number;
  /** The MEV gate's sandwich score [0..1]. 0 = no sandwich detected. */
  sandwichScore: number;
}

export interface SignerResult {
  ok: boolean;
  /** Tx hash if accepted by the signer. */
  txHash?: string;
  /** Reason for rejection, if ok=false. */
  error?: string;
}

export interface SignerSink {
  submit(req: SignerRequest): Promise<SignerResult>;
}

// -------------------------------------------------------------------------
// Pipeline request — everything the composer needs to run all gates.
// Each gate consumes its own slice; the composer does not transform.
// -------------------------------------------------------------------------

export interface SandwichInputs {
  victimAddress: string;
  preState: PoolStateSnapshot;
  postState: PoolStateSnapshot;
  observedTrades: AddressActivity[];
}

export interface MevInputs {
  /** Slippage check inputs (volatility, trade size, pool liquidity). */
  slippage: SlippageInputs;
  /** Expected execution price (e.g. USD per token) the caller assumed. */
  expectedPrice: number;
  /** Actual execution price observed (e.g. from sell-sim actualAmountOut). */
  actualPrice: number;
  /** Sandwich detection inputs. */
  sandwich: SandwichInputs;
}

export interface PipelineRequest {
  /** The fully-formed transaction the pipeline is gating. */
  tx: { from: string; to: string; value: string; data: string };
  /** The caller's expected state diff for the simulation gate. */
  expectedDiff: ExpectedDiff;
  /** Contract verification manifest (H2.1). */
  contractManifest: ContractManifest;
  /** Liquidity verification manifest (H2.2). */
  liquidityManifest: LiquidityManifest;
  /** Token authority manifest (H2.3). */
  authorityManifest: TokenAuthorityManifest;
  /** Sell simulation manifest (H2.4). */
  sellSimManifest: SellSimManifest;
  /** Approval request (H1.3). */
  approvalRequest: ApprovalRequest;
  /** MEV inputs (H1.4): slippage + sandwich. */
  mevInputs: MevInputs;
}

// -------------------------------------------------------------------------
// Pipeline result — what the composer returns.
// -------------------------------------------------------------------------

export interface PipelineGateResult {
  rpc?: QuorumResult<unknown>;
  simulation?: GateResult;
  contract?: VerificationResult;
  liquidity?: LiquidityReport;
  authority?: AuthorityReport;
  sellSim?: SellSimResult;
  approval?: ApprovalDecision;
  mev?: { slippage: SlippageCheck; sandwich: SandwichAnalysis };
  signer?: SignerResult;
}

export interface PipelineResult {
  /** True iff every gate passed AND the signer accepted. */
  ok: boolean;
  /**
   * Which gate failed. Null on full success. "signer" means every gate
   * passed but the signer rejected (rare — usually indicates the signer
   * process itself had a problem).
   */
  failedGate: GateName | null;
  /**
   * The failing gate's original reason, preserved verbatim. Null on
   * success. For exception-caused failures, prefixed with "exception: ".
   */
  originalReason: string | null;
  /** Each gate's raw result (undefined if not reached). */
  gates: PipelineGateResult;
  /** The audit entry seq that was written. */
  auditSeq: number;
  /** The audit entry hash that was written. */
  auditHash: string;
  /**
   * The list of gates that were actually executed, in order. Used by
   * the "no bypass" test to verify the gate sequence.
   */
  executedGates: GateName[];
}

// -------------------------------------------------------------------------
// Config — NO bypass options exist. Deliberately minimal.
// -------------------------------------------------------------------------

export interface PipelineConfig {
  /** RPC client used for the preflight (block number) gate. */
  rpc: QuorumRpcClient;
  /** H1.2 simulation gate. */
  simulation: SimulationGate;
  /** H2.1 contract verifier. */
  contract: ContractVerifier;
  /** H2.2 liquidity verifier. */
  liquidity: LiquidityVerifier;
  /** H2.3 token authority verifier. */
  authority: TokenAuthorityVerifier;
  /** H2.4 sell simulation verifier. */
  sellSim: SellSimVerifier;
  /** H1.3 approval gate. */
  approval: ApprovalGate;
  /** Audit sink (wraps H0.3 AuditLog in production). */
  audit: AuditSink;
  /** Signer sink (mock in H2.6 tests; real signer in M3+). */
  signer: SignerSink;
  /**
   * Logger — defaults to no-op. Used for observability only; does not
   * affect gate decisions.
   */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

function noopLog() {
  /* no-op */
}

// -------------------------------------------------------------------------
// The composer.
// -------------------------------------------------------------------------

export class Pipeline {
  private readonly cfg: Required<PipelineConfig>;

  constructor(config: PipelineConfig) {
    this.cfg = {
      ...config,
      log: config.log ?? noopLog,
    };
  }

  /**
   * Run the full pipeline. Returns a PipelineResult. Writes exactly one
   * audit entry via the configured AuditSink, regardless of outcome
   * (success, failure, or exception).
   *
   * The composer does NOT throw. Any exception from a gate is caught
   * and converted into a failed PipelineResult with failedGate set to
   * the gate that threw, and originalReason prefixed with "exception: ".
   * This ensures the audit entry is always written.
   */
  async process(req: PipelineRequest): Promise<PipelineResult> {
    const executedGates: GateName[] = [];
    const gates: PipelineGateResult = {};

    // Helper: write exactly one audit entry and return a failed result.
    // This is the ONLY place audit.append is called on the failure path.
    const fail = (
      failedGate: GateName,
      originalReason: string,
    ): PipelineResult => {
      const auditEntry = this.cfg.audit.append("pipeline.failure", {
        ok: false,
        failedGate,
        originalReason,
        executedGates,
        gateSummaries: summarizeGates(gates),
        tx: { to: req.tx.to, from: req.tx.from, value: req.tx.value },
      });
      this.cfg.log("warn", "pipeline failed", {
        failedGate,
        originalReason,
        executedGates,
      });
      return {
        ok: false,
        failedGate,
        originalReason,
        gates,
        auditSeq: auditEntry.seq,
        auditHash: auditEntry.hash,
        executedGates,
      };
    };

    // Helper: write exactly one audit entry and return a success result.
    // This is the ONLY place audit.append is called on the success path.
    const succeed = (signerResult: SignerResult): PipelineResult => {
      const auditEntry = this.cfg.audit.append("pipeline.success", {
        ok: true,
        failedGate: null,
        executedGates,
        gateSummaries: summarizeGates(gates),
        txHash: signerResult.txHash,
        tx: { to: req.tx.to, from: req.tx.from, value: req.tx.value },
      });
      this.cfg.log("info", "pipeline succeeded", {
        executedGates,
        txHash: signerResult.txHash,
      });
      return {
        ok: true,
        failedGate: null,
        originalReason: null,
        gates,
        auditSeq: auditEntry.seq,
        auditHash: auditEntry.hash,
        executedGates,
      };
    };

    // ----- Gate 1: RPC preflight (block number quorum read) -----
    executedGates.push("rpc");
    try {
      const rpcResult = await this.cfg.rpc.quorumRead<unknown>(
        "eth_blockNumber",
        [],
      );
      gates.rpc = rpcResult;
      if (!rpcResult.ok) {
        return fail(
          "rpc",
          rpcResult.error ?? "rpc preflight failed (no error detail)",
        );
      }
    } catch (err) {
      gates.rpc = {
        ok: false,
        queried: [],
        agreed: [],
        disagreed: [],
        primaryUsed: null,
        failedOver: false,
        breakerTripped: [],
        error: `exception: ${(err as Error).message}`,
      };
      return fail("rpc", `exception: ${(err as Error).message}`);
    }

    // ----- Gate 2: Simulation (H1.2) -----
    executedGates.push("simulation");
    try {
      const simResult = await this.cfg.simulation.simulateAndVerify(
        req.tx,
        req.expectedDiff,
      );
      gates.simulation = simResult;
      if (!simResult.ok) {
        return fail(
          "simulation",
          simResult.blockReason ?? "simulation failed (no block reason)",
        );
      }
    } catch (err) {
      gates.simulation = {
        ok: false,
        blockReason: `exception: ${(err as Error).message}`,
        simulation: {
          ok: false,
          changes: [],
          gasUsed: 0,
          from: req.tx.from,
          revertReason: (err as Error).message,
        },
        diff: {
          matched: [],
          missingExpected: [],
          missingSimulated: [...req.expectedDiff.changes],
          mismatchedAmount: [],
        },
      };
      return fail("simulation", `exception: ${(err as Error).message}`);
    }

    // ----- Gate 3: Contract verification (H2.1) -----
    executedGates.push("contract");
    try {
      const contractResult = await this.cfg.contract.verify(
        req.contractManifest,
      );
      gates.contract = contractResult;
      if (!contractResult.ok) {
        return fail(
          "contract",
          contractResult.reasons.join("; ") ||
            "contract verification failed (no reasons)",
        );
      }
    } catch (err) {
      gates.contract = {
        ok: false,
        reasons: [`exception: ${(err as Error).message}`],
        findings: {
          bytecodeHash: "",
          selectors: [],
          unknownSelectors: [],
          isProxy: false,
          proxyKind: null,
          implementation: null,
          beacon: null,
          admin: null,
          isUpgradeable: false,
          owner: null,
        },
      };
      return fail("contract", `exception: ${(err as Error).message}`);
    }

    // ----- Gate 4: Liquidity verification (H2.2) -----
    executedGates.push("liquidity");
    try {
      const liquidityResult = await this.cfg.liquidity.verify(
        req.liquidityManifest,
      );
      gates.liquidity = liquidityResult;
      if (!liquidityResult.ok) {
        return fail(
          "liquidity",
          liquidityResult.reasons.join("; ") ||
            "liquidity verification failed (no reasons)",
        );
      }
    } catch (err) {
      gates.liquidity = {
        ok: false,
        reasons: [`exception: ${(err as Error).message}`],
        pools: [],
        extraPools: [],
      };
      return fail("liquidity", `exception: ${(err as Error).message}`);
    }

    // ----- Gate 5: Token authority verification (H2.3) -----
    executedGates.push("authority");
    try {
      const authorityResult = await this.cfg.authority.verify(
        req.authorityManifest,
      );
      gates.authority = authorityResult;
      if (!authorityResult.ok) {
        return fail(
          "authority",
          authorityResult.reasons.join("; ") ||
            "authority verification failed (no reasons)",
        );
      }
    } catch (err) {
      gates.authority = {
        ok: false,
        reasons: [`exception: ${(err as Error).message}`],
        findings: [],
        ownerIsZero: false,
        renounceEventFound: false,
        realRenounce: false,
      };
      return fail("authority", `exception: ${(err as Error).message}`);
    }

    // ----- Gate 6: Sell simulation (H2.4) -----
    executedGates.push("sell-sim");
    try {
      const sellSimResult = await this.cfg.sellSim.verify(
        req.sellSimManifest,
      );
      gates.sellSim = sellSimResult;
      if (!sellSimResult.ok) {
        return fail(
          "sell-sim",
          sellSimResult.reasons.join("; ") ||
            "sell simulation failed (no reasons)",
        );
      }
    } catch (err) {
      gates.sellSim = {
        ok: false,
        reasons: [`exception: ${(err as Error).message}`],
        buyResult: {
          reverted: true,
          revertReason: (err as Error).message,
          actualAmountOut: "0",
          gasUsed: 0,
        },
        sellResult: {
          reverted: true,
          revertReason: "buy failed — sell not simulated",
          actualAmountOut: "0",
          gasUsed: 0,
        },
        observedBuyTaxBps: NaN,
        observedSellTaxBps: NaN,
        slippageLimitBps: NaN,
        observedSlippageBps: NaN,
      };
      return fail("sell-sim", `exception: ${(err as Error).message}`);
    }

    // ----- Gate 7: Approval gate (H1.3) -----
    executedGates.push("approval");
    try {
      const approvalResult = await this.cfg.approval.evaluate(
        req.approvalRequest,
      );
      gates.approval = approvalResult;
      if (!approvalResult.ok) {
        return fail(
          "approval",
          approvalResult.rejectReason ??
            "approval rejected (no reject reason)",
        );
      }
    } catch (err) {
      gates.approval = {
        ok: false,
        rejectReason: `exception: ${(err as Error).message}`,
        approvedAmount: "0",
        capped: false,
        policy: {
          maxApprovalPerSpender: undefined,
          allowFullBalanceApproval: false,
          autoRevokeAfterUse: true,
        },
      };
      return fail("approval", `exception: ${(err as Error).message}`);
    }

    // ----- Gate 8: MEV gate (H1.4) — slippage + sandwich -----
    executedGates.push("mev");
    try {
      const slippage = checkSlippage(
        req.mevInputs.expectedPrice,
        req.mevInputs.actualPrice,
        req.mevInputs.slippage,
      );
      const sandwich = detectSandwich(
        req.mevInputs.sandwich.victimAddress,
        req.mevInputs.sandwich.preState,
        req.mevInputs.sandwich.postState,
        req.mevInputs.sandwich.observedTrades,
      );
      gates.mev = { slippage, sandwich };
      if (!slippage.ok) {
        return fail(
          "mev",
          `slippage ${slippage.actualBps} bps ${slippage.direction} exceeds dynamic limit ${slippage.limit.bps} bps`,
        );
      }
      if (sandwich.detected) {
        return fail(
          "mev",
          `sandwich detected (score ${sandwich.score.toFixed(2)}): ${sandwich.reason}`,
        );
      }
    } catch (err) {
      gates.mev = {
        slippage: {
          ok: false,
          actualBps: NaN,
          direction: "excess",
          limit: {
            bps: NaN,
            components: {
              baseline: NaN,
              volatilityContribution: NaN,
              sizeContribution: NaN,
              hardCap: NaN,
            },
          },
        },
        sandwich: {
          detected: false,
          score: 0,
          reason: `exception: ${(err as Error).message}`,
          preState: req.mevInputs.sandwich.preState,
          postState: req.mevInputs.sandwich.postState,
          observedTrades: req.mevInputs.sandwich.observedTrades,
        },
      };
      return fail("mev", `exception: ${(err as Error).message}`);
    }

    // ----- Gate 9: Signer (mock in H2.6; real signer in M3+) -----
    executedGates.push("signer");
    try {
      const signerReq: SignerRequest = {
        tx: req.tx,
        expectedDiff: req.expectedDiff,
        approvedAmount: gates.approval!.approvedAmount,
        slippageLimitBps: gates.mev!.slippage.limit.bps,
        sandwichScore: gates.mev!.sandwich.score,
      };
      const signerResult = await this.cfg.signer.submit(signerReq);
      gates.signer = signerResult;
      if (!signerResult.ok) {
        return fail(
          "signer",
          signerResult.error ?? "signer rejected (no error detail)",
        );
      }
      return succeed(signerResult);
    } catch (err) {
      gates.signer = {
        ok: false,
        error: `exception: ${(err as Error).message}`,
      };
      return fail("signer", `exception: ${(err as Error).message}`);
    }
  }
}

// -------------------------------------------------------------------------
// Helper: summarize each gate's result for the audit payload.
// -------------------------------------------------------------------------

function summarizeGates(gates: PipelineGateResult): Record<string, { ok: boolean; reason?: string }> {
  const out: Record<string, { ok: boolean; reason?: string }> = {};
  if (gates.rpc !== undefined) {
    out.rpc = { ok: gates.rpc.ok, reason: gates.rpc.error };
  }
  if (gates.simulation !== undefined) {
    out.simulation = { ok: gates.simulation.ok, reason: gates.simulation.blockReason };
  }
  if (gates.contract !== undefined) {
    out.contract = {
      ok: gates.contract.ok,
      reason: gates.contract.reasons.join("; ") || undefined,
    };
  }
  if (gates.liquidity !== undefined) {
    out.liquidity = {
      ok: gates.liquidity.ok,
      reason: gates.liquidity.reasons.join("; ") || undefined,
    };
  }
  if (gates.authority !== undefined) {
    out.authority = {
      ok: gates.authority.ok,
      reason: gates.authority.reasons.join("; ") || undefined,
    };
  }
  if (gates.sellSim !== undefined) {
    out["sell-sim"] = {
      ok: gates.sellSim.ok,
      reason: gates.sellSim.reasons.join("; ") || undefined,
    };
  }
  if (gates.approval !== undefined) {
    out.approval = { ok: gates.approval.ok, reason: gates.approval.rejectReason };
  }
  if (gates.mev !== undefined) {
    out.mev = {
      ok: gates.mev.slippage.ok && !gates.mev.sandwich.detected,
      reason: !gates.mev.slippage.ok
        ? `slippage ${gates.mev.slippage.actualBps} bps exceeds limit ${gates.mev.slippage.limit.bps} bps`
        : gates.mev.sandwich.detected
          ? `sandwich score ${gates.mev.sandwich.score.toFixed(2)}`
          : undefined,
    };
  }
  if (gates.signer !== undefined) {
    out.signer = { ok: gates.signer.ok, reason: gates.signer.error };
  }
  return out;
}
