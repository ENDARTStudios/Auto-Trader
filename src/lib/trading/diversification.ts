// Diversification — enforces per-symbol, per-chain, and per-strategy caps
// on simultaneous open positions.
//
// v16: The user spec says: "diversificação entre operações ativas."
// ("Diversification between active operations.")
//
// We enforce three independent caps, all configurable in Config:
//   • maxPositionsPerSymbol    — no more than N positions on the same symbol
//   • maxPositionsPerChain     — no more than N positions on the same chain
//   • maxPositionsPerStrategy  — no more than N positions with the same strategy tag
//
// All three must pass for a candidate to be eligible. The engine's SCOUT
// phase calls canOpenMore() for each candidate and filters out any that
// would breach a cap.
//
// Rationale: diversification prevents a single bad event (token rug, chain
// outage, strategy regime shift) from wiping out multiple positions at once.
// Even if the operator is bullish on a single token, the cap forces them to
// spread risk across unrelated positions.

import { db } from "@/lib/db";
import { logger } from "./logger";
import type { EngineConfig } from "./config";
import type { TokenCandidate } from "./types";

export interface DiversificationCheck {
  allowed: boolean;
  reasons: string[];
  // Current counts (for UI display)
  current: {
    perSymbol: number;
    perChain: number;
    perStrategy: number;
    total: number;
  };
  // Caps (for UI display)
  caps: {
    maxPositionsPerSymbol: number;
    maxPositionsPerChain: number;
    maxPositionsPerStrategy: number;
    maxPositionsPerRound: number;
  };
}

/**
 * Check whether opening a new position for `candidate` with `strategy` tag
 * would breach any diversification cap. Returns allowed=false + reasons
 * if any cap would be breached.
 */
export async function checkDiversification(
  cfg: EngineConfig,
  candidate: TokenCandidate,
  strategy: string
): Promise<DiversificationCheck> {
  const reasons: string[] = [];

  // Count current open positions by symbol / chain / strategy
  const openPositions = await db.position.findMany({
    where: { status: "open" },
    select: { symbol: true, chain: true, strategy: true },
  });

  const perSymbol = openPositions.filter((p) => p.symbol === candidate.symbol).length;
  const perChain = openPositions.filter(
    (p) => (p.chain ?? "cex") === (candidate.chain ?? "cex")
  ).length;
  const perStrategy = openPositions.filter(
    (p) => (p.strategy ?? "day") === strategy
  ).length;
  const total = openPositions.length;

  if (perSymbol >= cfg.maxPositionsPerSymbol) {
    reasons.push(
      `Max positions per symbol (${cfg.maxPositionsPerSymbol}) reached for ${candidate.symbol} (${perSymbol} open)`
    );
  }
  if (perChain >= cfg.maxPositionsPerChain) {
    reasons.push(
      `Max positions per chain (${cfg.maxPositionsPerChain}) reached for ${candidate.chain ?? "cex"} (${perChain} open)`
    );
  }
  if (perStrategy >= cfg.maxPositionsPerStrategy) {
    reasons.push(
      `Max positions per strategy (${cfg.maxPositionsPerStrategy}) reached for "${strategy}" (${perStrategy} open)`
    );
  }
  if (total >= cfg.maxPositionsPerRound) {
    reasons.push(
      `Max total positions per round (${cfg.maxPositionsPerRound}) reached (${total} open)`
    );
  }

  const allowed = reasons.length === 0;
  if (!allowed) {
    logger.info("diversification", `${candidate.symbol} blocked by diversification caps`, {
      perSymbol,
      perChain,
      perStrategy,
      total,
      reasons,
    });
  }

  return {
    allowed,
    reasons,
    current: { perSymbol, perChain, perStrategy, total },
    caps: {
      maxPositionsPerSymbol: cfg.maxPositionsPerSymbol,
      maxPositionsPerChain: cfg.maxPositionsPerChain,
      maxPositionsPerStrategy: cfg.maxPositionsPerStrategy,
      maxPositionsPerRound: cfg.maxPositionsPerRound,
    },
  };
}

/**
 * Get a snapshot of current diversification state. Used by the dashboard
 * to display "how diversified are we right now?".
 */
export async function getDiversificationSnapshot(): Promise<{
  totalOpen: number;
  bySymbol: Record<string, number>;
  byChain: Record<string, number>;
  byStrategy: Record<string, number>;
  uniqueSymbols: number;
  uniqueChains: number;
  uniqueStrategies: number;
  // Diversity score 0-100: 100 = perfectly diversified (every position on a
  // different symbol/chain/strategy), 0 = all eggs in one basket
  diversityScore: number;
}> {
  const openPositions = await db.position.findMany({
    where: { status: "open" },
    select: { symbol: true, chain: true, strategy: true },
  });

  const bySymbol: Record<string, number> = {};
  const byChain: Record<string, number> = {};
  const byStrategy: Record<string, number> = {};
  for (const p of openPositions) {
    const sym = p.symbol;
    const ch = p.chain ?? "cex";
    const st = p.strategy ?? "day";
    bySymbol[sym] = (bySymbol[sym] ?? 0) + 1;
    byChain[ch] = (byChain[ch] ?? 0) + 1;
    byStrategy[st] = (byStrategy[st] ?? 0) + 1;
  }

  const total = openPositions.length;
  const uniqueSymbols = Object.keys(bySymbol).length;
  const uniqueChains = Object.keys(byChain).length;
  const uniqueStrategies = Object.keys(byStrategy).length;

  // Diversity score: weighted average of (unique/total) across the three
  // dimensions. 100% means every position is on a unique symbol+chain+strategy.
  // 0% means all positions are identical on all three.
  let diversityScore = 0;
  if (total > 0) {
    const symScore = (uniqueSymbols / total) * 100;
    const chainScore = (uniqueChains / total) * 100;
    const stratScore = (uniqueStrategies / total) * 100;
    diversityScore = (symScore + chainScore + stratScore) / 3;
  }

  return {
    totalOpen: total,
    bySymbol,
    byChain,
    byStrategy,
    uniqueSymbols,
    uniqueChains,
    uniqueStrategies,
    diversityScore,
  };
}

/**
 * Pick a strategy tag for a new candidate, cycling through enabled strategies
 * to maximize diversification. If all enabled strategies are at cap, returns
 * null (caller should skip the candidate).
 *
 * Heuristic: prefer the strategy with the FEWEST open positions among the
 * enabled set. This naturally balances the strategy mix.
 */
export async function pickStrategyForCandidate(
  cfg: EngineConfig
): Promise<string | null> {
  const enabled = cfg.enabledStrategies.length > 0 ? cfg.enabledStrategies : ["scalp", "day", "swing"];
  const openPositions = await db.position.findMany({
    where: { status: "open" },
    select: { strategy: true },
  });

  // Count open positions per strategy
  const counts: Record<string, number> = {};
  for (const s of enabled) counts[s] = 0;
  for (const p of openPositions) {
    const s = p.strategy ?? "day";
    if (counts[s] !== undefined) counts[s]++;
  }

  // Find the strategy with the fewest open positions that hasn't hit its cap
  let best: string | null = null;
  let bestCount = Infinity;
  for (const s of enabled) {
    if (counts[s] >= cfg.maxPositionsPerStrategy) continue;
    if (counts[s] < bestCount) {
      bestCount = counts[s];
      best = s;
    }
  }

  return best;
}
