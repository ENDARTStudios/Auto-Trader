// Portfolio Manager — owns position lifecycle + profit split logic.
//
// Key rules (per user spec):
//   - First round: deploy 100% of trading balance across N tokens
//   - On each closed position, realized P&L is added back to trading balance
//   - After a round completes (all positions closed):
//       profit = roundRealizedPnl  (if > 0)
//       reserveCut = profit * reservePct/100  → moved to USDC cold reserve
//       reinvestCut = profit * reinvestPct/100 → stays in trading balance
//   - If round was unprofitable, no split happens; loss stays in trading balance
//   - Reserve can ONLY leave via explicit manual withdrawal (not auto-traded)

import { db } from "@/lib/db";
import { EngineConfig } from "./config";
import { logger } from "./logger";
import {
  paperBuy,
  paperSell,
  liveBuy,
  liveSell,
  ExecutionResult,
} from "./paper-trader";
import type {
  ExitReason,
  PositionRow,
  ScamReportData,
  TokenCandidate,
} from "./types";

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export async function ensureInitialized(): Promise<void> {
  // Config singleton
  const cfgExists = await db.config.findUnique({ where: { id: "singleton" } });
  if (!cfgExists) {
    await db.config.create({ data: { id: "singleton" } });
  }

  // TradingBalance singleton
  const tbExists = await db.tradingBalance.findUnique({
    where: { id: "singleton" },
  });
  if (!tbExists) {
    const cfg = await db.config.findUnique({ where: { id: "singleton" } });
    const initial = cfg?.initialCapitalUsd ?? 1000.0;
    await db.tradingBalance.create({
      data: {
        id: "singleton",
        balanceUsd: initial,
        peakBalanceUsd: initial,
      },
    });
    logger.info("portfolio", `TradingBalance inicializado com $${initial}`);
  }

  // Reserve singleton
  const rExists = await db.reserve.findUnique({ where: { id: "singleton" } });
  if (!rExists) {
    await db.reserve.create({ data: { id: "singleton" } });
  }
}

// ---------------------------------------------------------------------------
// Open position
// ---------------------------------------------------------------------------

export async function openPosition(
  cfg: EngineConfig,
  candidate: TokenCandidate,
  amountUsd: number,
  scamReport: ScamReportData,
  roundId: number
): Promise<PositionRow | null> {
  // Execute buy
  const isLive = cfg.mode === "live" && cfg.graduatedToLive;
  const result: ExecutionResult = isLive
    ? await liveBuy(candidate, amountUsd)
    : await paperBuy(candidate, amountUsd);

  if (!result.ok) {
    logger.warn("portfolio", `Buy falhou para ${candidate.symbol}`, {
      error: result.error,
    });
    return null;
  }

  // Compute TP/SL prices
  const entry = result.executedPriceUsd;
  const tp = entry * (1 + cfg.takeProfitPct / 100);
  const sl = entry * (1 - cfg.stopLossPct / 100);
  const maxExitAt = new Date(Date.now() + cfg.maxHoldMinutes * 60_000);

  const position = await db.position.create({
    data: {
      symbol: candidate.symbol,
      tokenId: candidate.tokenId ?? null,
      chain: candidate.chain ?? null,
      source: candidate.source,
      status: "open",
      entryPriceUsd: entry,
      entryAmountUsd: result.amountUsd,
      entryQty: result.qty,
      entryAt: new Date(),
      takeProfitPrice: tp,
      stopLossPrice: sl,
      maxExitAt,
      scamScore: scamReport.score,
      scamBreakdown: JSON.stringify(scamReport.findings),
      roundId,
    },
  });

  // Bump counters
  await db.tradingBalance.update({
    where: { id: "singleton" },
    data: { tradesOpened: { increment: 1 } },
  });

  logger.info("portfolio", `Position OPENED ${candidate.symbol}`, {
    id: position.id,
    entry,
    qty: result.qty,
    tp,
    sl,
    roundId,
  });

  return {
    id: position.id,
    symbol: position.symbol,
    source: position.source as "cex" | "dex",
    chain: position.chain,
    tokenId: position.tokenId,
    status: "open",
    entryPriceUsd: position.entryPriceUsd,
    entryAmountUsd: position.entryAmountUsd,
    entryQty: position.entryQty,
    entryAt: position.entryAt.toISOString(),
    exitPriceUsd: null,
    exitAmountUsd: null,
    exitAt: null,
    exitReason: null,
    pnlUsd: null,
    pnlPct: null,
    takeProfitPrice: position.takeProfitPrice,
    stopLossPrice: position.stopLossPrice,
    maxExitAt: position.maxExitAt.toISOString(),
    scamScore: position.scamScore,
    scamBreakdown: position.scamBreakdown,
    roundId: position.roundId,
  };
}

// ---------------------------------------------------------------------------
// Close position
// ---------------------------------------------------------------------------

