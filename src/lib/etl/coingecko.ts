// src/lib/etl/coingecko.ts — CoinGecko connector (HTTP real, sem mock)
//
// Endpoint real (free tier): GET /api/v3/coins/markets (top 100 por market cap).
//   - Com chave demo: https://api.coingecko.com/api/v3/coins/markets
//     header x-cg-demo-api-key (30 req/min).
//   - Se a chave existir mas estiver inválida (401/403), caímos para o endpoint
//     público SEM a chave (com warning), que é o modo anônimo do mesmo host.
//   - Se o fallback também falhar, LANÇA: nunca devolvemos preços inventados.
import { getEnv } from "@/lib/env";
import { logger } from "../trading/logger";
import type { EtlProvenance } from "./dexscreener";

export interface Token {
  symbol: string;
  name: string;
  chain: string;
  priceUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
}

// CoinGecko id → chain interna (o resto cai em "cex", igual à lista de majors)
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

const CG_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1";
const CG_TIMEOUT_MS = 10_000;

function mapMarkets(rows: CgMarketRow[]): Token[] {
  return rows
    .filter((r) => typeof r.current_price === "number" && r.current_price > 0)
    .map((r) => ({
      symbol: String(r.symbol ?? "").toUpperCase(),
      name: r.name,
      chain: CHAIN_BY_CG_ID[r.id] ?? "cex",
      priceUsd: r.current_price,
      marketCapUsd: r.market_cap ?? 0,
      volume24hUsd: r.total_volume ?? 0,
    }));
}

async function callMarkets(apiKey?: string): Promise<CgMarketRow[]> {
  const resp = await fetch(CG_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}),
    },
    signal: AbortSignal.timeout(CG_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const err = new Error(`CoinGecko HTTP ${resp.status}`) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
  const rows = (await resp.json()) as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("CoinGecko resposta vazia ou malformada");
  }
  return rows as CgMarketRow[];
}

export async function fetchCoinGecko(): Promise<{
  tokens: Token[];
  source: string;
  provenance: EtlProvenance;
}> {
  const apiKey = getEnv().COINGECKO_API_KEY;
  let rows: CgMarketRow[];
  let source: string;

  if (apiKey) {
    try {
      rows = await callMarkets(apiKey);
      source = "CoinGecko live (demo key)";
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        logger.warn(
          "etl",
          `CoinGecko demo key inválida (HTTP ${status}) — fallback para o endpoint público sem chave`
        );
        rows = await callMarkets();
        source = `CoinGecko live (público, fallback após HTTP ${status} da demo key)`;
      } else {
        throw err;
      }
    }
  } else {
    rows = await callMarkets();
    source = "CoinGecko live (público, sem chave)";
  }

  const tokens = mapMarkets(rows);
  if (tokens.length === 0) throw new Error("CoinGecko: nenhum token utilizável na resposta");
  logger.info("etl", `CoinGecko real: ${tokens.length} tokens (top market cap)`);
  return { tokens, source, provenance: "live" };
}
