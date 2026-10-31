import { describe, it, expect } from 'vitest';
import { fetchCoinGecko } from '@/lib/etl/coingecko';
import { fetchDexScreener } from '@/lib/etl/dexscreener';
import { fetchGoPlus } from '@/lib/etl/goplus';
import { fetchEtherscan } from '@/lib/etl/etherscan';
import { runETL } from '@/lib/etl/run';

describe('Crypto ETL', () => {
  it('fetchCoinGecko 10 tokens', async () => {
    const res = await fetchCoinGecko();
    expect(res.tokens.length).toBe(10);
    expect(res.tokens[0].symbol).toBe('BTC');
  });

  it('fetchDexScreener 10 pairs', async () => {
    const res = await fetchDexScreener();
    expect(res.pairs.length).toBe(10);
    expect(res.pairs[0].pair).toContain('ETH');
  });

  it('fetchGoPlus 5 audits', async () => {
    const res = await fetchGoPlus();
    expect(res.audits.length).toBe(5);
    // At least one honeypot example exists
    expect(res.audits.some((a) => a.isHoneypot)).toBe(true);
  });

  it('fetchEtherscan 5 contracts', async () => {
    const res = await fetchEtherscan();
    expect(res.sources.length).toBe(5);
  });

  it('runETL embeddings crypto', async () => {
    const res = await runETL();
    expect(res.tokens).toBe(10);
    expect(res.pairs).toBe(10);
    expect(res.audits).toBe(5);
    expect(res.sources).toBe(5);
    expect(res.embeddings).toBeGreaterThan(0);
  });
});
