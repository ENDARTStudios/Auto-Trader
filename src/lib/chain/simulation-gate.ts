// H1.2 — Transaction Simulation: mandatory pre-broadcast simulation,
// expected-vs-simulated state-diff comparison, automatic block on
// divergence.
//
// DESIGN PHILOSOPHY
// -----------------
// A signed transaction is irreversible once it lands on-chain. The only
// chance to catch a bad payload — a revert, an unexpected approval, a
// wrong recipient, an MEV bait — is BEFORE the broadcast. H1.2 builds
// the simulation gate that sits in front of `QuorumRpcClient.broadcastRawTransaction`.
//
// The gate works as follows:
//
//   1. The caller constructs a transaction (to, value, data, from).
//   2. The caller also constructs an EXPECTED state diff: a list of
//      balance changes, approval changes, and ERC-20 transfers that the
//      transaction is supposed to cause. This is the caller's claim
//      about what the transaction will do.
//   3. The simulation engine calls `eth_call` (with state override) to
//      execute the transaction against the current chain state WITHOUT
//      broadcasting it. It returns the actual state diff the
//      transaction would produce.
//   4. The simulator also calls `eth_simulateV1` if available (post-
//      Cancun) which returns the full state diff in one round trip; if
//      unavailable, it falls back to per-call simulation against the
//      expected calls.
//   5. The gate compares EXPECTED vs SIMULATED. If they diverge, the
//      broadcast is BLOCKED. The block is observable (logged with the
//      divergence details, surfaced in the result) so the caller can
//      decide whether to alert, retry with adjusted params, or abort.
//
// ADVERSARIAL TESTS (per the permanent principle)
// -----------------------------------------------
//   - A simulated revert blocks broadcast.
//   - A simulated transfer to an unexpected recipient blocks broadcast.
//   - A simulated approval of MAX_UINT (when caller expected a capped
//     approval) blocks broadcast.
//   - A simulated balance change that exceeds the caller's expected
//     amount blocks broadcast.
//   - A simulated gas cost that exceeds the caller's expected gas
//     blocks broadcast (catches reentrancy traps that drain gas).
//
// INJECTABLE SIMULATOR
// --------------------
// The gate takes a `Simulator` function in its config, so tests can
// inject deterministic mock simulations without any real network. The
// production simulator wraps ethers' `eth_call` with state override
// (or `eth_simulateV1` when available), wired in main.ts when M3 lands.

export interface ExpectedStateChange {
  /** Kind of state change. */
  kind: "erc20_transfer" | "erc20_approval" | "native_transfer" | "custom";
  /** The contract address (for erc20_*) or null for native transfers. */
  token?: string;
  /** From address (checksummed). */
  from: string;
  /** To address (checksummed). */
  to: string;
  /** Amount in atomic units (as a decimal string to avoid BigInt parsing pain). */
  amount: string;
}

export interface ExpectedDiff {
  /** List of state changes the caller asserts the transaction will cause. */
  changes: ExpectedStateChange[];
  /** Maximum gas the caller expects the transaction to consume. */
  maxGas?: number;
  /** Whether the transaction is expected to revert. Default false. */
  expectRevert?: boolean;
}

export interface SimulatedStateChange {
  kind: "erc20_transfer" | "erc20_approval" | "native_transfer" | "custom";
  token?: string;
  from: string;
  to: string;
  amount: string;
}

export interface SimulationResult {
  /** Whether the simulation succeeded (did not revert). */
  ok: boolean;
  /** Revert reason if it reverted. */
  revertReason?: string;
  /** State changes the simulation actually produced. */
  changes: SimulatedStateChange[];
  /** Gas the simulation consumed. */
  gasUsed: number;
  /** The from-address used in the simulation. */
  from: string;
}

export type Simulator = (tx: {
  from: string;
  to: string;
  value: string;
  data: string;
}) => Promise<SimulationResult>;

export interface SimulationGateConfig {
  simulator: Simulator;
  /** Tolerance for amount comparison, in basis points. Default 50 (0.5%). */
  amountToleranceBps?: number;
  /** Logger — defaults to no-op. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

export interface GateResult {
  /** True if simulation succeeded AND diff matches expectation. */
  ok: boolean;
  /** Reason for block, if ok=false. */
  blockReason?: string;
  /** The full simulation result (for caller inspection). */
  simulation: SimulationResult;
  /** Diff details — what matched, what diverged. */
  diff: {
    matched: ExpectedStateChange[];
    missingExpected: SimulatedStateChange[];  // simulated but not in expected
    missingSimulated: ExpectedStateChange[];  // expected but not in simulation
    mismatchedAmount: { expected: ExpectedStateChange; simulated: SimulatedStateChange; reason: string }[];
  };
}

