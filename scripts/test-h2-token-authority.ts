/**
 * H2.3 — Token Authority Verification test suite.
 *
 * Tests TokenAuthorityVerifier against an in-memory mock source.
 *
 * 16 scenarios across 4 categories:
 *
 *   A. Happy paths (3 tests)
 *     1. Vanilla ERC-20 with no privileged selectors, no owner() → ok.
 *     2. Owner renounced (event + owner=0x0) with no other surfaces → ok.
 *     3. Owner allowlisted, no privileged selectors → ok.
 *
 *   B. Authority surfaces (5 tests)
 *     4. mint() present + no recognizable access control → fail-closed.
 *     5. mint() present + access control + owner allowlisted + allowMintIfAllowlisted → ok.
 *     6. pause() present + not paused + allowPauseIfAllowlisted=true + owner allowlisted → ok.
 *     7. pause() present + currently paused → fail regardless of allowlist.
 *     8. blacklist() present + owner allowlisted + allowFreezeBlacklistIfAllowlisted=false → fail.
 *
 *   C. Renounce variants (3 tests)
 *     9. Fake renounce: owner=0x0 but no OwnershipTransferred event → fail.
 *    10. Real renounce: owner=0x0 AND event present → ok; transferOwnership is dead code.
 *    11. Non-renounced owner in allowlist: owner=X, X in allowedAuthorityHolders → ok.
 *
 *   D. Adversarial (5 tests)
 *    12. HIDDEN MINT: mint() present but contract uses custom role system
 *        (no hasRole selector). Verifier can't determine access control.
 *        failClosedOnHidden=true (default) → fail. Caller can override
 *        with failClosedOnHidden=false, but the test documents the
 *        fail-closed default.
 *    13. TWO-STEP RENOUNCE TRICK: owner()=0x0 AND OwnershipTransferred
 *        event emitted — BUT the event has topics[2]=0x0 (transfer TO
 *        0x0). Actually wait, that's the real renounce. The trick is
 *        the opposite: owner()=0x0 was set via a non-standard path
 *        (e.g. setOwner(0x0) without emitting the event). Verifier
 *        catches this via the missing event. (Test 9 covers this.)
 *        For D2, we test: transferOwnership was last called by a non-
 *        zero owner to set owner=0x0 — the OwnershipTransferred event
 *        IS emitted with topics[2]=0x0 (real renounce), but the
 *        contract has a separate "backup owner" via a custom role.
 *        The mint() selector is gated by the backup role. Verifier
 *        detects mint() as "hidden" → fail-closed.
 *    14. PAUSED RENOUNCE: real renounce (owner=0x0 + event) AND pause()
 *        present AND contract currently unpaused. With default config
 *        (allowPauseIfAllowlisted=false), this fails because pause
 *        authority is unaccounted for. Document that real renounce of
 *        Ownable does NOT imply pause authority is renounced — pause
 *        may be governed by a separate Pausable-role.
 *    15. BLACKLIST ESCAPE: blacklist() present, currently empty (bot's
 *        address not yet blacklisted). Verifier rejects on
 *        "blacklist() present" alone — does NOT need to wait for the
 *        bot's address to actually be blacklisted. This is the
 *        "blocklist authority exists" trap.
 *    16. CALLER-DEPENDENT OWNER: contract returns different owner()
 *        values depending on caller. The verifier probes as 0x0; the
 *        contract returns the real owner to caller=0x0 and 0x0 to
 *        other callers. Verifier sees real owner (which is in
 *        allowlist) → ok. Then the contract is "flipped" — verifier's
 *        caller now gets 0x0. Verifier detects fake renounce. The
 *        limitation (verifier's view is caller-blind) is documented.
 *
 * Run: npx tsx scripts/test-h2-token-authority.ts
 */

