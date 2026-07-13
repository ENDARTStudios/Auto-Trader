// Rising Tokens Discovery — finds tokens that are gaining momentum.
//
// Complementary to token-selector.ts (which pulls the standard watchlist).
// This module proactively searches for tokens that are "ascending" right now:
//   1. DexScreener /tokens/boosted  — paid-boost tokens (high visibility, often
//      legitimate projects spending marketing budget)
//   2. DexScreener /tokens/trending — most-viewed tokens in last 24h
//   3. CoinGecko /search/trending   — most-searched tokens globally
//   4. DexScreener search per chain, sorted by 24h volume * price change —
//      catches tokens with sustained volume + price appreciation
//
// All endpoints are free, no auth. Results are merged, deduped, and ranked by
// a composite "rising score" (volume rank + price change rank + trending rank).
//
// IMPORTANT: Rising tokens are CANDIDATES — they still go through the full
// 4-layer analyze pipeline (scam-detector → GoPlus → market → AI). This module
// only feeds the funnel; it does NOT bypass any safety check.

import { EngineConfig } from "./config";
import { logger } from "./logger";
import type { TokenCandidate } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface RisingToken extends TokenCandidate {
  priceChange24hPct: number;
  priceChange6hPct?: number;
  priceChange1hPct?: number;
  txns24h?: number;
  trendingRank?: number; // 1 = most trending (CoinGecko or DexScreener)
  boosted?: boolean;     // DexScreener paid boost
  risingScore: number;   // 0-100 composite
  discoverySource: string[];
}

// ---------------------------------------------------------------------------
// DexScreener endpoints (free, no auth, ~300 req/min)
// ---------------------------------------------------------------------------
const DEXSCREENER_BASE = "https://api.dexscreener.com";

interface DexScreenerTokenResponse {
  pairs: Array<{
    chainId: string;
    dexId: string;
    baseToken: { address: string; symbol: string; name: string };
    quoteToken: { address: string; symbol: string };
    priceUsd?: string;
    liquidity?: { usd?: number };
    volume?: { h24?: number; h6?: number; h1?: number };
    priceChange?: { h24?: number; h6?: number; h1?: number };
    txns?: {
      h24?: { buys?: number; sells?: number };
      h6?: { buys?: number; sells?: number };
      h1?: { buys?: number; sells?: number };
    };
    pairCreatedAt?: number;
    info?: { holders?: number };
    fdv?: number;
    marketCap?: number;
    url?: string;
  }>;
}

let boostedCache: { at: number; data: RisingToken[] } = { at: 0, data: [] };
let trendingCache: { at: number; data: RisingToken[] } = { at: 0, data: [] };
const DEX_CACHE_TTL_MS = 90_000; // 1.5 min

// ---------------------------------------------------------------------------
// 1. DexScreener boosted tokens — paid promotion, often legitimate projects
//    NOTE: DexScreener deprecated /tokens/boosted/* and /tokens/trending/* in
//    late 2024. These endpoints now 404. We keep the function as a graceful
//    no-op so the rest of the pipeline keeps working when they come back online.
// ---------------------------------------------------------------------------
async function fetchBoostedTokens(_cfg: EngineConfig): Promise<RisingToken[]> {
  return [];
}

// ---------------------------------------------------------------------------
// 2. DexScreener trending tokens — most-viewed in last 24h (deprecated, no-op)
// ---------------------------------------------------------------------------
async function fetchTrendingTokens(_cfg: EngineConfig): Promise<RisingToken[]> {
  return [];
}

// ---------------------------------------------------------------------------
// 3. CoinGecko /search/trending — globally most-searched
// ---------------------------------------------------------------------------
let cgTrendingCache: { at: number; data: RisingToken[] } = { at: 0, data: [] };

