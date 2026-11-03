// Engine correctness helpers — pure decision logic extracted from the engine
// loop so it can be unit-tested without a database, network, or timers.
//
// Everything in this module is deterministic:
//   - validateEntryPrice    — price consistency gate (stale candidate price bug)
//   - decideMechanicalExit  — TP/SL/timeout, including timeout WITHOUT a price
//   - finalizeRoundPnl      — round P&L split that always finalizes
//   - error classifiers     — MARKET_DATA_UNAVAILABLE / AI_UNAVAILABLE
//   - dataQuality gate      — DEX only trades on 'live' market data
//
// The engine (engine.ts) and portfolio (portfolio.ts) own the I/O; they delegate
// the decisions below so a behavioural regression fails a test instead of
// silently spending capital.

// ---------------------------------------------------------------------------
// Entry price consistency
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_ENTRY_DEVIATION_PCT = 2.0;

/** Maximum tolerated deviation (%) between the candidate's discovery price and
 *  the live price fetched right before opening. Env: MAX_ENTRY_DEVIATION_PCT. */
export function getMaxEntryDeviationPct(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.MAX_ENTRY_DEVIATION_PCT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_ENTRY_DEVIATION_PCT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_ENTRY_DEVIATION_PCT;
  return parsed;
}

export type EntryPriceRejection =
  | "no_price"
  | "invalid_candidate_price"
  | "deviation"
  | null;

export interface EntryPriceValidation {
  ok: boolean;
  /** Price to use as the entry mid — always the freshly fetched price. */
  entryPriceUsd: number;
  /** Absolute deviation vs the candidate price, in %. */
  deviationPct: number | null;
  reason: EntryPriceRejection;
  maxDeviationPct: number;
}

/**
 * Reject a candidate when the live fetched price diverges from the price the
 * candidate was discovered at. This is the guard for the LIT/USDT incident:
 * a -77% "move" in 13s was a stale/incorrect reference price, and the engine
 * entered anyway. Also rejects when no live price is available at all — never
 * open a position on an unverified price.
 */
export function validateEntryPrice(
  candidatePriceUsd: number,
  fetchedPriceUsd: number,
  maxDeviationPct: number = getMaxEntryDeviationPct()
): EntryPriceValidation {
  const max =
    Number.isFinite(maxDeviationPct) && maxDeviationPct >= 0
      ? maxDeviationPct
      : DEFAULT_MAX_ENTRY_DEVIATION_PCT;

  if (!Number.isFinite(fetchedPriceUsd) || fetchedPriceUsd <= 0) {
    return {
      ok: false,
      entryPriceUsd: 0,
      deviationPct: null,
      reason: "no_price",
      maxDeviationPct: max,
    };
  }
  if (!Number.isFinite(candidatePriceUsd) || candidatePriceUsd <= 0) {
    return {
      ok: false,
      entryPriceUsd: fetchedPriceUsd,
      deviationPct: null,
      reason: "invalid_candidate_price",
      maxDeviationPct: max,
    };
  }
  const deviationPct =
    (Math.abs(fetchedPriceUsd - candidatePriceUsd) / candidatePriceUsd) * 100;

  if (deviationPct > max) {
    return {
      ok: false,
      entryPriceUsd: fetchedPriceUsd,
      deviationPct,
      reason: "deviation",
      maxDeviationPct: max,
    };
  }
  return {
    ok: true,
    entryPriceUsd: fetchedPriceUsd,
    deviationPct,
    reason: null,
    maxDeviationPct: max,
  };
}

// ---------------------------------------------------------------------------
// Mechanical exits (TP / SL / timeout), including the unpriced timeout
// ---------------------------------------------------------------------------

export type MechanicalExitAction = "take_profit" | "stop_loss" | "timeout" | "none";

export interface MechanicalExitDecision {
  action: MechanicalExitAction;
  /** Price to close at. Falls back to entryPriceUsd when no market price. */
  exitPriceUsd: number;
  /** false => no market price; the close is a bookkeeping fallback (entry price). */
  priced: boolean;
}

export interface MechanicalExitPosition {
  entryPriceUsd: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  maxExitAt: Date;
}

/**
 * Decide a mechanical exit for an open position.
 *
 * Bug being fixed: an unpriced position (price <= 0) used to be skipped
 * forever, so positions without a feed stayed open past maxHoldMinutes and
 * locked capital. Now: when the timeout is reached we close at entryPrice
 * (best available reference) and report priced=false so the caller logs a
 * risk event instead of pretending it was a market exit.
 */
export function decideMechanicalExit(
  position: MechanicalExitPosition,
  priceUsd: number,
  now: Date
): MechanicalExitDecision {
  const priced = Number.isFinite(priceUsd) && priceUsd > 0;
  const timedOut =
    Number.isFinite(position.maxExitAt.getTime()) && now.getTime() >= position.maxExitAt.getTime();

  if (priced) {
    if (priceUsd >= position.takeProfitPrice) {
      return { action: "take_profit", exitPriceUsd: priceUsd, priced: true };
    }
    if (priceUsd <= position.stopLossPrice) {
      return { action: "stop_loss", exitPriceUsd: priceUsd, priced: true };
    }
    if (timedOut) {
      return { action: "timeout", exitPriceUsd: priceUsd, priced: true };
    }
    return { action: "none", exitPriceUsd: 0, priced: true };
  }

  if (timedOut) {
    return { action: "timeout", exitPriceUsd: position.entryPriceUsd, priced: false };
  }
  return { action: "none", exitPriceUsd: 0, priced: false };
}