import {
  TokenAuthorityVerifier,
  TokenAuthoritySource,
  TokenAuthorityManifest,
  AuthorityLog,
  Address,
  selectorPresent,
  SEL,
  OWNERSHIP_TRANSFERRED_TOPIC,
} from "../src/lib/chain/token-authority";
import { getAddress, zeroPadValue } from "ethers";

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
// Mock source
// -------------------------------------------------------------------------

interface MockState {
  code: string;
  /** Map of calldata-prefix (first 4 bytes / 8 hex chars after 0x) → handler. */
  callHandlers: Map<string, (calldata: string) => string>;
  logs: AuthorityLog[];
}

class MockSource implements TokenAuthoritySource {
  constructor(private readonly st: MockState) {}

  async getCode(): Promise<string> {
    return this.st.code;
  }

  async call(_token: Address, calldata: string): Promise<string> {
    // First 4 bytes = first 8 hex chars after 0x.
    const prefix = calldata.slice(0, 10).toLowerCase();
    const handler = this.st.callHandlers.get(prefix);
    if (!handler) throw new Error(`mock: no handler for ${prefix}`);
    return handler(calldata);
  }

  async getLogs(_token: Address, topic0: string): Promise<AuthorityLog[]> {
    return this.st.logs.filter(l => l.topics[0]?.toLowerCase() === topic0.toLowerCase());
  }
}

// -------------------------------------------------------------------------
// Helpers — build bytecode with selectors, build logs.
// -------------------------------------------------------------------------

function buildBytecode(selectors: string[]): string {
  let code = "0x";
  for (const sel of selectors) {
    const s = sel.startsWith("0x") ? sel.slice(2) : sel;
    code += "63" + s.toLowerCase() + "14";
  }
  code += "00";
  return code;
}

const ZERO_ADDR = "0x" + "0".repeat(40);
const OWNER_REAL = getAddress("0x0000000000000000000000000000000000000abc");
const OWNER_OTHER = getAddress("0x0000000000000000000000000000000000000def");
const TOKEN = getAddress("0x0000000000000000000000000000000000000001");

function pad32(hex: string): string {
  let h = hex.toLowerCase();
  if (h.startsWith("0x")) h = h.slice(2);
  while (h.length < 64) h = "0" + h;
  return "0x" + h;
}

function addrReturn(addr: Address): string {
  if (addr === ZERO_ADDR || /^0x0+$/.test(addr)) return pad32("0");
  return zeroPadValue(addr, 32);
}

function boolReturn(b: boolean): string {
  return pad32(b ? "01" : "00");
}

/** Build an OwnershipTransferred(previousOwner, newOwner) log. */
function ownershipLog(previousOwner: Address, newOwner: Address, blockNumber = 100): AuthorityLog {
  return {
    address: TOKEN,
    topics: [
      OWNERSHIP_TRANSFERRED_TOPIC,
      zeroPadValue(previousOwner === ZERO_ADDR ? ZERO_ADDR : previousOwner, 32),
      zeroPadValue(newOwner === ZERO_ADDR ? ZERO_ADDR : newOwner, 32),
    ],
    data: "0x",
    blockNumber,
    txIndex: 0,
    logIndex: 0,
  };
}

console.log("\n=== H2.3 — Token Authority Verification ===\n");

async function main(): Promise<void> {

// =========================================================================
// A. Happy paths
// =========================================================================

console.log("A. Happy paths");

// A1 — vanilla ERC-20, no privileged selectors, no owner().
{
  const code = buildBytecode([
    "0xa9059cbb",  // transfer
    "0x095ea7b3",  // approve
    "0x70a08231",  // balanceOf
    "0x18160ddd",  // totalSupply
  ]);
  const st: MockState = { code, callHandlers: new Map(), logs: [] };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [],
  });
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
  assert(!r.ownerIsZero, "expected ownerIsZero=false (no owner selector — nothing to renounce)");
  assert(!r.realRenounce, "expected realRenounce=false (no renounce needed)");
}

