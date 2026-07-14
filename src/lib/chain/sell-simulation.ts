// H2.4 — Sell Simulation: buy succeeds, sell succeeds, taxes expected
// vs. observed, exit possible, slippage acceptable.
//
// DESIGN PHILOSOPHY
// -----------------
// H1.2 built the SimulationGate — a pre-broadcast primitive that
// catches any single transaction that reverts or diverges from the
// caller's expected state diff. H1.2 alone is insufficient for the
// honeypot vector: a honeypot contract lets the BUY succeed (so the
// bot's pre-broadcast simulation passes) but reverts the SELL. The
// bot is now stuck holding a worthless token it can't exit.
//
// H2.4 closes this by running a PAIRED simulation: simulate the buy,
// then simulate the sell from the post-buy state. The sell must
// succeed, the observed tax must match the caller's expected tax,
// the slippage must be within the dynamic limit, AND the exit must
// actually produce a non-zero output (a "successful" sell that
// returns 0 USDC is a sneaky honeypot pattern).
//
// Five properties enforced:
//
//   1. BUY SUCCEEDS — the buy simulation does not revert. (H1.2
//      already covers this; H2.4 re-asserts it as part of the pair.)
//   2. SELL SUCCEEDS — the sell simulation, run against the post-buy
//      state, does not revert.
//   3. TAXES MATCH — the observed buy tax and sell tax (computed as
//      1 - actualAmountOut/expectedAmountOut, in bps) must be within
//      `taxToleranceBps` of the caller's expected tax.
//   4. EXIT POSSIBLE — the sell produces a non-zero output above
//      `minExitAmount`. A sell that "succeeds" but returns 0 is a
//      honeypot pattern.
//   5. SLIPPAGE ACCEPTABLE — the actual sell price vs. the expected
//      sell price must be within the dynamic slippage limit (re-uses
//      H1.4's computeSlippageLimit / checkSlippage).
//
// INJECTABLE SIMULATOR
// --------------------
// The verifier takes a `TradeSimulator` interface so tests inject
// deterministic mock simulations. Production wraps eth_call with
// state override (or eth_simulateV1) — the same primitive H1.2 uses.
//
// STATE-AWARE SIMULATION
// ----------------------
// The sell simulation requires the post-buy state (the bot's token
// balance > 0). The simulator's `simulateSell` method takes the
// `buyResult` as input and applies the state change before running
// the sell. In production, this is done via eth_call's state override
// (set the bot's balance to the bought amount, then call the sell
// function). Tests mock this by computing the sell outcome from the
// buy outcome directly.
//
// ADVERSARIAL SCOPE
// -----------------
// Per the permanent principle, the verifier ships with adversarial
// tests for: (a) classic honeypot (buy succeeds, sell reverts), (b)
// "tax bait" — buy tax 0%, sell tax 100% (the bot can sell but
// receives 0), (c) "tax shift" — buy tax 5%, sell tax 5% on first
// simulation, but sell tax jumps to 50% on the second simulation
// (the contract changes behavior based on caller or block), (d)
// "front-loaded exit" — sell succeeds for the first 1% of the
// position but reverts for the remaining 99% (the contract checks
// `amount > threshold && revert`), (e) "slippage trap" — sell
// succeeds but at a price 50% below the expected price, exceeding
// the dynamic slippage limit.

import type { Address } from "./contract-verification";
import { checkSlippage, computeSlippageLimit, SlippageInputs } from "./mev-baseline";
export type { Address };

// -------------------------------------------------------------------------
// Simulator — injectable.
// -------------------------------------------------------------------------

export interface BuySpec {
  /** The token being bought. */
  token: Address;
  /** The DEX router to call. */
  router: Address;
  /** The account that will receive the bought tokens. */
  buyer: Address;
  /** The amount of quote currency (e.g. WETH, USDC) being spent, atomic units. */
  amountIn: string;
  /** The minimum amount of `token` the buyer expects to receive, atomic units. */
  expectedAmountOut: string;
  /** Calldata for the buy (passed to the simulator as-is). */
  calldata: string;
}

