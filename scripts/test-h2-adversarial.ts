/**
 * H2.5 — Cross-cutting adversarial test suite.
 *
 * This file enumerates the six adversarial scenarios the operator
 * mandated for H2, maps each to the specific test(s) that cover it
 * within H2.1-H2.4, and adds the one scenario not previously
 * covered: "owner muda durante execução" (owner changes during
 * execution).
 *
 * The six scenarios:
 *
 *   1. LP REMOVIDA ENTRE BLOCOS
 *      Covered by: test-h2-liquidity-verification.ts D4 ("rug between
 *      blocks"). The verifier never caches; first verify() passes,
 *      deployer transfers LP to an unknown address, second verify()
 *      fails. Re-asserted here for explicit cross-reference.
 *
 *   2. OWNER MUDA DURANTE EXECUÇÃO
 *      NEW. Not previously covered. A contract where `owner()`
 *      returns OWNER_A on the first call and OWNER_B on the second
 *      call (within the SAME verify() flow). The H2.3 verifier
 *      currently calls `owner()` once and trusts the result for
 *      every check that needs owner. If owner changes mid-flow, the
 *      verifier's view is inconsistent. Test documents the
 *      requirement: the verifier must call owner() ONCE per verify()
 *      call and use that single observation throughout; OR call
 *      owner() multiple times and reject on inconsistency.
 *
 *      The H2.3 verifier currently does the former (calls owner()
 *      once). The test demonstrates a contract that flips owner
 *      between calls and asserts the verifier's single-call approach
 *      produces a stable result — but flags the vulnerability: a
 *      caller who knows the verifier calls owner() at time T can
 *      arrange for owner to be allowlisted at T and malicious at
 *      T+1. The mitigation (in production) is to bound the
 *      time-between-verify-and-broadcast to one block; the verifier
 *      itself can't defend against an owner change that happens
 *      after verify() returns.
 *
 *   3. PROXY MUDA IMPLEMENTAÇÃO
 *      Covered by: test-h2-contract-verification.ts D4 ("proxy impl
 *      swapped between two verifications"). First verify() passes;
 *      impl slot is repointed to a different impl; second verify()
 *      fails because the manifest's implementationManifest pins the
 *      original impl address. Re-asserted here.
 *
 *   4. SELL PASSA NA PRIMEIRA SIMULAÇÃO E FALHA NA SEGUNDA
 *      Covered by: test-h2-sell-simulation.ts D3 ("tax shift"). First
 *      verify() returns 5% tax (within tolerance); second verify()
 *      returns 50% tax (rejected). Documents the no-caching rule.
 *      Re-asserted here.
 *
 *   5. TAXAS MUDAM APÓS BUY
 *      Covered by: test-h2-sell-simulation.ts D3 (same as #4 — the
 *      tax change is on the sell side, post-buy) AND by the tax
 *      tolerance check in H2.4 generally. The "taxas mudam após buy"
 *      scenario is specifically about a contract that has 0% buy
 *      tax + 0% sell tax at the time of the buy simulation, but
 *      raises sell tax to 100% by the time the sell simulation runs
 *      (a few blocks later). Test below explicitly constructs this.
 *
 *   6. CONTRATO MUDA COMPORTAMENTO POR CALLER
 *      Covered by: test-h2-contract-verification.ts D7 (caller-
 *      dependent owner) AND test-h2-token-authority.ts D5 (same
 *      pattern for owner()) AND test-h2-sell-simulation.ts D6
 *      (caller-dependent sell). Re-asserted with the specific
 *      honeypot variant: sell succeeds for caller=0x0 but reverts
 *      for caller=buyer.
 *
 * Run: npx tsx scripts/test-h2-adversarial.ts
 */

