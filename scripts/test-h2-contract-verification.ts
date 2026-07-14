/**
 * H2.1 — Contract Verification test suite.
 *
 * Tests ContractVerifier directly against an injectable mock chain
 * reader. No real network calls are made.
 *
 * 18 scenarios across 4 categories:
 *
 *   A. Bytecode (4 tests)
 *     1. Hash matches expected — ok=true.
 *     2. Hash mismatch — ok=false, reason includes "bytecode hash mismatch".
 *     3. No expected hash + no opt-out — ok=false, "refuse unknown bytecode".
 *     4. allowBytecodeDrift=true — ok=true even with mismatch (with warning).
 *
 *   B. Selectors (3 tests)
 *     5. All selectors in allowlist — ok=true.
 *     6. Extra selector not in allowlist — ok=false, reason names it.
 *     7. allowUnknownSelectors=true — ok=true.
 *
 *   C. Owner (3 tests)
 *     8. owner() returns allowlisted address — ok=true.
 *     9. owner() returns non-allowlisted address — ok=false, reason names it.
 *    10. owner() returns address(0) on a contract that exposes owner()
 *        selector — ok=false, "fake renounce".
 *
 *   D. Proxy + upgradeability + adversarial (8 tests)
 *    11. EIP-1967 transparent proxy detected, !allowProxy — ok=false.
 *    12. EIP-1967 minimal proxy with allowProxy + impl manifest — ok=true
 *        after recursive verification of the implementation.
 *    13. Upgradeable contract (upgradeTo selector present) — ok=false
 *        unless allowUpgradeable.
 *    14. ADVERSARIAL: proxy impl swapped between two verifications
 *        (first call: impl A; second call: impl B with different
 *        bytecode) — second verification fails with bytecode mismatch
 *        on the IMPLEMENTATION manifest.
 *    15. ADVERSARIAL: extra sweep() selector introduced after upgrade —
 *        verification fails on unknown selector even though bytecode
 *        hash also changed (double-check the selector gate is
 *        independent of the bytecode gate).
 *    16. ADVERSARIAL: fake renounce — owner() returns 0x0 but contract
 *        has setFee() / mint() / pause() selectors and could re-assert
 *        ownership via custom logic — verification fails on the
 *        fake-renounce check.
 *    17. ADVERSARIAL: caller-dependent owner — call returns different
 *        values depending on caller. The verifier always calls as
 *        address(0), so we simulate "if caller is 0x0, return real
 *        owner; otherwise return address(0)" — verifier sees real
 *        owner and accepts it, but a separate test demonstrates the
 *        detection would fail if the contract reported 0x0 to the
 *        verifier's caller.
 *    18. ADVERSARIAL: beacon proxy with upgradeBeaconToAndCall selector
 *        — rejected as upgradeable even when allowProxy=true (because
 *        allowUpgradeable is still false by default).
 *
 * Run: npx tsx scripts/test-h2-contract-verification.ts
 */

import {
  ContractVerifier,
  ChainReader,
  ContractManifest,
  Address,
  Bytes32,
  Selector,
  extractSelectors,
  keccak256Hex,
  decodeAddress,
  detectProxyFromStorage,
  EIP1967_IMPL_SLOT,
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1822_PROXIABLE_SLOT,
  UPGRADE_SELECTORS,
} from "../src/lib/chain/contract-verification";
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
// Helpers — build bytecode with specific selectors, build storage maps,
// build a scripted chain reader.
// -------------------------------------------------------------------------

/**
 * Build a fake deployed bytecode that exposes the given 4-byte selectors
 * via the standard `PUSH4 selector EQ JUMPI` pattern. The bytecode is
 * not actually executable — it's just enough to fool extractSelectors.
 *
 * Format per selector: `63<8hex>14` (PUSH4, EQ). Plus a STOP (00) at
 * the end so the bytecode looks well-formed.
 */
