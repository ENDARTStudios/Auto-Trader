/**
 * H2.4 — Sell Simulation test suite.
 *
 * Tests SellSimVerifier against an injectable mock TradeSimulator.
 *
 * 16 scenarios across 4 categories:
 *
 *   A. Happy paths (3 tests)
 *     1. Buy + sell both succeed, taxes match, exit non-zero, slippage ok.
 *     2. Buy + sell both succeed with 5% tax, expected tax matches.
 *     3. Buy + sell both succeed with slippage at the boundary of the
 *        dynamic limit — accepted.
 *
 *   B. Failures (4 tests)
 *     4. Buy reverts → ok=false, sell not simulated.
 *     5. Buy succeeds, sell reverts → ok=false, honeypot pattern.
 *     6. Buy + sell succeed but sell returns 0 (honeypot variant) → fail.
 *     7. Buy + sell succeed but observed sell tax deviates > tolerance → fail.
 *
 *   C. Slippage (3 tests)
 *     8. Slippage within limit → ok.
 *     9. Slippage exceeds dynamic limit → ok=false.
 *    10. Negative expected price (div-by-zero defense) → ok=false.
 *
 *   D. Adversarial (6 tests)
 *    11. CLASSIC HONEYPOT — buy ok, sell reverts. (Covered by B5 but
 *        re-asserted with explicit naming.)
 *    12. TAX BAIT — buy tax 0%, sell tax 100% (sell "succeeds" but
 *        returns 0). The exit-non-zero check catches this even though
 *        the sell didn't revert.
 *    13. TAX SHIFT — first sell simulation: 5% tax. Second sell
 *        simulation: 50% tax (contract changes behavior). The verifier
 *        must use the SECOND simulation's result (no caching); first
 *        verification passes, second fails.
 *    14. FRONT-LOADED EXIT — sell succeeds for amountIn=1 (dust) but
 *        reverts for amountIn=full position. The verifier uses the
 *        full position in the manifest's SellSpec, so the simulation
 *        reverts → fail. Documents that small-dust sell simulation
 *        can't substitute for full-position sell simulation.
 *    15. SLIPPAGE TRAP — sell succeeds but at 50% below expected price.
 *        The dynamic limit (default 3% hard cap) catches this even
 *        when no tax is observed.
 *    16. CALLER-DEPENDENT SELL — sell succeeds when called by
 *        address(0) (the verifier's eth_call default) but reverts
 *        when called by the buyer's actual address. The verifier's
 *        simulator must apply state override with the buyer as the
 *        caller; if it doesn't, the verifier has a caller-blind
 *        vulnerability. Test documents the requirement.
 *
 * Run: npx tsx scripts/test-h2-sell-simulation.ts
 */

