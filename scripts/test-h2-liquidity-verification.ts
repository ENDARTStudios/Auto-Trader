/**
 * H2.2 — Liquidity Verification test suite.
 *
 * Tests LiquidityVerifier against an in-memory mock LiquiditySource.
 *
 * 16 scenarios across 4 categories:
 *
 *   A. Happy paths (3 tests)
 *     1. Single pool, lock valid, 100% locked → ok=true.
 *     2. Single pool, lock valid, exactly min locked fraction (95%) → ok=true.
 *     3. Single pool, no lock claimed, all LP held by allowlisted holder → ok=true.
 *
 *   B. Lock defects (5 tests)
 *     4. Lock expired in the past → lock-duration-too-short.
 *     5. Lock expires tomorrow (less than min horizon) → lock-duration-too-short.
 *     6. Lock covers 51% (below 95% min) → lock-percentage-low.
 *     7. Lock contract not in trustedLockContracts → lock-contract-untrusted.
 *     8. Lock contract's withdraw() is permissionless → lock-withdraw-unpermissioned.
 *
 *   C. Multi-pool + holder defects (4 tests)
 *     9. Two pools: A good, B bad → overall ok=false; B's verdict named.
 *    10. Pool listed twice in manifest → pool-duplicate.
 *    11. Extra pool on-chain not in manifest → extra-pool-present (default strict).
 *    12. Unlocked LP tokens held by unknown address → unlocked-lp-held-by-unknown.
 *
 *   D. Adversarial (4 tests)
 *    13. Lock claims unlockTime=type(uint256).max but withdraw() is
 *        permissionless — must be rejected on the withdraw check
 *        (the "permanent lock that isn't" pattern). Documents that
 *        the duration check alone is insufficient.
 *    14. Lock contract address that LOOKS like a trusted address (same
 *        length, off-by-one hex char) — must be rejected as
 *        lock-contract-untrusted. The allowlist is exact-match, not
 *        fuzzy.
 *    15. Lock covering exactly 95% of LP supply (boundary) → ok=true;
 *        lock covering 94.99% → ok=false. The boundary is inclusive
 *        on the good side.
 *    16. Two pools where pool A is locked correctly and pool B is
 *        unlocked with all LP held by allowlisted holder — both pass.
 *        Then pool B's LP holder transfers to an unknown address —
 *        the second verification (with the same manifest) fails.
 *        This is the "rug between blocks" adversarial pattern: the
 *        verification must re-fetch state every time, never cache.
 *
 * Run: npx tsx scripts/test-h2-liquidity-verification.ts
 */

import {
  LiquidityVerifier,
  LiquiditySource,
  LiquidityManifest,
  PoolInfo,
  LpLockInfo,
  Address,
  computeLockedFractionBps,
} from "../src/lib/chain/liquidity-verification";
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
// Mock liquidity source — in-memory state, optionally mutable to
// simulate "rug between blocks" scenarios.
// -------------------------------------------------------------------------

interface MockState {
  pools: Map<Address, PoolInfo>;
  /** lpToken -> holder -> balance. */
  balances: Map<Address, Map<Address, string>>;
  /** lpToken -> lockContract -> lock info. */
  locks: Map<Address, Map<Address, LpLockInfo>>;
  /** For listPoolsForToken: token -> pools containing it. */
  tokenPools: Map<Address, Address[]>;
}

class MockLiquiditySource implements LiquiditySource {
  constructor(private readonly st: MockState) {}

  async getPool(pool: Address): Promise<PoolInfo | null> {
    return this.st.pools.get(pool.toLowerCase()) ?? null;
  }

  async listPoolsForToken(token: Address): Promise<PoolInfo[]> {
    const poolAddrs = this.st.tokenPools.get(token.toLowerCase()) ?? [];
    const out: PoolInfo[] = [];
    for (const a of poolAddrs) {
      const p = this.st.pools.get(a);
      if (p) out.push(p);
    }
    return out;
  }

  async lpBalanceOf(lpToken: Address, holder: Address): Promise<string> {
    return this.st.balances.get(lpToken.toLowerCase())?.get(holder.toLowerCase()) ?? "0";
  }

  async getLock(lpToken: Address, lockContract: Address): Promise<LpLockInfo | null> {
    return this.st.locks.get(lpToken.toLowerCase())?.get(lockContract.toLowerCase()) ?? null;
  }

