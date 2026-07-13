// Token Selector — discovers candidate tokens for the next round.
//
// Two pipelines:
//   - CEX: pulls Binance 24h ticker for the configured major pairs.
//     Uses Binance public REST API directly (no auth, no CCXT dependency).
//   - DEX: pulls DexScreener top tokens by chain (base, arbitrum, optimism),
//     filtered by liquidity & volume. DexScreener is fully public, no API key.
//
// Returns a flat list of TokenCandidate sorted by volume desc.

import { EngineConfig } from "./config";
import { logger } from "./logger";
import type { TokenCandidate } from "./types";

// ---------------------------------------------------------------------------
// CEX side — direct Binance REST
// ---------------------------------------------------------------------------

// Binance symbol format: BTC/USDT -> BTCUSDT
function toBinanceSymbol(symbol: string): string | null {
  const [base, quote] = symbol.split("/");
  if (!base || !quote) return null;
  return `${base}${quote}`.toUpperCase();
}

let cexCache: { at: number; data: TokenCandidate[] } = { at: 0, data: [] };
const CEX_CACHE_TTL_MS = 30_000;

export async function fetchCexCandidates(
  cfg: EngineConfig
): Promise<TokenCandidate[]> {
  if (!cfg.scanCex) return [];
  if (Date.now() - cexCache.at < CEX_CACHE_TTL_MS) {
    return cexCache.data;
  }

  const out: TokenCandidate[] = [];
  const binanceSymbols = cfg.cexSymbols
    .map(toBinanceSymbol)
    .filter((s): s is string => s !== null);

  if (binanceSymbols.length === 0) {
    return out;
  }

  try {
    // Binance endpoint for multiple symbols:
    //   GET https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT"]
    const symbolsParam = encodeURIComponent(
      JSON.stringify(binanceSymbols)
    );
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!resp.ok) {
      logger.warn("cex", `Binance retornou ${resp.status}`);
      return cexCache.data;
    }
    const tickers = (await resp.json()) as Array<{
      symbol: string;
      lastPrice: string;
      quoteVolume: string;
    }>;

    // Build reverse map: BTCUSDT -> BTC/USDT
    const reverse = new Map<string, string>();
    for (const s of cfg.cexSymbols) {
      const b = toBinanceSymbol(s);
      if (b) reverse.set(b, s);
    }

    for (const t of tickers) {
      const symbol = reverse.get(t.symbol);
      if (!symbol) continue;
      const priceUsd = parseFloat(t.lastPrice);
      const volumeUsd = parseFloat(t.quoteVolume);
      if (priceUsd <= 0 || volumeUsd < cfg.minVolume24hUsd) continue;
      out.push({
        symbol,
        source: "cex",
        priceUsd,
        volume24hUsd: volumeUsd,
        liquidityUsd: volumeUsd, // CEX liquidity ~ daily volume (rough proxy)
      });
    }
  } catch (err) {
    logger.error("cex", "Erro buscando tickers Binance", {
      error: String(err),
    });
  }

  cexCache = { at: Date.now(), data: out };
  logger.debug("cex", `CEX candidates: ${out.length}`);
  return out;
}

// ---------------------------------------------------------------------------
// DEX side — DexScreener public API (https://docs.dexscreener.com/api/reference)
// ---------------------------------------------------------------------------

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string; name: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  pairCreatedAt?: number;
  info?: { holders?: number };
  fdv?: number;
  marketCap?: number;
}

let dexCache: { at: number; data: TokenCandidate[] } = { at: 0, data: [] };
const DEX_CACHE_TTL_MS = 60_000;

export async function fetchDexCandidates(
  cfg: EngineConfig
): Promise<TokenCandidate[]> {
  if (!cfg.scanDex) return [];
  if (Date.now() - dexCache.at < DEX_CACHE_TTL_MS) {
    return dexCache.data;
  }

  const out: TokenCandidate[] = [];

  try {
    for (const chain of cfg.dexChains) {
      // DexScreener search endpoint — returns ranked pairs for a query
      const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(
        chain
      )}`;
      const resp = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!resp.ok) {
        logger.warn("dex", `DexScreener retornou ${resp.status} para chain ${chain}`);
        continue;
      }
      const json = (await resp.json()) as { pairs?: DexScreenerPair[] };
      const pairs = json.pairs ?? [];

      const filtered = pairs
        .filter((p) => p.chainId === chain)
        .filter((p) => p.priceUsd && parseFloat(p.priceUsd) > 0)
        .filter(
          (p) =>
            (p.liquidity?.usd ?? 0) >= cfg.minLiquidityUsd &&
            (p.volume?.h24 ?? 0) >= cfg.minVolume24hUsd
        )
        .sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))
        .slice(0, 30);

      for (const p of filtered) {
        const existing = out.find(
          (o) =>
            o.tokenId?.toLowerCase() === p.baseToken.address.toLowerCase() &&
            o.chain === chain
        );
        if (existing) continue;

        out.push({
          symbol: p.baseToken.symbol,
          source: "dex",
          chain,
          tokenId: p.baseToken.address,
          priceUsd: parseFloat(p.priceUsd!),
          volume24hUsd: p.volume?.h24 ?? 0,
          liquidityUsd: p.liquidity?.usd ?? 0,
          ageHours: p.pairCreatedAt
            ? (Date.now() - p.pairCreatedAt) / 3_600_000
            : undefined,
          holderCount: p.info?.holders,
        });
      }
    }
  } catch (err) {
    logger.error("dex", "Erro buscando DexScreener", { error: String(err) });
  }

  dexCache = { at: Date.now(), data: out };
  logger.debug("dex", `DEX candidates: ${out.length}`);
  return out;
}

// ---------------------------------------------------------------------------
// Combined selector
// ---------------------------------------------------------------------------

export async function selectCandidates(
  cfg: EngineConfig,
  limit: number
): Promise<TokenCandidate[]> {
  const [cexList, dexList] = await Promise.all([
    fetchCexCandidates(cfg),
    fetchDexCandidates(cfg),
  ]);

  const merged = [...cexList, ...dexList].sort(
    (a, b) => b.volume24hUsd - a.volume24hUsd
  );

  const seen = new Set<string>();
  const deduped: TokenCandidate[] = [];
  for (const c of merged) {
    const key = c.tokenId
      ? `${c.chain}:${c.tokenId.toLowerCase()}`
      : `cex:${c.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  logger.info("selector", `Candidatos: ${deduped.length} (top ${limit})`, {
    cex: cexList.length,
    dex: dexList.length,
  });
  return deduped.slice(0, limit);
}
