import { describe, it, expect } from 'vitest';
import { fetchCoinGecko } from '../src/lib/etl/coingecko';
import { runETL } from '../src/lib/etl/run';

describe('DataSource logging (S26 T003)', () => {
  it('fetchCoinGecko has 10 tokens with source field', async () => {
    const r = await fetchCoinGecko();
    expect(r.tokens).toHaveLength(10);
    expect(r.source).toBe('CoinGecko mock');
  });

  it('runETL persists 4 DataSource rows + indexes 30 embeddings', async () => {
    const r = await runETL();
    expect(r.dataSources).toBe(4);
    expect(r.tokens + r.pairs + r.audits + r.sources).toBe(30);
    expect(r.embeddings).toBeGreaterThanOrEqual(30);
  }, 30000);
});
