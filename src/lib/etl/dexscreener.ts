// src/lib/etl/dexscreener.ts — DexScreener connector (mock, 10 DEX pairs)
export interface DexPair {
  pair: string;        // e.g. "ETH/USDC"
  dex: string;         // e.g. "uniswap-v3"
  chain: string;       // e.g. "ethereum"
  liquidityUsd: number;
  volume24hUsd: number;
  priceUsd: number;
}

const MOCK_PAIRS: DexPair[] = [
  { pair: "ETH/USDC", dex: "uniswap-v3", chain: "ethereum", liquidityUsd: 50_000_000, volume24hUsd: 8_000_000, priceUsd: 3500 },
  { pair: "WBTC/USDC", dex: "uniswap-v3", chain: "ethereum", liquidityUsd: 30_000_000, volume24hUsd: 4_000_000, priceUsd: 65000 },
  { pair: "ARB/ETH", dex: "camelot", chain: "arbitrum", liquidityUsd: 5_000_000, volume24hUsd: 800_000, priceUsd: 0.000343 },
  { pair: "OP/ETH", dex: "velodrome", chain: "optimism", liquidityUsd: 8_000_000, volume24hUsd: 1_200_000, priceUsd: 0.000714 },
  { pair: "DEGEN/ETH", dex: "aerodrome", chain: "base", liquidityUsd: 1_500_000, volume24hUsd: 200_000, priceUsd: 0.00000286 },
  { pair: "BRETT/WETH", dex: "baseswap", chain: "base", liquidityUsd: 3_000_000, volume24hUsd: 500_000, priceUsd: 0.0000143 },
  { pair: "TOSHI/WETH", dex: "aerodrome", chain: "base", liquidityUsd: 800_000, volume24hUsd: 100_000, priceUsd: 0.000000286 },
  { pair: "USDC/USDT", dex: "uniswap-v3", chain: "ethereum", liquidityUsd: 100_000_000, volume24hUsd: 50_000_000, priceUsd: 1.0001 },
  { pair: "DAI/USDC", dex: "uniswap-v3", chain: "ethereum", liquidityUsd: 20_000_000, volume24hUsd: 1_000_000, priceUsd: 1.00005 },
  { pair: "WSTETH/ETH", dex: "curve", chain: "ethereum", liquidityUsd: 200_000_000, volume24hUsd: 5_000_000, priceUsd: 1.085 },
];

export async function fetchDexScreener(): Promise<{ pairs: DexPair[]; source: string }> {
  // Real: fetch https://api.dexscreener.com/latest/dex/tokens/{address}
  return { pairs: MOCK_PAIRS, source: "DexScreener mock" };
}
