// Risk Scaling — dynamic position size adjustment based on win rate.
//
// v16: The user spec says: "Deve escalar o processo conforme taxa de sucesso."
// ("Scale the process according to success rate.")
//
// We translate this into a 5-band position-size multiplier:
//
//   Win rate band     Multiplier   Meaning
//   --------------------------------------------------------------
//   0%  - 33%         0.50x        Engine is struggling — halve exposure
//   33% - 50%         0.75x        Cautious regime
//   50% - 65%         1.00x        Baseline (neutral)
//   65% - 80%         1.25x        Scale up — momentum
//   80% - 100%        1.50x        Max leverage on success streak
//
// The multiplier applies to the per-token allocation computed by the engine
// (roundAllocation / maxPositions). It does NOT bypass the per-token cap
// (maxExposurePerTokenPct) — that's a hard ceiling that always applies.
//
// Rationale: a bot that's winning most of its trades should be allocating
// more capital per trade (within risk limits). A bot that's losing should
// shrink positions until it proves it can win again. This is the
// "anti-martingale" approach — increase bets when winning, decrease when
// losing — which is mathematically superior to martingale for sustained
// capital growth.

import { db } from "@/lib/db";
import { logger } from "./logger";

export interface RiskScaleBand {
  minWinRate: number; // inclusive
  maxWinRate: number; // exclusive (except last band)
  multiplier: number;
  label: string;
  description: string;
}

export const RISK_SCALE_BANDS: RiskScaleBand[] = [
  {
    minWinRate: 0,
    maxWinRate: 33,
    multiplier: 0.5,
    label: "Defensive",
    description: "Win rate < 33% — halve exposure until engine recovers",
  },
  {
    minWinRate: 33,
    maxWinRate: 50,
    multiplier: 0.75,
    label: "Cautious",
    description: "Win rate 33-50% — reduced exposure, rebuild confidence",
  },
  {
    minWinRate: 50,
    maxWinRate: 65,
    multiplier: 1.0,
    label: "Baseline",
    description: "Win rate 50-65% — standard allocation",
  },
  {
    minWinRate: 65,
    maxWinRate: 80,
    multiplier: 1.25,
    label: "Aggressive",
    description: "Win rate 65-80% — scale up, momentum is real",
  },
  {
    minWinRate: 80,
    maxWinRate: 101,
    multiplier: 1.5,
    label: "Maximum",
    description: "Win rate > 80% — max leverage allowed by caps",
  },
];

export interface RiskScaleAssessment {
  winRate: number;
  tradesClosed: number;
  band: RiskScaleBand;
  multiplier: number;
  // Applied amount after multiplier
  scaledAmountUsd: number;
  // Original amount before scaling
  baseAmountUsd: number;
  // Whether scaling was applied (false if disabled or insufficient data)
  applied: boolean;
  reason: string;
}

/**
 * Assess the current win rate and return the appropriate position-size
 * multiplier. Returns 1.0 (no scaling) if:
 *   - riskScaleEnabled is false
 *   - fewer than MIN_TRADES_FOR_SCALING closed trades (not enough data)
 *
 * @param baseAmountUsd  The per-token allocation computed by the engine
 *                       (roundAllocation / maxPositions), already capped by
 *                       maxExposurePerTokenPct.
 * @param riskScaleEnabled  Whether the operator has enabled scaling.
 */
export async function assessRiskScale(
  baseAmountUsd: number,
  riskScaleEnabled: boolean
): Promise<RiskScaleAssessment> {
  const MIN_TRADES_FOR_SCALING = 10;

  const tb = await db.tradingBalance.findUnique({ where: { id: "singleton" } });
  const tradesClosed = tb?.tradesClosed ?? 0;
  const wins = tb?.wins ?? 0;
  const winRate = tradesClosed > 0 ? (wins / tradesClosed) * 100 : 0;

  if (!riskScaleEnabled) {
    return {
      winRate,
      tradesClosed,
      band: RISK_SCALE_BANDS[2], // baseline
      multiplier: 1.0,
      scaledAmountUsd: baseAmountUsd,
      baseAmountUsd,
      applied: false,
      reason: "Risk scaling disabled in config",
    };
  }

  if (tradesClosed < MIN_TRADES_FOR_SCALING) {
    return {
      winRate,
      tradesClosed,
      band: RISK_SCALE_BANDS[2], // baseline
      multiplier: 1.0,
      scaledAmountUsd: baseAmountUsd,
      baseAmountUsd,
      applied: false,
      reason: `Insufficient data (${tradesClosed}/${MIN_TRADES_FOR_SCALING} trades) — baseline until ${MIN_TRADES_FOR_SCALING} closed`,
    };
  }

  // Find the matching band
  const band =
    RISK_SCALE_BANDS.find(
      (b) => winRate >= b.minWinRate && winRate < b.maxWinRate
    ) ?? RISK_SCALE_BANDS[RISK_SCALE_BANDS.length - 1];

  const scaledAmountUsd = baseAmountUsd * band.multiplier;

  logger.info("risk", `Risk scale: ${winRate.toFixed(1)}% win rate → ${band.multiplier}x (${band.label})`, {
    tradesClosed,
    wins,
    baseAmountUsd,
    scaledAmountUsd,
  });

  return {
    winRate,
    tradesClosed,
    band,
    multiplier: band.multiplier,
    scaledAmountUsd,
    baseAmountUsd,
    applied: true,
    reason: `Win rate ${winRate.toFixed(1)}% → band "${band.label}" (${band.multiplier}x)`,
  };
}

/**
 * Get the current risk scale assessment without applying it to a specific
 * amount. Used by the dashboard to display the current band.
 */
export async function getCurrentRiskScale(): Promise<{
  winRate: number;
  tradesClosed: number;
  band: RiskScaleBand;
  multiplier: number;
  applied: boolean;
  reason: string;
}> {
  const assessment = await assessRiskScale(0, true);
  return {
    winRate: assessment.winRate,
    tradesClosed: assessment.tradesClosed,
    band: assessment.band,
    multiplier: assessment.multiplier,
    applied: assessment.applied,
    reason: assessment.reason,
  };
}