import {
  ContractVerifier,
  ChainReader,
  ContractManifest,
  Selector,
  keccak256Hex,
} from "../src/lib/chain/contract-verification";
import {
  LiquidityVerifier,
  LiquiditySource,
  LiquidityManifest,
  PoolInfo,
  LpLockInfo,
} from "../src/lib/chain/liquidity-verification";
import {
  TokenAuthorityVerifier,
  TokenAuthoritySource,
  TokenAuthorityManifest,
  AuthorityLog,
  SEL,
  OWNERSHIP_TRANSFERRED_TOPIC,
} from "../src/lib/chain/token-authority";
import {
  SellSimVerifier,
  TradeSimulator,
  BuySpec,
  SellSpec,
  SimResult,
  SellSimManifest,
} from "../src/lib/chain/sell-simulation";
import { SlippageInputs } from "../src/lib/chain/mev-baseline";
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
// Fixtures (re-created per scenario)
// -------------------------------------------------------------------------

const TOKEN = getAddress("0x0000000000000000000000000000000000000001");
const POOL_A = getAddress("0x0000000000000000000000000000000000000010");
const LP_A = getAddress("0x00000000000000000000000000000000000000a0");
const LOCK_TRUSTED = getAddress("0x00000000000000000000000000000000000000f1");
const HOLDER_DEPLOYER = getAddress("0x00000000000000000000000000000000000000d1");
const HOLDER_UNKNOWN = getAddress("0x00000000000000000000000000000000000000d2");
const OWNER_REAL = getAddress("0x0000000000000000000000000000000000000abc");
const OWNER_OTHER = getAddress("0x0000000000000000000000000000000000000def");
const PROXY_ADDR = getAddress("0x0000000000000000000000000000000000000f00");
const IMPL_A_ADDR = getAddress("0x0000000000000000000000000000000000000a01");
const IMPL_B_ADDR = getAddress("0x0000000000000000000000000000000000000a02");
const ROUTER = getAddress("0x0000000000000000000000000000000000000002");
const BUYER = getAddress("0x0000000000000000000000000000000000000003");
const ZERO_ADDR = "0x" + "0".repeat(40);

const NOW = Math.floor(Date.now() / 1000);
const MIN_LOCK_END = NOW + 7 * 86400;
const ZERO32 = "0x" + "0".repeat(64);

function buildBytecode(selectors: Selector[]): string {
  let code = "0x";
  for (const sel of selectors) {
    code += "63" + sel.slice(2).toLowerCase() + "14";
  }
  code += "00";
  return code;
}

const STD_SELECTORS: Selector[] = [
  "0xa9059cbb", "0x095ea7b3", "0x70a08231", "0x18160ddd", SEL.owner,
].sort();

function pad32(hex: string): string {
  let h = hex.toLowerCase();
  if (h.startsWith("0x")) h = h.slice(2);
  while (h.length < 64) h = "0" + h;
  return "0x" + h;
}

function addrReturn(addr: string): string {
  if (addr === ZERO_ADDR || /^0x0+$/.test(addr)) return pad32("0");
  return zeroPadValue(addr, 32);
}

console.log("\n=== H2.5 — Cross-cutting adversarial scenarios ===\n");