function buildBytecode(selectors: Selector[]): string {
  let code = "0x";
  for (const sel of selectors) {
    const s = sel.startsWith("0x") ? sel.slice(2) : sel;
    code += "63" + s.toLowerCase() + "14";  // PUSH4 <sel> EQ
  }
  code += "00";  // STOP
  return code;
}

/** Pad a 20-byte address to a 32-byte storage slot value. */
function padAddress(addr: Address): Bytes32 {
  return zeroPadValue(addr, 32).toLowerCase();
}

const ZERO32 = "0x" + "0".repeat(64);

interface ScriptedChainConfig {
  code: Record<Address, string>;  // address -> bytecode
  storage: Record<Address, Record<Bytes32, string>>;  // address -> slot -> value
  calls: Record<Address, (calldata: string) => string>;  // address -> handler
}

function makeScriptedChain(cfg: ScriptedChainConfig): ChainReader {
  return {
    async getCode(addr: Address) {
      return cfg.code[addr] ?? "0x";
    },
    async getStorageAt(addr: Address, slot: Bytes32) {
      return cfg.storage[addr]?.[slot.toLowerCase()] ?? ZERO32;
    },
    async call(to: Address, calldata: string) {
      const fn = cfg.calls[to];
      if (!fn) return "0x";
      return fn(calldata);
    },
  };
}

// -------------------------------------------------------------------------
// Common test fixtures
// -------------------------------------------------------------------------

const OWNER_REAL = getAddress("0x0000000000000000000000000000000000000abc");
const OWNER_OTHER = getAddress("0x0000000000000000000000000000000000000def");
const PROXY_ADDR = getAddress("0x0000000000000000000000000000000000000f00");
const IMPL_A_ADDR = getAddress("0x0000000000000000000000000000000000000a01");
const IMPL_B_ADDR = getAddress("0x0000000000000000000000000000000000000a02");

// Standard ERC-20-ish selectors — these are what most legitimate token
// contracts expose. We use a small subset for tests.
const SEL_TRANSFER = "0xa9059cbb";  // transfer(address,uint256)
const SEL_APPROVE = "0x095ea7b3";   // approve(address,uint256)
const SEL_BALANCEOF = "0x70a08231"; // balanceOf(address)
const SEL_ALLOWANCE = "0xdd62ed3e"; // allowance(address,address)
const SEL_TOTALSUPPLY = "0x18160ddd"; // totalSupply()
const SEL_NAME = "0x06fdde03";      // name()
const SEL_SYMBOL = "0x95d89b41";    // symbol()
const SEL_DECIMALS = "0x313ce567";  // decimals()
const SEL_OWNER = "0x8da5cb5b";     // owner()
const SEL_SWEEP = "0x022c0d9f";     // sweep — used as the adversarial extra
const SEL_UPGRADE_TO = "0x3659cfe6"; // upgradeTo(address)
const SEL_UPGRADE_BEACON = "0xa9145dea"; // upgradeBeaconToAndCall

const STANDARD_TOKEN_SELECTORS: Selector[] = [
  SEL_TRANSFER, SEL_APPROVE, SEL_BALANCEOF, SEL_ALLOWANCE,
  SEL_TOTALSUPPLY, SEL_NAME, SEL_SYMBOL, SEL_DECIMALS, SEL_OWNER,
].sort();

function ownerReturnData(addr: Address): string {
  return padAddress(addr);
}