const DEFAULT_TOLERANCE_BPS = 50;

function noopLog() { /* no-op */ }

export class SimulationGate {
  private readonly cfg: Required<SimulationGateConfig>;
  private readonly simulator: Simulator;

  constructor(config: SimulationGateConfig) {
    this.simulator = config.simulator;
    this.cfg = {
      simulator: config.simulator,
      amountToleranceBps: config.amountToleranceBps ?? DEFAULT_TOLERANCE_BPS,
      log: config.log ?? noopLog,
    };
  }

  /**
   * Run the simulation gate. Returns ok=true ONLY when:
   *   - the simulation did not revert (or revert was expected)
   *   - every expected state change is present in the simulation
   *   - every simulated state change is present in the expected diff
   *     (no surprise transfers/approvals)
   *   - no amount mismatch exceeds the configured tolerance
   *   - gas used ≤ maxGas (if maxGas is specified)
   *
   * The caller MUST treat ok=false as "do not broadcast".
   */
  async simulateAndVerify(
    tx: { from: string; to: string; value: string; data: string },
    expected: ExpectedDiff,
  ): Promise<GateResult> {
    // Run the simulation.
    let simulation: SimulationResult;
    try {
      simulation = await this.simulator(tx);
    } catch (err) {
      this.cfg.log("error", "simulation threw", { error: (err as Error).message });
      return {
        ok: false,
        blockReason: `simulation error: ${(err as Error).message}`,
        simulation: {
          ok: false,
          changes: [],
          gasUsed: 0,
          from: tx.from,
          revertReason: (err as Error).message,
        },
        diff: { matched: [], missingExpected: [], missingSimulated: [...expected.changes], mismatchedAmount: [] },
      };
    }

    const diff = this.computeDiff(expected, simulation);
    const result: GateResult = { ok: false, simulation, diff };

    // 1. Revert check.
    if (!expected.expectRevert && !simulation.ok) {
      result.blockReason = `simulation reverted: ${simulation.revertReason ?? "no reason"}`;
      this.cfg.log("warn", "simulation gate: revert blocked broadcast", { reason: simulation.revertReason });
      return result;
    }
    if (expected.expectRevert && simulation.ok) {
      result.blockReason = "expected revert but simulation succeeded";
      this.cfg.log("warn", "simulation gate: expected revert but tx succeeded");
      return result;
    }

    // 2. Diff checks.
    if (diff.missingExpected.length > 0) {
      result.blockReason = `simulation produced ${diff.missingExpected.length} unexpected state change(s)`;
      this.cfg.log("warn", "simulation gate: unexpected state change", {
        missingExpected: diff.missingExpected,
      });
      return result;
    }
    if (diff.missingSimulated.length > 0) {
      result.blockReason = `expected ${diff.missingSimulated.length} state change(s) not present in simulation`;
      this.cfg.log("warn", "simulation gate: expected change missing", {
        missingSimulated: diff.missingSimulated,
      });
      return result;
    }
    if (diff.mismatchedAmount.length > 0) {
      const m = diff.mismatchedAmount[0];
      result.blockReason = `amount mismatch: expected ${m.expected.amount}, simulated ${m.simulated.amount} (${m.reason})`;
      this.cfg.log("warn", "simulation gate: amount mismatch", {
        expected: m.expected, simulated: m.simulated, reason: m.reason,
      });
      return result;
    }

    // 3. Gas check.
    if (expected.maxGas !== undefined && simulation.gasUsed > expected.maxGas) {
      result.blockReason = `gas exceeded: used ${simulation.gasUsed}, max ${expected.maxGas}`;
      this.cfg.log("warn", "simulation gate: gas exceeded", {
        used: simulation.gasUsed, max: expected.maxGas,
      });
      return result;
    }

    result.ok = true;
    return result;
  }