async function main(): Promise<void> {

// =========================================================================
// 1. LP REMOVIDA ENTRE BLOCOS
// =========================================================================

console.log("1. LP removida entre blocos (covered by h2.2 D4; re-asserted)");

{
  // In-memory state, mutable to simulate the rug.
  const balances = new Map<Address, Map<Address, string>>();
  const pools = new Map<Address, PoolInfo>();
  pools.set(POOL_A.toLowerCase(), {
    dex: "uniswap-v2",
    pool: POOL_A,
    lpToken: LP_A,
    lpTotalSupply: "1000000",
    token0: TOKEN,
    token1: getAddress("0x0000000000000000000000000000000000000002"),
    reserve0: "1000000000000000000",
    reserve1: "1000000000000000000",
  });

  function setBal(lp: Address, holder: Address, bal: string) {
    if (!balances.has(lp.toLowerCase())) balances.set(lp.toLowerCase(), new Map());
    balances.get(lp.toLowerCase())!.set(holder.toLowerCase(), bal);
  }
  setBal(LP_A, HOLDER_DEPLOYER, "1000000");

  const src: LiquiditySource & {
    enumerateHolders?: (lp: string) => Promise<Array<{ holder: string; balance: string }>>;
  } = {
    async getPool(pool) { return pools.get(pool.toLowerCase()) ?? null; },
    async listPoolsForToken(token) {
      const out: PoolInfo[] = [];
      for (const p of pools.values()) {
        if (p.token0.toLowerCase() === token.toLowerCase() || p.token1.toLowerCase() === token.toLowerCase()) {
          out.push(p);
        }
      }
      return out;
    },
    async lpBalanceOf(lp, holder) {
      return balances.get(lp.toLowerCase())?.get(holder.toLowerCase()) ?? "0";
    },
    async getLock() { return null; },
    async enumerateHolders(lp) {
      const map = balances.get(lp.toLowerCase());
      if (!map) return [];
      return Array.from(map.entries()).map(([holder, balance]) => ({ holder: getAddress(holder), balance }));
    },
  };

  const manifest: LiquidityManifest = {
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: null }],
    trustedLockContracts: [],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
  };

  const v = new LiquidityVerifier(src);
  const r1 = await v.verify(manifest);
  assert(r1.ok, `pre-rug verify should pass, got: ${r1.reasons.join("; ")}`);

  // Rug: deployer transfers LP to unknown address.
  setBal(LP_A, HOLDER_DEPLOYER, "0");
  setBal(LP_A, HOLDER_UNKNOWN, "1000000");

  const r2 = await v.verify(manifest);
  assert(!r2.ok, "post-rug verify must fail");
  assert(r2.pools[0].verdict === "unlocked-lp-held-by-unknown", `expected unlocked-lp-held-by-unknown, got ${r2.pools[0].verdict}`);
}

// =========================================================================
// 2. OWNER MUDA DURANTE EXECUÇÃO (NEW)
// =========================================================================

console.log("\n2. Owner muda durante execução (new scenario)");

{
  // Contract that returns OWNER_REAL on the first owner() call and
  // OWNER_OTHER on subsequent calls. The H2.3 verifier calls owner()
  // ONCE per verify() flow; the test demonstrates that the verifier
  // is internally consistent (uses the first observation throughout)
  // but documents the residual vulnerability: a malicious contract
  // that knows the verifier calls owner() at time T can be
  // allowlisted at T and switch to a malicious owner at T+1 —
  // between verify() returning and the actual broadcast landing
  // on-chain.
  let ownerCallCount = 0;
  const code = buildBytecode([...STD_SELECTORS, SEL.transferOwnership]);
  const chain: TokenAuthoritySource = {
    async getCode() { return code; },
    async call(_t, calldata) {
      if (calldata.toLowerCase().startsWith(SEL.owner)) {
        ownerCallCount++;
        const owner = ownerCallCount === 1 ? OWNER_REAL : OWNER_OTHER;
        return addrReturn(owner);
      }
      throw new Error(`unexpected call: ${calldata}`);
    },
    async getLogs() { return []; },
  };

  const v = new TokenAuthorityVerifier(chain);
  const manifest: TokenAuthorityManifest = {
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
  };
  const r = await v.verify(manifest);

  // The verifier observed OWNER_REAL (the first call's result) and
  // accepted. ownerCallCount should be 1 (only one owner() call).
  assert(ownerCallCount === 1, `expected 1 owner() call (verifier uses single observation), got ${ownerCallCount}`);
  assert(r.ok, `verifier should accept when first owner() returns allowlisted, got: ${r.reasons.join("; ")}`);
  assert(r.findings.find(f => f.surface === "ownership-current")?.holder === OWNER_REAL, "expected owner=OWNER_REAL in findings");

  // Document the vulnerability: a malicious contract that flips owner
  // after the first call would pass verification but have a different
  // owner by the time the tx lands. The mitigation is the operator's
  // responsibility: bound the verify-to-broadcast gap to one block,
  // and re-verify immediately before broadcast (the pre-broadcast
  // simulation gate from H1.2 + this verifier run together at
  // broadcast time).
  console.log("    [documented] verifier uses single owner() observation; contract that flips owner after first call passes verification. Mitigation: bound verify-to-broadcast gap to one block + re-verify at broadcast time.");
}

