/**
 * H1.2 — Transaction Simulation test suite.
 *
 * Tests the SimulationGate class against an injectable mock simulator.
 * No real network calls are made.
 *
 * 14 scenarios across 4 categories:
 *
 *   A. Happy path (3 tests)
 *     1. Exact match: simulation matches expected diff → broadcast ok.
 *     2. Tolerance match: amount within 0.5% → broadcast ok.
 *     3. No-state-change tx (e.g. simple native transfer expected,
 *        simulation confirms) → broadcast ok.
 *
 *   B. Revert handling (3 tests)
 *     4. Simulation reverts → broadcast blocked.
 *     5. Expected revert + simulation reverts → broadcast ok.
 *     6. Expected revert but simulation succeeds → broadcast blocked.
 *
 *   C. Diff divergence (4 tests)
 *     7. Simulated has extra transfer not in expected → blocked.
 *     8. Expected transfer missing from simulation → blocked.
 *     9. Amount mismatch beyond tolerance → blocked.
 *    10. Gas exceeds maxGas → blocked.
 *
 *   D. Adversarial — the permanent principle (4 tests)
 *    11. ADVERSARIAL: a honeypot tx (sell looks OK in code but simulates
 *        as a revert) is blocked by the gate.
 *    12. ADVERSARIAL: an approval-of-MAX_UINT that the caller expected
 *        to be a capped approval is blocked.
 *    13. ADVERSARIAL: a reentrancy trap that drains extra gas is blocked.
 *    14. ADVERSARIAL: a transfer-to-wrong-recipient (simulated `to` ≠
 *        expected `to`) is blocked.
 *
 * Run: npx tsx scripts/test-h1-simulation-gate.ts
 */

import {
  SimulationGate,
  Simulator,
  ExpectedDiff,
  SimulationResult,
  compareAmounts,
} from "../src/lib/chain/simulation-gate";

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
// Mock simulator builder.
// -------------------------------------------------------------------------

/**
 * A scripted simulator. Each call returns the next entry in the script.
 * If the script is exhausted, throws.
 */
function makeScriptedSimulator(script: SimulationResult[]): Simulator {
  let cursor = 0;
  return async () => {
    if (cursor >= script.length) throw new Error("simulator script exhausted");
    return script[cursor++];
  };
}

const ADDR_TOKEN = "0xTokenContract";
const ADDR_FROM = "0xCaller";
const ADDR_TO_SWAP_ROUTER = "0xSwapRouter";
const ADDR_RECIPIENT = "0xIntendedRecipient";
const ADDR_ATTACKER = "0xAttacker";

console.log("\n=== H1.2 — Transaction Simulation Gate Test Suite ===\n");

