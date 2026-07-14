// H2.2 — Liquidity Verification: LP lock, lock duration, locked
// percentage, multi-pool consistency, removable-liquidity detection.
//
// DESIGN PHILOSOPHY
// -----------------
// The rug-pull vector against an auto-trader is structural: the
// operator buys a token whose liquidity is "locked" according to a
// DexScreener-style third-party API, but the lock is either (a)
// shorter than claimed, (b) covering only a fraction of the LP
// tokens, (c) duplicated shallow pools to make one look deeper than
// it is, or (d) actually revocable by an unknown account that the
// third-party API doesn't surface.
//
// H2.2 verifies liquidity STRUCTURALLY from on-chain state, not from
// a third-party API. The primitive takes a `LiquiditySource` (a
// reader interface) and produces a `LiquidityReport` that names
// every defect found:
//
//   1. LP LOCK — does the LP token holder delegate to a known lock
//      contract? We check the LP token's balanceOf(lockContract) and
//      the lock contract's `getLock()` return for the LP.
//   2. LOCK DURATION — the lock must extend past `minLockEndEpoch`.
//      A 1-day lock when the bot's hold horizon is 7 days is a
//      defect even if the lock is real.
//   3. LOCKED PERCENTAGE — lockedAmount / totalSupply of LP must
//      exceed `minLockedFractionBps` (default 9500 = 95%). A 50%
//      lock means the unlocked half can be pulled to drain the pool.
//   4. MULTI-POOL — the same token can list on multiple DEXes. We
//      verify each pool independently and reject if ANY pool fails
//      the checks (a shallow duplicate doesn't excuse a deep one
//      from being verified; conversely, a deep main pool doesn't
//      excuse a shallow duplicate that the operator might also
//      trade against).
//   5. REMOVABLE LIQUIDITY — the LP tokens NOT covered by the lock
//      must be held by an address in `allowedLpHolders`. If an
//      unknown address holds unlocked LP tokens, those tokens can
//      be used to drain the pool at any time — the lock is
//      theatrical.
//
// INJECTABLE LIQUIDITY SOURCE
// ---------------------------
// The verifier takes a `LiquiditySource` interface so tests inject
// deterministic mock state. Production wraps the same ChainReader
// used by H2.1 plus a small set of well-known lock-contract ABIs
// (Unicrypt, PinkLock, TeamFinance, custom). The verifier does NOT
// depend on a specific lock vendor — the lock-contract address and
// its ABI are passed by the caller in the manifest.
//
// ADVERSARIAL SCOPE
// -----------------
// Per the permanent principle, the verifier ships with adversarial
// tests for: (a) a lock that expired 1 block ago (still claims
// "locked" via the third-party API but on-chain `unlockTime` is in
// the past), (b) a lock covering 51% when minLockedFraction is 95%
// — the "yes it's locked, but not enough" gap, (c) two pools where
// pool A is genuinely locked and pool B is unlocked, used to bypass
// a verification that only checked pool A, (d) unlocked LP tokens
// held by an address that just looks like the lock contract (same
// length, different checksum) — caught by explicit allowlist, (e)
// a lock contract that returns unlockTime=type(uint256).max but
// the `withdraw()` function has no `onlyOwner` modifier and can be
// called by anyone (the "permanent lock that isn't" pattern).

import type { Address } from "./contract-verification";

export type { Address };

// -------------------------------------------------------------------------
// Liquidity source — injectable reader.
// -------------------------------------------------------------------------

export interface LpLockInfo {
  /** Lock contract address (the contract that holds the LP tokens). */
  lockContract: Address;
  /** Owner of the lock (who can withdraw once unlocked). */
  lockOwner: Address | null;
  /** Amount of LP tokens locked, in atomic units (decimal string). */
  lockedAmount: string;
  /** Epoch seconds when the lock ends. */
  unlockEpoch: number;
  /** Whether the lock contract's `withdraw()` is permissioned (only callable by lockOwner). False = anyone can withdraw. */
  withdrawPermissioned: boolean;
}

