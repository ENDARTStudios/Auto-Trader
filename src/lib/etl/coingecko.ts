// src/lib/etl/coingecko.ts — CoinGecko connector
// Real: GET /api/v3/coins/markets (top 100 por market cap) com a chave Demo
// (header x-cg-demo-api-key, 30 req/min). Sem rede/chave → fallback mock.
// Em NODE_ENV=test fica no mock para os testes serem determinísticos.
import { getEnv } from "@/lib/env";
import { logger } from "../trading/logger";

export interface Token {
  symbol: string;
  name: string;
  chain: string;
  priceUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
}

const MOCK_TOKENS: Token[] = [
  { symbol: "BTC", name: "Bitcoin", chain: "cex", priceUsd: 65000, marketCapUsd: 1_280_000_000_000, volume24hUsd: 25_000_000_000 },
  { symbol: "ETH", name: "Ethereum", chain: "cex", priceUsd: 3500, marketCapUsd: 420_000_000_000, volume24hUsd: 12_000_000_000 },
  { symbol: "SOL", name: "Solana", chain: "cex", priceUsd: 150, marketCapUsd: 70_000_000_000, volume24hUsd: 3_000_000_000 },
  { symbol: "BNB", name: "Binance Coin", chain: "cex", priceUsd: 600, marketCapUsd: 90_000_000_000, volume24hUsd: 1_500_000_000 },
  { symbol: "XRP", name: "Ripple", chain: "cex", priceUsd: 0.6, marketCapUsd: 33_000_000_000, volume24hUsd: 1_200_000_000 },
  { symbol: "ARB", name: "Arbitrum", chain: "arbitrum", priceUsd: 1.2, marketCapUsd: 4_000_000_000, volume24hUsd: 200_000_000 },
  { symbol: "OP", name: "Optimism", chain: "optimism", priceUsd: 2.5, marketCapUsd: 2_500_000_000, volume24hUsd: 100_000_000 },
  { symbol: "DEGEN", name: "Degen", chain: "base", priceUsd: 0.01, marketCapUsd: 50_000_000, volume24hUsd: 5_000_000 },
  { symbol: "BRETT", name: "Brett", chain: "base", priceUsd: 0.05, marketCapUsd: 500_000_000, volume24hUsd: 30_000_000 },
  { symbol: "TOSHI", name: "Toshi", chain: "base", priceUsd: 0.001, marketCapUsd: 100_000_000, volume24hUsd: 10_000_000 },
];

// CoinGecko id → chain interna (o resto cai em "cex", igual ao mock dos majors)
const CHAIN_BY_CG_ID: Record<string, string> = {
  arbitrum: "arbitrum",
  "wrapped-bitcoin": "cex",
  "coinbase-wrapped-btc": "base",
  optimism: "optimism",
  "degen-base": "base",
  brett: "base",
  "based-brett": "base",
  toshi: "base",
  "aerodrome-finance": "base",
};

interface CgMarketRow {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
}

function mapMarkets(rows: CgMarketRow[]): Token[] {
  return rows
    .filter((r) => typeof r.current_price === "number" && r.current_price > 0)
    .map((r) => ({
      symbol: r.symbol.toUpperCase(),
      name: r.name,
      chain: CHAIN_BY_CG_ID[r.id] ?? "cex",
      priceUsd: r.current_price,
      marketCapUsd: r.market_cap ?? 0,
      volume24hUsd: r.total_volume ?? 0,
    }));
}

export async function fetchCoinGecko(): Promise<{ tokens: Token[]; source: string }> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return { tokens: MOCK_TOKENS, source: "CoinGecko mock" };
  }

  try {
    const apiKey = getEnv().COINGECKO_API_KEY;
    const url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1";
    const resp = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      throw new Error(`CoinGecko HTTP ${resp.status}`);
    }
    const rows = (await resp.json()) as CgMarketRow[];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("CoinGecko resposta vazia ou malformada");
    }
    const tokens = mapMarkets(rows);
    logger.info("etl", `CoinGecko real: ${tokens.length} tokens (top market cap)`);
    return {
      tokens,
      source: apiKey ? "CoinGecko real (demo key)" : "CoinGecko real (public)",
    };
  } catch (e) {
    logger.warn("etl", `CoinGecko real falhou — usando mock como fallback: ${String(e)}`);
    return { tokens: MOCK_TOKENS, source: "CoinGecko mock (fallback)" };
  }
}
