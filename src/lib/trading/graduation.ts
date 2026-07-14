// Graduation — paper-to-live promotion evaluator.
//
// v14 reform: the old `paperCyclesPassed` counter was a bug-as-designed —
// 49 losing rounds + 1 big positive outlier would graduate the bot.
//
// New criteria (all must hold over the rolling window of last N attempts):
//   1. Win rate >= 60%         (3 out of 5 last attempts profitable)
//   2. Max drawdown within window <= 5% of trading balance at start of window
//   3. Cumulative P&L within window > 0
//   4. No single attempt with loss > maxLossPerTradePct × 2  (catastrophic outlier)
//
// Window size default = 20 attempts. If fewer than WINDOW_SIZE attempts exist,
// the bot is NOT eligible — the window must be full to evaluate.
//
// Each criterion returns { value, threshold, satisfied }. The UI shows the
// current window so the operator can see exactly what's missing.

import { db } from "@/lib/db";
import { logger } from "./logger";

export const WINDOW_SIZE = 20;
export const MIN_WIN_RATE_PCT = 60;
export const MAX_WINDOW_DRAWDOWN_PCT = 5;
export const MAX_SINGLE_LOSS_MULTIPLIER = 2; // × maxLossPerTradePct

export interface GraduationCriterion {
  label: string;
  value: string;
  threshold: string;
  satisfied: boolean;
  detail?: string;
}

export interface GraduationEvaluation {
  windowSize: number;
  attemptsUsed: number;
  eligible: boolean;                  // true if window is full AND all criteria met
  windowFull: boolean;
  criteria: GraduationCriterion[];
  attempts: Array<{
    roundId: number;
    pnlUsd: number;
    profitable: boolean;
    completedAt: string;
  }>;
  graduatedToLive: boolean;
  paperCyclesPassed: number;          // legacy counter (kept for audit)
  paperCyclesRequired: number;
}