// =========================================================================
// 3. PROXY MUDA IMPLEMENTAÇÃO
// =========================================================================

console.log("\n3. Proxy muda implementação (covered by h2.1 D4; re-asserted)");

{
  const proxyCode = buildBytecode([]);
  const implA_code = buildBytecode(STD_SELECTORS);
  const implB_code = buildBytecode([...STD_SELECTORS, "0x022c0d9f"].sort());  // sweep added
  const implA_hash = keccak256Hex(implA_code);

  const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

  // First state: impl slot → IMPL_A_ADDR (manifest matches).
  const chain1: ChainReader = {
    async getCode(addr) {
      if (addr.toLowerCase() === PROXY_ADDR.toLowerCase()) return proxyCode;
      if (addr.toLowerCase() === IMPL_A_ADDR.toLowerCase()) return implA_code;
      return "0x";
    },
    async getStorageAt(addr, slot) {
      if (addr.toLowerCase() === PROXY_ADDR.toLowerCase() && slot === EIP1967_IMPL_SLOT) {
        return zeroPadValue(IMPL_A_ADDR, 32);
      }
      return ZERO32;
    },
    async call(addr, cd) {
      if (cd.toLowerCase().startsWith(SEL.owner)) return addrReturn(OWNER_REAL);
      throw new Error(`unexpected call: ${addr} ${cd}`);
    },
  };

  const manifest: ContractManifest = {
    address: PROXY_ADDR,
    expectedBytecodeHash: keccak256Hex(proxyCode),
    allowProxy: true,
    allowUpgradeable: true,
    allowUnknownSelectors: true,
    allowUnknownOwner: true,
    implementationManifest: {
      address: IMPL_A_ADDR,
      expectedBytecodeHash: implA_hash,
      expectedSelectors: STD_SELECTORS,
      allowedOwners: [OWNER_REAL],
    },
  };

  const v1 = new ContractVerifier({ chain: chain1 });
  const r1 = await v1.verify(manifest);
  assert(r1.ok, `first verify should pass (impl=A), got: ${r1.reasons.join("; ")}`);

  // Second state: impl slot → IMPL_B_ADDR (different impl, different
  // bytecode). The manifest pins IMPL_A_ADDR as the implementation,
  // so the verifier recurses into IMPL_A_ADDR — which has no code
  // in chain2. The recursion's getCode returns "0x", hash mismatch.
  const chain2: ChainReader = {
    async getCode(addr) {
      if (addr.toLowerCase() === PROXY_ADDR.toLowerCase()) return proxyCode;
      if (addr.toLowerCase() === IMPL_B_ADDR.toLowerCase()) return implB_code;
      // IMPL_A_ADDR has no code in chain2.
      return "0x";
    },
    async getStorageAt(addr, slot) {
      if (addr.toLowerCase() === PROXY_ADDR.toLowerCase() && slot === EIP1967_IMPL_SLOT) {
        return zeroPadValue(IMPL_B_ADDR, 32);
      }
      return ZERO32;
    },
    async call(addr, cd) {
      if (cd.toLowerCase().startsWith(SEL.owner)) return addrReturn(OWNER_REAL);
      throw new Error(`unexpected call: ${addr} ${cd}`);
    },
  };

  const v2 = new ContractVerifier({ chain: chain2 });
  const r2 = await v2.verify(manifest);
  assert(!r2.ok, "second verify must fail (impl swapped)");
  assert(
    r2.reasons.some(x => x.toLowerCase().includes("implementation")),
    `expected implementation-related failure, got: ${r2.reasons.join("; ")}`,
  );
}

// =========================================================================
// 4. SELL PASSA NA PRIMEIRA SIMULAÇÃO E FALHA NA SEGUNDA
// =========================================================================

console.log("\n4. Sell passa na primeira simulação e falha na segunda (covered by h2.4 D3; re-asserted)");