  /** Test-only helper: enumerate LP holders. Used by the verifier's
   * `collectUnknownHolders` when present. */
  async enumerateHolders(lpToken: Address): Promise<Array<{ holder: Address; balance: string }>> {
    const map = this.st.balances.get(lpToken.toLowerCase());
    if (!map) return [];
    return Array.from(map.entries()).map(([holder, balance]) => ({ holder: getAddress(holder), balance }));
  }
}

// -------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------

const TOKEN = getAddress("0x0000000000000000000000000000000000000001");
const POOL_A = getAddress("0x0000000000000000000000000000000000000010");
const POOL_B = getAddress("0x0000000000000000000000000000000000000011");
const POOL_C = getAddress("0x0000000000000000000000000000000000000012");
const LP_A = getAddress("0x00000000000000000000000000000000000000a0");
const LP_B = getAddress("0x00000000000000000000000000000000000000b0");
const LP_C = getAddress("0x00000000000000000000000000000000000000c0");
const LOCK_TRUSTED = getAddress("0x00000000000000000000000000000000000000f1");
const LOCK_LOOKALIKE = getAddress("0x00000000000000000000000000000000000000f2");
const LOCK_UNPERMISSIONED = getAddress("0x00000000000000000000000000000000000000f3");
const HOLDER_DEPLOYER = getAddress("0x00000000000000000000000000000000000000d1");
const HOLDER_UNKNOWN = getAddress("0x00000000000000000000000000000000000000d2");
const TOKEN_OTHER = getAddress("0x0000000000000000000000000000000000000002");

const NOW = Math.floor(Date.now() / 1000);
const MIN_LOCK_END = NOW + 7 * 86400;  // 7 days from now
const MAX_UINT = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

function makePool(addr: Address, lp: Address, lpTotalSupply: string, token0 = TOKEN, token1 = TOKEN_OTHER): PoolInfo {
  return {
    dex: "uniswap-v2",
    pool: addr,
    lpToken: lp,
    lpTotalSupply,
    token0,
    token1,
    reserve0: "1000000000000000000",
    reserve1: "1000000000000000000",
  };
}

function makeLock(lockContract: Address, lpToken: Address, lockedAmount: string, unlockEpoch: number, permissioned = true, owner: Address | null = HOLDER_DEPLOYER): LpLockInfo {
  return {
    lockContract,
    lockOwner: owner,
    lockedAmount,
    unlockEpoch,
    withdrawPermissioned: permissioned,
  };
}

function makeState(): MockState {
  return {
    pools: new Map(),
    balances: new Map(),
    locks: new Map(),
    tokenPools: new Map(),
  };
}

function setBalance(st: MockState, lpToken: Address, holder: Address, balance: string): void {
  if (!st.balances.has(lpToken.toLowerCase())) st.balances.set(lpToken.toLowerCase(), new Map());
  st.balances.get(lpToken.toLowerCase())!.set(holder.toLowerCase(), balance);
}

function setLock(st: MockState, lpToken: Address, lock: LpLockInfo): void {
  if (!st.locks.has(lpToken.toLowerCase())) st.locks.set(lpToken.toLowerCase(), new Map());
  st.locks.get(lpToken.toLowerCase())!.set(lock.lockContract.toLowerCase(), lock);
}

function registerPoolForToken(st: MockState, token: Address, pool: Address): void {
  const arr = st.tokenPools.get(token.toLowerCase()) ?? [];
  if (!arr.includes(pool.toLowerCase())) arr.push(pool.toLowerCase());
  st.tokenPools.set(token.toLowerCase(), arr);
}

console.log("\n=== H2.2 — Liquidity Verification ===\n");

async function main(): Promise<void> {

// =========================================================================
// A. Happy paths
// =========================================================================

console.log("A. Happy paths");

// A1 — single pool, lock valid, 100% locked.
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_TRUSTED, "1000000");
  setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "1000000", MIN_LOCK_END + 86400));

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const manifest: LiquidityManifest = {
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
    minLockedFractionBps: 9500,
  };
  const r = await v.verify(manifest);
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
  assert(r.pools[0].verdict === "ok", `expected verdict=ok, got ${r.pools[0].verdict}`);
  assert(r.pools[0].lockedFractionBps === 10000, `expected 10000 bps, got ${r.pools[0].lockedFractionBps}`);
}

