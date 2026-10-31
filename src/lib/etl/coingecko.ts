// src/lib/etl/coingecko.ts — CoinGecko connector (mock, 10 tokens)
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

export async function fetchCoinGecko(): Promise<{ tokens: Token[]; source: string }> {
  // Real: fetch https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc
  return { tokens: MOCK_TOKENS, source: "CoinGecko mock" };
}
