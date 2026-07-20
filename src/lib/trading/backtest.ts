// Backtest engine — simulates the trading strategy over historical Binance
// klines to validate thresholds (TP/SL/RSI entry/exit) before live trading.
//
// Strategy simulated:
//   1. Fetch N days of historical candles (default 1h interval) per symbol
//   2. Walk forward candle-by-candle. At each candle:
//      - Compute RSI(14) on closes up to current bar
//      - If no open trade AND RSI < rsiEntryMax → open LONG at close
//      - For each open trade:
//          - If bar's high >= entry * (1 + TP) → exit at TP price (win)
//          - Else if bar's low <= entry * (1 - SL) → exit at SL price (loss)
//          - Else if bars held >= maxHoldBars → exit at close (timeout)
//          - Else if RSI >= rsiExitMin → exit at close (RSI overbought)
//   3. Track equity curve (cash + unrealized PnL of open trade)
//   4. Compute metrics: total trades, win rate, profit factor, max drawdown,
//      Sharpe ratio per trade, avg hold bars, best/worst trade
//
// Limitations:
//   - One trade at a time per symbol (no portfolio overlap)
//   - Only LONG positions (matches our paper-trading engine)
//   - No fees/slippage modeled (could add 0.1% per side later)
//   - Doesn't simulate scam/GoPlus filtering (historical tokens would need
//     historical GoPlus data we don't have)
//
// All data: Binance public REST klines (free, no auth).

import { db } from "@/lib/db";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BacktestParams {
  symbols: string[];        // e.g. ["BTC/USDT", "ETH/USDT"]
  interval: string;         // "1h" | "4h" | "1d" | "15m"
  periodDays: number;       // how many days of history to fetch
  initialCapitalUsd: number;
  perTradeUsd: number;      // fixed $ per trade (no compounding)
  takeProfitPct: number;    // 0.05 = 5%
  stopLossPct: number;      // 0.04 = 4%
  maxHoldBars: number;      // exit after N bars if no TP/SL hit
  rsiEntryMax: number;      // enter long if RSI(14) < this (e.g. 70)
  rsiExitMin: number;       // exit if RSI(14) > this (e.g. 75) — overbought
}

export interface BacktestTrade {
  symbol: string;
  entryBar: number;
  exitBar: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnlUsd: number;
  pnlPct: number;
  holdBars: number;
  reason: "take_profit" | "stop_loss" | "timeout" | "rsi_exit";
}

export interface BacktestMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;          // %
  profitFactor: number;     // sumWins / |sumLosses| (∞ if no losses)
  totalPnlUsd: number;
  totalPnlPct: number;      // % of initial capital
  maxDrawdownPct: number;
  sharpeRatio: number;      // per-trade Sharpe
  avgTradePnlUsd: number;
  avgHoldBars: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
}

export interface BacktestEquityPoint {
  bar: number;
  equityUsd: number;
  cashUsd: number;
  openTradeUnrealizedUsd: number;
}

export interface BacktestResult {
  params: BacktestParams;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  perSymbol: Array<{
    symbol: string;
    trades: number;
    wins: number;
    pnlUsd: number;
    winRate: number;
  }>;
  candlesLoaded: number;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Indicator math (re-implemented locally to avoid pulling market-analysis
// deps that fetch live data — backtest needs pure functions on raw arrays)
// ---------------------------------------------------------------------------
function rsi(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];
  const out: number[] = new Array(closes.length).fill(NaN);
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetch historical klines from Binance
// ---------------------------------------------------------------------------
interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
}

async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  limit: number
): Promise<Candle[]> {
  // symbol like "BTC/USDT" → "BTCUSDT"
  const bnSymbol = symbol.replace("/", "").toUpperCase();
  // Binance max limit per request is 1000. If we need more, we'd have to
  // paginate with endTime. For our use case (30-90 days of 1h candles =
  // 720-2160), we'll do up to 3 requests.
  const MAX_PER_REQ = 1000;
  const candles: Candle[] = [];
  let endTime: number | undefined = undefined;

  while (candles.length < limit) {
    const need = Math.min(MAX_PER_REQ, limit - candles.length);
    let url = `https://api.binance.com/api/v3/klines?symbol=${bnSymbol}&interval=${interval}&limit=${need}`;
    if (endTime !== undefined) {
      url += `&endTime=${endTime}`;
    }
    const resp = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      throw new Error(`Binance klines HTTP ${resp.status} for ${symbol}`);
    }
    const json = (await resp.json()) as unknown[][];
    if (!Array.isArray(json) || json.length === 0) break;
    const batch: Candle[] = json.map((k) => ({
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
      time: k[0] as number,
    }));
    // Prepend (since we're going backwards in time with endTime)
    candles.unshift(...batch);
    if (json.length < need) break; // no more data
    // Set endTime to the oldest candle's time - 1ms to avoid duplicates
    endTime = (json[0][0] as number) - 1;
  }
  return candles;
}

