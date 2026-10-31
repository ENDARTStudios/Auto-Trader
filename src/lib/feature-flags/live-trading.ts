// src/lib/feature-flags/live-trading.ts — S25 T002: FeatureFlag para live_trading (CCXT testnet + ethers mainnet)
import { db } from '@/lib/db';

export interface LiveTradingConfig {
  enabled: boolean;
  testnet: boolean;
  maxPositionUsd: number;
  allowedChains: string[];
  killSwitchSecondsToConfirm: number;
}

const DEFAULTS: LiveTradingConfig = {
  enabled: false,        // OFF by default — explicit opt-in required
  testnet: true,         // default to testnet (safer)
  maxPositionUsd: 1000,  // $1k per position cap
  allowedChains: ['base', 'arbitrum', 'optimism', 'ethereum'],
  killSwitchSecondsToConfirm: 5,
};

let cache: { value: LiveTradingConfig; ts: number } | null = null;
const CACHE_TTL_MS = 10_000;

export async function getLiveTradingConfig(): Promise<LiveTradingConfig> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.value;
  }
  try {
    const flag = await db.featureFlag.findUnique({ where: { key: 'live_trading' } });
    if (flag) {
      const parsed = flag.description ? JSON.parse(flag.description) : {};
      cache = { value: { ...DEFAULTS, ...parsed, enabled: flag.enabled }, ts: Date.now() };
      return cache.value;
    }
  } catch {
    // ignore
  }
  cache = { value: DEFAULTS, ts: Date.now() };
  return cache.value;
}

export async function setLiveTradingConfig(updates: Partial<LiveTradingConfig>): Promise<void> {
  const current = await getLiveTradingConfig();
  const next: LiveTradingConfig = { ...current, ...updates };
  await db.featureFlag.upsert({
    where: { key: 'live_trading' },
    create: {
      key: 'live_trading',
      description: JSON.stringify(next),
      enabled: next.enabled,
      rolloutPct: 100,
    },
    update: {
      description: JSON.stringify(next),
      enabled: next.enabled,
    },
  });
  cache = { value: next, ts: Date.now() };
}

export async function isLiveTradingEnabled(): Promise<boolean> {
  const cfg = await getLiveTradingConfig();
  return cfg.enabled;
}

export function invalidateLiveTradingCache(): void {
  cache = null;
}