export async function evaluateGraduation(): Promise<GraduationEvaluation> {
  const cfg = await db.config.findUnique({ where: { id: "singleton" } });
  if (!cfg) {
    throw new Error("Config não encontrada");
  }
  const tb = await db.tradingBalance.findUnique({ where: { id: "singleton" } });

  // Fetch last WINDOW_SIZE+1 attempts (we need +1 to compute drawdown against the
  // balance at the START of the window, which equals the balance AFTER the
  // (WINDOW_SIZE+1)th-from-last attempt — but we approximate by using current
  // balance minus cumulative P&L of the window).
  const attempts = await db.paperCycleAttempt.findMany({
    orderBy: { completedAt: "desc" },
    take: WINDOW_SIZE,
  });
  // Reverse to chronological for cumulative/drawdown computation
  const chrono = attempts.slice().reverse();

  const windowFull = chrono.length >= WINDOW_SIZE;

  // Criterion 1: win rate >= 60%
  const wins = chrono.filter((a) => a.profitable).length;
  const winRatePct = chrono.length > 0 ? (wins / chrono.length) * 100 : 0;
  const c1: GraduationCriterion = {
    label: "Win rate na janela",
    value: `${winRatePct.toFixed(1)}% (${wins}/${chrono.length})`,
    threshold: `>= ${MIN_WIN_RATE_PCT}%`,
    satisfied: winRatePct >= MIN_WIN_RATE_PCT,
  };

  // Criterion 2: max drawdown within window <= 5%
  // Compute equity curve starting from "balance at start of window" (approx:
  // current trading balance minus cumulative pnl of window). Track peak and
  // max drawdown % relative to that peak.
  const currentBalance = tb?.balanceUsd ?? cfg.initialCapitalUsd;
  const cumulativePnl = chrono.reduce((s, a) => s + a.pnlUsd, 0);
  const startBalance = currentBalance - cumulativePnl;
  let equity = startBalance;
  let peak = equity;
  let maxDrawdownPct = 0;
  for (const a of chrono) {
    equity += a.pnlUsd;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }
  const c2: GraduationCriterion = {
    label: "Drawdown máx na janela",
    value: `${maxDrawdownPct.toFixed(2)}%`,
    threshold: `<= ${MAX_WINDOW_DRAWDOWN_PCT}%`,
    satisfied: maxDrawdownPct <= MAX_WINDOW_DRAWDOWN_PCT,
  };

  // Criterion 3: cumulative P&L > 0
  const c3: GraduationCriterion = {
    label: "P&L cumulativo na janela",
    value: `$${cumulativePnl.toFixed(2)}`,
    threshold: "> $0",
    satisfied: cumulativePnl > 0,
  };

  // Criterion 4: no single attempt with loss > maxLossPerTradePct × 2
  // Approximate: per-attempt loss as % of trading balance at that time.
  // We use currentBalance as proxy for "balance at time of attempt" since
  // we don't snapshot balance per attempt.
  const maxSingleLossThreshold = cfg.maxLossPerTradePct * MAX_SINGLE_LOSS_MULTIPLIER;
  let worstSingleLossPct = 0;
  let worstRoundId: number | null = null;
  for (const a of chrono) {
    if (a.pnlUsd < 0 && currentBalance > 0) {
      const lossPct = (Math.abs(a.pnlUsd) / currentBalance) * 100;
      if (lossPct > worstSingleLossPct) {
        worstSingleLossPct = lossPct;
        worstRoundId = a.roundId;
      }
    }
  }
  const c4: GraduationCriterion = {
    label: `Perda single máx (limite: ${maxSingleLossThreshold.toFixed(1)}% = ${MAX_SINGLE_LOSS_MULTIPLIER}× maxLossPerTrade)`,
    value: `${worstSingleLossPct.toFixed(2)}%${worstRoundId !== null ? ` (round #${worstRoundId})` : ""}`,
    threshold: `<= ${maxSingleLossThreshold.toFixed(1)}%`,
    satisfied: worstSingleLossPct <= maxSingleLossThreshold,
  };

  const allSatisfied = c1.satisfied && c2.satisfied && c3.satisfied && c4.satisfied;
  const eligible = windowFull && allSatisfied;

  return {
    windowSize: WINDOW_SIZE,
    attemptsUsed: chrono.length,
    eligible,
    windowFull,
    criteria: [c1, c2, c3, c4],
    attempts: chrono.map((a) => ({
      roundId: a.roundId,
      pnlUsd: a.pnlUsd,
      profitable: a.profitable,
      completedAt: a.completedAt.toISOString(),
    })),
    graduatedToLive: cfg.graduatedToLive,
    paperCyclesPassed: cfg.paperCyclesPassed,
    paperCyclesRequired: cfg.paperCyclesRequired,
  };
}

// Insert a new attempt when a paper-mode round completes. Called from engine
// after rebalanceRound. Also bumps the legacy paperCyclesPassed counter for
// backward-compat in the existing UI.
export async function recordPaperCycleAttempt(
  roundId: number,
  pnlUsd: number,
  meta: { tokensScanned: number; positionsOpened: number; positionsClosed: number }
): Promise<void> {
  try {
    await db.paperCycleAttempt.create({
      data: {
        roundId,
        pnlUsd,
        tokensScanned: meta.tokensScanned,
        positionsOpened: meta.positionsOpened,
        positionsClosed: meta.positionsClosed,
        profitable: pnlUsd > 0,
      },
    });
    // Legacy counter
    if (pnlUsd > 0) {
      await db.config.update({
        where: { id: "singleton" },
        data: { paperCyclesPassed: { increment: 1 } },
      });
    }
    logger.info(
      "engine",
      `PaperCycleAttempt registrado: round #${roundId} pnl=$${pnlUsd.toFixed(2)} (${pnlUsd > 0 ? "WIN" : "LOSS"})`
    );
  } catch (err) {
    logger.error("engine", `Erro registrando PaperCycleAttempt: ${String(err)}`);
  }
}
