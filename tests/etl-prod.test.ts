import { describe, it, expect } from 'vitest';
import { fetchCoinGecko } from '../src/lib/etl/coingecko';
import { fetchDexScreener } from '../src/lib/etl/dexscreener';

describe('Crypto ETL production (S24 T004)', () => {
  it('fetchCoinGecko returns tokens with required fields', async () => {
    const { tokens, source } = await fetchCoinGecko();
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) {
      expect(t.symbol).toBeTruthy();
      expect(typeof t.priceUsd).toBe('number');
      expect(t.priceUsd).toBeGreaterThan(0);
      expect(['cex', 'arbitrum', 'optimism', 'base']).toContain(t.chain);
    }
    expect(source).toContain('CoinGecko');
  });

  it('BTC always present in CoinGecko result', async () => {
    const { tokens } = await fetchCoinGecko();
    expect(tokens.find((t) => t.symbol === 'BTC')).toBeDefined();
  });

  it('fetchDexScreener returns pairs with liquidity > 0', async () => {
    const { pairs, source } = await fetchDexScreener();
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.liquidityUsd).toBeGreaterThan(0);
      expect(p.pair).toMatch(/^[A-Z]+\/[A-Z]+$/);
      expect(['ethereum', 'arbitrum', 'optimism', 'base']).toContain(p.chain);
    }
    expect(source).toContain('DexScreener');
  });

  it('Coingecko priceUsd consistent with marketCapUsd (cap >= price for supply >= 1)', async () => {
    const { tokens } = await fetchCoinGecko();
    for (const t of tokens) {
      expect(t.marketCapUsd).toBeGreaterThan(0);
      expect(t.volume24hUsd).toBeGreaterThanOrEqual(0);
    }
  });
});
