// Fee Model — central authority for fee-aware execution.
//
// v16: This module wraps every buy/sell with a transparent fee + slippage
// breakdown, persists a FeeAuditLog row for each trade, and exposes a
// "is this trade still profitable after fees?" gate that the engine uses
// to skip marginal setups.
//
// The fee model is conservative: we apply the configured fee on BOTH sides
// of the trade (entry and exit), plus slippage on both sides. This means
// a position needs to move at least (2 * (feeBps + slippageBps)) / 10000
// in the favorable direction before it breaks even on a round-trip.
//
// Example: feeBps=10, slippageBps=30 → round-trip cost = 2 * (10+30) = 80bps
//          = 0.80% — the position needs to gain > 0.80% to be profitable.
//
// All fee math is done in USD for clarity. Net P&L = gross P&L - totalFees.

import { db } from "@/lib/db";
import { logger } from "./logger";

export interface FeeBreakdown {
  // Input
  grossAmountUsd: number;
  feeBps: number;
  slippageBps: number;
  side: "buy" | "sell";
  // Computed
  feeUsd: number;
  slippageUsd: number;
  totalCostUsd: number;
  netAmountUsd: number;
  // For buys: netAmountUsd = grossAmountUsd + totalCostUsd (cost is added on top)
  // For sells: netAmountUsd = grossAmountUsd - totalCostUsd (cost is subtracted)
}

/**
 * Compute the fee + slippage breakdown for a single trade leg.
 * Pure function — no DB calls.
 */
export function computeFeeBreakdown(
  grossAmountUsd: number,
  feeBps: number,
  slippageBps: number,
  side: "buy" | "sell"
): FeeBreakdown {
  const feeUsd = (grossAmountUsd * feeBps) / 10_000;
  const slippageUsd = (grossAmountUsd * slippageBps) / 10_000;
  const totalCostUsd = feeUsd + slippageUsd;
  const netAmountUsd =
    side === "buy"
      ? grossAmountUsd + totalCostUsd // buyer pays more
      : grossAmountUsd - totalCostUsd; // seller receives less
  return {
    grossAmountUsd,
    feeBps,
    slippageBps,
    side,
    feeUsd,
    slippageUsd,
    totalCostUsd,
    netAmountUsd,
  };
}

/**
 * Compute the round-trip cost (buy + sell) for a position of the given size.
 * Used by the engine in SCOUT to gate trades: if expected move < roundTripCost,
 * the trade is skipped because it can't be profitable.
 *
 * Returns the cost in USD and as a % of the gross position size.
 */
export function computeRoundTripCost(
  positionSizeUsd: number,
  feeBps: number,
  slippageBps: number
): { costUsd: number; costPct: number; breakevenMovePct: number } {
  const buyBreakdown = computeFeeBreakdown(positionSizeUsd, feeBps, slippageBps, "buy");
  const sellBreakdown = computeFeeBreakdown(positionSizeUsd, feeBps, slippageBps, "sell");
  const costUsd = buyBreakdown.totalCostUsd + sellBreakdown.totalCostUsd;
  const costPct = (costUsd / positionSizeUsd) * 100;
  // Breakeven move: how much the price needs to move in our favor (in %)
  // before we start making money. Equals roundTripCost / positionSize * 100.
  const breakevenMovePct = costPct;
  return { costUsd, costPct, breakevenMovePct };
}

/**
 * Persist a FeeAuditLog row for an executed trade. Silent on failure —
 * fee logging must never break trade execution.
 */
export async function recordFeeAuditLog(
  positionId: string,
  symbol: string,
  side: "buy" | "sell",
  breakdown: FeeBreakdown,
  opts?: { strategy?: string; exchange?: string }
): Promise<void> {
  try {
    await db.feeAuditLog.create({
      data: {
        positionId,
        symbol,
        side,
        grossAmountUsd: breakdown.grossAmountUsd,
        executedPriceUsd: 0, // not tracked here — caller can update if needed
        qty: 0,
        feeBps: breakdown.feeBps,
        feeUsd: breakdown.feeUsd,
        slippageBps: breakdown.slippageBps,
        slippageUsd: breakdown.slippageUsd,
        totalCostUsd: breakdown.totalCostUsd,
        netAmountUsd: breakdown.netAmountUsd,
        strategy: opts?.strategy ?? null,
        exchange: opts?.exchange ?? null,
      },
    });
  } catch (err) {
    logger.debug("fee", `FeeAuditLog write failed: ${String(err)}`);
  }
}