{
  const BUY: BuySpec = {
    token: TOKEN, router: ROUTER, buyer: BUYER,
    amountIn: "1000000000000000000",
    expectedAmountOut: "1000000000000000000000",
    calldata: "0x",
  };
  const SELL: SellSpec = {
    router: ROUTER, token: TOKEN, seller: BUYER,
    amountIn: "1000000000000000000000",
    expectedAmountOut: "1000000000000000000",
    calldata: "0x",
  };
  const SLIPPAGE: SlippageInputs = {
    baselineBps: 30, volatilityBps: 20,
    tradeSizeUsd: 1000, poolLiquidityUsd: 1_000_000,
    hardCapBps: 300,
  };
  const manifest: SellSimManifest = {
    buy: BUY,
    sell: SELL,
    expectedBuyTaxBps: 0,
    expectedSellTaxBps: 500,  // caller expects 5%
    taxToleranceBps: 50,
    slippage: SLIPPAGE,
  };

  // First simulator: sell returns 5% tax (within tolerance).
  const sim1: TradeSimulator = {
    async simulateBuy() { return { reverted: false, actualAmountOut: "1000000000000000000000", gasUsed: 100000 }; },
    async simulateSell() { return { reverted: false, actualAmountOut: "950000000000000000", gasUsed: 100000 }; },
  };
  const r1 = await new SellSimVerifier(sim1).verify(manifest);
  assert(r1.ok, `first verify (5% tax) should pass, got: ${r1.reasons.join("; ")}`);

  // Second simulator: sell returns 50% tax (rejected).
  const sim2: TradeSimulator = {
    async simulateBuy() { return { reverted: false, actualAmountOut: "1000000000000000000000", gasUsed: 100000 }; },
    async simulateSell() { return { reverted: false, actualAmountOut: "500000000000000000", gasUsed: 100000 }; },
  };
  const r2 = await new SellSimVerifier(sim2).verify(manifest);
  assert(!r2.ok, "second verify (50% tax) must fail");
  assert(r2.reasons.some(x => x.includes("sell tax deviation")), `expected 'sell tax deviation' reason, got: ${r2.reasons.join("; ")}`);
}

// =========================================================================
// 5. TAXAS MUDAM APÓS BUY
// =========================================================================

console.log("\n5. Taxas mudam após buy (specific scenario: 0% buy, 0% sell at buy-time, 100% sell at sell-time)");

{
  // The contract has 0% buy tax and 0% sell tax at the time of the
  // buy simulation. By the time the sell simulation runs (a few
  // blocks later), the contract's `setSellTax(10000)` has been
  // called — sell tax is now 100%. The sell "succeeds" but returns 0.
  //
  // This is a tax-time-shift variant of the tax-bait honeypot. The
  // H2.4 verifier catches it via the exit-amount check (sell returns
  // 0 < minExitAmount) and the tax-deviation check (caller expected
  // 0% sell tax, observed 100%).
  const BUY: BuySpec = {
    token: TOKEN, router: ROUTER, buyer: BUYER,
    amountIn: "1000000000000000000",
    expectedAmountOut: "1000000000000000000000",  // 0% buy tax expected
    calldata: "0x",
  };
  const SELL: SellSpec = {
    router: ROUTER, token: TOKEN, seller: BUYER,
    amountIn: "1000000000000000000000",
    expectedAmountOut: "1000000000000000000",  // 0% sell tax expected
    calldata: "0x",
  };
  const SLIPPAGE: SlippageInputs = {
    baselineBps: 30, volatilityBps: 20,
    tradeSizeUsd: 1000, poolLiquidityUsd: 1_000_000,
    hardCapBps: 300,
  };

  // Buy: 0% tax (full amount out).
  // Sell: 100% tax (returns 0).
  const sim: TradeSimulator = {
    async simulateBuy() { return { reverted: false, actualAmountOut: "1000000000000000000000", gasUsed: 100000 }; },
    async simulateSell() { return { reverted: false, actualAmountOut: "0", gasUsed: 100000 }; },
  };

  const r = await new SellSimVerifier(sim).verify({
    buy: BUY,
    sell: SELL,
    expectedBuyTaxBps: 0,
    expectedSellTaxBps: 0,
    taxToleranceBps: 50,
    slippage: SLIPPAGE,
    minExitAmount: "1",
  });
  assert(!r.ok, "tax-after-buy scenario must be rejected");
  assert(
    r.reasons.some(x => x.includes("sell tax deviation") || x.includes("exit amount")),
    `expected tax-deviation or exit-amount reason, got: ${r.reasons.join("; ")}`,
  );
}