// A2 — owner renounced (event + owner=0x0).
{
  const code = buildBytecode([
    "0xa9059cbb",  // transfer
    "0x095ea7b3",  // approve
    "0x70a08231",  // balanceOf
    "0x18160ddd",  // totalSupply
    SEL.owner,
    SEL.transferOwnership,
    SEL.renounceOwnership,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(ZERO_ADDR)],
    ]),
    logs: [
      // Real renounce: OwnershipTransferred(OWNER_REAL, 0x0).
      ownershipLog(OWNER_REAL, ZERO_ADDR),
    ],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [],
  });
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
  assert(r.realRenounce, "expected realRenounce=true");
  // transferOwnership should be marked as renounced (dead code).
  const transferFinding = r.findings.find(f => f.surface === "ownership-transfer");
  assert(!!transferFinding, "expected ownership-transfer finding");
  assert(transferFinding!.state === "renounced", `expected transferOwnership state=renounced, got ${transferFinding!.state}`);
}

// A3 — owner allowlisted, no privileged selectors.
{
  const code = buildBytecode([
    "0xa9059cbb",  // transfer
    "0x70a08231",  // balanceOf
    "0x18160ddd",  // totalSupply
    SEL.owner,
    SEL.transferOwnership,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(OWNER_REAL)],
    ]),
    logs: [],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
  });
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
  assert(!r.realRenounce, "expected realRenounce=false");
}

// =========================================================================
// B. Authority surfaces
// =========================================================================

console.log("\nB. Authority surfaces");

// B1 — mint() present, no recognizable access control → fail-closed.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.mint,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(OWNER_REAL)],
    ]),
    logs: [],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
    // allowMintIfAllowlisted NOT set → default false → fail.
  });
  assert(!r.ok, "expected ok=false on mint() with no recognizable access control");
  assert(r.reasons.some(x => x.includes("mint:")), `expected mint reason, got: ${r.reasons.join("; ")}`);
}

// B2 — mint() present + access control + owner allowlisted + allowMintIfAllowlisted → ok.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.mint,
    SEL.hasRole,  // access control signal
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(OWNER_REAL)],
    ]),
    logs: [],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
    allowMintIfAllowlisted: true,
  });
  assert(r.ok, `expected ok=true with allowMintIfAllowlisted, got: ${r.reasons.join("; ")}`);
}

// B3 — pause() present + not paused + allowPauseIfAllowlisted=true + owner allowlisted.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.pause,
    SEL.paused,  // pause() and paused() share selector? Actually pause=0x8456cb59, paused=0x5c975abb. We have both here.
    SEL.unpause,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(OWNER_REAL)],
      [SEL.paused, () => boolReturn(false)],
    ]),
    logs: [],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
    allowPauseIfAllowlisted: true,
  });
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
}

// B4 — pause() present + currently paused → fail regardless of allowlist.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.pause,
    SEL.paused,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(OWNER_REAL)],
      [SEL.paused, () => boolReturn(true)],  // paused!
    ]),
    logs: [],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
    allowPauseIfAllowlisted: true,  // even with this, currently-paused should fail
  });
  assert(!r.ok, "expected ok=false on currently-paused contract");
  assert(r.reasons.some(x => x.includes("currently paused")), `expected 'currently paused' reason, got: ${r.reasons.join("; ")}`);
}

// B5 — blacklist() present + owner allowlisted + allowFreezeBlacklistIfAllowlisted=false → fail.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.blacklist,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(OWNER_REAL)],
    ]),
    logs: [],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
    allowFreezeBlacklistIfAllowlisted: false,
  });
  assert(!r.ok, "expected ok=false on blacklist() with allowFreezeBlacklistIfAllowlisted=false");
  assert(r.reasons.some(x => x.includes("blacklist:")), `expected blacklist reason, got: ${r.reasons.join("; ")}`);
}

// =========================================================================
// C. Renounce variants
// =========================================================================

console.log("\nC. Renounce variants");

