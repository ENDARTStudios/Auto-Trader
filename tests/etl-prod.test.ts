// tests/etl-prod.test.ts — formato de produção dos connectors (HTTP real mockado)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCoinGecko } from '../src/lib/etl/coingecko';
import { fetchDexScreener } from '../src/lib/etl/dexscreener';

const CG_ROWS = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 77861, market_cap: 1_565_416_281_273, total_volume: 25_545_327_677 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', current_price: 2295.49, market_cap: 276_000_000_000, total_volume: 15_000_000_000 },
  { id: 'degen-base', symbol: 'degen', name: 'Degen', current_price: 0.00086, market_cap: 90_000_000, total_volume: 29_000 },
];

const DS_PAIRS = [
  {
    chainId: 'base',
    dexId: 'uniswap',
    pairAddress: '0xc9034c3E7F58003E6ae0C8438e7c8f4598d5ACAA',
    baseToken: { address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', symbol: 'DEGEN' },
    quoteToken: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH' },
    priceUsd: '0.0008626',
    liquidity: { usd: 237357.06 },
    volume: { h24: 29053.81 },
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Crypto ETL production shape (S24 T004)', () => {
  it('fetchCoinGecko devolve tokens com campos válidos', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(CG_ROWS)));
    const { tokens, source, provenance } = await fetchCoinGecko();
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) {
      expect(t.symbol).toBeTruthy();
      expect(typeof t.priceUsd).toBe('number');
      expect(t.priceUsd).toBeGreaterThan(0);
      expect(['cex', 'arbitrum', 'optimism', 'base']).toContain(t.chain);
    }
    expect(source).toContain('CoinGecko');
    expect(provenance).toBe('live');
  });

  it('BTC sempre presente quando a API o devolve', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(CG_ROWS)));
    const { tokens } = await fetchCoinGecko();
    expect(tokens.find((t) => t.symbol === 'BTC')).toBeDefined();
  });

  it('fetchDexScreener devolve pares com liquidez > 0 e pairAddress', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(DS_PAIRS)));
    const { pairs, source, provenance } = await fetchDexScreener();
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.liquidityUsd).toBeGreaterThan(0);
      expect(p.pair).toMatch(/^[A-Z0-9]+\/[A-Z0-9]+$/);
      expect(['ethereum', 'arbitrum', 'optimism', 'base']).toContain(p.chain);
      expect(p.pairAddress).toMatch(/^0x/);
    }
    expect(source).toContain('DexScreener');
    expect(provenance).toBe('live');
  });

  it('marketCap/volume coerentes (não negativos)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(CG_ROWS)));
    const { tokens } = await fetchCoinGecko();
    for (const t of tokens) {
      expect(t.marketCapUsd).toBeGreaterThan(0);
      expect(t.volume24hUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it('falha de rede propaga erro (não devolve dado sintético)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ error: 'down' }, 503)));
    await expect(fetchCoinGecko()).rejects.toThrow();
  });
});
