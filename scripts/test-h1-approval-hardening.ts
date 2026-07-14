/**
 * H1.3 — Approval Hardening test suite.
 *
 * Tests the ApprovalGate class against an in-memory ledger. No real
 * network calls are made.
 *
 * 15 scenarios across 4 categories:
 *
 *   A. Cap enforcement (4 tests)
 *     1. Normal approval within cap → ok, approvedAmount = requested.
 *     2. Approval exceeding cap → ok, capped=true, approvedAmount = cap.
 *     3. Approval exceeding balance → blocked (over-approval).
 *     4. Approval equal to balance (with allowFullBalanceApproval=false)
 *        → blocked.
 *
 *   B. Unlimited approval block (3 tests)
 *     5. type(uint256).max → blocked.
 *     6. MAX_UINT as bigint literal → blocked.
 *     7. Zero approval → blocked.
 *
 *   C. Ledger + revocation (3 tests)
 *     8. recordGrant writes to ledger; inventory lists it.
 *     9. recordRevocation marks revoked; inventory excludes it.
 *    10. recordRevocation on non-existent approval → ok=true, found=false.
 *
 *   D. Adversarial — the permanent principle (5 tests)
 *    11. ADVERSARIAL: unlimited approval (MAX_UINT) cannot bypass the
 *        gate even with allowFullBalanceApproval=true.
 *    12. ADVERSARIAL: over-approval cannot bypass via a malicious cap
 *        (cap higher than balance still gets blocked on the balance check).
 *    13. ADVERSARIAL: an approval exactly at the cap is allowed; one unit
 *         above is capped — verifies the boundary.
 *    14. ADVERSARIAL: after revocation, a re-grant with the same (token,
 *         owner, spender) creates a NEW record (revoked=false).
 *    15. ADVERSARIAL: inventory filter correctly excludes revoked records
 *         even when the ledger still stores them.
 *
 * Run: npx tsx scripts/test-h1-approval-hardening.ts
 */

import {
  ApprovalGate,
  InMemoryApprovalLedger,
  MAX_UINT256,
  ApprovalPolicy,
} from "../src/lib/chain/approval-hardening";

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

const TOKEN = "0xToken";
const OWNER = "0xOwner";
const SPENDER = "0xSpender";

// 1 million tokens with 18 decimals.
const ONE_MILLION = "1000000000000000000000000";
// 100 tokens.
const ONE_HUNDRED = "100000000000000000000";

console.log("\n=== H1.3 — Approval Hardening Test Suite ===\n");