async function main(): Promise<void> {
console.log("\n=== H2.1 — Contract Verification ===\n");

// =========================================================================
// A. Bytecode
// =========================================================================

console.log("A. Bytecode");

// A1 — hash matches.
{
  const code = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const expectedHash = keccak256Hex(code);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const manifest: ContractManifest = {
    address: PROXY_ADDR,
    expectedBytecodeHash: expectedHash,
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  };
  const r = await v.verify(manifest);
  assert(r.ok, `expected ok=true, got reasons: ${r.reasons.join("; ")}`);
}

// A2 — hash mismatch.
{
  const code = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const manifest: ContractManifest = {
    address: PROXY_ADDR,
    expectedBytecodeHash: "0x" + "1".repeat(64),
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  };
  const r = await v.verify(manifest);
  assert(!r.ok, "expected ok=false on hash mismatch");
  assert(
    r.reasons.some(x => x.includes("bytecode hash mismatch")),
    `expected 'bytecode hash mismatch' reason, got: ${r.reasons.join("; ")}`,
  );
}

// A3 — no expected hash, no opt-out.
{
  const code = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const manifest: ContractManifest = {
    address: PROXY_ADDR,
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
    // No expectedBytecodeHash, no allowBytecodeDrift.
  };
  const r = await v.verify(manifest);
  assert(!r.ok, "expected ok=false when no expectedBytecodeHash and no opt-out");
  assert(
    r.reasons.some(x => x.includes("refuse unknown bytecode")),
    `expected 'refuse unknown bytecode' reason, got: ${r.reasons.join("; ")}`,
  );
}

// A4 — allowBytecodeDrift.
{
  const code = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const manifest: ContractManifest = {
    address: PROXY_ADDR,
    expectedBytecodeHash: "0x" + "1".repeat(64),  // mismatched
    allowBytecodeDrift: true,
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  };
  const r = await v.verify(manifest);
  assert(r.ok, `expected ok=true with allowBytecodeDrift, got: ${r.reasons.join("; ")}`);
}

// =========================================================================
// B. Selectors
// =========================================================================

console.log("\nB. Selectors");

// B1 — all selectors in allowlist.
{
  const code = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code),
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  });
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
  assert(r.findings.unknownSelectors.length === 0, "expected no unknown selectors");
}

// B2 — extra selector not in allowlist.
{
  const selectorsWithSweep = [...STANDARD_TOKEN_SELECTORS, SEL_SWEEP].sort();
  const code = buildBytecode(selectorsWithSweep);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code),
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  });
  assert(!r.ok, "expected ok=false on unknown selector");
  assert(
    r.reasons.some(x => x.includes("unknown selectors") && x.includes(SEL_SWEEP)),
    `expected 'unknown selectors' reason naming ${SEL_SWEEP}, got: ${r.reasons.join("; ")}`,
  );
}

// B3 — allowUnknownSelectors.
{
  const selectorsWithSweep = [...STANDARD_TOKEN_SELECTORS, SEL_SWEEP].sort();
  const code = buildBytecode(selectorsWithSweep);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code),
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowUnknownSelectors: true,
    allowedOwners: [OWNER_REAL],
  });
  assert(r.ok, `expected ok=true with allowUnknownSelectors, got: ${r.reasons.join("; ")}`);
}

// =========================================================================
// C. Owner
// =========================================================================

console.log("\nC. Owner");

// C1 — owner() returns allowlisted address.
{
  const code = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code),
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  });
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
  assert(r.findings.owner === OWNER_REAL, `expected owner=${OWNER_REAL}, got ${r.findings.owner}`);
}

// C2 — owner() returns non-allowlisted address.
{
  const code = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_OTHER) },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code),
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  });
  assert(!r.ok, "expected ok=false on non-allowlisted owner");
  assert(
    r.reasons.some(x => x.includes("not in allowedOwners")),
    `expected 'not in allowedOwners' reason, got: ${r.reasons.join("; ")}`,
  );
}

// C3 — fake renounce: owner() returns address(0) but contract has owner() selector.
{
  const code = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ZERO32 },  // owner() returns 0x0
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code),
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  });
  assert(!r.ok, "expected ok=false on fake renounce");
  assert(
    r.reasons.some(x => x.toLowerCase().includes("fake renounce") || x.includes("returned 0")),
    `expected fake-renounce reason, got: ${r.reasons.join("; ")}`,
  );
}

// =========================================================================
// D. Proxy + upgradeability + adversarial
// =========================================================================

console.log("\nD. Proxy + upgradeability + adversarial");