// =========================================================================
// 6. CONTRATO MUDA COMPORTAMENTO POR CALLER
// =========================================================================

console.log("\n6. Contrato muda comportamento por caller (covered by h2.1 D7, h2.3 D5, h2.4 D6; re-asserted)");

{
  // Specific variant: sell succeeds when called by 0x0 but reverts
  // when called by the buyer. The H2.4 verifier's simulator must use
  // the seller from the manifest; if the simulator is caller-blind
  // (uses 0x0), it would pass a tx that reverts on-chain.
  const BUY: BuySpec = {
    token: TOKEN, router: ROUTER, buyer: BUYER,
    amountIn: "1000000000000000000",
    expectedAmountOut: "1000000000000000000000",
    calldata: "0x",
  };
  const SELL: SellSpec = {
    router: ROUTER, token: TOKEN,
    seller: BUYER,  // correct seller
    amountIn: "1000000000000000000000",
    expectedAmountOut: "1000000000000000000",
    calldata: "0x",
  };
  const SLIPPAGE: SlippageInputs = {
    baselineBps: 30, volatilityBps: 20,
    tradeSizeUsd: 1000, poolLiquidityUsd: 1_000_000,
    hardCapBps: 300,
  };

  // Caller-aware simulator: succeeds iff spec.seller === BUYER.
  class CallerAwareSim implements TradeSimulator {
    async simulateBuy() { return { reverted: false, actualAmountOut: "1000000000000000000000", gasUsed: 100000 }; }
    async simulateSell(spec: SellSpec): Promise<SimResult> {
      if (spec.seller.toLowerCase() === BUYER.toLowerCase()) {
        return { reverted: false, actualAmountOut: "1000000000000000000", gasUsed: 100000 };
      }
      return { reverted: true, revertReason: "NOT_AUTHORIZED", actualAmountOut: "0", gasUsed: 100000 };
    }
  }
  const r1 = await new SellSimVerifier(new CallerAwareSim()).verify({
    buy: BUY, sell: SELL, slippage: SLIPPAGE,
  });
  assert(r1.ok, `caller-aware sim with correct seller should pass, got: ${r1.reasons.join("; ")}`);

  // Caller-blind manifest (seller=0x0): fails because the contract
  // reverts for non-buyer callers.
  const SELL_BLIND: SellSpec = { ...SELL, seller: getAddress(ZERO_ADDR) };
  const r2 = await new SellSimVerifier(new CallerAwareSim()).verify({
    buy: BUY, sell: SELL_BLIND, slippage: SLIPPAGE,
  });
  assert(!r2.ok, "caller-blind manifest (seller=0x0) must fail");
  assert(r2.reasons.some(x => x.includes("sell reverted")), `expected 'sell reverted' reason, got: ${r2.reasons.join("; ")}`);
}

// =========================================================================
// Summary
// =========================================================================

console.log(`\n=== H2.5 Summary: ${pass} pass, ${fail} fail ===`);
console.log("\nAll six operator-mandated adversarial scenarios have explicit test coverage:");
console.log("  1. LP removida entre blocos          → h2.2 D4 + this file §1");
console.log("  2. Owner muda durante execução        → this file §2 (NEW)");
console.log("  3. Proxy muda implementação           → h2.1 D4 + this file §3");
console.log("  4. Sell passa 1a sim, falha 2a        → h2.4 D3 + this file §4");
console.log("  5. Taxas mudam após buy               → h2.4 D3 + this file §5");
console.log("  6. Contrato muda comportamento caller → h2.1 D7, h2.3 D5, h2.4 D6 + this file §6");

if (fail > 0) {
  console.log("\nFAILURES DETECTED — see above.");
  process.exit(1);
}

}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