async function main(): Promise<void> {
  // =====================================================================
  // A. Cap enforcement
  // =====================================================================

  console.log("  [A1] Normal approval within cap → ok, approvedAmount = requested...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {
      maxApprovalPerSpender: ONE_HUNDRED,  // cap at 100 tokens
    });
    const r = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: ONE_HUNDRED,  // exactly at cap
      ownerBalance: ONE_MILLION,
    });
    assert(r.ok, `expected ok=true; got ${JSON.stringify(r)}`);
    assert(r.approvedAmount === ONE_HUNDRED, `expected approvedAmount=${ONE_HUNDRED}; got ${r.approvedAmount}`);
    assert(!r.capped, `expected capped=false; got ${r.capped}`);
  }

  console.log("  [A2] Approval exceeding cap → ok, capped=true, approvedAmount = cap...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {
      maxApprovalPerSpender: ONE_HUNDRED,
    });
    const r = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: ONE_MILLION,  // way above cap
      ownerBalance: ONE_MILLION,
    });
    assert(r.ok, `expected ok=true; got ${JSON.stringify(r)}`);
    assert(r.approvedAmount === ONE_HUNDRED, `expected approvedAmount=${ONE_HUNDRED}; got ${r.approvedAmount}`);
    assert(r.capped, `expected capped=true; got ${r.capped}`);
  }

  console.log("  [A3] Approval exceeding balance → blocked (over-approval)...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {});  // no cap
    const r = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: "200000000000000000000",  // 200 tokens
      ownerBalance: ONE_HUNDRED,        // only 100 tokens
    });
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.rejectReason?.includes("over-approval"), `expected 'over-approval'; got ${r.rejectReason}`);
  }

  console.log("  [A4] Approval equal to balance (allowFullBalanceApproval=false) → blocked...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {});
    const r = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: ONE_HUNDRED,
      ownerBalance: ONE_HUNDRED,  // equal — still blocked
    });
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.rejectReason?.includes("over-approval"), `expected 'over-approval'; got ${r.rejectReason}`);
  }

  // =====================================================================
  // B. Unlimited approval block
  // =====================================================================

  console.log("  [B1] type(uint256).max → blocked...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {});
    const r = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: MAX_UINT256,
      ownerBalance: ONE_MILLION,
    });
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.rejectReason?.includes("unlimited approval"), `expected 'unlimited approval'; got ${r.rejectReason}`);
  }

  console.log("  [B2] MAX_UINT as bigint literal (numerically equal) → blocked...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {});
    // Same numeric value, but expressed as a different string.
    const sameMaxUint = (2n ** 256n - 1n).toString();
    assert(sameMaxUint === MAX_UINT256, "test setup: sameMaxUint should equal MAX_UINT256");
    const r = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: sameMaxUint,
      ownerBalance: ONE_MILLION,
    });
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.rejectReason?.includes("unlimited approval"), `expected 'unlimited approval'; got ${r.rejectReason}`);
  }

  console.log("  [B3] Zero approval → blocked...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {});
    const r = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: "0",
      ownerBalance: ONE_MILLION,
    });
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.rejectReason?.includes("must be positive"), `expected 'must be positive'; got ${r.rejectReason}`);
  }

  // =====================================================================
  // C. Ledger + revocation
  // =====================================================================

  console.log("  [C1] recordGrant writes to ledger; inventory lists it...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {});
    await gate.recordGrant({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      grantedAmount: ONE_HUNDRED, remainingAmount: ONE_HUNDRED,
    });
    const inv = await gate.inventory(OWNER);
    assert(inv.length === 1, `expected 1 inventory item; got ${inv.length}`);
    assert(inv[0].token === TOKEN, `expected token; got ${inv[0].token}`);
    assert(inv[0].grantedAmount === ONE_HUNDRED, `expected grantedAmount; got ${inv[0].grantedAmount}`);
    assert(!inv[0].revoked, `expected revoked=false; got ${inv[0].revoked}`);
  }

  console.log("  [C2] recordRevocation marks revoked; inventory excludes it...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {});
    await gate.recordGrant({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      grantedAmount: ONE_HUNDRED, remainingAmount: ONE_HUNDRED,
    });
    const r = await gate.recordRevocation({ token: TOKEN, owner: OWNER, spender: SPENDER });
    assert(r.ok && r.found, `expected ok=true found=true; got ${JSON.stringify(r)}`);
    const inv = await gate.inventory(OWNER);
    assert(inv.length === 0, `expected 0 inventory items after revocation; got ${inv.length}`);
  }

  console.log("  [C3] recordRevocation on non-existent approval → ok=true, found=false...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {});
    const r = await gate.recordRevocation({ token: TOKEN, owner: OWNER, spender: SPENDER });
    assert(r.ok, `expected ok=true; got ${JSON.stringify(r)}`);
    assert(!r.found, `expected found=false; got ${r.found}`);
  }

  // =====================================================================
  // D. Adversarial — the permanent principle
  // =====================================================================

  console.log("  [D1] ADVERSARIAL: unlimited approval (MAX_UINT) cannot bypass even with allowFullBalanceApproval=true...");
  {
    // The "allowFullBalanceApproval=true" policy is a relaxation of the
    // over-approval check, NOT a relaxation of the unlimited-approval
    // block. MAX_UINT must still be blocked.
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, { allowFullBalanceApproval: true });
    const r = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: MAX_UINT256,
      ownerBalance: ONE_MILLION,
    });
    assert(!r.ok, `MAX_UINT MUST be blocked even with allowFullBalanceApproval=true; got ${JSON.stringify(r)}`);
    assert(r.rejectReason?.includes("unlimited approval"), `expected 'unlimited approval'; got ${r.rejectReason}`);
  }

  console.log("  [D2] ADVERSARIAL: over-approval cannot bypass via a malicious cap higher than balance...");
  {
    // Operator configures a cap of 1 million. Owner only has 100.
    // Requesting 1000 should still be blocked (over-approval on balance)
    // even though the cap allows it.
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {
      maxApprovalPerSpender: ONE_MILLION,
    });
    const r = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: "1000000000000000000000",  // 1000 tokens
      ownerBalance: ONE_HUNDRED,          // only 100
    });
    assert(!r.ok, `over-approval MUST be blocked regardless of cap; got ${JSON.stringify(r)}`);
    assert(r.rejectReason?.includes("over-approval"), `expected 'over-approval'; got ${r.rejectReason}`);
  }

  console.log("  [D3] ADVERSARIAL: approval at cap boundary (exactly cap) is allowed; one unit above is capped...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {
      maxApprovalPerSpender: ONE_HUNDRED,
    });
    // Exactly cap.
    const r1 = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: ONE_HUNDRED,
      ownerBalance: ONE_MILLION,
    });
    assert(r1.ok && !r1.capped && r1.approvedAmount === ONE_HUNDRED,
      `expected ok=true capped=false at exact cap; got ${JSON.stringify(r1)}`);

    // One wei above cap.
    const oneWeiAbove = (BigInt(ONE_HUNDRED) + 1n).toString();
    const r2 = await gate.evaluate({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      amount: oneWeiAbove,
      ownerBalance: ONE_MILLION,
    });
    assert(r2.ok && r2.capped && r2.approvedAmount === ONE_HUNDRED,
      `expected ok=true capped=true one wei above; got ${JSON.stringify(r2)}`);
  }

  console.log("  [D4] ADVERSARIAL: after revocation, a re-grant creates a new non-revoked record...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {});
    // First grant.
    await gate.recordGrant({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      grantedAmount: ONE_HUNDRED, remainingAmount: ONE_HUNDRED,
    });
    // Revoke.
    await gate.recordRevocation({ token: TOKEN, owner: OWNER, spender: SPENDER });
    // Re-grant.
    await gate.recordGrant({
      token: TOKEN, owner: OWNER, spender: SPENDER,
      grantedAmount: ONE_HUNDRED, remainingAmount: ONE_HUNDRED,
    });
    const inv = await gate.inventory(OWNER);
    assert(inv.length === 1, `expected 1 active inventory item after re-grant; got ${inv.length}`);
    assert(!inv[0].revoked, `expected new record not revoked; got ${inv[0].revoked}`);
  }

  console.log("  [D5] ADVERSARIAL: inventory filter excludes revoked records even when ledger stores them...");
  {
    const ledger = new InMemoryApprovalLedger();
    const gate = new ApprovalGate(ledger, {});
    // Grant two approvals with different spenders.
    await gate.recordGrant({
      token: TOKEN, owner: OWNER, spender: "0xSpender1",
      grantedAmount: ONE_HUNDRED, remainingAmount: ONE_HUNDRED,
    });
    await gate.recordGrant({
      token: TOKEN, owner: OWNER, spender: "0xSpender2",
      grantedAmount: ONE_HUNDRED, remainingAmount: ONE_HUNDRED,
    });
    // Revoke one.
    await gate.recordRevocation({ token: TOKEN, owner: OWNER, spender: "0xSpender1" });
    const inv = await gate.inventory(OWNER);
    assert(inv.length === 1, `expected 1 active (1 of 2 revoked); got ${inv.length}`);
    assert(inv[0].spender === "0xSpender2", `expected Spender2 to remain; got ${inv[0].spender}`);
    // Underlying ledger should still have 2 records (revoked is not deleted).
    const allRecords = await ledger.listForOwner(OWNER);
    assert(allRecords.length === 2, `expected 2 raw records; got ${allRecords.length}`);
  }

  console.log(`\n=== H1.3 summary: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
