/**
 * H1.4 — MEV Baseline test suite.
 *
 * Tests the slippage + sandwich detection + private-relay abstraction.
 * No real network calls are made.
 *
 * 15 scenarios across 4 categories:
 *
 *   A. Dynamic slippage limit (4 tests)
 *     1. Baseline only: zero volatility, small trade vs deep pool → limit = baseline.
 *     2. Volatility contribution: high volatility → wider limit.
 *     3. Size contribution: large trade vs shallow pool → wider limit.
 *     4. Hard cap: extreme inputs → limit capped at 300bps.
 *
 *   B. Slippage check (3 tests)
 *     5. Within limit → ok=true.
 *     6. Beyond limit → ok=false.
 *     7. Negative expected price → ok=false (defense against div-by-zero).
 *
 *   C. Sandwich detection (4 tests)
 *     8. No attacker (only victim trades) → score=0, not detected.
 *     9. Perfect sandwich (attacker buy + victim buy + attacker sell, profit)
 *        → score=1.0, detected.
 *    10. Lone front-run (attacker buy before victim, no sell yet)
 *        → score=0.5, detected.
 *    11. Attacker no-profit (buy+sell but lost money) → score=0.4, not detected.
 *
 *   D. Adversarial — the permanent principle (4 tests)
 *    12. ADVERSARIAL: a 5% slippage on a low-volatility pool is blocked
 *         (the dynamic limit is small, so 5% is way beyond).
 *    13. ADVERSARIAL: a sandwich with attacker profit of exactly $0.01
 *         is still detected (the check is profit > 0, not profit > threshold).
 *    14. ADVERSARIAL: a sandwich attempt where the attacker's sell is
 *         in a LATER block (block N+2) is still detected (block-range
 *         window is ≥ 2).
 *    15. ADVERSARIAL: the private-relay stub correctly returns
 *         "not implemented" — no production code accidentally broadcasts
 *         via a non-existent relay.
 *
 * Run: npx tsx scripts/test-h1-mev-baseline.ts
 */

import {
  computeSlippageLimit,
  checkSlippage,
  detectSandwich,
  PublicMempoolRelay,
  PrivateRelayStub,
  PoolStateSnapshot,
  AddressActivity,
} from "../src/lib/chain/mev-baseline";

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

console.log("\n=== H1.4 — MEV Baseline Test Suite ===\n");