// D1 — EIP-1967 transparent proxy, !allowProxy.
{
  const proxyCode = buildBytecode([SEL_OWNER, "0x5c60da1b"]);  // owner, implementation
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: proxyCode },
    storage: {
      [PROXY_ADDR]: {
        [EIP1967_IMPL_SLOT]: padAddress(IMPL_A_ADDR),
        [EIP1967_ADMIN_SLOT]: padAddress(OWNER_REAL),
      },
    },
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(proxyCode),
    expectedSelectors: [SEL_OWNER, "0x5c60da1b"],
    allowedOwners: [OWNER_REAL],
    // allowProxy omitted → default false.
  });
  assert(!r.ok, "expected ok=false when proxy detected and allowProxy=false");
  assert(
    r.reasons.some(x => x.includes("proxy contract detected")),
    `expected 'proxy contract detected' reason, got: ${r.reasons.join("; ")}`,
  );
  assert(r.findings.isProxy, "expected isProxy=true");
  assert(r.findings.proxyKind === "transparent", `expected proxyKind=transparent, got ${r.findings.proxyKind}`);
  assert(r.findings.implementation === IMPL_A_ADDR, `expected implementation=${IMPL_A_ADDR}, got ${r.findings.implementation}`);
}

// D2 — EIP-1967 minimal proxy with allowProxy + impl manifest.
{
  const proxyCode = buildBytecode([]);  // minimal proxy has no own selectors
  const implCode = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const chain = makeScriptedChain({
    code: {
      [PROXY_ADDR]: proxyCode,
      [IMPL_A_ADDR]: implCode,
    },
    storage: {
      [PROXY_ADDR]: {
        [EIP1967_IMPL_SLOT]: padAddress(IMPL_A_ADDR),
      },
    },
    calls: {
      [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL),
      [IMPL_A_ADDR]: () => ownerReturnData(OWNER_REAL),
    },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(proxyCode),
    allowProxy: true,
    allowUpgradeable: true,  // minimal proxy is technically upgradeable
    implementationManifest: {
      address: IMPL_A_ADDR,
      expectedBytecodeHash: keccak256Hex(implCode),
      expectedSelectors: STANDARD_TOKEN_SELECTORS,
      allowedOwners: [OWNER_REAL],
    },
    // No expectedSelectors for the proxy itself — minimal proxies have none.
    allowUnknownSelectors: true,
    allowUnknownOwner: true,
  });
  assert(r.ok, `expected ok=true on recursive verification, got: ${r.reasons.join("; ")}`);
  assert(r.findings.proxyKind === "eip1967-implementation", `expected eip1967-implementation, got ${r.findings.proxyKind}`);
  assert(r.implementationResult?.ok, "expected implementation verification ok=true");
}

// D3 — upgradeable contract (upgradeTo selector present), !allowUpgradeable.
{
  const upgradeableSelectors = [...STANDARD_TOKEN_SELECTORS, SEL_UPGRADE_TO].sort();
  const code = buildBytecode(upgradeableSelectors);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code),
    expectedSelectors: upgradeableSelectors,
    allowedOwners: [OWNER_REAL],
    // allowUpgradeable omitted.
  });
  assert(!r.ok, "expected ok=false on upgradeable contract");
  assert(
    r.reasons.some(x => x.includes("upgradeable contract detected")),
    `expected 'upgradeable contract detected' reason, got: ${r.reasons.join("; ")}`,
  );
  assert(r.findings.isUpgradeable, "expected isUpgradeable=true");
}