async function fetchCoinGeckoTrending(cfg: EngineConfig): Promise<RisingToken[]> {
  if (Date.now() - cgTrendingCache.at < DEX_CACHE_TTL_MS) return cgTrendingCache.data;

  const out: RisingToken[] = [];
  try {
    // CoinGecko free public endpoint — no key required (rate-limited)
    const resp = await fetch("https://api.coingecko.com/api/v3/search/trending", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!resp.ok) {
      logger.warn("rising", `CoinGecko trending retornou ${resp.status}`);
      return cgTrendingCache.data;
    }
    const json = (await resp.json()) as {
      coins?: Array<{ item: { id: string; symbol: string; name: string; market_cap_rank?: number; thumb?: string; data?: { price?: number; price_btc?: number; price_change_percentage_24h?: { usd?: number }; total_volume?: { usd?: number } } } }>;
    };
    let rank = 1;
    for (const c of json.coins ?? []) {
      const sym = c.item.symbol?.toUpperCase();
      if (!sym) continue;
      // CoinGecko trending includes both CEX majors and DEX tokens. We treat
      // them as CEX candidates if they have a market cap rank, otherwise DEX.
      const isCex = c.item.market_cap_rank !== undefined && c.item.market_cap_rank <= 200;
      const priceUsd = c.item.data?.price ?? 0;
      const volUsd = c.item.data?.total_volume?.usd ?? 0;
      const priceChange24hPct = c.item.data?.price_change_percentage_24h?.usd ?? 0;
      out.push({
        symbol: isCex ? `${sym}/USDT` : sym,
        source: isCex ? "cex" : "dex",
        chain: isCex ? undefined : "coingecko",
        tokenId: isCex ? undefined : c.item.id,
        priceUsd,
        volume24hUsd: volUsd,
        liquidityUsd: volUsd,
        priceChange24hPct,
        trendingRank: rank++,
        discoverySource: ["coingecko_trending"],
        risingScore: 0,
      });
    }
  } catch (err) {
    logger.warn("rising", `Erro CoinGecko trending: ${String(err)}`);
  }
  cgTrendingCache = { at: Date.now(), data: out };
  logger.debug("rising", `CoinGecko trending: ${out.length}`);
  return out;
}

// ---------------------------------------------------------------------------
// 4. CoinGecko top gainers — /coins/markets sorted by 24h price change desc
//    This catches established tokens (top 250 by market cap) that are pumping.
// ---------------------------------------------------------------------------
let cgGainersCache: { at: number; data: RisingToken[] } = { at: 0, data: [] };

async function fetchTopGainers(_cfg: EngineConfig): Promise<RisingToken[]> {
  if (Date.now() - cgGainersCache.at < DEX_CACHE_TTL_MS) return cgGainersCache.data;

  const out: RisingToken[] = [];
  try {
    // Fetch top 250 coins by market cap, sorted by 24h price change descending
    // Free CoinGecko endpoint (no auth, rate-limited ~10-30 req/min)
    const url =
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=1h,24h";
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!resp.ok) {
      logger.warn("rising", `CoinGecko /markets retornou ${resp.status}`);
      return cgGainersCache.data;
    }
    const json = (await resp.json()) as Array<{
      id: string;
      symbol: string;
      name: string;
      current_price?: number;
      market_cap_rank?: number;
      total_volume?: number;
      price_change_percentage_1h_in_currency?: number;
      price_change_percentage_24h?: number;
    }>;
    // Filter for tokens with positive 24h gain >5% AND positive 1h momentum
    const gainers = json
      .filter((c) => (c.price_change_percentage_24h ?? 0) > 5)
      .filter((c) => (c.price_change_percentage_1h_in_currency ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0)
      )
      .slice(0, 20);

    for (const c of gainers) {
      const sym = c.symbol?.toUpperCase();
      if (!sym) continue;
      const isCex = (c.market_cap_rank ?? 999) <= 200;
      out.push({
        symbol: isCex ? `${sym}/USDT` : sym,
        source: isCex ? "cex" : "dex",
        chain: isCex ? undefined : "coingecko",
        tokenId: isCex ? undefined : c.id,
        priceUsd: c.current_price ?? 0,
        volume24hUsd: c.total_volume ?? 0,
        liquidityUsd: c.total_volume ?? 0,
        priceChange24hPct: c.price_change_percentage_24h ?? 0,
        priceChange1hPct: c.price_change_percentage_1h_in_currency,
        discoverySource: ["coingecko_gainers"],
        risingScore: 0,
      });
    }
  } catch (err) {
    logger.warn("rising", `Erro CoinGecko gainers: ${String(err)}`);
  }
  cgGainersCache = { at: Date.now(), data: out };
  logger.debug("rising", `Top gainers: ${out.length}`);
  return out;
}