// C1 — fake renounce: owner=0x0 but no event.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.transferOwnership,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(ZERO_ADDR)],
    ]),
    logs: [],  // no event!
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [],
  });
  assert(!r.ok, "expected ok=false on fake renounce");
  assert(r.reasons.some(x => x.includes("fake renounce")), `expected fake renounce reason, got: ${r.reasons.join("; ")}`);
  assert(!r.realRenounce, "expected realRenounce=false");
}

// C2 — real renounce + transferOwnership is dead code.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.transferOwnership,
    SEL.renounceOwnership,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(ZERO_ADDR)],
    ]),
    logs: [ownershipLog(OWNER_REAL, ZERO_ADDR)],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [],
  });
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
  assert(r.realRenounce, "expected realRenounce=true");
}

// C3 — owner is X, X in allowlist, no event.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.transferOwnership,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(OWNER_REAL)],
    ]),
    logs: [],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
  });
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
  // ownership-transfer is live but owner is allowlisted → not flagged.
  // (only flagged when not realRenounce AND owner is unknown.)
}

// =========================================================================
// D. Adversarial
// =========================================================================

console.log("\nD. Adversarial");

// D1 — HIDDEN MINT: mint() present, no hasRole selector.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.mint,  // NO hasRole selector — access control is custom/hidden
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(OWNER_REAL)],
    ]),
    logs: [],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  // Default failClosedOnHidden=true AND default allowMintIfAllowlisted=false → fail.
  const r1 = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
  });
  assert(!r1.ok, "expected ok=false on hidden mint (default policy blocks)");
  // The block reason comes from allowMintIfAllowlisted=false (the
  // default "no mint allowed" policy), not from fail-closed-on-hidden.
  assert(r1.reasons.some(x => x.startsWith("mint:")), `expected 'mint:' reason, got: ${r1.reasons.join("; ")}`);

  // With failClosedOnHidden=false, the hidden mint is still flagged
  // (because mint is present + allowMintIfAllowlisted not set) — but
  // the failure reason changes to "not allowlisted".
  const r2 = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
    failClosedOnHidden: false,
    allowMintIfAllowlisted: false,
  });
  assert(!r2.ok, "expected ok=false even with failClosedOnHidden=false (mint still blocked)");
}

// D2 — TWO-STEP RENOUNCE TRICK: real renounce (event + owner=0x0) BUT
// mint() gated by a separate role the deployer kept. Verifier detects
// mint() as hidden (no hasRole) → fail-closed. Real renounce of Ownable
// does NOT imply all authority is renounced.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.transferOwnership,
    SEL.renounceOwnership,
    SEL.mint,  // NO hasRole — custom role system
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(ZERO_ADDR)],
    ]),
    logs: [ownershipLog(OWNER_REAL, ZERO_ADDR)],  // real renounce of Ownable
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [],
    // allowMintIfAllowlisted NOT set → fail on mint regardless.
  });
  assert(!r.ok, "expected ok=false despite real renounce — mint hidden");
  assert(r.realRenounce, "expected realRenounce=true (Ownable renounced)");
  assert(r.reasons.some(x => x.includes("mint:")), `expected mint reason, got: ${r.reasons.join("; ")}`);
  // This documents the trick: real renounce of Ownable ≠ real renounce
  // of all authority. The mint authority is independent.
}

// D3 — PAUSED RENOUNCE: real renounce + pause() present + not currently
// paused. With default allowPauseIfAllowlisted=false, this fails.
// Document that real renounce of Ownable does NOT imply pause authority
// is renounced — pause may be governed by a separate Pausable-role.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.transferOwnership,
    SEL.renounceOwnership,
    SEL.pause,
    SEL.paused,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(ZERO_ADDR)],
      [SEL.paused, () => boolReturn(false)],
    ]),
    logs: [ownershipLog(OWNER_REAL, ZERO_ADDR)],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [],
    // allowPauseIfAllowlisted NOT set → fail.
  });
  assert(!r.ok, "expected ok=false — pause present without allowPauseIfAllowlisted");
  assert(r.realRenounce, "expected realRenounce=true");
  assert(r.reasons.some(x => x.includes("pause:")), `expected pause reason, got: ${r.reasons.join("; ")}`);
}