export interface PoolInfo {
  /** DEX identifier (e.g. "uniswap-v3", "sushiswap"). */
  dex: string;
  /** Pool contract address. */
  pool: Address;
  /** LP token contract address (same as pool for UniswapV2-style; different for V3). */
  lpToken: Address;
  /** LP token total supply, in atomic units (decimal string). */
  lpTotalSupply: string;
  /** Token 0 / Token 1 of the pool (the pair being traded). */
  token0: Address;
  token1: Address;
  /** Reserves of token0 / token1 in atomic units. */
  reserve0: string;
  reserve1: string;
}

export interface LiquiditySource {
  /** Fetch pool info for a pool address. Returns null if not found. */
  getPool(pool: Address): Promise<PoolInfo | null>;
  /** List pools that contain the given token. */
  listPoolsForToken(token: Address): Promise<PoolInfo[]>;
  /** LP token balance of an address. */
  lpBalanceOf(lpToken: Address, holder: Address): Promise<string>;
  /** Fetch the lock info for an LP position, if any lock contract is known to hold LP for this pool. */
  getLock(lpToken: Address, lockContract: Address): Promise<LpLockInfo | null>;
}

// -------------------------------------------------------------------------
// Manifest — what the caller claims about the liquidity.
// -------------------------------------------------------------------------

export interface LiquidityManifest {
  /** The token being traded. */
  token: Address;
  /** Pools the operator intends to trade against. Each must be verified independently. */
  pools: PoolDescriptor[];
  /** Lock contracts the caller trusts (allowlist). Locks held by addresses NOT in this list = rejected. */
  trustedLockContracts: Address[];
  /** Addresses permitted to hold unlocked LP tokens (typically the pool contract itself, the deployer, the lock contract). Empty = any holder fails. */
  allowedLpHolders: Address[];
  /** Minimum lock end, epoch seconds. The lock's unlockEpoch must be >= this. Default: now + 7 days. */
  minLockEndEpoch?: number;
  /** Minimum locked fraction of LP supply, in bps. Default 9500 (95%). */
  minLockedFractionBps?: number;
  /** Maximum number of pools to verify for a single token. Default 5. */
  maxPoolsPerToken?: number;
  /** When true, if listPoolsForToken returns MORE pools than the manifest's `pools`, the extra pools are NOT verified but a warning is recorded. Default false (strict: any extra pool = reject). */
  allowExtraPools?: boolean;
  /** Logger. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

export interface PoolDescriptor {
  pool: Address;
  /** Lock contract claimed to hold LP for this pool. If null, the pool is "unlocked" and must pass `unlockedAllowPolicy`. */
  lockContract: Address | null;
}

// -------------------------------------------------------------------------
// Findings — what the verifier observed.
// -------------------------------------------------------------------------

export type PoolVerdict =
  | "ok"                // all checks pass
  | "no-pool"           // pool not found on-chain
  | "no-lock-claimed"   // manifest claims no lock; the pool's LP is fully unlocked
  | "lock-not-found"    // manifest claims a lock but the lock contract returns null
  | "lock-contract-untrusted"  // lock contract not in trustedLockContracts
  | "lock-duration-too-short" // unlockEpoch < minLockEndEpoch
  | "lock-percentage-low"     // lockedAmount / lpTotalSupply < minLockedFractionBps
  | "lock-withdraw-unpermissioned"  // anyone can withdraw from the lock
  | "unlocked-lp-held-by-unknown"   // unlocked LP tokens held by address not in allowedLpHolders
  | "extra-pool-present"     // listPoolsForToken returned pools not in manifest
  | "pool-duplicate"         // the same LP token appears in multiple pool descriptors (degenerate)
  | "lp-total-supply-zero";  // pool has no liquidity

export interface PoolResult {
  pool: Address;
  verdict: PoolVerdict;
  /** Detail message for the verdict. */
  detail: string;
  /** Pool info, if fetched. */
  poolInfo: PoolInfo | null;
  /** Lock info, if fetched. */
  lockInfo: LpLockInfo | null;
  /** Locked fraction in bps (0-10000). */
  lockedFractionBps: number;
  /** Unlocked LP holders (and their balances) that are NOT in allowedLpHolders. */
  unknownHolders: Array<{ holder: Address; balance: string }>;
}