export async function closePosition(
  cfg: EngineConfig,
  positionId: string,
  currentPriceUsd: number,
  reason: ExitReason
): Promise<PositionRow | null> {
  const pos = await db.position.findUnique({ where: { id: positionId } });
  if (!pos || pos.status !== "open") return null;

  const isLive = cfg.mode === "live" && cfg.graduatedToLive;
  const result: ExecutionResult = isLive
    ? await liveSell(pos.symbol, pos.entryQty, currentPriceUsd)
    : await paperSell(pos.symbol, pos.entryQty, currentPriceUsd);

  if (!result.ok) {
    logger.error("portfolio", `Sell falhou para ${pos.symbol}`, {
      error: result.error,
    });
    return null;
  }

  const exitAmount = result.amountUsd;
  const pnlUsd = exitAmount - pos.entryAmountUsd;
  const pnlPct = (pnlUsd / pos.entryAmountUsd) * 100;

  const updated = await db.position.update({
    where: { id: positionId },
    data: {
      status: pnlUsd < 0 && reason === "stop_loss" ? "liquidated" : "closed",
      exitPriceUsd: result.executedPriceUsd,
      exitAmountUsd: exitAmount,
      exitAt: new Date(),
      exitReason: reason,
      pnlUsd,
      pnlPct,
    },
  });

  // Update trading balance stats (the actual cash movement already happened
  // in paperSell — we only update counters here).
  await db.tradingBalance.update({
    where: { id: "singleton" },
    data: {
      realizedPnlUsd: { increment: pnlUsd },
      tradesClosed: { increment: 1 },
      wins: { increment: pnlUsd >= 0 ? 1 : 0 },
      losses: { increment: pnlUsd < 0 ? 1 : 0 },
    },
  });

  logger.info("portfolio", `Position CLOSED ${pos.symbol}`, {
    id: positionId,
    reason,
    exit: result.executedPriceUsd,
    pnlUsd: pnlUsd.toFixed(2),
    pnlPct: pnlPct.toFixed(2),
  });

  return {
    id: updated.id,
    symbol: updated.symbol,
    source: updated.source as "cex" | "dex",
    chain: updated.chain,
    tokenId: updated.tokenId,
    status: updated.status as "open" | "closed" | "liquidated" | "killed",
    entryPriceUsd: updated.entryPriceUsd,
    entryAmountUsd: updated.entryAmountUsd,
    entryQty: updated.entryQty,
    entryAt: updated.entryAt.toISOString(),
    exitPriceUsd: updated.exitPriceUsd,
    exitAmountUsd: updated.exitAmountUsd,
    exitAt: updated.exitAt?.toISOString() ?? null,
    exitReason: updated.exitReason as ExitReason | null,
    pnlUsd: updated.pnlUsd,
    pnlPct: updated.pnlPct,
    takeProfitPrice: updated.takeProfitPrice,
    stopLossPrice: updated.stopLossPrice,
    maxExitAt: updated.maxExitAt.toISOString(),
    scamScore: updated.scamScore,
    scamBreakdown: updated.scamBreakdown,
    roundId: updated.roundId,
  };
}

// ---------------------------------------------------------------------------
// Round rebalance — split profit, move reserve.
// Called once a round has zero open positions.
// ---------------------------------------------------------------------------

export async function rebalanceRound(
  cfg: EngineConfig,
  roundId: number
): Promise<{ profitUsd: number; reserveCutUsd: number; reinvestCutUsd: number }> {
  // Sum realized PnL for this round's closed positions
  const positions = await db.position.findMany({
    where: { roundId, status: { in: ["closed", "liquidated", "killed"] } },
    select: { pnlUsd: true },
  });
  const roundPnl = positions.reduce((s, p) => s + (p.pnlUsd ?? 0), 0);

  if (roundPnl <= 0) {
    logger.info("portfolio", `Round ${roundId} sem lucro (PnL ${roundPnl.toFixed(2)}) — sem split`);
    return { profitUsd: roundPnl, reserveCutUsd: 0, reinvestCutUsd: 0 };
  }

  const reserveCut = (roundPnl * cfg.reservePct) / 100;
  const reinvestCut = (roundPnl * cfg.reinvestPct) / 100;

  // Move reserve cut from trading balance to reserve.
  // (Cash already sits in trading balance because sells credited it there.)
  if (reserveCut > 0) {
    await db.$transaction([
      db.tradingBalance.update({
        where: { id: "singleton" },
        data: {
          balanceUsd: { decrement: reserveCut },
        },
      }),
      db.reserve.update({
        where: { id: "singleton" },
        data: {
          balanceUsd: { increment: reserveCut },
          totalDepositedUsd: { increment: reserveCut },
        },
      }),
    ]);
    logger.info("portfolio", `Reserva += $${reserveCut.toFixed(2)} (cold storage USDC)`);
  }

  // Update round record
  await db.round.update({
    where: { id: roundId },
    data: {
      endedAt: new Date(),
      roundPnlUsd: roundPnl,
      status: "completed",
    },
  });

  logger.info("portfolio", `Round ${roundId} rebalanceado`, {
    roundPnl: roundPnl.toFixed(2),
    reserveCut: reserveCut.toFixed(2),
    reinvestCut: reinvestCut.toFixed(2),
  });

  return { profitUsd: roundPnl, reserveCutUsd: reserveCut, reinvestCutUsd: reinvestCut };
}

// ---------------------------------------------------------------------------
// Manual reserve withdrawal (only way money leaves cold reserve)
// ---------------------------------------------------------------------------

export async function withdrawReserve(amountUsd: number): Promise<boolean> {
  if (amountUsd <= 0) return false;
  const reserve = await db.reserve.findUnique({ where: { id: "singleton" } });
  if (!reserve || reserve.balanceUsd < amountUsd) {
    logger.warn("portfolio", `Reserva insuficiente para saque $${amountUsd}`);
    return false;
  }
  await db.reserve.update({
    where: { id: "singleton" },
    data: {
      balanceUsd: { decrement: amountUsd },
      totalWithdrawnUsd: { increment: amountUsd },
    },
  });
  logger.warn("portfolio", `SAQUE MANUAL de reserva: $${amountUsd}`);
  return true;
}