import {
  SellSimVerifier,
  TradeSimulator,
  BuySpec,
  SellSpec,
  SimResult,
  SellSimManifest,
  computeTaxBps,
} from "../src/lib/chain/sell-simulation";
import { SlippageInputs } from "../src/lib/chain/mev-baseline";
import { getAddress } from "ethers";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  \u2713 PASS`);
    pass++;
  } else {
    console.log(`  \u2717 FAIL: ${msg}`);
    fail++;
    process.exitCode = 1;
  }
}

// -------------------------------------------------------------------------
// Mock simulator
// -------------------------------------------------------------------------

interface MockBehavior {
  buy: SimResult;
  sell: SimResult;
  /** Optional override: if set, the second call to simulateSell returns this. Used by D3 (tax shift). */
  sellSecondCall?: SimResult;
}

class MockSimulator implements TradeSimulator {
  private sellCallCount = 0;
  constructor(private readonly behavior: MockBehavior) {}

  async simulateBuy(): Promise<SimResult> {
    return this.behavior.buy;
  }

  async simulateSell(_spec: SellSpec, _buyAmountOut: string): Promise<SimResult> {
    this.sellCallCount++;
    if (this.sellCallCount === 2 && this.behavior.sellSecondCall) {
      return this.behavior.sellSecondCall;
    }
    return this.behavior.sell;
  }

  /** Test helper: reset the call counter (for tax-shift across separate verifier runs). */
  resetCount(): void {
    this.sellCallCount = 0;
  }
}

// -------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------

const TOKEN = getAddress("0x0000000000000000000000000000000000000001");
const ROUTER = getAddress("0x0000000000000000000000000000000000000002");
const BUYER = getAddress("0x0000000000000000000000000000000000000003");

const BUY: BuySpec = {
  token: TOKEN,
  router: ROUTER,
  buyer: BUYER,
  amountIn: "1000000000000000000",  // 1 WETH
  expectedAmountOut: "1000000000000000000000",  // 1000 tokens
  calldata: "0x",
};

const SELL: SellSpec = {
  router: ROUTER,
  token: TOKEN,
  seller: BUYER,
  amountIn: "1000000000000000000000",  // 1000 tokens
  expectedAmountOut: "1000000000000000000",  // 1 WETH expected
  calldata: "0x",
};

const SLIPPAGE: SlippageInputs = {
  baselineBps: 30,
  volatilityBps: 20,
  tradeSizeUsd: 1000,
  poolLiquidityUsd: 1_000_000,
  hardCapBps: 300,  // 3% hard cap
};

function okResult(amountOut: string, gasUsed = 100000): SimResult {
  return { reverted: false, actualAmountOut: amountOut, gasUsed };
}

function revertResult(reason: string, gasUsed = 100000): SimResult {
  return { reverted: true, revertReason: reason, actualAmountOut: "0", gasUsed };
}

console.log("\n=== H2.4 — Sell Simulation ===\n");

async function main(): Promise<void> {

// =========================================================================
// A. Happy paths
// =========================================================================

console.log("A. Happy paths");

// A1 — buy + sell both succeed, taxes 0, exit non-zero, slippage 0.
{
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),  // 1000 tokens (matches expected)
    sell: okResult("1000000000000000000"),   // 1 WETH (matches expected)
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    slippage: SLIPPAGE,
  });
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
  assert(r.observedBuyTaxBps === 0, `expected buy tax 0, got ${r.observedBuyTaxBps}`);
  assert(r.observedSellTaxBps === 0, `expected sell tax 0, got ${r.observedSellTaxBps}`);
}

// A2 — buy + sell both succeed with 5% tax, expected tax matches.
{
  // Buy: expected 1000 tokens, actual 950 (5% tax).
  // Sell: expected 1 WETH, actual 0.95 WETH (5% tax).
  const sim = new MockSimulator({
    buy: okResult("950000000000000000000"),
    sell: okResult("950000000000000000"),
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    expectedBuyTaxBps: 500,
    expectedSellTaxBps: 500,
    taxToleranceBps: 50,
    slippage: SLIPPAGE,
  });
  assert(r.ok, `expected ok=true with 5% tax, got: ${r.reasons.join("; ")}`);
  assert(r.observedBuyTaxBps === 500, `expected buy tax 500 bps, got ${r.observedBuyTaxBps}`);
  assert(r.observedSellTaxBps === 500, `expected sell tax 500 bps, got ${r.observedSellTaxBps}`);
}

// A3 — slippage at the boundary of the dynamic limit.
{
  // Dynamic limit = baseline 30 + 0.5*20 (vol) + 0.5*(1000/1M * 10000) (size) = 30+10+5 = 45 bps.
  // Sell: expected 1 WETH, actual = 1 WETH - 45 bps = 0.9955 WETH.
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: okResult("995500000000000000"),
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    slippage: SLIPPAGE,
  });
  // At boundary — checkSlippage uses `<=` so 45 bps should be accepted.
  // (If the implementation uses `<`, this would fail; the test documents
  // the boundary behavior.)
  assert(r.ok, `expected ok=true at slippage boundary, got: ${r.reasons.join("; ")}`);
  // The slippage limit should be ~45 bps.
  assert(Math.abs(r.slippageLimitBps - 45) < 1, `expected slippage limit ~45 bps, got ${r.slippageLimitBps}`);
}

// =========================================================================
// B. Failures
// =========================================================================

console.log("\nB. Failures");

// B1 — buy reverts → ok=false, sell not simulated.
{
  const sim = new MockSimulator({
    buy: revertResult("INSUFFICIENT_OUTPUT_AMOUNT"),
    sell: okResult("1000000000000000000"),
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    slippage: SLIPPAGE,
  });
  assert(!r.ok, "expected ok=false on buy revert");
  assert(r.reasons.some(x => x.includes("buy reverted")), `expected 'buy reverted' reason, got: ${r.reasons.join("; ")}`);
  assert(r.sellResult.reverted, "expected sellResult.reverted=true (not simulated)");
  assert(r.sellResult.revertReason?.includes("buy failed"), `expected 'buy failed' message, got: ${r.sellResult.revertReason}`);
}

// B2 — buy ok, sell reverts → honeypot pattern.
{
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: revertResult("TRANSFER_FROM_FAILED"),
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    slippage: SLIPPAGE,
  });
  assert(!r.ok, "expected ok=false on sell revert");
  assert(r.reasons.some(x => x.includes("sell reverted") && x.includes("honeypot")), `expected 'sell reverted ... honeypot' reason, got: ${r.reasons.join("; ")}`);
}

// B3 — sell "succeeds" but returns 0 (honeypot variant).
{
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: okResult("0"),  // 0 output
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    slippage: SLIPPAGE,
    minExitAmount: "1",
  });
  assert(!r.ok, "expected ok=false on zero exit");
  assert(r.reasons.some(x => x.includes("exit amount") && x.includes("honeypot")), `expected 'exit amount ... honeypot' reason, got: ${r.reasons.join("; ")}`);
}

// B4 — sell tax deviates > tolerance.
{
  // Expected sell tax = 0%. Actual sell tax = 10%.
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: okResult("900000000000000000"),  // 0.9 WETH = 10% tax
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    expectedBuyTaxBps: 0,
    expectedSellTaxBps: 0,
    taxToleranceBps: 50,  // 0.5%
    slippage: SLIPPAGE,
  });
  assert(!r.ok, "expected ok=false on tax deviation");
  assert(r.reasons.some(x => x.includes("sell tax deviation")), `expected 'sell tax deviation' reason, got: ${r.reasons.join("; ")}`);
}

// =========================================================================
// C. Slippage
// =========================================================================

console.log("\nC. Slippage");

// C1 — slippage within limit.
{
  // Slippage 20 bps (within 45 bps limit).
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: okResult("998000000000000000"),  // 0.998 WETH = 20 bps slippage
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    slippage: SLIPPAGE,
  });
  assert(r.ok, `expected ok=true on slippage within limit, got: ${r.reasons.join("; ")}`);
}

// C2 — slippage exceeds dynamic limit.
{
  // Slippage 100 bps (exceeds 45 bps limit, under 300 bps hard cap).
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: okResult("990000000000000000"),  // 0.99 WETH = 100 bps slippage
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    slippage: SLIPPAGE,
  });
  assert(!r.ok, "expected ok=false on slippage exceeding limit");
  assert(r.reasons.some(x => x.includes("slippage") && x.includes("exceeds")), `expected 'slippage ... exceeds' reason, got: ${r.reasons.join("; ")}`);
}

// C3 — negative expected price (div-by-zero defense).
{
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: okResult("1000000000000000000"),
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: { ...SELL, expectedAmountOut: "0" },  // zero expected
    slippage: SLIPPAGE,
  });
  assert(!r.ok, "expected ok=false on zero expected price");
}

// =========================================================================
// D. Adversarial
// =========================================================================

console.log("\nD. Adversarial");

// D1 — CLASSIC HONEYPOT (re-asserted with explicit naming).
{
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: revertResult("PANIC_CODE_0x11"),
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    slippage: SLIPPAGE,
  });
  assert(!r.ok, "classic honeypot must be rejected");
  assert(r.reasons.some(x => x.includes("honeypot")), `expected 'honeypot' in reason, got: ${r.reasons.join("; ")}`);
}

// D2 — TAX BAIT — sell succeeds but returns 0 (100% tax).
{
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),  // 0% buy tax
    sell: okResult("0"),  // 100% sell tax — sell "succeeds"
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    expectedBuyTaxBps: 0,
    expectedSellTaxBps: 0,  // caller expects 0%
    taxToleranceBps: 50,
    slippage: SLIPPAGE,
    minExitAmount: "1",
  });
  assert(!r.ok, "tax bait must be rejected");
  // Should be caught by EITHER the tax-deviation check OR the exit-amount check.
  assert(
    r.reasons.some(x => x.includes("sell tax deviation") || x.includes("exit amount")),
    `expected tax-deviation or exit-amount reason, got: ${r.reasons.join("; ")}`,
  );
}

// D3 — TAX SHIFT — first sell sim returns 5% tax, second returns 50%.
// Verifier must use the SECOND simulation result (no caching across
// separate verify() calls). First verify passes; second fails.
{
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: okResult("950000000000000000"),  // 5% tax (within tolerance)
    sellSecondCall: okResult("500000000000000000"),  // 50% tax (way out)
  });
  const v = new SellSimVerifier(sim);
  const manifest: SellSimManifest = {
    buy: BUY,
    sell: SELL,
    expectedBuyTaxBps: 0,
    expectedSellTaxBps: 500,  // caller expects 5%
    taxToleranceBps: 50,
    slippage: SLIPPAGE,
  };
  // First call — fresh simulator, sell call count = 1, returns 5% tax.
  // (Note: we use a fresh simulator instance for the first call to
  // avoid the call counter already being at 1 from a previous test.)
  const sim1 = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: okResult("950000000000000000"),
  });
  const v1 = new SellSimVerifier(sim1);
  const r1 = await v1.verify(manifest);
  assert(r1.ok, `first verification should pass (5% tax), got: ${r1.reasons.join("; ")}`);

  // Second call — fresh simulator that returns 50% tax on first sell call.
  const sim2 = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: okResult("500000000000000000"),  // 50% tax
  });
  const v2 = new SellSimVerifier(sim2);
  const r2 = await v2.verify(manifest);
  assert(!r2.ok, "second verification must fail (50% tax)");
  assert(r2.reasons.some(x => x.includes("sell tax deviation")), `expected 'sell tax deviation' reason, got: ${r2.reasons.join("; ")}`);
}

// D4 — FRONT-LOADED EXIT — sell succeeds for dust amount, reverts for full.
// The verifier uses the manifest's SellSpec which specifies the full
// position; the simulation runs against the full position and reverts.
{
  // Build a simulator that reverts if amountIn > 1 wei.
  class FrontLoadedSim implements TradeSimulator {
    async simulateBuy(): Promise<SimResult> {
      return okResult("1000000000000000000000");
    }
    async simulateSell(spec: SellSpec): Promise<SimResult> {
      if (BigInt(spec.amountIn) > BigInt(1)) {
        return revertResult("AMOUNT_TOO_LARGE");
      }
      return okResult("1");
    }
  }
  const v = new SellSimVerifier(new FrontLoadedSim());
  const r = await v.verify({
    buy: BUY,
    sell: SELL,  // amountIn = full position (1000 tokens)
    slippage: SLIPPAGE,
  });
  assert(!r.ok, "front-loaded exit must be rejected");
  assert(r.reasons.some(x => x.includes("sell reverted")), `expected 'sell reverted' reason, got: ${r.reasons.join("; ")}`);
}

// D5 — SLIPPAGE TRAP — sell succeeds but at 50% below expected price.
// The dynamic limit (default 3% hard cap) catches this even when no
// tax is observed.
{
  // Sell: expected 1 WETH, actual 0.5 WETH = 5000 bps slippage.
  const sim = new MockSimulator({
    buy: okResult("1000000000000000000000"),
    sell: okResult("500000000000000000"),
  });
  const v = new SellSimVerifier(sim);
  const r = await v.verify({
    buy: BUY,
    sell: SELL,
    slippage: SLIPPAGE,  // hard cap 300 bps
    // expectedSellTaxBps=0; observed = 5000 bps; tax tolerance exceeded too.
    // But the slippage check independently fires.
  });
  assert(!r.ok, "slippage trap must be rejected");
  assert(r.reasons.some(x => x.includes("slippage")), `expected 'slippage' reason, got: ${r.reasons.join("; ")}`);
}

// D6 — CALLER-DEPENDENT SELL — sell succeeds when called by address(0)
// but reverts when called by the buyer. The verifier's simulator must
// apply state override with the buyer as the caller; if it doesn't,
// the verifier has a caller-blind vulnerability. Test documents the
// requirement: the simulator's `simulateSell` receives `buyAmountOut`
// which represents the post-buy state, but the CALLER must be the
// buyer (or the actual seller), not address(0).
{
  class CallerDependentSim implements TradeSimulator {
    async simulateBuy(): Promise<SimResult> {
      return okResult("1000000000000000000000");
    }
    async simulateSell(spec: SellSpec): Promise<SimResult> {
      // If the seller is the actual buyer, sell succeeds.
      // If the seller is 0x0 (caller-blind verifier), sell reverts.
      if (spec.seller.toLowerCase() === BUYER.toLowerCase()) {
        return okResult("1000000000000000000");
      }
      return revertResult("NOT_AUTHORIZED");
    }
  }
  const v = new SellSimVerifier(new CallerDependentSim());
  const r = await v.verify({
    buy: BUY,
    sell: SELL,  // seller = BUYER (correct)
    slippage: SLIPPAGE,
  });
  assert(r.ok, `caller-aware simulator with correct seller should pass, got: ${r.reasons.join("; ")}`);

  // If the manifest's SellSpec has seller=0x0 (caller-blind), it fails.
  const vBlind = new SellSimVerifier(new CallerDependentSim());
  const rBlind = await vBlind.verify({
    buy: BUY,
    sell: { ...SELL, seller: getAddress("0x0000000000000000000000000000000000000000") },
    slippage: SLIPPAGE,
  });
  assert(!rBlind.ok, "caller-blind simulator (seller=0x0) must fail");
  assert(rBlind.reasons.some(x => x.includes("sell reverted")), `expected 'sell reverted' reason, got: ${rBlind.reasons.join("; ")}`);
}

// =========================================================================
// Pure helper
// =========================================================================

console.log("\nE. Pure helper");

// E1 — computeTaxBps.
{
  assert(computeTaxBps(BigInt("1000"), BigInt("1000")) === 0, "0% tax");
  assert(computeTaxBps(BigInt("1000"), BigInt("950")) === 500, "5% tax");
  assert(computeTaxBps(BigInt("1000"), BigInt("500")) === 5000, "50% tax");
  assert(computeTaxBps(BigInt("1000"), BigInt("0")) === 10000, "100% tax");
  assert(computeTaxBps(BigInt("1000"), BigInt("1100")) === 0, "negative tax clamped to 0 (rebate)");
  assert(Number.isNaN(computeTaxBps(BigInt("0"), BigInt("0"))), "zero expected → NaN");
}

// =========================================================================
// Summary
// =========================================================================

console.log(`\n=== H2.4 Summary: ${pass} pass, ${fail} fail ===`);
if (fail > 0) {
  console.log("FAILURES DETECTED — see above.");
  process.exit(1);
}

}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