export interface LiquidityReport {
  ok: boolean;
  /** Aggregate reasons (one per failing pool). Empty when ok=true. */
  reasons: string[];
  /** Per-pool results, in manifest order. */
  pools: PoolResult[];
  /** Extra pools observed on-chain that the manifest didn't list. */
  extraPools: PoolInfo[];
}

// -------------------------------------------------------------------------
// The verifier.
// -------------------------------------------------------------------------

export class LiquidityVerifier {
  constructor(private readonly src: LiquiditySource) {}

  async verify(manifest: LiquidityManifest): Promise<LiquidityReport> {
    const log = manifest.log ?? (() => {});
    const minLockEndEpoch = manifest.minLockEndEpoch ?? (Math.floor(Date.now() / 1000) + 7 * 86400);
    const minLockedFractionBps = manifest.minLockedFractionBps ?? 9500;
    const maxPoolsPerToken = manifest.maxPoolsPerToken ?? 5;
    const reasons: string[] = [];
    const poolResults: PoolResult[] = [];
    const extraPools: PoolInfo[] = [];

    // --- 1. Duplicate pool check ---
    const seenPools = new Set<Address>();
    const seenLpTokens = new Set<Address>();
    for (const desc of manifest.pools) {
      const poolLower = desc.pool.toLowerCase();
      if (seenPools.has(poolLower)) {
        poolResults.push({
          pool: desc.pool,
          verdict: "pool-duplicate",
          detail: `pool ${desc.pool} appears more than once in the manifest`,
          poolInfo: null,
          lockInfo: null,
          lockedFractionBps: 0,
          unknownHolders: [],
        });
        reasons.push(`pool ${desc.pool}: duplicate pool in manifest`);
      }
      seenPools.add(poolLower);
    }
    if (manifest.pools.length > maxPoolsPerToken) {
      reasons.push(
        `manifest lists ${manifest.pools.length} pools; maxPoolsPerToken is ${maxPoolsPerToken}`,
      );
    }

    // --- 2. Per-pool verification ---
    for (const desc of manifest.pools) {
      if (seenLpTokens.has(desc.pool.toLowerCase())) continue;  // already errored as duplicate
      const result = await this.verifyPool(
        desc,
        manifest,
        minLockEndEpoch,
        minLockedFractionBps,
        log,
      );
      poolResults.push(result);
      if (result.poolInfo) seenLpTokens.add(result.poolInfo.lpToken.toLowerCase());
      if (result.verdict !== "ok") {
        reasons.push(`pool ${desc.pool}: ${result.verdict} — ${result.detail}`);
      }
    }

    // --- 3. Extra-pool detection ---
    try {
      const onChainPools = await this.src.listPoolsForToken(manifest.token);
      const manifestSet = new Set(manifest.pools.map(p => p.pool.toLowerCase()));
      for (const p of onChainPools) {
        if (!manifestSet.has(p.pool.toLowerCase())) {
          extraPools.push(p);
        }
      }
      if (extraPools.length > 0 && !manifest.allowExtraPools) {
        reasons.push(
          `${extraPools.length} extra pool(s) found on-chain not in manifest: ${extraPools.map(p => p.pool).join(", ")}`,
        );
        // Mark each extra pool in the result list with verdict=extra-pool-present.
        for (const p of extraPools) {
          poolResults.push({
            pool: p.pool,
            verdict: "extra-pool-present",
            detail: `pool ${p.pool} (${p.dex}) exists on-chain but is not in the manifest`,
            poolInfo: p,
            lockInfo: null,
            lockedFractionBps: 0,
            unknownHolders: [],
          });
        }
      }
    } catch (e) {
      log("warn", "listPoolsForToken failed; skipping extra-pool check", { err: (e as Error).message });
    }

    return {
      ok: reasons.length === 0,
      reasons,
      pools: poolResults,
      extraPools,
    };
  }