export interface SellSpec {
  /** Same router / token / buyer as the buy. */
  router: Address;
  token: Address;
  seller: Address;
  /** Amount of token to sell, atomic units. */
  amountIn: string;
  /** Minimum amount of quote currency the seller expects to receive, atomic units. */
  expectedAmountOut: string;
  /** Calldata for the sell. */
  calldata: string;
}

export interface SimResult {
  /** Did the simulation revert? */
  reverted: boolean;
  /** Revert reason (if reverted). */
  revertReason?: string;
  /** Actual amount out, atomic units. Zero if reverted. */
  actualAmountOut: string;
  /** Gas used. */
  gasUsed: number;
}

export interface TradeSimulator {
  /** Simulate the buy. */
  simulateBuy(spec: BuySpec): Promise<SimResult>;
  /**
   * Simulate the sell, applying the post-buy state. The simulator
   * should set the seller's `token` balance to `buyAmountOut` before
   * running the sell. In production this is eth_call with state
   * override.
   */
  simulateSell(spec: SellSpec, buyAmountOut: string): Promise<SimResult>;
}

// -------------------------------------------------------------------------
// Manifest
// -------------------------------------------------------------------------

export interface SellSimManifest {
  buy: BuySpec;
  sell: SellSpec;
  /** Caller's expected buy tax, in bps. Default 0. */
  expectedBuyTaxBps?: number;
  /** Caller's expected sell tax, in bps. Default 0. */
  expectedSellTaxBps?: number;
  /** Tolerance for tax deviation, in bps. Default 50 (0.5%). */
  taxToleranceBps?: number;
  /** Minimum non-zero exit amount, in atomic units of the quote currency. Default "1". */
  minExitAmount?: string;
  /** Slippage inputs for the dynamic limit (re-uses H1.4). Required. */
  slippage: SlippageInputs;
  /** Logger. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

// -------------------------------------------------------------------------
// Findings
// -------------------------------------------------------------------------

export interface SellSimResult {
  ok: boolean;
  reasons: string[];
  buyResult: SimResult;
  sellResult: SimResult;
  /** Observed buy tax in bps (1 - actual/expected) * 10000. */
  observedBuyTaxBps: number;
  /** Observed sell tax in bps. */
  observedSellTaxBps: number;
  /** Computed slippage limit in bps. */
  slippageLimitBps: number;
  /** Observed slippage in bps (only meaningful if sell succeeded). */
  observedSlippageBps: number;
}

// -------------------------------------------------------------------------
// The verifier.
// -------------------------------------------------------------------------

export class SellSimVerifier {
  constructor(private readonly sim: TradeSimulator) {}

