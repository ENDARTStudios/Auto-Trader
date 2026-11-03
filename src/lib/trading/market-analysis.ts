// Market analysis module — combines technical indicators + market sentiment
// into a composite signal that informs the engine's entry/exit decisions.
//
// All data sources are free and open, and ALL are real (no synthetic candles):
//   - Binance klines REST API — candles for CEX tokens (dataQuality "live")
//   - DexScreener /tokens/v1 — descobre o pool de MAIOR liquidez do token
//   - GeckoTerminal /ohlcv/minute — OHLCV real desse pool (dataQuality "live")
//   - alternative.me Fear & Greed Index API — no auth
//   - CoinGecko /search/trending — no auth (we use a 60s cache)
//
// DEGRADAÇÃO HONESTA (audit round1): antes, quando não havia candles, este
// módulo sintetizava uma reta + seno a partir do preço atual e calculava
// RSI/MACD/EMA sobre ruído inventado. Agora, sem OHLCV real ele LANÇA
// MarketDataUnavailableError (code = "MARKET_DATA_UNAVAILABLE") e o engine
// decide (ex.: pular entrada). Nenhum indicador é fabricado.
//
// Technical indicators implemented inline (no external TA library):
//   - RSI(14)        — Relative Strength Index
//   - MACD(12,26,9)  — Moving Average Convergence Divergence
//   - EMA(20), EMA(50) — trend direction
//   - Bollinger Bands(20, 2σ) — volatility envelope
// These are textbook formulas. No need to add a heavy dependency.

import { db } from "@/lib/db";
import { logger } from "./logger";
import { recordSuccess, recordError } from "./source-health";
import { fetchTokenPairs } from "@/lib/etl/dexscreener";
import type { TokenCandidate } from "./types";

// ---------------------------------------------------------------------------
// Indicator math
// ---------------------------------------------------------------------------
export function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    const v = values[i] * k + prev * (1 - k);
    out.push(v);
    prev = v;
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
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

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number[]; signal: number[]; hist: number[] } {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  const hist = macdLine.map((v, i) => v - signalLine[i]);
  return { macd: macdLine, signal: signalLine, hist };
}

export function bollinger(
  closes: number[],
  period = 20,
  mult = 2
): { upper: number; lower: number; mid: number; percent: number } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const last = closes[closes.length - 1];
  const percent = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  return { upper, lower, mid, percent };
}

// ---------------------------------------------------------------------------
// Fetch klines (candles) — Binance (CEX) / GeckoTerminal OHLCV (DEX). Tudo real.
// ---------------------------------------------------------------------------
export interface Candle { open: number; high: number; low: number; close: number; volume: number; time: number; }

/**
 * Não existe OHLCV real disponível. NUNCA sintetizamos candles: quem chama
 * decide degradar (o engine cai no fallback neutro; a API responde erro).
 */
export class MarketDataUnavailableError extends Error {
  readonly code = "MARKET_DATA_UNAVAILABLE" as const;
  constructor(
    message: string,
    readonly meta?: { symbol?: string; chain?: string; tokenId?: string; source?: string; cause?: string }
  ) {
    super(message);
    this.name = "MarketDataUnavailableError";
  }
}

/** chain interna -> network slug do GeckoTerminal. */
export const CHAIN_TO_GECKO_NETWORK: Readonly<Record<string, string>> = {
  ethereum: "eth",
  eth: "eth",
  bsc: "bsc",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon_pos",
  polygon_pos: "polygon_pos",
};