async function main(): Promise<void> {
  // =====================================================================
  // A. Happy path
  // =====================================================================

  console.log("  [A1] Exact match: simulation matches expected diff → broadcast ok...");
  {
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
        gasUsed: 120_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      {
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
        maxGas: 200_000,
      },
    );
    assert(r.ok, `expected ok=true; got ${JSON.stringify(r)}`);
    assert(r.diff.matched.length === 1, `expected 1 matched; got ${r.diff.matched.length}`);
    assert(r.diff.missingExpected.length === 0, `expected 0 missingExpected; got ${r.diff.missingExpected.length}`);
    assert(r.diff.missingSimulated.length === 0, `expected 0 missingSimulated; got ${r.diff.missingSimulated.length}`);
  }

  console.log("  [A2] Tolerance match: amount within 0.5% → broadcast ok...");
  {
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [
          // Simulated 0.3% slippage — within 0.5% tolerance.
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "997000000000000000" },
        ],
        gasUsed: 120_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim, amountToleranceBps: 50 });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      {
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
      },
    );
    assert(r.ok, `expected ok=true (within tolerance); got ${JSON.stringify(r)}`);
  }

  console.log("  [A3] Tolerance exceeded: 1% slippage vs 0.5% tolerance → blocked...");
  {
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [
          // Simulated 1% slippage — beyond 0.5% tolerance.
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "990000000000000000" },
        ],
        gasUsed: 120_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim, amountToleranceBps: 50 });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      {
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
      },
    );
    assert(!r.ok, `expected ok=false (beyond tolerance); got ${JSON.stringify(r)}`);
    assert(r.blockReason?.includes("amount mismatch"), `expected 'amount mismatch'; got ${r.blockReason}`);
  }

  // =====================================================================
  // B. Revert handling
  // =====================================================================

  console.log("  [B1] Simulation reverts → broadcast blocked...");
  {
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: false,
        revertReason: "execution reverted: ERC20InsufficientBalance",
        changes: [],
        gasUsed: 30_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      { changes: [], maxGas: 200_000 },
    );
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.blockReason?.includes("reverted"), `expected 'reverted' in reason; got ${r.blockReason}`);
    assert(r.blockReason?.includes("ERC20InsufficientBalance"), `expected revert reason surfaced; got ${r.blockReason}`);
  }

  console.log("  [B2] Expected revert + simulation reverts → broadcast ok...");
  {
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: false,
        revertReason: "execution reverted: Erc20InsufficientAllowance",
        changes: [],
        gasUsed: 30_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      { changes: [], maxGas: 200_000, expectRevert: true },
    );
    assert(r.ok, `expected ok=true (revert was expected); got ${JSON.stringify(r)}`);
  }

  console.log("  [B3] Expected revert but simulation succeeds → broadcast blocked...");
  {
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [],
        gasUsed: 100_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      { changes: [], maxGas: 200_000, expectRevert: true },
    );
    assert(!r.ok, `expected ok=false (revert expected but didn't happen); got ${JSON.stringify(r)}`);
    assert(r.blockReason?.includes("expected revert"), `expected 'expected revert' in reason; got ${r.blockReason}`);
  }

  // =====================================================================
  // C. Diff divergence
  // =====================================================================

  console.log("  [C1] Simulated has extra transfer not in expected → blocked...");
  {
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
          // EXTRA: attacker receives a dust transfer
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_ATTACKER, amount: "1000000000000000" },
        ],
        gasUsed: 120_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      {
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
      },
    );
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.blockReason?.includes("unexpected state change"), `expected 'unexpected state change'; got ${r.blockReason}`);
    assert(r.diff.missingExpected.length === 1, `expected 1 missingExpected (the dust transfer); got ${r.diff.missingExpected.length}`);
    assert(r.diff.missingExpected[0].to === ADDR_ATTACKER, `expected attacker as missing recipient; got ${r.diff.missingExpected[0].to}`);
  }

  console.log("  [C2] Expected transfer missing from simulation → blocked...");
  {
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [],  // simulation produces no state change at all
        gasUsed: 80_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      {
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
      },
    );
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.blockReason?.includes("not present in simulation"), `expected 'not present in simulation'; got ${r.blockReason}`);
    assert(r.diff.missingSimulated.length === 1, `expected 1 missingSimulated; got ${r.diff.missingSimulated.length}`);
  }

  console.log("  [C3] Amount mismatch beyond tolerance → blocked...");
  {
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [
          // Simulated 50% more tokens transferred than expected — clearly malicious.
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1500000000000000000" },
        ],
        gasUsed: 120_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim, amountToleranceBps: 50 });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      {
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
      },
    );
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.blockReason?.includes("amount mismatch"), `expected 'amount mismatch'; got ${r.blockReason}`);
    assert(r.diff.mismatchedAmount.length === 1, `expected 1 mismatchedAmount; got ${r.diff.mismatchedAmount.length}`);
    assert(r.diff.mismatchedAmount[0].reason.includes("excess"), `expected 'excess'; got ${r.diff.mismatchedAmount[0].reason}`);
  }

  console.log("  [C4] Gas exceeds maxGas → blocked...");
  {
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
        gasUsed: 350_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      {
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
        maxGas: 200_000,
      },
    );
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.blockReason?.includes("gas exceeded"), `expected 'gas exceeded'; got ${r.blockReason}`);
  }

  // =====================================================================
  // D. Adversarial — the permanent principle
  // Each test explicitly attempts to break the property the gate promises.
  // =====================================================================

  console.log("  [D1] ADVERSARIAL: honeypot tx (sell looks OK in code but simulates as revert) is blocked...");
  {
    // The caller expects the sell to succeed (a normal ERC-20 transfer).
    // The simulation reveals the contract reverts on sell (classic honeypot).
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: false,
        revertReason: "execution reverted: CannotSell",
        changes: [],
        gasUsed: 50_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TOKEN, value: "0", data: "0xa9059cbb..." },
      {
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
      },
    );
    assert(!r.ok, `honeypot MUST be blocked; got ${JSON.stringify(r)}`);
    assert(r.blockReason?.includes("reverted") && r.blockReason?.includes("CannotSell"),
      `expected 'reverted: CannotSell'; got ${r.blockReason}`);
  }

  console.log("  [D2] ADVERSARIAL: approval of MAX_UINT (caller expected capped) is blocked...");
  {
    // The caller expects a 100-token approval. The simulation reveals
    // the actual approval would be type(uint256).max — a drain vector.
    const MAX_UINT = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [
          { kind: "erc20_approval", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: MAX_UINT },
        ],
        gasUsed: 50_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TOKEN, value: "0", data: "0x095ea7b3..." },
      {
        changes: [
          // Caller expected a capped approval of 100 tokens.
          { kind: "erc20_approval", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "100000000000000000000" },
        ],
      },
    );
    assert(!r.ok, `MAX_UINT approval MUST be blocked; got ${JSON.stringify(r)}`);
    // The block can be either "amount mismatch" (structural match exists, amount differs wildly)
    // or "unexpected state change" (if exact-match succeeds on kind/token/from/to only when amounts equal).
    // Given amounts differ, this should hit the mismatchedAmount path.
    assert(r.diff.mismatchedAmount.length === 1, `expected 1 mismatchedAmount; got ${r.diff.mismatchedAmount.length}`);
    assert(r.diff.mismatchedAmount[0].simulated.amount === MAX_UINT, `expected MAX_UINT in simulated; got ${r.diff.mismatchedAmount[0].simulated.amount}`);
  }

  console.log("  [D3] ADVERSARIAL: reentrancy trap that drains extra gas is blocked...");
  {
    // Caller expects ~120k gas. The simulation reveals a reentrancy trap
    // that consumes 2M gas (would drain the caller's gas limit and revert
    // the outer tx, but only after side-effects).
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
        gasUsed: 2_000_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "0", data: "0x" },
      {
        changes: [
          { kind: "erc20_transfer", token: ADDR_TOKEN, from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, amount: "1000000000000000000" },
        ],
        maxGas: 250_000,
      },
    );
    assert(!r.ok, `reentrancy gas drain MUST be blocked; got ${JSON.stringify(r)}`);
    assert(r.blockReason?.includes("gas exceeded"), `expected 'gas exceeded'; got ${r.blockReason}`);
  }

  console.log("  [D4] ADVERSARIAL: transfer to wrong recipient (simulated `to` ≠ expected) is blocked...");
  {
    // Caller expects the recipient to be ADDR_RECIPIENT. The simulation
    // reveals the funds would actually go to ADDR_ATTACKER — a
    // misconfigured-router or compromised-contract attack.
    const sim: Simulator = makeScriptedSimulator([
      {
        ok: true,
        changes: [
          { kind: "native_transfer", from: ADDR_FROM, to: ADDR_ATTACKER, amount: "1000000000000000000" },
        ],
        gasUsed: 30_000,
        from: ADDR_FROM,
      },
    ]);
    const gate = new SimulationGate({ simulator: sim });
    const r = await gate.simulateAndVerify(
      { from: ADDR_FROM, to: ADDR_TO_SWAP_ROUTER, value: "1000000000000000000", data: "0x" },
      {
        changes: [
          { kind: "native_transfer", from: ADDR_FROM, to: ADDR_RECIPIENT, amount: "1000000000000000000" },
        ],
      },
    );
    assert(!r.ok, `wrong-recipient transfer MUST be blocked; got ${JSON.stringify(r)}`);
    // Both: expected is missing from simulation (no transfer to RECIPIENT)
    // AND simulation has an unexpected transfer to ATTACKER.
    assert(r.diff.missingExpected.length === 1 || r.diff.missingSimulated.length === 1,
      `expected at least one diff entry; got missingExpected=${r.diff.missingExpected.length} missingSimulated=${r.diff.missingSimulated.length}`);
    if (r.diff.missingExpected.length === 1) {
      assert(r.diff.missingExpected[0].to === ADDR_ATTACKER, `expected ATTACKER in missingExpected; got ${r.diff.missingExpected[0].to}`);
    }
  }

  // =====================================================================
  // Bonus: direct unit test for compareAmounts (the tolerance primitive).
  // This is the "inner" adversarial test — even if the gate orchestration
  // is correct, a buggy compareAmounts would let amounts through.
  // =====================================================================

  console.log("  [D5] ADVERSARIAL: compareAmounts tolerance primitive is correct...");
  {
    // Exact equality.
    assert(compareAmounts("1000", "1000", 50) === "ok",
      `expected ok for exact equality; got ${compareAmounts("1000", "1000", 50)}`);

    // Within tolerance (0.3% on 1000 = 3 → simulated 1003 is within 0.5%/50bps).
    assert(compareAmounts("1000", "1003", 50) === "ok",
      `expected ok for 0.3% slippage; got ${compareAmounts("1000", "1003", 50)}`);

    // At tolerance boundary (50bps on 1000 = 5 → simulated 1005 is exactly at boundary).
    assert(compareAmounts("1000", "1005", 50) === "ok",
      `expected ok at boundary; got ${compareAmounts("1000", "1005", 50)}`);

    // Beyond tolerance (50bps on 1000 = 5 → simulated 1006 exceeds).
    assert(compareAmounts("1000", "1006", 50) !== "ok",
      `expected non-ok beyond boundary; got ${compareAmounts("1000", "1006", 50)}`);

    // Deficit direction.
    const r1 = compareAmounts("1000", "990", 50);
    assert(r1 !== "ok" && r1.includes("deficit"), `expected deficit; got ${r1}`);

    // Excess direction.
    const r2 = compareAmounts("1000", "1010", 50);
    assert(r2 !== "ok" && r2.includes("excess"), `expected excess; got ${r2}`);

    // Zero expected, non-zero simulated.
    const r3 = compareAmounts("0", "1", 50);
    assert(r3 !== "ok" && r3.includes("expected 0"), `expected 'expected 0' message; got ${r3}`);

    // Non-integer.
    const r4 = compareAmounts("abc", "1000", 50);
    assert(r4 !== "ok" && r4.includes("non-integer"), `expected 'non-integer'; got ${r4}`);

    // Big numbers (out of Number range).
    const big = "115792089237316195423570985008687907853269984665640564039457584007913129639935";  // MAX_UINT
    assert(compareAmounts(big, big, 50) === "ok", `expected ok for MAX_UINT equality`);
    // 1 unit difference on MAX_UINT is way within tolerance.
    const bigPlus1 = (BigInt(big) + 1n).toString();
    assert(compareAmounts(big, bigPlus1, 50) === "ok", `expected ok for 1-unit diff on MAX_UINT`);
  }

  console.log(`\n=== H1.2 summary: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
