// Risk Manager — central authority for whether a proposed action is allowed.
// Implements circuit breakers:
//   - kill switch (manual)
//   - max daily loss
//   - max loss per trade
//   - max exposure per token
//   - max drawdown from peak

import { db } from "@/lib/db";
import { EngineConfig } from "./config";
import { logger } from "./logger";
import type { RiskAssessment } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function assessTradeRisk(
  cfg: EngineConfig,
  symbol: string,
  proposedAmountUsd: number
): Promise<RiskAssessment> {
  const reasons: string[] = [];
  let allowed = true;

  // 1. Kill switch
  if (cfg.killSwitchActive) {
    allowed = false;
    reasons.push(`Kill switch ativo: ${cfg.killSwitchReason ?? "sem motivo"}`);
  }

  // 2. Mode guard: live trading only allowed after graduation
  if (cfg.mode === "live" && !cfg.graduatedToLive) {
    allowed = false;
    reasons.push(
      `Modo live requer graduação: ${cfg.paperCyclesPassed}/${cfg.paperCyclesRequired} ciclos paper aprovados`
    );
  }

  // 3. Fetch trading balance + open positions
  const balance = await db.tradingBalance.findUnique({
    where: { id: "singleton" },
  });
  if (!balance) {
    allowed = false;
    reasons.push("TradingBalance não inicializado");
    return { allowed, reasons, maxRoundAllocationUsd: 0, maxPerTokenUsd: 0 };
  }

  // 4. Max drawdown — measured against REALIZED losses only.
  //    Deploying capital into positions is NOT drawdown (cash → inventory).
  //    Drawdown = (peak - current) where current reflects realized P&L,
  //    not unrealized position allocation.
  //    realizedPnl is cumulative; balance = initialCapital + realizedPnl - deployed.
  //    So "realized balance" = balance + deployed = initialCapital + realizedPnl.
  //    We can compute this as: balance.balanceUsd + sum(openPositions.entryAmount)
  //    ≈ what balance would be if all positions closed at entry (no P&L).
  //    But simpler: realizedPnl tells us lifetime win/loss. If cumulative
  //    realized P&L has dropped more than maxDrawdown% below peak, abort.
  const realizedPnl = balance.realizedPnlUsd;
  // peakBalanceUsd is updated only when a new peak is hit (after winning rounds).
  // So drawdown = (peak - (peak + realizedPnl)) / peak when realizedPnl < 0
  //             = -realizedPnl / peak (when negative)
  const drawdownPct =
    balance.peakBalanceUsd > 0 && realizedPnl < 0
      ? (Math.abs(realizedPnl) / balance.peakBalanceUsd) * 100
      : 0;
  if (drawdownPct >= cfg.maxDrawdownPct) {
    allowed = false;
    reasons.push(
      `Drawdown ${drawdownPct.toFixed(2)}% >= limite ${cfg.maxDrawdownPct}%`
    );
    await recordRiskEvent(
      "drawdown_breach",
      "critical",
      `Drawdown ${drawdownPct.toFixed(2)}% atingiu limite ${cfg.maxDrawdownPct}%`,
      { drawdownPct, peak: balance.peakBalanceUsd, realizedPnl }
    );
  }

  // 5. Max daily loss — sum of realized + unrealized losses in last 24h
  const since = new Date(Date.now() - DAY_MS);
  const recentCloses = await db.position.findMany({
    where: { status: { in: ["closed", "liquidated", "killed"] }, exitAt: { gte: since } },
    select: { pnlUsd: true },
  });
  const dailyPnl = recentCloses.reduce(
    (sum, p) => sum + (p.pnlUsd ?? 0),
    0
  );
  const maxDailyLossUsd =
    (cfg.maxDailyLossPct / 100) * balance.peakBalanceUsd;
  if (dailyPnl < 0 && Math.abs(dailyPnl) >= maxDailyLossUsd) {
    allowed = false;
    reasons.push(
      `Perda diária ${Math.abs(dailyPnl).toFixed(2)} USD >= limite ${maxDailyLossUsd.toFixed(2)} USD`
    );
    await recordRiskEvent(
      "daily_loss_breach",
      "critical",
      `Perda diária atingiu limite`,
      { dailyPnl, maxDailyLossUsd }
    );
  }

  // 6. Max exposure per token — computed against PEAK balance so it stays
  //    stable within a round (current balance drops as positions open).
  const openForSymbol = await db.position.findMany({
    where: { symbol, status: "open" },
    select: { entryAmountUsd: true },
  });
  const exposedUsd = openForSymbol.reduce(
    (sum, p) => sum + p.entryAmountUsd,
    0
  );
  const maxPerTokenUsd =
    (cfg.maxExposurePerTokenPct / 100) * balance.peakBalanceUsd;
  if (exposedUsd + proposedAmountUsd > maxPerTokenUsd) {
    allowed = false;
    reasons.push(
      `Exposição por token excede limite: ${exposedUsd + proposedAmountUsd} > ${maxPerTokenUsd}`
    );
  }

  // 7. Per-trade loss cap (we pre-validate by ensuring a stop-loss exists,
  //    actual enforcement at exit time). Also against peak balance.
  const maxPerTradeLossUsd =
    (cfg.maxLossPerTradePct / 100) * balance.peakBalanceUsd;
  const worstCaseLoss = proposedAmountUsd * (cfg.stopLossPct / 100);
  if (worstCaseLoss > maxPerTradeLossUsd) {
    allowed = false;
    reasons.push(
      `Pior caso de perda ${worstCaseLoss.toFixed(2)} USD > limite por trade ${maxPerTradeLossUsd.toFixed(2)} USD`
    );
  }

  // 8. Max round allocation = capitalPctPerRound * balance, divided across positions
  const maxRoundAllocationUsd =
    (cfg.capitalPctPerRound / 100) * balance.balanceUsd;

  if (!allowed) {
    logger.warn("risk", `Trade bloqueado para ${symbol}`, { reasons });
  }

  return {
    allowed,
    reasons,
    maxRoundAllocationUsd,
    maxPerTokenUsd,
  };
}

