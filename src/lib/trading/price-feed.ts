// Price Feed — fetches current USD price for a position's symbol.
//
// For CEX tokens, uses Binance public REST API directly.
// For DEX tokens, uses DexScreener /tokens/v1/{chain}/{address}.

import { logger } from "./logger";

interface CacheEntry {
  at: number;
  price: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 15_000;

function cacheKey(
  symbol: string,
  chain?: string | null,
  tokenId?: string | null
) {
  if (tokenId && chain) return `${chain}:${tokenId.toLowerCase()}`;
  return `cex:${symbol}`;
}

// Binance symbol format: BTC/USDT -> BTCUSDT
function toBinanceSymbol(symbol: string): string | null {
  const [base, quote] = symbol.split("/");
  if (!base || !quote) return null;
  return `${base}${quote}`.toUpperCase();
}

export async function fetchPriceUsd(
  symbol: string,
  source: "cex" | "dex",
  chain?: string | null,
  tokenId?: string | null
): Promise<number> {
  const key = cacheKey(symbol, chain, tokenId);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.price;
  }

  let price = 0;
  try {
    if (source === "cex") {
      const binanceSymbol = toBinanceSymbol(symbol);
      if (!binanceSymbol) return 0;
      const url = `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`;
      const resp = await fetch(url, { cache: "no-store" });
      if (resp.ok) {
        const json = (await resp.json()) as { price?: string };
        if (json.price) price = parseFloat(json.price);
      }
    } else if (source === "dex" && chain && tokenId) {
      const url = `https://api.dexscreener.com/tokens/v1/${chain}/${tokenId}`;
      const resp = await fetch(url, { cache: "no-store" });
      if (resp.ok) {
        const json = (await resp.json()) as Array<{
          priceUsd?: string;
          liquidity?: { usd?: number };
        }>;
        if (Array.isArray(json) && json.length > 0 && json[0].priceUsd) {
          price = parseFloat(json[0].priceUsd);
        }
      }
    }
  } catch (err) {
    logger.warn("engine", `Erro buscando preço ${symbol}`, { error: String(err) });
  }

  if (price > 0) {
    cache.set(key, { at: Date.now(), price });
  }
  return price;
}

// Batch fetch for multiple positions
export async function fetchPricesBatch(
  positions: Array<{
    id: string;
    symbol: string;
    source: "cex" | "dex";
    chain?: string | null;
    tokenId?: string | null;
  }>
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = new Map<
    string,
    {
      symbol: string;
      source: "cex" | "dex";
      chain?: string | null;
      tokenId?: string | null;
    }
  >();
  for (const p of positions) {
    const k = cacheKey(p.symbol, p.chain, p.tokenId);
    if (!uniq.has(k)) uniq.set(k, p);
  }

  const entries = Array.from(uniq.entries());
  const BATCH_SIZE = 6;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ([k, p]) => {
        const price = await fetchPriceUsd(p.symbol, p.source, p.chain, p.tokenId);
        return [k, price] as const;
      })
    );
    for (const [k, price] of results) out.set(k, price);
  }

  const positionPrices = new Map<string, number>();
  for (const p of positions) {
    const k = cacheKey(p.symbol, p.chain, p.tokenId);
    positionPrices.set(p.id, out.get(k) ?? 0);
  }
  return positionPrices;
}
