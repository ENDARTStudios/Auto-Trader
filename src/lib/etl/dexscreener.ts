// src/lib/etl/dexscreener.ts — DexScreener connector (HTTP real, sem mock)
//
// Endpoints reais usados (públicos, sem auth, free tier ~300 req/min):
//   GET https://api.dexscreener.com/tokens/v1/{chain}/{tokenAddress}
//       -> lista os pares (pools) em que o token aparece, cada um com
//          pairAddress, dexId, liquidity.usd, volume.h24, priceUsd,
//          baseToken/quoteToken.
//
// Regra de honestidade: nada de dados sintéticos aqui. Se a API falhar ou
// devolver vazio, o connector LANÇA — o orquestrador (run.ts) registra
// status "error" e proveniência "error". A UI nunca deve ler dado inventado.
import { logger } from "../trading/logger";

export interface DexPair {
  pair: string;          // e.g. "WETH/USDC"
  dex: string;           // e.g. "uniswap"
  chain: string;         // e.g. "ethereum"
  liquidityUsd: number;
  volume24hUsd: number;
  priceUsd: number;
  pairAddress: string;   // endereço do pool (usado p/ OHLCV real no GeckoTerminal)
  baseToken: string;     // símbolo do token base do par
  quoteToken: string;    // símbolo do token quote do par
  baseTokenAddress: string;
  quoteTokenAddress: string;
}

export type EtlProvenance = "live" | "mock" | "error";

/** Par bruto (subconjunto tipado) devolvido por /tokens/v1/{chain}/{address}. */
export interface DexScreenerRawPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h6?: number; h1?: number };
}

const DS_TIMEOUT_MS = 8_000;
const DS_BASE = "https://api.dexscreener.com";

/**
 * Universo de tokens do ETL — endereços canônicos por chain (WETH/USDC).
 * É uma lista explícita (não sintética): cada entrada é consultada na API real
 * e o resultado é o que a API devolveu.
 */
export const ETL_TOKEN_UNIVERSE: ReadonlyArray<{ chain: string; tokenId: string }> = [
  { chain: "ethereum", tokenId: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" }, // WETH
  { chain: "ethereum", tokenId: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }, // USDC
  { chain: "base", tokenId: "0x4200000000000000000000000000000000000006" },     // WETH (Base)
  { chain: "base", tokenId: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },     // USDC (Base)
  { chain: "arbitrum", tokenId: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" }, // WETH (Arbitrum)
  { chain: "arbitrum", tokenId: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" }, // USDC (Arbitrum)
  { chain: "optimism", tokenId: "0x4200000000000000000000000000000000000006" }, // WETH (Optimism)
  { chain: "optimism", tokenId: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" }, // USDC (Optimism)
];

function toPair(raw: DexScreenerRawPair, chain: string): DexPair | null {
  const pairAddress = raw.pairAddress?.trim();
  if (!pairAddress) return null;
  const base = raw.baseToken?.symbol ?? "?";
  const quote = raw.quoteToken?.symbol ?? "?";
  return {
    pair: `${base}/${quote}`,
    dex: raw.dexId ?? "unknown",
    chain: raw.chainId ?? chain,
    liquidityUsd: raw.liquidity?.usd ?? 0,
    volume24hUsd: raw.volume?.h24 ?? 0,
    priceUsd: Number.parseFloat(raw.priceUsd ?? "0"),
    pairAddress,
    baseToken: base,
    quoteToken: quote,
    baseTokenAddress: raw.baseToken?.address ?? "",
    quoteTokenAddress: raw.quoteToken?.address ?? "",
  };
}

/**
 * Busca os pares reais de um token específico. Lança em HTTP != 2xx, corpo
 * malformado ou lista vazia (o chamador decide se degrada ou falha).
 */
export async function fetchTokenPairs(
  chain: string,
  tokenId: string
): Promise<{ pairs: DexPair[]; url: string }> {
  const url = `${DS_BASE}/tokens/v1/${encodeURIComponent(chain)}/${encodeURIComponent(tokenId)}`;
  const resp = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(DS_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`DexScreener HTTP ${resp.status} (${chain}:${tokenId})`);
  const json = (await resp.json()) as unknown;
  if (!Array.isArray(json)) throw new Error("DexScreener resposta não-array");
  const pairs = (json as DexScreenerRawPair[])
    .map((p) => toPair(p, chain))
    .filter((p): p is DexPair => p !== null && p.priceUsd > 0);
  if (pairs.length === 0) throw new Error(`DexScreener sem pares para ${chain}:${tokenId}`);
  return { pairs, url };
}

/**
 * Snapshot real de pares DEX no universo curado. Uma falha pontual num token
 * não derruba o lote (registra warn); se NADA vier da API, lança.
 */
export async function fetchDexScreener(): Promise<{
  pairs: DexPair[];
  source: string;
  provenance: EtlProvenance;
}> {
  const pairs: DexPair[] = [];
  const seen = new Set<string>();
  let lastUrl = `${DS_BASE}/tokens/v1`;
  let failures = 0;

  for (const item of ETL_TOKEN_UNIVERSE) {
    try {
      const res = await fetchTokenPairs(item.chain, item.tokenId);
      lastUrl = res.url;
      for (const p of res.pairs) {
        const key = `${p.chain}:${p.pairAddress.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push(p);
      }
    } catch (err) {
      failures++;
      logger.warn("etl", `DexScreener ${item.chain}:${item.tokenId} falhou: ${String(err)}`);
    }
  }

  if (pairs.length === 0) {
    throw new Error(`DexScreener: nenhum par real obtido (${failures} falhas)`);
  }
  logger.info("etl", `DexScreener real: ${pairs.length} pares (${failures} falhas parciais)`);
  return {
    pairs,
    source: `DexScreener live (${pairs.length} pares, ${failures} falhas)`,
    provenance: "live",
  };
}