// D4 — ADVERSARIAL: proxy impl swapped between two verifications.
// First verification passes; second verification (against same manifests)
// fails because the impl slot now points to a different contract whose
// bytecode hash doesn't match the implementationManifest.
{
  const proxyCode = buildBytecode([]);
  const implA_code = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const implB_code = buildBytecode([...STANDARD_TOKEN_SELECTORS, SEL_SWEEP].sort());
  const implA_hash = keccak256Hex(implA_code);

  // First verification: impl = A, hash matches implA_hash.
  const chain1 = makeScriptedChain({
    code: { [PROXY_ADDR]: proxyCode, [IMPL_A_ADDR]: implA_code },
    storage: {
      [PROXY_ADDR]: { [EIP1967_IMPL_SLOT]: padAddress(IMPL_A_ADDR) },
    },
    calls: {
      [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL),
      [IMPL_A_ADDR]: () => ownerReturnData(OWNER_REAL),
    },
  });
  // Second verification: impl = B (different address, different code),
  // but the manifest still expects implA_hash. The verifier should
  // recurse into IMPL_B_ADDR (because the slot points there) and fail
  // the bytecode check.
  const chain2 = makeScriptedChain({
    code: { [PROXY_ADDR]: proxyCode, [IMPL_B_ADDR]: implB_code },
    storage: {
      [PROXY_ADDR]: { [EIP1967_IMPL_SLOT]: padAddress(IMPL_B_ADDR) },
    },
    calls: {
      [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL),
      [IMPL_B_ADDR]: () => ownerReturnData(OWNER_REAL),
    },
  });

  const manifest: ContractManifest = {
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(proxyCode),
    allowProxy: true,
    allowUpgradeable: true,
    allowUnknownSelectors: true,
    allowUnknownOwner: true,
    implementationManifest: {
      address: IMPL_A_ADDR,  // The MANIFEST pins impl address as A.
      expectedBytecodeHash: implA_hash,
      expectedSelectors: STANDARD_TOKEN_SELECTORS,
      allowedOwners: [OWNER_REAL],
    },
  };

  const v1 = new ContractVerifier({ chain: chain1 });
  const r1 = await v1.verify(manifest);
  assert(r1.ok, `first verification should pass, got: ${r1.reasons.join("; ")}`);

  const v2 = new ContractVerifier({ chain: chain2 });
  const r2 = await v2.verify(manifest);
  assert(!r2.ok, "second verification must fail (impl swapped)");
  // The failure could be either: (a) impl address in slot doesn't match
  // the manifest's expected impl address (because manifest pins IMPL_A_ADDR),
  // OR (b) the recursive verification of IMPL_A_ADDR returns code=0x
  // (because chain2 has no code at IMPL_A_ADDR) → hash mismatch.
  assert(
    r2.reasons.some(x => x.toLowerCase().includes("implementation")),
    `expected implementation-related failure reason, got: ${r2.reasons.join("; ")}`,
  );
}

// D5 — ADVERSARIAL: extra sweep() selector introduced after upgrade.
// This is the "selector gate is independent of bytecode gate" test.
// Build a contract that exposes STANDARD_TOKEN_SELECTORS. Verification
// passes. Now build a different contract that adds sweep(). The
// bytecode hash mismatch is ONE reason; the unknown-selector sweep is
// ANOTHER reason. Both should be reported.
{
  const code1 = buildBytecode(STANDARD_TOKEN_SELECTORS);
  const code2 = buildBytecode([...STANDARD_TOKEN_SELECTORS, SEL_SWEEP].sort());

  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code2 },  // actual on-chain is the "upgraded" code
    storage: {},
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code1),  // manifest still pins old code
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  });
  assert(!r.ok, "expected ok=false after silent upgrade");
  assert(
    r.reasons.some(x => x.includes("bytecode hash mismatch")),
    `expected bytecode mismatch reason, got: ${r.reasons.join("; ")}`,
  );
  assert(
    r.reasons.some(x => x.includes("unknown selectors") && x.includes(SEL_SWEEP)),
    `expected unknown-selector reason naming sweep, got: ${r.reasons.join("; ")}`,
  );
}