  async verify(manifest: SellSimManifest): Promise<SellSimResult> {
    const log = manifest.log ?? (() => {});
    const reasons: string[] = [];
    const expectedBuyTaxBps = manifest.expectedBuyTaxBps ?? 0;
    const expectedSellTaxBps = manifest.expectedSellTaxBps ?? 0;
    const taxToleranceBps = manifest.taxToleranceBps ?? 50;
    const minExit = BigInt(manifest.minExitAmount ?? "1");

    // --- 1. Buy simulation ---
    const buyResult = await this.sim.simulateBuy(manifest.buy);
    if (buyResult.reverted) {
      reasons.push(`buy reverted: ${buyResult.revertReason ?? "no reason"}`);
      // No point running the sell — the buy didn't happen.
      return {
        ok: false,
        reasons,
        buyResult,
        sellResult: { reverted: true, revertReason: "buy failed — sell not simulated", actualAmountOut: "0", gasUsed: 0 },
        observedBuyTaxBps: NaN,
        observedSellTaxBps: NaN,
        slippageLimitBps: NaN,
        observedSlippageBps: NaN,
      };
    }

    // --- 2. Buy tax check ---
    const expectedBuyOut = BigInt(manifest.buy.expectedAmountOut);
    const actualBuyOut = BigInt(buyResult.actualAmountOut);
    const observedBuyTaxBps = computeTaxBps(expectedBuyOut, actualBuyOut);
    if (Math.abs(observedBuyTaxBps - expectedBuyTaxBps) > taxToleranceBps) {
      reasons.push(
        `buy tax deviation: expected ${expectedBuyTaxBps} bps, observed ${observedBuyTaxBps} bps (tolerance ${taxToleranceBps} bps)`,
      );
    }

    // --- 3. Sell simulation (against post-buy state) ---
    const sellResult = await this.sim.simulateSell(manifest.sell, buyResult.actualAmountOut);
    if (sellResult.reverted) {
      reasons.push(`sell reverted: ${sellResult.revertReason ?? "no reason"} — honeypot pattern`);
      return {
        ok: false,
        reasons,
        buyResult,
        sellResult,
        observedBuyTaxBps,
        observedSellTaxBps: NaN,
        slippageLimitBps: NaN,
        observedSlippageBps: NaN,
      };
    }

    // --- 4. Sell tax check ---
    const expectedSellOut = BigInt(manifest.sell.expectedAmountOut);
    const actualSellOut = BigInt(sellResult.actualAmountOut);
    const observedSellTaxBps = computeTaxBps(expectedSellOut, actualSellOut);
    if (Math.abs(observedSellTaxBps - expectedSellTaxBps) > taxToleranceBps) {
      reasons.push(
        `sell tax deviation: expected ${expectedSellTaxBps} bps, observed ${observedSellTaxBps} bps (tolerance ${taxToleranceBps} bps)`,
      );
    }

    // --- 5. Exit non-zero ---
    if (actualSellOut < minExit) {
      reasons.push(
        `exit amount ${actualSellOut.toString()} < minExitAmount ${minExit.toString()} — honeypot pattern (sell succeeds but returns 0)`,
      );
    }

    // --- 6. Slippage check ---
    // The slippage is measured AFTER applying the expected tax. The
    // caller's `expectedAmountOut` encodes their price expectation
    // BEFORE tax; the tax check (step 4) verifies the tax deviation.
    // The slippage check verifies the residual loss BEYOND the
    // expected tax — i.e. did we get less than (expected *
    // (1 - expectedTax))?
    //
    // Without this adjustment, a caller who expects 5% tax and
    // receives exactly 5% tax would be flagged for 500 bps slippage
    // (well above the typical 30-50 bps limit), defeating the
    // separation between tax tolerance and slippage tolerance.
    const slippageLimit = computeSlippageLimit(manifest.slippage);
    const expectedAfterTax = (expectedSellOut * BigInt(10000 - expectedSellTaxBps)) / BigInt(10000);
    const slippageCheck = checkSlippage(
      Number(expectedAfterTax),
      Number(actualSellOut),
      manifest.slippage,
    );
    if (!slippageCheck.ok) {
      reasons.push(
        `slippage ${slippageCheck.actualBps.toFixed(2)} bps exceeds dynamic limit ${slippageLimit.bps.toFixed(2)} bps (measured against expected-after-tax ${expectedAfterTax.toString()})`,
      );
    }

    return {
      ok: reasons.length === 0,
      reasons,
      buyResult,
      sellResult,
      observedBuyTaxBps,
      observedSellTaxBps,
      slippageLimitBps: slippageLimit.bps,
      observedSlippageBps: slippageCheck.actualBps,
    };
  }
}

/**
 * Compute the observed tax in bps:
 *   taxBps = (expected - actual) / expected * 10000
 *
 * If actual > expected (negative tax, e.g. rebate), tax is clamped to 0.
 * If expected == 0, returns NaN (can't compute).
 */
export function computeTaxBps(expected: bigint, actual: bigint): number {
  if (expected === BigInt(0)) return NaN;
  if (actual >= expected) return 0;
  // (expected - actual) * 10000 / expected
  const diff = expected - actual;
  return Number((diff * BigInt(10000)) / expected);
}