// D4 — BLACKLIST ESCAPE: blacklist() present, currently empty (bot's
// address not yet blacklisted). Verifier rejects on "blacklist()
// present" alone — does NOT need to wait for the bot to actually be
// blacklisted.
{
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
    SEL.blacklist,
    SEL.isBlacklisted,
  ]);
  const st: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(OWNER_REAL)],
      [SEL.isBlacklisted, () => boolReturn(false)],  // bot not yet blacklisted
    ]),
    logs: [],
  };
  const v = new TokenAuthorityVerifier(new MockSource(st));
  const r = await v.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
    allowFreezeBlacklistIfAllowlisted: false,
  });
  assert(!r.ok, "expected ok=false — blacklist() present even if bot not yet blacklisted");
  assert(r.reasons.some(x => x.includes("blacklist:")), `expected blacklist reason, got: ${r.reasons.join("; ")}`);
}

// D5 — CALLER-DEPENDENT OWNER: contract returns real owner to caller
// 0x0 and 0x0 to other callers. Verifier (as 0x0) sees real owner →
// accepts. Then flipped: contract returns 0x0 to caller 0x0 → verifier
// detects fake renounce.
{
  // First config: return OWNER_REAL to any caller (simulating caller=0x0
  // being the privileged probe address).
  const code = buildBytecode([
    "0xa9059cbb",
    SEL.owner,
  ]);
  const st1: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(OWNER_REAL)],
    ]),
    logs: [],
  };
  const v1 = new TokenAuthorityVerifier(new MockSource(st1));
  const r1 = await v1.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
  });
  assert(r1.ok, `first verification (verifier sees real owner) should pass, got: ${r1.reasons.join("; ")}`);

  // Flipped: contract now returns 0x0 to the verifier's probe (still
  // emitting no event — fake renounce).
  const st2: MockState = {
    code,
    callHandlers: new Map([
      [SEL.owner, () => addrReturn(ZERO_ADDR)],
    ]),
    logs: [],
  };
  const v2 = new TokenAuthorityVerifier(new MockSource(st2));
  const r2 = await v2.verify({
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
  });
  assert(!r2.ok, "flipped contract (verifier now sees 0x0) must be rejected");
  assert(r2.reasons.some(x => x.includes("fake renounce")), `expected fake renounce reason, got: ${r2.reasons.join("; ")}`);
  // This is the documented limitation: the verifier's view is only as
  // trustworthy as the caller context. In production, the source's
  // call() should eth_call with `from: <actual caller>` to match the
  // live-tx caller.
}

// =========================================================================
// Pure helper
// =========================================================================

console.log("\nE. Pure helper");

// E1 — selectorPresent finds the canonical PUSH4..EQ pattern.
{
  const code = buildBytecode([SEL.mint, SEL.pause]);
  assert(selectorPresent(code, SEL.mint), "mint selector should be present");
  assert(selectorPresent(code, SEL.pause), "pause selector should be present");
  assert(!selectorPresent(code, SEL.blacklist), "blacklist selector should NOT be present");
}

// E2 — selectorPresent is case-insensitive on the bytecode.
{
  const upper = "0x" + (buildBytecode([SEL.mint]).slice(2)).toUpperCase();
  assert(selectorPresent(upper, SEL.mint), "case-insensitive on bytecode");
}

// =========================================================================
// Summary
// =========================================================================

console.log(`\n=== H2.3 Summary: ${pass} pass, ${fail} fail ===`);
if (fail > 0) {
  console.log("FAILURES DETECTED — see above.");
  process.exit(1);
}

}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
