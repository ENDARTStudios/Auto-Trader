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
import { recordFeeAuditLog } from "./fee-model";
import { finalizeRoundPnl } from "./engine-correctness";
import { withSystemRls } from "@/lib/auth/rls-context";
import { recordPaperOrder, transitionPaperOrder } from "./paper-order-store";
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
// System owner — Position.ownerId is NOT NULL (S05 strict RLS). The engine is a
// system actor, so every position/query it owns is attributed to the super_admin
// user (there is no nullable "system" owner column). Cached briefly to avoid a
// user lookup on every query.
// ---------------------------------------------------------------------------

let cachedSystemOwnerId: { id: string; at: number } | null = null;
const SYSTEM_OWNER_TTL_MS = 60_000;

export async function getSystemOwnerId(): Promise<string | null> {
  if (cachedSystemOwnerId && Date.now() - cachedSystemOwnerId.at < SYSTEM_OWNER_TTL_MS) {
    return cachedSystemOwnerId.id;
  }
  const admin = await db.user.findFirst({
    where: { role: "super_admin" },
    select: { id: true },
  });
  if (!admin) return null;
  cachedSystemOwnerId = { id: admin.id, at: Date.now() };
  return admin.id;
}

/** Where-clause fragment that scopes engine queries to the system owner. */
export function systemOwnerScope(ownerId: string | null): { ownerId?: string } {
  return ownerId ? { ownerId } : {};
}

// ---------------------------------------------------------------------------
// Open position
// ---------------------------------------------------------------------------

export async function openPosition(
  cfg: EngineConfig,
  candidate: TokenCandidate,
  amountUsd: number,
  scamReport: ScamReportData,
  roundId: number,
  ownerId?: string | null,
  strategy = "day",
): Promise<PositionRow | null> {
  // Execute buy — real fee + slippage from config (net qty / net cash).
  const isLive = cfg.mode === "live" && cfg.graduatedToLive;
  const executionOpts = { feeBps: cfg.feeBps, slippageBps: cfg.slippageBps };
  const result: ExecutionResult = isLive
    ? await liveBuy(cfg, candidate, amountUsd)
    : await paperBuy(candidate, amountUsd, executionOpts);

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

  // Resolve ownerId — for S05 strict RLS, Position.ownerId is NOT NULL.
  // Explicit attribution: caller (engine) passes the system owner; otherwise
  // resolve the super_admin.
  let resolvedOwnerId = ownerId ?? null;
  if (!resolvedOwnerId) {
    resolvedOwnerId = await getSystemOwnerId();
  }
  if (!resolvedOwnerId) {
    logger.error("portfolio", "openPosition without ownerId and no super_admin found — abort");
    return null;
  }

  // RLS (prep round 7): Position será STRICT na round 8 — o engine é SISTEMA,
  // então toda query de posição roda em contexto explícito de bypass.
  const position = await withSystemRls((tx) =>
    tx.position.create({
      data: {
        ownerId: resolvedOwnerId,
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
        strategy,
        roundId,
      },
    })
  );

  // Persist the fee audit trail (this is what makes /api/fees non-zero).
  if (result.breakdown) {
    await recordFeeAuditLog(position.id, candidate.symbol, "buy", result.breakdown, {
      strategy,
      exchange: candidate.platformId ?? candidate.source,
      executedPriceUsd: result.executedPriceUsd,
      qty: result.qty,
    });
  }

  // Bump counters
  await db.tradingBalance.update({
    where: { id: "singleton" },
    data: { tradesOpened: { increment: 1 } },
  });

  await recordPaperOrder({
    positionId: position.id,
    symbol: candidate.symbol,
    priceUsd: result.executedPriceUsd,
    qty: result.qty,
    amountUsd: result.amountUsd,
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
  const pos = await withSystemRls((tx) =>
    tx.position.findUnique({ where: { id: positionId } })
  );
  if (!pos || pos.status !== "open") return null;

  const isLive = cfg.mode === "live" && cfg.graduatedToLive;
  const result: ExecutionResult = isLive
    ? await liveSell(
        cfg,
        {
          symbol: pos.symbol,
          source: pos.source as "cex" | "dex",
          chain: pos.chain,
          tokenId: pos.tokenId,
          qty: pos.entryQty,
        },
        currentPriceUsd
      )
    : await paperSell(pos.symbol, pos.entryQty, currentPriceUsd, {
        feeBps: cfg.feeBps,
        slippageBps: cfg.slippageBps,
      });

  if (!result.ok) {
    logger.error("portfolio", `Sell falhou para ${pos.symbol}`, {
      error: result.error,
    });
    return null;
  }

  const exitAmount = result.amountUsd;
  const pnlUsd = exitAmount - pos.entryAmountUsd;
  const pnlPct = (pnlUsd / pos.entryAmountUsd) * 100;

  const updated = await withSystemRls((tx) =>
    tx.position.update({
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
    })
  );

  // Persist the sell-leg fee audit trail.
  if (result.breakdown) {
    await recordFeeAuditLog(pos.id, pos.symbol, "sell", result.breakdown, {
      strategy: pos.strategy,
      exchange: pos.source,
      executedPriceUsd: result.executedPriceUsd,
      qty: result.qty,
    });
  }

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

  await transitionPaperOrder(
    positionId,
    reason === "kill_switch" ? "cancel" : "settle",
    reason === "kill_switch" ? "kill switch: encerrada sem liquidação" : `saída: ${reason}`
  );

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
  // Sum realized PnL for this round's closed positions and compute the split.
  // finalizeRoundPnl is pure + always returns a result: losing and break-even
  // rounds are valid outcomes, not early returns.
  const positions = await withSystemRls((tx) =>
    tx.position.findMany({
      where: { roundId, status: { in: ["closed", "liquidated", "killed"] } },
      select: { pnlUsd: true },
    })
  );
  const finalization = finalizeRoundPnl(
    positions.map((p) => p.pnlUsd),
    cfg.reservePct,
    cfg.reinvestPct
  );
  const { roundPnlUsd: roundPnl, reserveCutUsd: reserveCut, reinvestCutUsd: reinvestCut } =
    finalization;

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

  // ALWAYS finalize the round record — including PnL <= 0. updateMany keeps
  // this idempotent if the round was already completed by another tick.
  await db.round.updateMany({
    where: { id: roundId },
    data: {
      endedAt: new Date(),
      roundPnlUsd: roundPnl,
      positionsClosed: finalization.positionCount,
      status: "completed",
    },
  });

  logger.info(
    "portfolio",
    finalization.profitable
      ? `Round ${roundId} rebalanceado (lucro)`
      : `Round ${roundId} finalizado sem lucro (PnL ${roundPnl.toFixed(2)}) — sem split`,
    {
      roundPnl: roundPnl.toFixed(2),
      reserveCut: reserveCut.toFixed(2),
      reinvestCut: reinvestCut.toFixed(2),
      positions: finalization.positionCount,
    }
  );

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