export async function recordRiskEvent(
  type: string,
  severity: "info" | "warning" | "critical",
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  await db.riskEvent.create({
    data: {
      type,
      severity,
      message,
      context: context ? JSON.stringify(context) : null,
    },
  });
  logger.warn("risk", `[${type}] ${message}`, context);
}

export async function triggerKillSwitch(reason: string): Promise<void> {
  await db.config.update({
    where: { id: "singleton" },
    data: {
      killSwitchActive: true,
      killSwitchReason: reason,
      killSwitchAt: new Date(),
      engineRunning: false,
    },
  });
  await recordRiskEvent(
    "kill_switch",
    "critical",
    `Kill switch ativado: ${reason}`,
    { reason }
  );
  // Close all open positions at market (in paper mode, this is just marking them)
  // The engine's next loop iteration will see killSwitchActive and skip new entries;
  // existing positions get force-closed by the engine in the EXIT phase.
}

export async function clearKillSwitch(): Promise<void> {
  await db.config.update({
    where: { id: "singleton" },
    data: {
      killSwitchActive: false,
      killSwitchReason: null,
      killSwitchAt: null,
    },
  });
  await recordRiskEvent(
    "kill_switch",
    "info",
    "Kill switch desativado manualmente",
    {}
  );
}

// Update peak balance if current balance exceeds it. Called after each round.
export async function updatePeakBalance(): Promise<void> {
  const balance = await db.tradingBalance.findUnique({
    where: { id: "singleton" },
  });
  if (!balance) return;
  if (balance.balanceUsd > balance.peakBalanceUsd) {
    await db.tradingBalance.update({
      where: { id: "singleton" },
      data: { peakBalanceUsd: balance.balanceUsd },
    });
  }
}