/**
 * Aggregate fee statistics over a time window. Used by the Fee-Aware Execution
 * panel in the dashboard to show "how much have we paid in fees this week?".
 */
export async function getFeeStats(opts?: {
  since?: Date;
  positionId?: string;
}): Promise<{
  totalFeesUsd: number;
  totalSlippageUsd: number;
  totalCostUsd: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  avgCostPerTradeUsd: number;
  costAsPctOfVolume: number;
  totalVolumeUsd: number;
  byStrategy: Record<string, { count: number; costUsd: number }>;
  byExchange: Record<string, { count: number; costUsd: number }>;
}> {
  const where: Record<string, unknown> = {};
  if (opts?.since) where.executedAt = { gte: opts.since };
  if (opts?.positionId) where.positionId = opts.positionId;

  const rows = await db.feeAuditLog.findMany({
    where,
    orderBy: { executedAt: "desc" },
    take: 5000,
  });

  let totalFeesUsd = 0;
  let totalSlippageUsd = 0;
  let totalCostUsd = 0;
  let totalVolumeUsd = 0;
  let buyCount = 0;
  let sellCount = 0;
  const byStrategy: Record<string, { count: number; costUsd: number }> = {};
  const byExchange: Record<string, { count: number; costUsd: number }> = {};

  for (const r of rows) {
    totalFeesUsd += r.feeUsd;
    totalSlippageUsd += r.slippageUsd;
    totalCostUsd += r.totalCostUsd;
    totalVolumeUsd += r.grossAmountUsd;
    if (r.side === "buy") buyCount++;
    else sellCount++;

    const strat = r.strategy ?? "unknown";
    if (!byStrategy[strat]) byStrategy[strat] = { count: 0, costUsd: 0 };
    byStrategy[strat].count++;
    byStrategy[strat].costUsd += r.totalCostUsd;

    const exch = r.exchange ?? "unknown";
    if (!byExchange[exch]) byExchange[exch] = { count: 0, costUsd: 0 };
    byExchange[exch].count++;
    byExchange[exch].costUsd += r.totalCostUsd;
  }

  const tradeCount = rows.length;
  const avgCostPerTradeUsd = tradeCount > 0 ? totalCostUsd / tradeCount : 0;
  const costAsPctOfVolume = totalVolumeUsd > 0 ? (totalCostUsd / totalVolumeUsd) * 100 : 0;

  return {
    totalFeesUsd,
    totalSlippageUsd,
    totalCostUsd,
    tradeCount,
    buyCount,
    sellCount,
    avgCostPerTradeUsd,
    costAsPctOfVolume,
    totalVolumeUsd,
    byStrategy,
    byExchange,
  };
}

/**
 * Fee-aware trade gate: should we open this position given the expected
 * hold time + fee regime? Returns true if the expected move covers the
 * round-trip cost with a margin.
 *
 * The "expected move" is derived from the take-profit %: if TP is 15%, we
 * expect the position to potentially move 15% in our favor. The gate
 * requires that TP% > roundTripCostPct * MARGIN_FACTOR (default 3x), so
 * that even if the position only hits half its TP, we're still net positive.
 *
 * Conservative by default: a setup that's "barely profitable on paper"
 * gets rejected.
 */
export function isTradeProfitableAfterFees(
  takeProfitPct: number,
  positionSizeUsd: number,
  feeBps: number,
  slippageBps: number,
  marginFactor = 3.0
): { profitable: boolean; roundTripCostPct: number; expectedMovePct: number; margin: number } {
  const { costPct: roundTripCostPct } = computeRoundTripCost(
    positionSizeUsd,
    feeBps,
    slippageBps
  );
  const expectedMovePct = takeProfitPct;
  const margin = expectedMovePct / Math.max(roundTripCostPct, 0.001);
  const profitable = margin >= marginFactor;
  return { profitable, roundTripCostPct, expectedMovePct, margin };
}