async function main(): Promise<void> {
  // =====================================================================
  // A. Dynamic slippage limit
  // =====================================================================

  console.log("  [A1] Baseline only: zero vol, small trade vs deep pool → limit ≈ baseline...");
  {
    const r = computeSlippageLimit({
      volatilityBps: 0,
      tradeSizeUsd: 100,
      poolLiquidityUsd: 1_000_000,
      baselineBps: 50,
    });
    // limit = 50 (baseline) + 0 (vol) + 0.5 (size: 100/1M * 10000 * 0.5 = 0.5) = 50.5
    assert(r.bps >= 50 && r.bps <= 51, `expected bps~50 (small size contribution); got ${r.bps}`);
    assert(r.components.baseline === 50, `expected baseline=50; got ${r.components.baseline}`);
    assert(r.components.volatilityContribution === 0, `expected vol=0; got ${r.components.volatilityContribution}`);
    assert(r.components.sizeContribution < 1, `expected size<1; got ${r.components.sizeContribution}`);
  }

  console.log("  [A2] Volatility contribution: high volatility → wider limit...");
  {
    const r = computeSlippageLimit({
      volatilityBps: 200,  // 2% stdev
      tradeSizeUsd: 100,
      poolLiquidityUsd: 1_000_000,
      baselineBps: 50,
    });
    // baseline 50 + vol 100 + size 0.5 = 150.5
    assert(r.bps >= 150 && r.bps <= 151, `expected bps~150 (small size contribution); got ${r.bps}`);
    assert(r.components.volatilityContribution === 100, `expected vol=100; got ${r.components.volatilityContribution}`);
  }

  console.log("  [A3] Size contribution: large trade vs shallow pool → wider limit...");
  {
    const r = computeSlippageLimit({
      volatilityBps: 0,
      tradeSizeUsd: 10_000,  // 10% of pool
      poolLiquidityUsd: 100_000,
      baselineBps: 50,
    });
    // baseline 50 + vol 0 + size (0.1 * 10000 * 0.5) = 500
    // hard cap 300 wins
    assert(r.bps === 300, `expected bps=300 (hard cap); got ${r.bps}`);
    assert(r.components.sizeContribution === 500, `expected size=500; got ${r.components.sizeContribution}`);
  }

  console.log("  [A4] Hard cap: extreme inputs → limit capped at 300bps...");
  {
    const r = computeSlippageLimit({
      volatilityBps: 10_000,  // 100% stdev (absurd)
      tradeSizeUsd: 1_000_000,
      poolLiquidityUsd: 1,  // pool with $1 liquidity (absurd)
      baselineBps: 50,
    });
    assert(r.bps === 300, `expected bps=300 (hard cap); got ${r.bps}`);
  }

  // =====================================================================
  // B. Slippage check
  // =====================================================================

  console.log("  [B1] Within limit → ok=true...");
  {
    const r = checkSlippage(100, 100.3, {
      volatilityBps: 0,
      tradeSizeUsd: 100,
      poolLiquidityUsd: 1_000_000,
      baselineBps: 50,
    });
    // 0.3% slippage = 30 bps; limit = 50 bps → ok
    assert(r.ok, `expected ok=true; got ${JSON.stringify(r)}`);
    // 0.3% slippage = 30 bps (allow floating-point tolerance).
    assert(Math.abs(r.actualBps - 30) < 0.001, `expected actualBps~30; got ${r.actualBps}`);
    assert(r.direction === "excess", `expected direction=excess; got ${r.direction}`);
  }

  console.log("  [B2] Beyond limit → ok=false...");
  {
    const r = checkSlippage(100, 101, {  // 1% slippage = 100 bps
      volatilityBps: 0,
      tradeSizeUsd: 100,
      poolLiquidityUsd: 1_000_000,
      baselineBps: 50,
    });
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.actualBps === 100, `expected actualBps=100; got ${r.actualBps}`);
  }

  console.log("  [B3] Negative expected price → ok=false (defense)...");
  {
    const r = checkSlippage(0, 100, {
      volatilityBps: 0,
      tradeSizeUsd: 100,
      poolLiquidityUsd: 1_000_000,
    });
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.actualBps === Infinity, `expected actualBps=Infinity; got ${r.actualBps}`);
  }

  // =====================================================================
  // C. Sandwich detection
  // =====================================================================

  const PRE: PoolStateSnapshot = { blockNumber: 100, spotPrice: 1.0, liquidityUsd: 500_000 };
  const POST: PoolStateSnapshot = { blockNumber: 102, spotPrice: 1.02, liquidityUsd: 498_000 };

  console.log("  [C1] No attacker (only victim trades) → score=0, not detected...");
  {
    const trades: AddressActivity[] = [
      { address: "0xVictim", side: "buy", sizeUsd: 1000, blockNumber: 101 },
    ];
    const r = detectSandwich("0xVictim", PRE, POST, trades);
    assert(r.score === 0, `expected score=0; got ${r.score}`);
    assert(!r.detected, `expected not detected; got ${r.detected}`);
  }

  console.log("  [C2] Perfect sandwich (attacker buy + victim buy + attacker sell, profit) → detected...");
  {
    const trades: AddressActivity[] = [
      { address: "0xAttacker", side: "buy", sizeUsd: 5000, blockNumber: 100 },
      { address: "0xVictim", side: "buy", sizeUsd: 1000, blockNumber: 101 },
      { address: "0xAttacker", side: "sell", sizeUsd: 5200, blockNumber: 102 },  // profit $200
    ];
    const r = detectSandwich("0xVictim", PRE, POST, trades);
    assert(r.score === 1.0, `expected score=1.0; got ${r.score}`);
    assert(r.detected, `expected detected; got ${r.detected}`);
    assert(r.attacker === "0xattacker", `expected attacker=0xattacker; got ${r.attacker}`);
    assert(r.reason.includes("sandwich detected"), `expected reason; got ${r.reason}`);
  }

  console.log("  [C3] Lone front-run (attacker buy before victim, no sell yet) → detected...");
  {
    const trades: AddressActivity[] = [
      { address: "0xAttacker", side: "buy", sizeUsd: 5000, blockNumber: 100 },
      { address: "0xVictim", side: "buy", sizeUsd: 1000, blockNumber: 101 },
      // No attacker sell — back-run hasn't happened yet (or we're in the
      // middle of the sandwich).
    ];
    const postHigher: PoolStateSnapshot = { ...POST, spotPrice: 1.05 };
    const r = detectSandwich("0xVictim", PRE, postHigher, trades);
    assert(r.score === 0.5, `expected score=0.5; got ${r.score}`);
    assert(r.detected, `expected detected; got ${r.detected}`);
    assert(r.reason.includes("front-run"), `expected 'front-run' in reason; got ${r.reason}`);
  }

  console.log("  [C4] Attacker no-profit (buy+sell but lost money) — front-run signal still fires...");
  {
    // The attacker's buy+sell pair LOST money ($200 loss). The "perfect
    // sandwich" path (requires profit > 0) does NOT fire. However, the
    // lone-front-run path DOES fire because the attacker bought BEFORE
    // the victim and the pool price increased — that's suspicious on
    // its own, even if the visible back-run was unprofitable. (The
    // attacker could be profiting on a hidden third trade.)
    //
    // Expected: score=0.5 (front-run), detected=true.
    const trades: AddressActivity[] = [
      { address: "0xAttacker", side: "buy", sizeUsd: 5000, blockNumber: 100 },
      { address: "0xVictim", side: "buy", sizeUsd: 1000, blockNumber: 101 },
      { address: "0xAttacker", side: "sell", sizeUsd: 4800, blockNumber: 102 },  // loss $200
    ];
    const r = detectSandwich("0xVictim", PRE, POST, trades);
    assert(r.score === 0.5, `expected score=0.5 (front-run, no perfect-sandwich); got ${r.score}`);
    assert(r.detected, `expected detected (front-run); got ${r.detected}`);
    assert(r.reason.includes("front-run"), `expected 'front-run' in reason; got ${r.reason}`);
  }

  console.log("  [C4b] Attacker buys AFTER victim (no front-run) and loses money → not detected...");
  {
    // The attacker buys AFTER the victim (no front-run signal) and
    // sells even later at a loss. There's no profit and no front-run,
    // so neither path fires.
    const trades: AddressActivity[] = [
      { address: "0xVictim", side: "buy", sizeUsd: 1000, blockNumber: 100 },
      { address: "0xAttacker", side: "buy", sizeUsd: 5000, blockNumber: 101 },
      { address: "0xAttacker", side: "sell", sizeUsd: 4800, blockNumber: 102 },  // loss $200
    ];
    const r = detectSandwich("0xVictim", PRE, POST, trades);
    assert(r.score < 0.5, `expected score<0.5 (no front-run, no profit); got ${r.score}`);
    assert(!r.detected, `expected not detected; got ${r.detected}`);
  }

  // =====================================================================
  // D. Adversarial — the permanent principle
  // =====================================================================

  console.log("  [D1] ADVERSARIAL: 5% slippage on low-vol pool is blocked...");
  {
    // Low-vol pool, small trade: dynamic limit ~50bps.
    // 5% slippage = 500bps — way beyond.
    const r = checkSlippage(100, 105, {  // 5% slippage
      volatilityBps: 0,
      tradeSizeUsd: 100,
      poolLiquidityUsd: 1_000_000,
      baselineBps: 50,
    });
    assert(!r.ok, `5% slippage MUST be blocked on low-vol pool; got ${JSON.stringify(r)}`);
    assert(r.actualBps === 500, `expected 500bps; got ${r.actualBps}`);
    // limit = 50 (baseline) + 0 (vol) + 0.5 (size: 100/1M * 10000 * 0.5) = 50.5
    assert(r.limit.bps >= 50 && r.limit.bps <= 51, `expected limit ~50bps (small size contribution); got ${r.limit.bps}`);
  }

  console.log("  [D2] ADVERSARIAL: sandwich with attacker profit of exactly $0.01 is still detected...");
  {
    // The check is "attackerProfit > 0", not "attackerProfit > threshold".
    // Even a microscopic profit indicates a sandwich (the attacker might
    // be running a sub-optimal sandwich, or splitting across many victims).
    const trades: AddressActivity[] = [
      { address: "0xAttacker", side: "buy", sizeUsd: 100, blockNumber: 100 },
      { address: "0xVictim", side: "buy", sizeUsd: 50, blockNumber: 101 },
      { address: "0xAttacker", side: "sell", sizeUsd: 100.01, blockNumber: 102 },  // profit $0.01
    ];
    const r = detectSandwich("0xVictim", PRE, POST, trades);
    assert(r.score === 1.0, `expected score=1.0 even for $0.01 profit; got ${r.score}`);
    assert(r.detected, `expected detected; got ${r.detected}`);
  }

  console.log("  [D3] ADVERSARIAL: sandwich with attacker sell in a later block (N+2) is still detected...");
  {
    // The attacker's sell is 2 blocks after the victim's buy. This is
    // a "slow" sandwich (attacker waits for the price to settle). The
    // detector should still catch it.
    const trades: AddressActivity[] = [
      { address: "0xAttacker", side: "buy", sizeUsd: 5000, blockNumber: 100 },
      { address: "0xVictim", side: "buy", sizeUsd: 1000, blockNumber: 101 },
      { address: "0xAttacker", side: "sell", sizeUsd: 5500, blockNumber: 103 },  // 2 blocks later
    ];
    const r = detectSandwich("0xVictim", PRE, POST, trades);
    assert(r.score === 1.0, `expected score=1.0 for slow sandwich; got ${r.score}`);
    assert(r.detected, `expected detected; got ${r.detected}`);
  }

  console.log("  [D4] ADVERSARIAL: private-relay stub returns 'not implemented' (no production use)...");
  {
    const relay = new PrivateRelayStub("flashbots-protect-stub");
    assert(relay.name === "flashbots-protect-stub", `expected name; got ${relay.name}`);
    assert(relay.isPrivate, `expected isPrivate=true; got ${relay.isPrivate}`);

    const r = await relay.broadcast({ rawTx: "0xdeadbeef" });
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.error?.includes("not implemented"), `expected 'not implemented'; got ${r.error}`);
    assert(r.error?.includes("M3+"), `expected M3+ mention; got ${r.error}`);
  }

  console.log("  [D5] ADVERSARIAL: public-mempool relay passes through to the injected broadcastFn...");
  {
    let capturedRawTx: string | null = null;
    const relay = new PublicMempoolRelay(async (rawTx) => {
      capturedRawTx = rawTx;
      return { ok: true, txHash: "0xtxhash123" };
    });
    assert(relay.name === "public-mempool", `expected name; got ${relay.name}`);
    assert(!relay.isPrivate, `expected isPrivate=false; got ${relay.isPrivate}`);

    const r = await relay.broadcast({ rawTx: "0xdeadbeef" });
    assert(r.ok, `expected ok=true; got ${JSON.stringify(r)}`);
    assert(r.txHash === "0xtxhash123", `expected txHash; got ${r.txHash}`);
    assert(capturedRawTx === "0xdeadbeef", `expected rawTx captured; got ${capturedRawTx}`);
  }

  console.log(`\n=== H1.4 summary: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
