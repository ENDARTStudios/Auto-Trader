// tests/datasource-logging.test.ts — DataSource logging com proveniência real
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCoinGecko } from '../src/lib/etl/coingecko';
import { runETL } from '../src/lib/etl/run';

const CG_ROWS = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 77861, market_cap: 1_565_416_281_273, total_volume: 25_545_327_677 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', current_price: 2295.49, market_cap: 276_000_000_000, total_volume: 15_000_000_000 },
];

const DS_PAIR = {
  chainId: 'ethereum',
  dexId: 'uniswap',
  pairAddress: '0xPoolEth',
  baseToken: { address: '0xWeth', symbol: 'WETH' },
  quoteToken: { address: '0xUsdc', symbol: 'USDC' },
  priceUsd: '2295.49',
  liquidity: { usd: 4_000_000 },
  volume: { h24: 65_000_000 },
};

const GP_RESULT = {
  code: 1,
  result: { '0xweth': { is_honeypot: '0', is_open_source: '1' } },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DataSource logging (S26 T003)', () => {
  it('fetchCoinGecko devolve source label real (não "mock")', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(CG_ROWS)));
    const r = await fetchCoinGecko();
    expect(r.tokens).toHaveLength(2);
    expect(r.source).toContain('CoinGecko live');
    expect(r.source.toLowerCase()).not.toContain('mock');
  });

  it('runETL persiste 4 DataSource rows com status por proveniência', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        const url = String(input);
        if (url.includes('coingecko')) return jsonResponse(CG_ROWS);
        if (url.includes('dexscreener')) return jsonResponse([DS_PAIR]);
        if (url.includes('gopluslabs')) return jsonResponse(GP_RESULT);
        return jsonResponse({ error: 'unexpected' }, 500);
      })
    );

    const r = await runETL();
    expect(r.dataSources).toBe(4);
    expect(r.sources).toHaveLength(4);
    expect(r.tokens).toBe(2);
    expect(r.pairs).toBeGreaterThan(0);
    expect(r.audits).toBeGreaterThan(0);
    // Etherscan em NODE_ENV=test devolve mock -> NÃO pode ser reportado como ok
    expect(r.sources.find((s) => s.name === 'Etherscan')?.status).toBe('error');
    expect(r.sources.find((s) => s.name === 'CoinGecko')?.status).toBe('ok');
    expect(r.embeddings).toBeGreaterThanOrEqual(0);
  }, 30000);
});