  /**
   * Compute the diff between expected and simulated state changes.
   *
   * Two changes "match" when:
   *   - same kind
   *   - same token (or both null)
   *   - same from (case-insensitive)
   *   - same to (case-insensitive)
   *   - amount within tolerance (or exactly equal for kind=custom)
   *
   * The diff is order-independent — we don't require the caller to
   * predict the exact order of state changes, only the set.
   */
  private computeDiff(expected: ExpectedDiff, simulation: SimulationResult): GateResult["diff"] {
    const matched: ExpectedStateChange[] = [];
    const missingExpected: SimulatedStateChange[] = [];
    const missingSimulated: ExpectedStateChange[] = [];
    const mismatchedAmount: { expected: ExpectedStateChange; simulated: SimulatedStateChange; reason: string }[] = [];

    // Work on copies so we can splice out matches.
    const simPool = [...simulation.changes];
    const expPool = [...expected.changes];

    // First pass: find exact matches (kind, token, from, to, amount).
    for (let i = expPool.length - 1; i >= 0; i--) {
      const exp = expPool[i];
      const j = simPool.findIndex(sim => exactMatch(exp, sim));
      if (j !== -1) {
        matched.push(exp);
        expPool.splice(i, 1);
        simPool.splice(j, 1);
      }
    }

    // Second pass: for remaining expected, find structural matches
    // (kind, token, from, to) but with amount within tolerance.
    for (let i = expPool.length - 1; i >= 0; i--) {
      const exp = expPool[i];
      const j = simPool.findIndex(sim => structuralMatch(exp, sim));
      if (j !== -1) {
        const sim = simPool[j];
        const reason = compareAmounts(exp.amount, sim.amount, this.cfg.amountToleranceBps);
        if (reason === "ok") {
          matched.push(exp);
          expPool.splice(i, 1);
          simPool.splice(j, 1);
        } else {
          mismatchedAmount.push({ expected: exp, simulated: sim, reason });
          expPool.splice(i, 1);
          simPool.splice(j, 1);
        }
      }
    }

    // Whatever's left in simPool was simulated but not expected.
    for (const sim of simPool) missingExpected.push(sim);
    // Whatever's left in expPool was expected but not simulated.
    for (const exp of expPool) missingSimulated.push(exp);

    return { matched, missingExpected, missingSimulated, mismatchedAmount };
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function addrEq(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function exactMatch(exp: ExpectedStateChange, sim: SimulatedStateChange): boolean {
  return (
    exp.kind === sim.kind &&
    addrEq(exp.token, sim.token) &&
    addrEq(exp.from, sim.from) &&
    addrEq(exp.to, sim.to) &&
    exp.amount === sim.amount
  );
}

function structuralMatch(exp: ExpectedStateChange, sim: SimulatedStateChange): boolean {
  return (
    exp.kind === sim.kind &&
    addrEq(exp.token, sim.token) &&
    addrEq(exp.from, sim.from) &&
    addrEq(exp.to, sim.to)
  );
}

/**
 * Compare two amounts (as decimal strings, representing atomic units).
 * Returns "ok" if within tolerance, otherwise a human-readable reason.
 *
 * The comparison handles three cases:
 *   - exact equality: ok
 *   - both are non-negative integers within bps tolerance: ok
 *   - anything else: descriptive reason
 *
 * The tolerance is symmetric: |sim - exp| / exp ≤ bps/10000.
 */
export function compareAmounts(expected: string, simulated: string, toleranceBps: number): "ok" | string {
  if (expected === simulated) return "ok";

  // Parse as BigInt (atomic units are integers).
  let expBi: bigint;
  let simBi: bigint;
  try {
    expBi = BigInt(expected);
    simBi = BigInt(simulated);
  } catch {
    return `non-integer amount: expected='${expected}' simulated='${simulated}'`;
  }

  if (expBi === simBi) return "ok";

  // Tolerance check (only meaningful for non-zero expected).
  if (expBi === 0n) {
    return `expected 0 but simulated ${simulated}`;
  }

  const diff = simBi > expBi ? simBi - expBi : expBi - simBi;
  // |diff| / expBi ≤ bps / 10000
  // => diff * 10000 ≤ expBi * bps
  if (diff * 10000n <= expBi * BigInt(toleranceBps)) {
    return "ok";
  }

  const direction = simBi > expBi ? "excess" : "deficit";
  return `${direction}: expected ${expected}, simulated ${simulated}, diff ${diff.toString()}, tolerance ${toleranceBps}bps`;
}