// ---------------------------------------------------------------------------
// Merge + dedupe + score
// ---------------------------------------------------------------------------
function dedupeRising(tokens: RisingToken[]): RisingToken[] {
  const map = new Map<string, RisingToken>();
  for (const t of tokens) {
    const key = t.tokenId
      ? `${t.chain}:${t.tokenId.toLowerCase()}`
      : `cex:${t.symbol}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, t);
    } else {
      // Merge discovery sources + keep best metrics
      existing.discoverySource = Array.from(
        new Set([...existing.discoverySource, ...t.discoverySource])
      );
      if ((t.trendingRank ?? 999) < (existing.trendingRank ?? 999)) {
        existing.trendingRank = t.trendingRank;
      }
      if (t.boosted) existing.boosted = true;
      if (t.priceChange24hPct > existing.priceChange24hPct) {
        existing.priceChange24hPct = t.priceChange24hPct;
      }
      if ((t.volume24hUsd ?? 0) > (existing.volume24hUsd ?? 0)) {
        existing.volume24hUsd = t.volume24hUsd;
      }
    }
  }
  return Array.from(map.values());
}

function computeRisingScore(t: RisingToken): number {
  // Composite score 0-100 combining:
  //   - 24h price change (capped at 100%)      35%
  //   - 1h price change (capped at 50%)        15%
  //   - 24h volume (log-scaled)                20%
  //   - Trending rank bonus                    15%
  //   - Boosted bonus                           5%
  //   - Transaction count (log-scaled)         10%

  const pc24 = Math.min(Math.max(t.priceChange24hPct, 0), 100) / 100; // 0-1
  const pc1 = Math.min(Math.max(t.priceChange1hPct ?? 0, 0), 50) / 50; // 0-1
  const volScore = Math.min(Math.log10((t.volume24hUsd ?? 1) + 1) / 7, 1); // 0-1 ($1M -> ~0.43, $10M -> 1)
  const trendScore = t.trendingRank ? Math.max(0, 1 - (t.trendingRank - 1) / 10) : 0;
  const boostScore = t.boosted ? 1 : 0;
  const txScore = Math.min(Math.log10((t.txns24h ?? 1) + 1) / 5, 1); // 0-1 (10000 txns -> 1)

  const score =
    pc24 * 35 + pc1 * 15 + volScore * 20 + trendScore * 15 + boostScore * 5 + txScore * 10;
  return Math.round(score);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover rising tokens across all free sources. Returns deduped, ranked list
 * of candidates that should be fed into the analyze pipeline.
 */
export async function discoverRisingTokens(
  cfg: EngineConfig,
  limit = 20
): Promise<RisingToken[]> {
  const [boosted, trending, cgTrending, gainers] = await Promise.all([
    fetchBoostedTokens(cfg),
    fetchTrendingTokens(cfg),
    fetchCoinGeckoTrending(cfg),
    fetchTopGainers(cfg),
  ]);

  const all = dedupeRising([...boosted, ...trending, ...cgTrending, ...gainers]);
  for (const t of all) {
    t.risingScore = computeRisingScore(t);
  }
  all.sort((a, b) => b.risingScore - a.risingScore);

  logger.info("rising", `Discovery: ${all.length} rising tokens`, {
    boosted: boosted.length,
    trending: trending.length,
    cgTrending: cgTrending.length,
    gainers: gainers.length,
  });

  return all.slice(0, limit);
}

/**
 * Returns rising tokens as TokenCandidate[] for direct injection into the
 * analyze pipeline. Filters out tokens with risingScore < minScore (default 30).
 */
export async function getRisingCandidates(
  cfg: EngineConfig,
  limit = 10,
  minScore = 30
): Promise<TokenCandidate[]> {
  const rising = await discoverRisingTokens(cfg, limit * 2);
  return rising
    .filter((t) => t.risingScore >= minScore)
    .slice(0, limit)
    .map((t) => ({
      symbol: t.symbol,
      source: t.source,
      chain: t.chain,
      tokenId: t.tokenId,
      priceUsd: t.priceUsd,
      volume24hUsd: t.volume24hUsd,
      liquidityUsd: t.liquidityUsd,
      ageHours: t.ageHours,
      holderCount: t.holderCount,
    }));
}