// D6 — ADVERSARIAL: fake renounce with privileged selectors present.
// owner() returns 0x0, but contract has setFee() / mint() / pause()
// selectors — these are exactly the "post-renounce privilege"
// selectors that a fake-renounce contract exposes. The verifier must
// catch this via the owner()-returns-zero check.
{
  const SEL_MINT = "0x40c10f19";     // mint(address,uint256)
  const SEL_PAUSE = "0x8456cb59";    // pause()
  const SEL_SETFEE = "0xca15c8d4";   // arbitrary selector used as setFee
  const selectors = [...STANDARD_TOKEN_SELECTORS, SEL_MINT, SEL_PAUSE, SEL_SETFEE].sort();
  const code = buildBytecode(selectors);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: { [PROXY_ADDR]: () => ZERO32 },  // owner() returns 0x0
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code),
    expectedSelectors: selectors,
    allowedOwners: [OWNER_REAL],  // expects real owner, not 0x0
  });
  assert(!r.ok, "expected ok=false on fake renounce");
  // The reasons should specifically call out owner()=0x0.
  assert(
    r.reasons.some(x => x.toLowerCase().includes("fake renounce") || x.includes("returned 0")),
    `expected fake-renounce reason, got: ${r.reasons.join("; ")}`,
  );
}

// D7 — ADVERSARIAL: caller-dependent owner.
// The contract reports real owner to caller=0x0 but address(0) to any
// other caller. The verifier (which calls as 0x0) sees the real owner
// and accepts. This test documents that the verifier's "view" is
// caller-blind — if a future caller (the operator's wallet) hits a
// different view, the verifier's acceptance is meaningless. The test
// makes this contract structure explicit; the fix (caller-aware
// verification) is left to the caller passing their actual caller
// address in the chain reader (via eth_call override).
{
  const code = buildBytecode(STANDARD_TOKEN_SELECTORS);
  // Calldata-conditional owner: when the calldata matches owner()
  // (0x8da5cb5b) AND (simulated caller is 0x0) — return OWNER_REAL;
  // else return 0x0. The chain reader's call() doesn't pass a caller,
  // so the verifier always appears as 0x0.
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: {
      [PROXY_ADDR]: (calldata: string) => {
        if (calldata.toLowerCase().startsWith("0x8da5cb5b")) {
          return ownerReturnData(OWNER_REAL);
        }
        return ZERO32;
      },
    },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code),
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  });
  assert(r.ok, `verifier-as-0x0 sees real owner and accepts, got: ${r.reasons.join("; ")}`);
  // DOCUMENTATION: this is the limitation — the verifier's view is
  // only as trustworthy as the caller context. In production, the
  // chain reader's call() should eth_call with `from: <actual caller>`
  // to match the live-tx caller.
  assert(r.findings.owner === OWNER_REAL, "expected owner=OWNER_REAL when probed as 0x0");
  // Now flip the contract's behavior: owner() returns 0x0 to caller 0x0.
  // This is what an attacker would deploy if they know the verifier
  // probes as 0x0. The verifier's fake-renounce check should fire.
  const chainFlipped = makeScriptedChain({
    code: { [PROXY_ADDR]: code },
    storage: {},
    calls: {
      [PROXY_ADDR]: () => ZERO32,
    },
  });
  const vFlipped = new ContractVerifier({ chain: chainFlipped });
  const rFlipped = await vFlipped.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(code),
    expectedSelectors: STANDARD_TOKEN_SELECTORS,
    allowedOwners: [OWNER_REAL],
  });
  assert(!rFlipped.ok, "flipped contract (owner returns 0 to verifier) must be rejected");
  assert(
    rFlipped.reasons.some(x => x.toLowerCase().includes("fake renounce") || x.includes("returned 0")),
    `expected fake-renounce reason, got: ${rFlipped.reasons.join("; ")}`,
  );
}