async function fetchBinanceKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  // symbol like "BTC/USDT" → "BTCUSDT" for Binance
  const bnSymbol = symbol.replace("/", "").toUpperCase();
  const url = `https://api.binance.com/api/v3/klines?symbol=${bnSymbol}&interval=${interval}&limit=${limit}`;
  let resp: Response;
  try {
    resp = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  } catch (err) {
    await recordError("binance", `klines ${bnSymbol}: ${String(err)}`);
    throw new MarketDataUnavailableError(`Binance indisponível para ${symbol}`, {
      symbol,
      source: "binance",
      cause: String(err),
    });
  }
  if (!resp.ok) {
    await recordError("binance", `klines ${bnSymbol}: HTTP ${resp.status}`);
    throw new MarketDataUnavailableError(`Binance klines HTTP ${resp.status} para ${symbol}`, {
      symbol,
      source: "binance",
    });
  }
  const json = (await resp.json()) as unknown[][];
  if (!Array.isArray(json) || json.length === 0) {
    await recordError("binance", `klines ${bnSymbol}: resposta vazia`);
    throw new MarketDataUnavailableError(`Binance sem candles para ${symbol}`, { symbol, source: "binance" });
  }
  await recordSuccess("binance");
  return json.map((k) => ({
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
    time: k[0] as number,
  }));
}

type GeckoOhlcvRow = number[];
interface GeckoPoolCandidate {
  pairAddress: string;
  liquidityUsd: number;
  inverted: boolean; // true = nosso token é o QUOTE do pool -> invertemos o preço
}

/**
 * OHLCV REAL de DEX: descobre o pool de maior liquidez via DexScreener e busca
 * as velas no GeckoTerminal. Os preços do GeckoTerminal são USD do token BASE;
 * quando nosso token é o quote do pool, invertemos a série (high/low trocam).
 */