// Map interval string → number of bars per day (for periodDays → limit calc)
function barsPerDay(interval: string): number {
  switch (interval) {
    case "1m": return 1440;
    case "5m": return 288;
    case "15m": return 96;
    case "30m": return 48;
    case "1h": return 24;
    case "2h": return 12;
    case "4h": return 6;
    case "6h": return 4;
    case "8h": return 3;
    case "12h": return 2;
    case "1d": return 1;
    case "3d": return 1 / 3;
    case "1w": return 1 / 7;
    case "1M": return 1 / 30;
    default: return 24; // assume 1h
  }
}

// ---------------------------------------------------------------------------
// Core simulation types
// ---------------------------------------------------------------------------
interface OpenTrade {
  symbol: string;
  entryBar: number;
  entryPrice: number;
  qty: number;
}

// ---------------------------------------------------------------------------
// Run a backtest — fetches data, simulates, computes metrics, persists
// ---------------------------------------------------------------------------
export async function runBacktest(
  params: BacktestParams
): Promise<BacktestResult> {
  const startedAt = Date.now();
  logger.info("backtest", `Iniciando backtest`, {
    symbols: params.symbols,
    interval: params.interval,
    periodDays: params.periodDays,
  });

  // Create a pending record in DB so UI can show "running"
  const dbRow = await db.backtestResult.create({
    data: {
      symbols: JSON.stringify(params.symbols),
      interval: params.interval,
      periodDays: params.periodDays,
      initialCapitalUsd: params.initialCapitalUsd,
      perTradeUsd: params.perTradeUsd,
      takeProfitPct: params.takeProfitPct,
      stopLossPct: params.stopLossPct,
      maxHoldBars: params.maxHoldBars,
      rsiEntryMax: params.rsiEntryMax,
      rsiExitMin: params.rsiExitMin,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      profitFactor: 0,
      totalPnlUsd: 0,
      totalPnlPct: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      avgTradePnlUsd: 0,
      avgHoldBars: 0,
      bestTradeUsd: 0,
      worstTradeUsd: 0,
      equityCurve: "[]",
      tradesJson: "[]",
      status: "running",
    },
  });

  try {
    // Calculate total bars needed
    const barsNeeded = Math.ceil(params.periodDays * barsPerDay(params.interval));
    // Cap at 5000 to avoid hitting Binance rate limits
    const cappedBars = Math.min(barsNeeded, 5000);

    // Fetch candles for all symbols in parallel
    const fetchResults = await Promise.allSettled(
      params.symbols.map((s) => fetchBinanceKlines(s, params.interval, cappedBars))
    );

    const symbolCandles: Map<string, Candle[]> = new Map();
    let totalCandlesLoaded = 0;
    const fetchErrors: string[] = [];

    fetchResults.forEach((r, i) => {
      const sym = params.symbols[i];
      if (r.status === "fulfilled") {
        symbolCandles.set(sym, r.value);
        totalCandlesLoaded += r.value.length;
      } else {
        fetchErrors.push(`${sym}: ${String(r.reason)}`);
        logger.warn("backtest", `Falha ao buscar klines para ${sym}`, {
          error: String(r.reason),
        });
      }
    });

    if (symbolCandles.size === 0) {
      throw new Error(`Nenhum candle carregado. Erros: ${fetchErrors.join("; ")}`);
    }

    // Find the longest candle array — we'll walk through all symbols in
    // parallel, bar by bar, with shared cash. This is more realistic than
    // sequential per-symbol because in live trading we'd have multiple
    // positions open simultaneously across symbols.
    const allTrades: BacktestTrade[] = [];
    let cash = params.initialCapitalUsd;

    // Sort symbols by candle count desc (better data quality first)
    const sortedSymbols = [...symbolCandles.entries()].sort(
      (a, b) => b[1].length - a[1].length
    );

    // Build a unified timeline: for each bar index, we check all symbols'
    // candles at that index. We need to track open trades per symbol.
    const openTradesBySymbol = new Map<string, OpenTrade>();
    const symbolCandleArrays = sortedSymbols.map(([sym, candles]) => ({
      symbol: sym,
      candles,
      rsiArr: rsi(candles.map((c) => c.close), 14),
    }));
    const maxBars = Math.max(
      ...symbolCandleArrays.map((s) => s.candles.length)
    );

    // Walk forward bar by bar, processing all symbols at each bar
    for (let bar = 14; bar < maxBars; bar++) {
      for (const { symbol, candles, rsiArr } of symbolCandleArrays) {
        if (bar >= candles.length) continue;
        const candle = candles[bar];
        const rsiVal = rsiArr[bar];

        // Check exit for open trade on this symbol
        const openTrade = openTradesBySymbol.get(symbol);
        if (openTrade) {
          const tpPrice = openTrade.entryPrice * (1 + params.takeProfitPct);
          const slPrice = openTrade.entryPrice * (1 - params.stopLossPct);
          const barsHeld = bar - openTrade.entryBar;

          let exitPrice: number | null = null;
          let reason: BacktestTrade["reason"] | null = null;

          if (candle.high >= tpPrice) {
            exitPrice = tpPrice;
            reason = "take_profit";
          } else if (candle.low <= slPrice) {
            exitPrice = slPrice;
            reason = "stop_loss";
          } else if (barsHeld >= params.maxHoldBars) {
            exitPrice = candle.close;
            reason = "timeout";
          } else if (!isNaN(rsiVal) && rsiVal >= params.rsiExitMin) {
            exitPrice = candle.close;
            reason = "rsi_exit";
          }

          if (exitPrice !== null && reason !== null) {
            const pnlUsd = (exitPrice - openTrade.entryPrice) * openTrade.qty;
            const pnlPct = (exitPrice / openTrade.entryPrice - 1) * 100;
            cash += params.perTradeUsd + pnlUsd; // return perTradeUsd + profit/loss
            allTrades.push({
              symbol: openTrade.symbol,
              entryBar: openTrade.entryBar,
              exitBar: bar,
              entryPrice: openTrade.entryPrice,
              exitPrice,
              qty: openTrade.qty,
              pnlUsd,
              pnlPct,
              holdBars: barsHeld,
              reason,
            });
            openTradesBySymbol.delete(symbol);
          }
        }

        // Check entry (only if no open trade on this symbol and RSI is valid)
        if (!openTradesBySymbol.has(symbol) && !isNaN(rsiVal) && rsiVal < params.rsiEntryMax) {
          if (cash >= params.perTradeUsd) {
            const qty = params.perTradeUsd / candle.close;
            cash -= params.perTradeUsd;
            openTradesBySymbol.set(symbol, {
              symbol,
              entryBar: bar,
              entryPrice: candle.close,
              qty,
            });
          }
        }
      }
    }

    // Close any remaining open trades at last close
    for (const [symbol, openTrade] of openTradesBySymbol) {
      const candles = symbolCandleArrays.find((s) => s.symbol === symbol)?.candles;
      if (!candles) continue;
      const lastCandle = candles[candles.length - 1];
      const exitPrice = lastCandle.close;
      const pnlUsd = (exitPrice - openTrade.entryPrice) * openTrade.qty;
      const pnlPct = (exitPrice / openTrade.entryPrice - 1) * 100;
      cash += params.perTradeUsd + pnlUsd;
      allTrades.push({
        symbol: openTrade.symbol,
        entryBar: openTrade.entryBar,
        exitBar: candles.length - 1,
        entryPrice: openTrade.entryPrice,
        exitPrice,
        qty: openTrade.qty,
        pnlUsd,
        pnlPct,
        holdBars: candles.length - 1 - openTrade.entryBar,
        reason: "timeout",
      });
    }
    openTradesBySymbol.clear();

    // Sort trades by entryBar (mixing symbols, but using bar index as time proxy)
    allTrades.sort((a, b) => a.entryBar - b.entryBar);

    // Build equity curve: walk through trades in order, tracking cash + unrealized
    // For simplicity, we'll just track realized cash after each trade closes.
    // This is a step function (jumps at each trade close), but it captures
    // drawdown correctly.
    const equityCurve: BacktestEquityPoint[] = [];
    let runningCash = params.initialCapitalUsd;
    let peak = runningCash;
    let maxDrawdownPct = 0;
    equityCurve.push({
      bar: 0,
      equityUsd: runningCash,
      cashUsd: runningCash,
      openTradeUnrealizedUsd: 0,
    });

    for (const t of allTrades) {
      runningCash += t.pnlUsd;
      if (runningCash > peak) peak = runningCash;
      const dd = peak > 0 ? ((peak - runningCash) / peak) * 100 : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
      equityCurve.push({
        bar: t.exitBar,
        equityUsd: runningCash,
        cashUsd: runningCash,
        openTradeUnrealizedUsd: 0,
      });
    }

    // Compute metrics
    const wins = allTrades.filter((t) => t.pnlUsd > 0);
    const losses = allTrades.filter((t) => t.pnlUsd < 0);
    const winsSum = wins.reduce((s, t) => s + t.pnlUsd, 0);
    const lossesSum = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
    const totalPnlUsd = runningCash - params.initialCapitalUsd;
    const totalPnlPct = (totalPnlUsd / params.initialCapitalUsd) * 100;
    const winRate =
      allTrades.length > 0 ? (wins.length / allTrades.length) * 100 : 0;
    const profitFactor = lossesSum > 0 ? winsSum / lossesSum : winsSum > 0 ? 99 : 0;
    const avgTradePnlUsd =
      allTrades.length > 0 ? totalPnlUsd / allTrades.length : 0;
    const avgHoldBars =
      allTrades.length > 0
        ? allTrades.reduce((s, t) => s + t.holdBars, 0) / allTrades.length
        : 0;
    const bestTradeUsd =
      allTrades.length > 0
        ? Math.max(...allTrades.map((t) => t.pnlUsd))
        : 0;
    const worstTradeUsd =
      allTrades.length > 0
        ? Math.min(...allTrades.map((t) => t.pnlUsd))
        : 0;
    // Sharpe ratio per trade: mean(pnl) / std(pnl) (annualized would need
    // bars-per-year factor; we report raw per-trade Sharpe).
    const pnls = allTrades.map((t) => t.pnlUsd);
    const meanPnl = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
    const variance =
      pnls.length > 1
        ? pnls.reduce((s, p) => s + (p - meanPnl) ** 2, 0) / (pnls.length - 1)
        : 0;
    const stdPnl = Math.sqrt(variance);
    const sharpeRatio = stdPnl > 0 ? meanPnl / stdPnl : 0;

    // Per-symbol breakdown
    const perSymbol = params.symbols.map((sym) => {
      const symTrades = allTrades.filter((t) => t.symbol === sym);
      const symWins = symTrades.filter((t) => t.pnlUsd > 0);
      const symPnl = symTrades.reduce((s, t) => s + t.pnlUsd, 0);
      return {
        symbol: sym,
        trades: symTrades.length,
        wins: symWins.length,
        pnlUsd: symPnl,
        winRate:
          symTrades.length > 0 ? (symWins.length / symTrades.length) * 100 : 0,
      };
    });

    const metrics: BacktestMetrics = {
      totalTrades: allTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      profitFactor,
      totalPnlUsd,
      totalPnlPct,
      maxDrawdownPct,
      sharpeRatio,
      avgTradePnlUsd,
      avgHoldBars,
      bestTradeUsd,
      worstTradeUsd,
    };

    const durationMs = Date.now() - startedAt;
    const result: BacktestResult = {
      params,
      metrics,
      trades: allTrades,
      equityCurve,
      perSymbol,
      candlesLoaded: totalCandlesLoaded,
      durationMs,
    };

    // Update DB row
    await db.backtestResult.update({
      where: { id: dbRow.id },
      data: {
        totalTrades: metrics.totalTrades,
        wins: metrics.wins,
        losses: metrics.losses,
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor,
        totalPnlUsd: metrics.totalPnlUsd,
        totalPnlPct: metrics.totalPnlPct,
        maxDrawdownPct: metrics.maxDrawdownPct,
        sharpeRatio: metrics.sharpeRatio,
        avgTradePnlUsd: metrics.avgTradePnlUsd,
        avgHoldBars: metrics.avgHoldBars,
        bestTradeUsd: metrics.bestTradeUsd,
        worstTradeUsd: metrics.worstTradeUsd,
        equityCurve: JSON.stringify(equityCurve),
        tradesJson: JSON.stringify(
          allTrades.map((t) => ({
            ...t,
            // Truncate to 200 trades to avoid DB bloat
          })).slice(-200)
        ),
        status: "completed",
        finishedAt: new Date(),
        durationMs,
      },
    });

    logger.info("backtest", `Backtest concluído`, {
      totalTrades: metrics.totalTrades,
      winRate: metrics.winRate.toFixed(1) + "%",
      totalPnl: metrics.totalPnlUsd.toFixed(2),
      durationMs,
    });

    return result;
  } catch (err) {
    const errMsg = String(err);
    logger.error("backtest", `Backtest falhou: ${errMsg}`);
    await db.backtestResult.update({
      where: { id: dbRow.id },
      data: {
        status: "failed",
        error: errMsg,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    return {
      params,
      metrics: {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        profitFactor: 0,
        totalPnlUsd: 0,
        totalPnlPct: 0,
        maxDrawdownPct: 0,
        sharpeRatio: 0,
        avgTradePnlUsd: 0,
        avgHoldBars: 0,
        bestTradeUsd: 0,
        worstTradeUsd: 0,
      },
      trades: [],
      equityCurve: [],
      perSymbol: [],
      candlesLoaded: 0,
      durationMs: Date.now() - startedAt,
      error: errMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// List recent backtests (for UI)
// ---------------------------------------------------------------------------
export async function listRecentBacktests(limit = 20) {
  const rows = await db.backtestResult.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    symbols: JSON.parse(r.symbols) as string[],
    interval: r.interval,
    periodDays: r.periodDays,
    initialCapitalUsd: r.initialCapitalUsd,
    perTradeUsd: r.perTradeUsd,
    takeProfitPct: r.takeProfitPct,
    stopLossPct: r.stopLossPct,
    maxHoldBars: r.maxHoldBars,
    rsiEntryMax: r.rsiEntryMax,
    rsiExitMin: r.rsiExitMin,
    totalTrades: r.totalTrades,
    wins: r.wins,
    losses: r.losses,
    winRate: r.winRate,
    profitFactor: r.profitFactor,
    totalPnlUsd: r.totalPnlUsd,
    totalPnlPct: r.totalPnlPct,
    maxDrawdownPct: r.maxDrawdownPct,
    sharpeRatio: r.sharpeRatio,
    avgTradePnlUsd: r.avgTradePnlUsd,
    avgHoldBars: r.avgHoldBars,
    bestTradeUsd: r.bestTradeUsd,
    worstTradeUsd: r.worstTradeUsd,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    status: r.status,
    error: r.error,
  }));
}

export async function getBacktestById(id: number) {
  const r = await db.backtestResult.findUnique({ where: { id } });
  if (!r) return null;
  return {
    id: r.id,
    symbols: JSON.parse(r.symbols) as string[],
    interval: r.interval,
    periodDays: r.periodDays,
    initialCapitalUsd: r.initialCapitalUsd,
    perTradeUsd: r.perTradeUsd,
    takeProfitPct: r.takeProfitPct,
    stopLossPct: r.stopLossPct,
    maxHoldBars: r.maxHoldBars,
    rsiEntryMax: r.rsiEntryMax,
    rsiExitMin: r.rsiExitMin,
    totalTrades: r.totalTrades,
    wins: r.wins,
    losses: r.losses,
    winRate: r.winRate,
    profitFactor: r.profitFactor,
    totalPnlUsd: r.totalPnlUsd,
    totalPnlPct: r.totalPnlPct,
    maxDrawdownPct: r.maxDrawdownPct,
    sharpeRatio: r.sharpeRatio,
    avgTradePnlUsd: r.avgTradePnlUsd,
    avgHoldBars: r.avgHoldBars,
    bestTradeUsd: r.bestTradeUsd,
    worstTradeUsd: r.worstTradeUsd,
    equityCurve: JSON.parse(r.equityCurve) as BacktestEquityPoint[],
    trades: JSON.parse(r.tradesJson) as BacktestTrade[],
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    status: r.status,
    error: r.error,
  };
}