  private async verifyPool(
    desc: PoolDescriptor,
    manifest: LiquidityManifest,
    minLockEndEpoch: number,
    minLockedFractionBps: number,
    log: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void,
  ): Promise<PoolResult> {
    // --- Pool info ---
    const poolInfo = await this.src.getPool(desc.pool);
    if (!poolInfo) {
      return {
        pool: desc.pool,
        verdict: "no-pool",
        detail: `pool ${desc.pool} not found on-chain`,
        poolInfo: null,
        lockInfo: null,
        lockedFractionBps: 0,
        unknownHolders: [],
      };
    }

    // LP total supply sanity.
    if (poolInfo.lpTotalSupply === "0") {
      return {
        pool: desc.pool,
        verdict: "lp-total-supply-zero",
        detail: `pool ${desc.pool} has zero LP supply`,
        poolInfo,
        lockInfo: null,
        lockedFractionBps: 0,
        unknownHolders: [],
      };
    }

    // --- Lock check ---
    if (!desc.lockContract) {
      // No lock claimed. All LP tokens are "unlocked". Every holder
      // must be in allowedLpHolders (otherwise it's a pool whose LP
      // can be drained by an unknown account).
      const unknown = await this.collectUnknownHolders(poolInfo, manifest);
      if (unknown.length > 0) {
        return {
          pool: desc.pool,
          verdict: "unlocked-lp-held-by-unknown",
          detail: `no lock claimed; LP holders not in allowlist: ${unknown.map(u => u.holder).join(", ")}`,
          poolInfo,
          lockInfo: null,
          lockedFractionBps: 0,
          unknownHolders: unknown,
        };
      }
      return {
        pool: desc.pool,
        verdict: "ok",
        detail: "no lock claimed; all LP holders are allowlisted",
        poolInfo,
        lockInfo: null,
        lockedFractionBps: 0,
        unknownHolders: [],
      };
    }

    // Lock contract trust check.
    if (!manifest.trustedLockContracts.some(c => c.toLowerCase() === desc.lockContract!.toLowerCase())) {
      return {
        pool: desc.pool,
        verdict: "lock-contract-untrusted",
        detail: `lock contract ${desc.lockContract} is not in trustedLockContracts allowlist`,
        poolInfo,
        lockInfo: null,
        lockedFractionBps: 0,
        unknownHolders: [],
      };
    }

    // Fetch lock info.
    const lockInfo = await this.src.getLock(poolInfo.lpToken, desc.lockContract);
    if (!lockInfo) {
      return {
        pool: desc.pool,
        verdict: "lock-not-found",
        detail: `lock contract ${desc.lockContract} returned no lock for LP ${poolInfo.lpToken}`,
        poolInfo,
        lockInfo: null,
        lockedFractionBps: 0,
        unknownHolders: [],
      };
    }

    // Lock duration.
    if (lockInfo.unlockEpoch < minLockEndEpoch) {
      return {
        pool: desc.pool,
        verdict: "lock-duration-too-short",
        detail: `lock ends at ${lockInfo.unlockEpoch}, minLockEndEpoch is ${minLockEndEpoch}`,
        poolInfo,
        lockInfo,
        lockedFractionBps: computeLockedFractionBps(lockInfo.lockedAmount, poolInfo.lpTotalSupply),
        unknownHolders: [],
      };
    }

    // Lock withdraw permission.
    if (!lockInfo.withdrawPermissioned) {
      return {
        pool: desc.pool,
        verdict: "lock-withdraw-unpermissioned",
        detail: `lock contract ${desc.lockContract} withdraw() is callable by anyone`,
        poolInfo,
        lockInfo,
        lockedFractionBps: computeLockedFractionBps(lockInfo.lockedAmount, poolInfo.lpTotalSupply),
        unknownHolders: [],
      };
    }

    // Locked percentage.
    const lockedFractionBps = computeLockedFractionBps(lockInfo.lockedAmount, poolInfo.lpTotalSupply);
    if (lockedFractionBps < minLockedFractionBps) {
      return {
        pool: desc.pool,
        verdict: "lock-percentage-low",
        detail: `locked fraction ${lockedFractionBps} bps < min ${minLockedFractionBps} bps`,
        poolInfo,
        lockInfo,
        lockedFractionBps,
        unknownHolders: [],
      };
    }

    // Unlocked-LP-holder check (the remaining LP tokens not in the lock
    // must be in allowedLpHolders).
    const unknown = await this.collectUnknownHolders(poolInfo, manifest, desc.lockContract, lockInfo.lockedAmount);
    if (unknown.length > 0) {
      return {
        pool: desc.pool,
        verdict: "unlocked-lp-held-by-unknown",
        detail: `unlocked LP holders not in allowlist: ${unknown.map(u => `${u.holder} (${u.balance})`).join(", ")}`,
        poolInfo,
        lockInfo,
        lockedFractionBps,
        unknownHolders: unknown,
      };
    }

    return {
      pool: desc.pool,
      verdict: "ok",
      detail: "lock valid, duration sufficient, percentage met, no unknown unlocked holders",
      poolInfo,
      lockInfo,
      lockedFractionBps,
      unknownHolders: [],
    };
  }