async function fetchDexCandles(
  chain: string,
  tokenId: string,
  symbol: string
): Promise<{ candles: Candle[]; poolAddress: string; network: string; inverted: boolean }> {
  const network = CHAIN_TO_GECKO_NETWORK[chain.toLowerCase()];
  if (!network) {
    throw new MarketDataUnavailableError(`Chain ${chain} sem network GeckoTerminal mapeada`, {
      symbol,
      chain,
      tokenId,
      source: "geckoterminal",
    });
  }

  let pairs: Awaited<ReturnType<typeof fetchTokenPairs>>["pairs"];
  try {
    const res = await fetchTokenPairs(chain, tokenId);
    pairs = res.pairs;
  } catch (err) {
    await recordError("dexscreener", `pools ${chain}:${tokenId}: ${String(err)}`);
    throw new MarketDataUnavailableError(`DexScreener indisponível para ${symbol}`, {
      symbol,
      chain,
      tokenId,
      source: "dexscreener",
      cause: String(err),
    });
  }

  const wanted = tokenId.toLowerCase();
  const candidates: GeckoPoolCandidate[] = pairs
    .filter((p) => p.priceUsd > 0 && p.pairAddress)
    .map((p) => ({
      pairAddress: p.pairAddress,
      liquidityUsd: p.liquidityUsd,
      inverted: p.baseTokenAddress.toLowerCase() !== wanted,
    }))
    .sort((a, b) => {
      // Prefere pool onde NOSSO token é o base (sem inversão) e depois liquidez.
      if (a.inverted !== b.inverted) return a.inverted ? 1 : -1;
      return b.liquidityUsd - a.liquidityUsd;
    })
    .slice(0, 3);

  if (candidates.length === 0) {
    await recordError("dexscreener", `pools ${chain}:${tokenId}: sem pares com liquidez`);
    throw new MarketDataUnavailableError(`Sem pool DEX com liquidez para ${symbol}`, {
      symbol,
      chain,
      tokenId,
      source: "dexscreener",
    });
  }
  await recordSuccess("dexscreener");

  const errors: string[] = [];
  for (const pool of candidates) {
    const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pool.pairAddress}/ohlcv/minute?aggregate=5&limit=100`;
    try {
      const resp = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as {
        data?: { attributes?: { ohlcv_list?: GeckoOhlcvRow[] } };
      };
      const rows = json.data?.attributes?.ohlcv_list ?? [];
      if (rows.length < 2) throw new Error("ohlcv_list vazia");
      const candles: Candle[] = rows
        .map((row) => {
          const [ts, o, h, l, c, v] = row;
          if (pool.inverted) {
            // 1/p com high/low trocados
            return {
              time: ts * 1000,
              open: 1 / o,
              high: 1 / l,
              low: 1 / h,
              close: 1 / c,
              volume: v,
            };
          }
          return { time: ts * 1000, open: o, high: h, low: l, close: c, volume: v };
        })
        .filter((c) => Number.isFinite(c.close) && c.close > 0)
        .sort((a, b) => a.time - b.time);
      if (candles.length < 2) throw new Error("candles inválidos após parse");
      await recordSuccess("geckoterminal");
      return { candles, poolAddress: pool.pairAddress, network, inverted: pool.inverted };
    } catch (err) {
      errors.push(`${pool.pairAddress}: ${String(err)}`);
    }
  }

  await recordError("geckoterminal", `ohlcv ${network}:${tokenId}: ${errors.join(" | ")}`);
  throw new MarketDataUnavailableError(`GeckoTerminal sem OHLCV real para ${symbol}`, {
    symbol,
    chain,
    tokenId,
    source: "geckoterminal",
    cause: errors.join(" | "),
  });
}

// ---------------------------------------------------------------------------
// Fear & Greed Index (alternative.me — free, no auth)
// ---------------------------------------------------------------------------
interface FearGreedData { value: number; classification: string; timestamp: string; }
let fearGreedCache: { data: FearGreedData | null; ts: number } = { data: null, ts: 0 };
const FEAR_GREED_TTL = 5 * 60 * 1000; // 5 minutes

export async function getFearGreedIndex(): Promise<FearGreedData | null> {
  if (fearGreedCache.data && Date.now() - fearGreedCache.ts < FEAR_GREED_TTL) {
    return fearGreedCache.data;
  }
  try {
    const resp = await fetch("https://api.alternative.me/fng/?limit=1", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = (await resp.json()) as {
      data: Array<{ value: string; value_classification: string; timestamp: string }>;
    };
    if (!json.data || json.data.length === 0) throw new Error("Sem data");
    const d = json.data[0];
    fearGreedCache = {
      data: {
        value: parseInt(d.value, 10),
        classification: d.value_classification,
        timestamp: d.timestamp,
      },
      ts: Date.now(),
    };
    await recordSuccess("feargreed");
    return fearGreedCache.data;
  } catch (err) {
    await recordError("feargreed", String(err));
    logger.warn("market", `Fear & Greed indisponível: ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// CoinGecko trending (free, no auth, but rate-limited — cache aggressively)
// ---------------------------------------------------------------------------
let trendingCache: { data: { id: string; symbol: string; rank: number }[] | null; ts: number } = {
  data: null,
  ts: 0,
};
const TRENDING_TTL = 5 * 60 * 1000;

export async function getTrendingTokens(): Promise<
  { id: string; symbol: string; rank: number }[]
> {
  if (trendingCache.data && Date.now() - trendingCache.ts < TRENDING_TTL) {
    return trendingCache.data;
  }
  try {
    const resp = await fetch("https://api.coingecko.com/api/v3/search/trending", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = (await resp.json()) as {
      coins: Array<{ item: { id: string; symbol: string; market_cap_rank: number } }>;
    };
    const data = (json.coins ?? []).map((c, i) => ({
      id: c.item.id,
      symbol: c.item.symbol,
      rank: i + 1,
    }));
    trendingCache = { data, ts: Date.now() };
    await recordSuccess("coingecko");
    return data;
  } catch (err) {
    await recordError("coingecko", `trending: ${String(err)}`);
    logger.warn("market", `Trending indisponível: ${String(err)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Composite signal builder
// ---------------------------------------------------------------------------
export interface MarketSignal {
  symbol: string;
  source: "cex" | "dex";
  chain?: string;
  tokenId?: string;
  priceUsd: number;
  rsi14: number | null;
  macdHist: number | null;
  ema20: number | null;
  ema50: number | null;
  bollUpper: number | null;
  bollLower: number | null;
  bollPercent: number | null;
  fearGreedIndex: number | null;
  fearGreedClass: string | null;
  trendingRank: number | null;
  signalScore: number; // 0-100 (100 = strongest buy)
  signalLabel: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  /**
   * "live" = indicadores calculados sobre OHLCV real (Binance para CEX,
   * GeckoTerminal para DEX). "unavailable" = NÃO houve dado real; o snapshot é
   * neutro e explicitamente não-analítico (engine aplica o gate de qualidade).
   */
  dataQuality: "live" | "unavailable";
  raw: Record<string, unknown>;
}

function classifySignal(score: number): MarketSignal["signalLabel"] {
  if (score >= 80) return "strong_buy";
  if (score >= 65) return "buy";
  if (score >= 40) return "neutral";
  if (score >= 25) return "sell";
  return "strong_sell";
}

// ---------------------------------------------------------------------------
// Main entry — analyze a token
// ---------------------------------------------------------------------------
export async function analyzeMarket(candidate: TokenCandidate): Promise<MarketSignal> {
  const raw: Record<string, unknown> = {};

  // ---------- candles reais (sem síntese) ----------
  let candles: Candle[] = [];
  let candleSource: "binance" | "geckoterminal";
  let poolAddress: string | null = null;
  let network: string | null = null;
  let inverted = false;

  if (candidate.source === "cex") {
    candleSource = "binance";
    candles = await fetchBinanceKlines(candidate.symbol, "1h", 60); // lança MarketDataUnavailableError
  } else {
    candleSource = "geckoterminal";
    if (!candidate.chain || !candidate.tokenId) {
      throw new MarketDataUnavailableError(
        `DEX sem chain/tokenId — impossível obter OHLCV real para ${candidate.symbol}`,
        { symbol: candidate.symbol, source: "geckoterminal" }
      );
    }
    const dex = await fetchDexCandles(candidate.chain, candidate.tokenId, candidate.symbol);
    candles = dex.candles;
    poolAddress = dex.poolAddress;
    network = dex.network;
    inverted = dex.inverted;
  }

  if (candles.length < 2) {
    throw new MarketDataUnavailableError(
      `OHLCV real insuficiente para ${candidate.symbol} (${candles.length} candles)`,
      { symbol: candidate.symbol, chain: candidate.chain, tokenId: candidate.tokenId, source: candleSource }
    );
  }

  const closes = candles.map((c) => c.close);
  const lastPrice = closes[closes.length - 1] ?? candidate.priceUsd;

  // Indicators
  let rsi14: number | null = null;
  let macdHist: number | null = null;
  let ema20: number | null = null;
  let ema50: number | null = null;
  let bollUpper: number | null = null;
  let bollLower: number | null = null;
  let bollPercent: number | null = null;

  if (closes.length >= 14) {
    const rsiArr = rsi(closes, 14);
    const lastRsi = rsiArr[rsiArr.length - 1];
    if (!isNaN(lastRsi)) rsi14 = lastRsi;
  }
  if (closes.length >= 26) {
    const m = macd(closes);
    const lastHist = m.hist[m.hist.length - 1];
    if (!isNaN(lastHist)) macdHist = lastHist;
  }
  if (closes.length >= 20) {
    const e20 = ema(closes, 20);
    ema20 = e20[e20.length - 1];
  }
  if (closes.length >= 50) {
    const e50 = ema(closes, 50);
    ema50 = e50[e50.length - 1];
  }
  if (closes.length >= 20) {
    const b = bollinger(closes, 20, 2);
    if (b) {
      bollUpper = b.upper;
      bollLower = b.lower;
      bollPercent = b.percent;
    }
  }

  // Sentiment
  const fg = await getFearGreedIndex();
  const trending = await getTrendingTokens();
  const trendingRank = trending.find(
    (t) => t.symbol.toUpperCase() === candidate.symbol.split("/")[0].toUpperCase()
  )?.rank ?? null;

  raw.candle_count = candles.length;
  raw.last_candle_at = candles.length > 0 ? new Date(candles[candles.length - 1].time).toISOString() : null;
  raw.candle_source = candleSource;
  raw.candle_interval = candleSource === "binance" ? "1h" : "5m";
  raw.data_quality = "live";
  if (poolAddress) raw.pool_address = poolAddress;
  if (network) raw.gecko_network = network;
  if (candleSource === "geckoterminal") raw.price_inverted = inverted;

  // ------------------- Composite signal -------------------
  // Weights (sum to 100):
  //   RSI           20  (oversold bullish / overbought bearish)
  //   MACD          20  (histogram > 0 = bullish momentum)
  //   EMA trend     20  (EMA20 > EMA50 = uptrend)
  //   Bollinger     10  (price near lower band = oversold bounce opportunity)
  //   Fear&Greed     10  (extreme fear = contrarian buy, extreme greed = cautious)
  //   Trending       10  (trending = attention, can go either way; small bonus)
  //   Token age/vol  10  (already in candidate metadata)
  let score = 50; // neutral start

  if (rsi14 !== null) {
    if (rsi14 < 30) score += 12;        // oversold → buy signal
    else if (rsi14 < 45) score += 6;
    else if (rsi14 > 70) score -= 12;   // overbought → sell signal
    else if (rsi14 > 55) score -= 4;
    // 45-55 neutral
  }

  if (macdHist !== null) {
    if (macdHist > 0) score += 8;
    else score -= 8;
  }

  if (ema20 !== null && ema50 !== null) {
    if (ema20 > ema50) score += 10;     // uptrend
    else score -= 10;
  }

  if (bollPercent !== null) {
    if (bollPercent < 0.2) score += 5;  // near lower band — bounce setup
    else if (bollPercent > 0.8) score -= 5; // near upper band — overextended
  }

  if (fg) {
    // Contrarian: extreme fear is buying opportunity, extreme greed is risk
    if (fg.value < 25) score += 5;
    else if (fg.value > 75) score -= 5;
  }

  if (trendingRank !== null && trendingRank <= 5) {
    score += 4; // small bonus — trending = attention liquidity
  }

  // Clamp
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = classifySignal(score);

  const signal: MarketSignal = {
    symbol: candidate.symbol,
    source: candidate.source,
    chain: candidate.chain,
    tokenId: candidate.tokenId,
    priceUsd: lastPrice,
    rsi14,
    macdHist,
    ema20,
    ema50,
    bollUpper,
    bollLower,
    bollPercent,
    fearGreedIndex: fg?.value ?? null,
    fearGreedClass: fg?.classification ?? null,
    trendingRank,
    signalScore: score,
    signalLabel: label,
    dataQuality: "live",
    raw,
  };

  // Persist snapshot
  try {
    await db.marketSnapshot.create({
      data: {
        symbol: signal.symbol,
        source: signal.source,
        chain: signal.chain ?? null,
        tokenId: signal.tokenId ?? null,
        priceUsd: signal.priceUsd,
        rsi14: signal.rsi14,
        macdHist: signal.macdHist,
        ema20: signal.ema20,
        ema50: signal.ema50,
        bollUpper: signal.bollUpper,
        bollLower: signal.bollLower,
        bollPercent: signal.bollPercent,
        fearGreedIndex: signal.fearGreedIndex,
        fearGreedClass: signal.fearGreedClass,
        trendingRank: signal.trendingRank,
        signalScore: signal.signalScore,
        signalLabel: signal.signalLabel,
        rawIndicators: JSON.stringify(raw),
      },
    });
  } catch (err) {
    logger.error("market", `Erro persistindo MarketSnapshot: ${String(err)}`);
  }

  logger.info(
    "market",
    `${candidate.symbol} signal=${label}(${score}) rsi=${rsi14?.toFixed(0) ?? "-"} macd=${macdHist?.toFixed(4) ?? "-"} candles=${candles.length}(${candleSource})`
  );
  return signal;
}