// ---------------------------------------------------------------------------
// Round finalization
// ---------------------------------------------------------------------------

export interface RoundPnlFinalization {
  roundPnlUsd: number;
  profitable: boolean;
  reserveCutUsd: number;
  reinvestCutUsd: number;
  positionCount: number;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

/**
 * Aggregate a round's realized P&L and compute the profit split.
 *
 * Contract: a round is ALWAYS finalizable. Losing/break-even rounds produce
 * zero reserve/reinvest cuts and a negative (or zero) P&L — they are not an
 * error and must still be written back (status completed, endedAt, pnl).
 */
export function finalizeRoundPnl(
  pnls: Array<number | null | undefined>,
  reservePct: number,
  reinvestPct: number
): RoundPnlFinalization {
  const values = pnls.filter(
    (p): p is number => typeof p === "number" && Number.isFinite(p)
  );
  const roundPnlUsd = values.reduce((sum, p) => sum + p, 0);
  const profitable = roundPnlUsd > 0;
  return {
    roundPnlUsd,
    profitable,
    reserveCutUsd: profitable ? (roundPnlUsd * clampPct(reservePct)) / 100 : 0,
    reinvestCutUsd: profitable ? (roundPnlUsd * clampPct(reinvestPct)) / 100 : 0,
    positionCount: values.length,
  };
}

/** A round record is only created when at least one position can actually be
 *  opened. Zero executable candidates => NO_TRADE, no empty running round. */
export function shouldCreateRound(executableCandidates: number): boolean {
  return Number.isFinite(executableCandidates) && executableCandidates > 0;
}

// ---------------------------------------------------------------------------
// External failure classifiers (contracts owned by the data/AI layer)
// ---------------------------------------------------------------------------

function readErrorField(err: unknown, key: "code" | "name"): string | null {
  if (!err || typeof err !== "object") return null;
  const value = (err as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export const AI_UNAVAILABLE_CODE = "AI_UNAVAILABLE";
export const MARKET_DATA_UNAVAILABLE_CODE = "MARKET_DATA_UNAVAILABLE";

/**
 * AI provider unavailable (no key / provider down). This is a FEATURE-OFF
 * condition, not a trade veto: log once and continue without AI. It must never
 * fabricate an "investigate" consensus — the squad simply does not run.
 */
export function isAiUnavailableError(err: unknown): boolean {
  return (
    readErrorField(err, "code") === AI_UNAVAILABLE_CODE ||
    readErrorField(err, "name") === "AIUnavailableError"
  );
}

/** Market data could not be fetched honestly. Skip the candidate (NO_TRADE). */
export function isMarketDataUnavailableError(err: unknown): boolean {
  return (
    readErrorField(err, "code") === MARKET_DATA_UNAVAILABLE_CODE ||
    readErrorField(err, "name") === "MarketDataUnavailableError"
  );
}

export interface AiSquadOutcome {
  /** true => reject the candidate (consensus "avoid" with high confidence). */
  veto: boolean;
  /** true => log "investigate" but keep going (does NOT veto). */
  investigate: boolean;
  /** true => AI feature is off for this tick; NOT a veto. */
  aiUnavailable: boolean;
  consensus: string | null;
  confidence: number;
}

/**
 * Interpret the AI squad result. AI is advisory: only an explicit "avoid" with
 * confidence >= 70% vetoes. An unavailable provider (AI_UNAVAILABLE) means the
 * feature is OFF — it must not veto and must not be recorded as "investigate".
 */
export function evaluateAiSquadOutcome(
  input:
    | { ok: true; consensus: string; consensusConfidence: number }
    | { ok: false; error: unknown }
): AiSquadOutcome {
  if (!input.ok) {
    return {
      veto: false,
      investigate: false,
      aiUnavailable: isAiUnavailableError(input.error),
      consensus: null,
      confidence: 0,
    };
  }
  const confidence = Number.isFinite(input.consensusConfidence)
    ? input.consensusConfidence
    : 0;
  return {
    veto: input.consensus === "avoid" && confidence >= 70,
    investigate: input.consensus === "investigate",
    aiUnavailable: false,
    consensus: input.consensus,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Data-quality gate
// ---------------------------------------------------------------------------

/** Reads market.dataQuality structurally so the engine compiles against both
 *  the old and the new MarketSignal contract (field is owned by the data layer). */
export function readMarketDataQuality(market: unknown): string | null {
  if (!market || typeof market !== "object") return null;
  const quality = (market as { dataQuality?: unknown }).dataQuality;
  return typeof quality === "string" ? quality : null;
}

export interface DataQualityGate {
  skip: boolean;
  dataQuality: string | null;
  reason: string | null;
}

/**
 * DEX candidates may only be traded when the market data is actually live.
 * Anything else (stale/degraded/unavailable/missing field) is NO_TRADE — a
 * neutral signal built on bad data is worse than not trading.
 */
export function evaluateDataQualityGate(
  source: "cex" | "dex" | string,
  market: unknown
): DataQualityGate {
  if (source !== "dex") {
    return { skip: false, dataQuality: readMarketDataQuality(market), reason: null };
  }
  const dataQuality = readMarketDataQuality(market);
  if (dataQuality === "live") {
    return { skip: false, dataQuality, reason: null };
  }
  return {
    skip: true,
    dataQuality,
    reason: dataQuality === null ? "data_quality_missing" : "data_quality_" + dataQuality,
  };
}