// A2 — exactly min locked fraction.
{
  const st = makeState();
  // totalSupply = 1000000, locked = 950000 = 95.00% = 9500 bps.
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_TRUSTED, "950000");
  setBalance(st, LP_A, HOLDER_DEPLOYER, "50000");  // 5% unlocked, allowlisted
  setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "950000", MIN_LOCK_END + 86400));

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
    minLockedFractionBps: 9500,
  });
  assert(r.ok, `expected ok=true at boundary 9500 bps, got: ${r.reasons.join("; ")}`);
  assert(r.pools[0].lockedFractionBps === 9500, `expected 9500 bps, got ${r.pools[0].lockedFractionBps}`);
}

// A3 — no lock claimed, all LP held by allowlisted holder.
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, HOLDER_DEPLOYER, "1000000");

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: null }],
    trustedLockContracts: [],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
  });
  assert(r.ok, `expected ok=true, got: ${r.reasons.join("; ")}`);
  assert(r.pools[0].verdict === "ok", `expected verdict=ok, got ${r.pools[0].verdict}`);
}

// =========================================================================
// B. Lock defects
// =========================================================================

console.log("\nB. Lock defects");

// B1 — lock expired in the past.
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_TRUSTED, "1000000");
  setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "1000000", NOW - 86400));  // expired yesterday

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
  });
  assert(!r.ok, "expected ok=false on expired lock");
  assert(r.pools[0].verdict === "lock-duration-too-short", `expected lock-duration-too-short, got ${r.pools[0].verdict}`);
}

// B2 — lock expires tomorrow (less than min horizon).
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_TRUSTED, "1000000");
  setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "1000000", NOW + 86400));  // 1 day

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,  // 7 days
  });
  assert(!r.ok, "expected ok=false on lock ending tomorrow");
  assert(r.pools[0].verdict === "lock-duration-too-short", `expected lock-duration-too-short, got ${r.pools[0].verdict}`);
}

// B3 — lock covers 51% (below 95% min).
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_TRUSTED, "510000");
  setBalance(st, LP_A, HOLDER_DEPLOYER, "490000");  // 49% unlocked, allowlisted
  setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "510000", MIN_LOCK_END + 86400));

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
    minLockedFractionBps: 9500,
  });
  assert(!r.ok, "expected ok=false on 51% lock");
  assert(r.pools[0].verdict === "lock-percentage-low", `expected lock-percentage-low, got ${r.pools[0].verdict}`);
  assert(r.pools[0].lockedFractionBps === 5100, `expected 5100 bps, got ${r.pools[0].lockedFractionBps}`);
}

// B4 — lock contract not in trustedLockContracts.
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_LOOKALIKE, "1000000");
  setLock(st, LP_A, makeLock(LOCK_LOOKALIKE, LP_A, "1000000", MIN_LOCK_END + 86400));

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_LOOKALIKE }],
    trustedLockContracts: [LOCK_TRUSTED],  // only TRUSTED is allowlisted
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
  });
  assert(!r.ok, "expected ok=false on untrusted lock contract");
  assert(r.pools[0].verdict === "lock-contract-untrusted", `expected lock-contract-untrusted, got ${r.pools[0].verdict}`);
}

// B5 — lock withdraw is permissionless.
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_UNPERMISSIONED, "1000000");
  setLock(st, LP_A, makeLock(LOCK_UNPERMISSIONED, LP_A, "1000000", MIN_LOCK_END + 86400, /* permissioned */ false));

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_UNPERMISSIONED }],
    trustedLockContracts: [LOCK_UNPERMISSIONED],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
  });
  assert(!r.ok, "expected ok=false on permissionless withdraw");
  assert(r.pools[0].verdict === "lock-withdraw-unpermissioned", `expected lock-withdraw-unpermissioned, got ${r.pools[0].verdict}`);
}

// =========================================================================
// C. Multi-pool + holder defects
// =========================================================================

console.log("\nC. Multi-pool + holder defects");

// C1 — two pools: A good, B bad → overall ok=false; B's verdict named.
{
  const st = makeState();
  // Pool A — fully locked, valid.
  const poolA = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), poolA);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_TRUSTED, "1000000");
  setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "1000000", MIN_LOCK_END + 86400));

  // Pool B — unlocked, LP held by unknown.
  const poolB = makePool(POOL_B, LP_B, "500000");
  st.pools.set(POOL_B.toLowerCase(), poolB);
  registerPoolForToken(st, TOKEN, POOL_B);
  setBalance(st, LP_B, HOLDER_UNKNOWN, "500000");

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [
      { pool: POOL_A, lockContract: LOCK_TRUSTED },
      { pool: POOL_B, lockContract: null },
    ],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
  });
  assert(!r.ok, "expected ok=false with B failing");
  assert(r.pools[0].verdict === "ok", `expected A ok, got ${r.pools[0].verdict}`);
  assert(r.pools[1].verdict === "unlocked-lp-held-by-unknown", `expected B unlocked-lp-held-by-unknown, got ${r.pools[1].verdict}`);
}