// D8 — ADVERSARIAL: beacon proxy with upgradeBeaconToAndCall selector.
// Even with allowProxy=true, the upgradeable selector must trigger
// rejection unless allowUpgradeable=true.
{
  const beaconProxySelectors = [SEL_OWNER, "0x5c60da1b", SEL_UPGRADE_BEACON].sort();
  const proxyCode = buildBytecode(beaconProxySelectors);
  const chain = makeScriptedChain({
    code: { [PROXY_ADDR]: proxyCode },
    storage: {
      [PROXY_ADDR]: {
        [EIP1967_BEACON_SLOT]: padAddress(IMPL_A_ADDR),
      },
    },
    calls: { [PROXY_ADDR]: () => ownerReturnData(OWNER_REAL) },
  });
  const v = new ContractVerifier({ chain });
  const r = await v.verify({
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(proxyCode),
    expectedSelectors: beaconProxySelectors,
    allowedOwners: [OWNER_REAL],
    allowProxy: true,
    // allowUpgradeable omitted — must be rejected.
  });
  assert(!r.ok, "expected ok=false on beacon proxy with upgrade selector");
  assert(
    r.reasons.some(x => x.includes("upgradeable contract detected")),
    `expected 'upgradeable contract detected' reason, got: ${r.reasons.join("; ")}`,
  );
  assert(r.findings.proxyKind === "eip1967-beacon", `expected beacon kind, got ${r.findings.proxyKind}`);
}

// =========================================================================
// Pure-helper unit tests
// =========================================================================

console.log("\nE. Pure helpers");

// E1 — extractSelectors dedupes + sorts.
{
  const code = buildBytecode([SEL_TRANSFER, SEL_TRANSFER, SEL_APPROVE, SEL_APPROVE]);
  const sels = extractSelectors(code);
  assert(sels.length === 2, `expected 2 unique selectors, got ${sels.length}`);
  assert(sels[0] === SEL_APPROVE, `expected sorted first=approve, got ${sels[0]}`);
  assert(sels[1] === SEL_TRANSFER, `expected sorted second=transfer, got ${sels[1]}`);
}

// E2 — decodeAddress handles zero, malformed, real.
{
  assert(decodeAddress(ZERO32) === null, "expected null for zero address");
  assert(decodeAddress("0x1234") === null, "expected null for short input");
  assert(decodeAddress(padAddress(OWNER_REAL)) === OWNER_REAL, "expected real address");
}

// E3 — detectProxyFromStorage identifies each kind.
{
  const impl = detectProxyFromStorage({
    [EIP1967_IMPL_SLOT]: padAddress(IMPL_A_ADDR),
  });
  assert(impl.kind === "eip1967-implementation", `expected eip1967-implementation, got ${impl.kind}`);
  assert(impl.implementation === IMPL_A_ADDR, "expected implementation address");
}
{
  const transparent = detectProxyFromStorage({
    [EIP1967_IMPL_SLOT]: padAddress(IMPL_A_ADDR),
    [EIP1967_ADMIN_SLOT]: padAddress(OWNER_REAL),
  });
  assert(transparent.kind === "transparent", `expected transparent, got ${transparent.kind}`);
  assert(transparent.admin === OWNER_REAL, "expected admin");
}
{
  const beacon = detectProxyFromStorage({
    [EIP1967_BEACON_SLOT]: padAddress(IMPL_A_ADDR),
  });
  assert(beacon.kind === "eip1967-beacon", `expected beacon, got ${beacon.kind}`);
  assert(beacon.beacon === IMPL_A_ADDR, "expected beacon address");
}
{
  const uups = detectProxyFromStorage({
    [EIP1822_PROXIABLE_SLOT]: padAddress(IMPL_A_ADDR),
  });
  assert(uups.kind === "eip1822", `expected eip1822, got ${uups.kind}`);
}
{
  const none = detectProxyFromStorage({ [EIP1967_IMPL_SLOT]: ZERO32 });
  assert(none.kind === null, "expected null kind for non-proxy");
}

// E4 — UPGRADE_SELECTORS includes the canonical upgrade functions.
{
  assert(UPGRADE_SELECTORS.includes(SEL_UPGRADE_TO), "missing upgradeTo");
  assert(UPGRADE_SELECTORS.includes(SEL_UPGRADE_BEACON), "missing upgradeBeaconToAndCall");
}

// =========================================================================
// Summary
// =========================================================================

console.log(`\n=== H2.1 Summary: ${pass} pass, ${fail} fail ===`);
if (fail > 0) {
  console.log("FAILURES DETECTED — see above.");
  process.exit(1);
}
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