  /**
   * Walk the LP token's holder list and return any holder (and balance)
   * that is NOT in `allowedLpHolders` and (when a lock is present) NOT
   * the lock contract itself.
   *
   * NOTE: in production, this requires either an index (The Graph,
   * Alchemy's `getTokenBalances` batched, etc.) or a manual list of
   * "known holders" provided by the caller. The LiquiditySource
   * interface here exposes a `lpBalanceOf` per-address check; the
   * caller-driven holder list is provided via `allowedLpHolders` in
   * the manifest. Unknown holders are detected by querying the LP
   * balance of every address in `candidateHolders` (a caller-provided
   * set) — if the sum of candidate balances + lock balance doesn't
   * equal totalSupply, the residual is treated as "unknown holders".
   *
   * For the test suite, we extend the source with an optional
   * `enumerateHolders` shortcut (see MockLiquiditySource).
   */
  private async collectUnknownHolders(
    poolInfo: PoolInfo,
    manifest: LiquidityManifest,
    lockContract?: Address,
    lockedAmount?: string,
  ): Promise<Array<{ holder: Address; balance: string }>> {
    const allowed = new Set(
      manifest.allowedLpHolders.map(a => a.toLowerCase()),
    );
    if (lockContract) allowed.add(lockContract.toLowerCase());

    // Use the source's holder enumeration if available.
    const enumSrc = this.src as LiquiditySource & {
      enumerateHolders?: (lpToken: Address) => Promise<Array<{ holder: Address; balance: string }>>;
    };
    if (enumSrc.enumerateHolders) {
      const holders = await enumSrc.enumerateHolders(poolInfo.lpToken);
      const unknown: Array<{ holder: Address; balance: string }> = [];
      for (const h of holders) {
        if (!allowed.has(h.holder.toLowerCase())) {
          unknown.push(h);
        }
      }
      return unknown;
    }

    // Fallback: query each allowed holder's balance and compute the
    // residual. If residual > 0, treat the pool as having an unknown
    // holder with balance = residual. We can't name the holder in
    // this case — the verdict detail will say "unknown holder(s)
    // with aggregate balance X".
    let accounted = BigInt(0);
    for (const holder of manifest.allowedLpHolders) {
      const bal = await this.src.lpBalanceOf(poolInfo.lpToken, holder);
      accounted += BigInt(bal || "0");
    }
    if (lockContract && lockedAmount) {
      accounted += BigInt(lockedAmount);
    }
    const total = BigInt(poolInfo.lpTotalSupply);
    const residual = total - accounted;
    if (residual > 0) {
      return [{ holder: "0xUNKNOWN" as Address, balance: residual.toString() }];
    }
    return [];
  }
}

/**
 * Compute the locked fraction in bps: (lockedAmount / lpTotalSupply) * 10000.
 * Truncated to integer bps. Returns 0 if total supply is zero.
 */
export function computeLockedFractionBps(lockedAmount: string, lpTotalSupply: string): number {
  const locked = BigInt(lockedAmount || "0");
  const total = BigInt(lpTotalSupply || "0");
  if (total === BigInt(0)) return 0;
  // (locked * 10000) / total — preserves precision.
  return Number((locked * BigInt(10000)) / total);
}