// C2 — pool listed twice in manifest.
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_TRUSTED, "1000000");
  setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "1000000", MIN_LOCK_END + 86400));

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [
      { pool: POOL_A, lockContract: LOCK_TRUSTED },
      { pool: POOL_A, lockContract: LOCK_TRUSTED },  // duplicate
    ],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
  });
  assert(!r.ok, "expected ok=false on duplicate pool");
  assert(r.pools.some(p => p.verdict === "pool-duplicate"), "expected pool-duplicate verdict");
}

// C3 — extra pool on-chain not in manifest.
{
  const st = makeState();
  // Manifest lists POOL_A.
  const poolA = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), poolA);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_TRUSTED, "1000000");
  setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "1000000", MIN_LOCK_END + 86400));
  // POOL_C also exists on-chain but is NOT in the manifest.
  const poolC = makePool(POOL_C, LP_C, "100000");
  st.pools.set(POOL_C.toLowerCase(), poolC);
  registerPoolForToken(st, TOKEN, POOL_C);

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
    // allowExtraPools omitted → default false → strict.
  });
  assert(!r.ok, "expected ok=false on extra pool present");
  assert(r.pools.some(p => p.verdict === "extra-pool-present"), "expected extra-pool-present verdict");
  assert(r.extraPools.length === 1, `expected 1 extra pool, got ${r.extraPools.length}`);
}

// C4 — unlocked LP tokens held by unknown address.
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_TRUSTED, "950000");
  setBalance(st, LP_A, HOLDER_UNKNOWN, "50000");  // 5% unlocked, NOT allowlisted
  setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "950000", MIN_LOCK_END + 86400));

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER],  // UNKNOWN not listed
    minLockEndEpoch: MIN_LOCK_END,
    minLockedFractionBps: 9500,
  });
  assert(!r.ok, "expected ok=false on unknown holder");
  assert(r.pools[0].verdict === "unlocked-lp-held-by-unknown", `expected unlocked-lp-held-by-unknown, got ${r.pools[0].verdict}`);
  assert(r.pools[0].unknownHolders.length === 1, `expected 1 unknown holder, got ${r.pools[0].unknownHolders.length}`);
}

// =========================================================================
// D. Adversarial
// =========================================================================

console.log("\nD. Adversarial");

// D1 — "permanent lock that isn't" — unlockTime=MAX_UINT but withdraw is permissionless.
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_UNPERMISSIONED, "1000000");
  // Lock claims unlock at type(uint256).max — the maximum possible.
  setLock(st, LP_A, makeLock(LOCK_UNPERMISSIONED, LP_A, "1000000", Number(MAX_UINT) > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Number(MAX_UINT), /* permissioned */ false));

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_UNPERMISSIONED }],
    trustedLockContracts: [LOCK_UNPERMISSIONED],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
  });
  assert(!r.ok, "expected ok=false despite MAX_UINT unlockEpoch");
  assert(r.pools[0].verdict === "lock-withdraw-unpermissioned", `expected lock-withdraw-unpermissioned, got ${r.pools[0].verdict}`);
  // Document explicitly: the duration check passes (MAX_UINT > MIN_LOCK_END),
  // but the withdraw-permission check fires independently.
}

// D2 — lock contract that LOOKS like trusted but is off-by-one.
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  setBalance(st, LP_A, LOCK_LOOKALIKE, "1000000");
  setLock(st, LP_A, makeLock(LOCK_LOOKALIKE, LP_A, "1000000", MIN_LOCK_END + 86400));

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const r = await v.verify({
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_LOOKALIKE }],
    trustedLockContracts: [LOCK_TRUSTED],  // only TRUSTED, not LOOKALIKE
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
  });
  assert(!r.ok, "expected ok=false on look-alike lock contract");
  assert(r.pools[0].verdict === "lock-contract-untrusted", `expected lock-contract-untrusted, got ${r.pools[0].verdict}`);
}

// D3 — boundary: 95.00% accepted, 94.99% rejected.
{
  // 95.00% — accepted.
  {
    const st = makeState();
    const pool = makePool(POOL_A, LP_A, "1000000");
    st.pools.set(POOL_A.toLowerCase(), pool);
    registerPoolForToken(st, TOKEN, POOL_A);
    setBalance(st, LP_A, LOCK_TRUSTED, "950000");
    setBalance(st, LP_A, HOLDER_DEPLOYER, "50000");
    setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "950000", MIN_LOCK_END + 86400));

    const v = new LiquidityVerifier(new MockLiquiditySource(st));
    const r = await v.verify({
      token: TOKEN,
      pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
      trustedLockContracts: [LOCK_TRUSTED],
      allowedLpHolders: [HOLDER_DEPLOYER],
      minLockEndEpoch: MIN_LOCK_END,
      minLockedFractionBps: 9500,
    });
    assert(r.ok, `95.00% should be accepted, got: ${r.reasons.join("; ")}`);
  }
  // 94.99% — rejected (949900 / 1000000 = 9499 bps).
  {
    const st = makeState();
    const pool = makePool(POOL_A, LP_A, "1000000");
    st.pools.set(POOL_A.toLowerCase(), pool);
    registerPoolForToken(st, TOKEN, POOL_A);
    setBalance(st, LP_A, LOCK_TRUSTED, "949900");
    setBalance(st, LP_A, HOLDER_DEPLOYER, "50100");
    setLock(st, LP_A, makeLock(LOCK_TRUSTED, LP_A, "949900", MIN_LOCK_END + 86400));

    const v = new LiquidityVerifier(new MockLiquiditySource(st));
    const r = await v.verify({
      token: TOKEN,
      pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
      trustedLockContracts: [LOCK_TRUSTED],
      allowedLpHolders: [HOLDER_DEPLOYER],
      minLockEndEpoch: MIN_LOCK_END,
      minLockedFractionBps: 9500,
    });
    assert(!r.ok, "94.99% should be rejected");
    assert(r.pools[0].verdict === "lock-percentage-low", `expected lock-percentage-low, got ${r.pools[0].verdict}`);
    assert(r.pools[0].lockedFractionBps === 9499, `expected 9499 bps, got ${r.pools[0].lockedFractionBps}`);
  }
}

// D4 — "rug between blocks" — first verification passes, then LP holder
// transfers to unknown address, second verification fails. Verifier
// never caches state.
{
  const st = makeState();
  const pool = makePool(POOL_A, LP_A, "1000000");
  st.pools.set(POOL_A.toLowerCase(), pool);
  registerPoolForToken(st, TOKEN, POOL_A);
  // Initially, all LP held by deployer (allowlisted).
  setBalance(st, LP_A, HOLDER_DEPLOYER, "1000000");

  const v = new LiquidityVerifier(new MockLiquiditySource(st));
  const manifest: LiquidityManifest = {
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: null }],
    trustedLockContracts: [],
    allowedLpHolders: [HOLDER_DEPLOYER],
    minLockEndEpoch: MIN_LOCK_END,
  };
  const r1 = await v.verify(manifest);
  assert(r1.ok, `first verification should pass, got: ${r1.reasons.join("; ")}`);

  // Now the deployer transfers LP to an unknown address.
  setBalance(st, LP_A, HOLDER_DEPLOYER, "0");
  setBalance(st, LP_A, HOLDER_UNKNOWN, "1000000");

  const r2 = await v.verify(manifest);
  assert(!r2.ok, "second verification must fail after rug");
  assert(r2.pools[0].verdict === "unlocked-lp-held-by-unknown", `expected unlocked-lp-held-by-unknown, got ${r2.pools[0].verdict}`);
}

// =========================================================================
// Pure helper
// =========================================================================

console.log("\nE. Pure helper");

// E1 — computeLockedFractionBps.
{
  assert(computeLockedFractionBps("0", "1000000") === 0, "0 locked → 0 bps");
  assert(computeLockedFractionBps("1000000", "1000000") === 10000, "100% → 10000 bps");
  assert(computeLockedFractionBps("950000", "1000000") === 9500, "95% → 9500 bps");
  assert(computeLockedFractionBps("949900", "1000000") === 9499, "94.99% → 9499 bps");
  assert(computeLockedFractionBps("1", "3") === 3333, "1/3 → 3333 bps (truncated)");
  assert(computeLockedFractionBps("100", "0") === 0, "zero total → 0 bps (no div-by-zero)");
}

// =========================================================================
// Summary
// =========================================================================

console.log(`\n=== H2.2 Summary: ${pass} pass, ${fail} fail ===`);
if (fail > 0) {
  console.log("FAILURES DETECTED — see above.");
  process.exit(1);
}

}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
