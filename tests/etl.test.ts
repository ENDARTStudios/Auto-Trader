// tests/etl.test.ts — connectors ETL com HTTP real mockado (sem mocks de DADOS)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCoinGecko } from '@/lib/etl/coingecko';
import { fetchDexScreener } from '@/lib/etl/dexscreener';
import { fetchGoPlus } from '@/lib/etl/goplus';
import { fetchEtherscan } from '@/lib/etl/etherscan';
import { runETL } from '@/lib/etl/run';

const CG_ROWS = Array.from({ length: 10 }, (_, i) => ({
  id: ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'ripple', 'arbitrum', 'optimism', 'degen-base', 'brett', 'toshi'][i],
  symbol: ['btc', 'eth', 'sol', 'bnb', 'xrp', 'arb', 'op', 'degen', 'brett', 'toshi'][i],
  name: `Token${i}`,
  current_price: 100 - i,
  market_cap: 1_000_000 * (10 - i),
  total_volume: 500_000,
}));

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
  result: {
    '0xweth': { is_honeypot: '0', buy_tax: '0', sell_tax: '0', is_open_source: '1', is_proxy: '0', is_mintable: '0', is_blacklisted: '0' },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(handler: (url: string) => Response) {
  const fn = vi.fn((input: unknown) => handler(String(input)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Crypto ETL (connectors reais)', () => {
  it('fetchCoinGecko devolve tokens reais (provenance live)', async () => {
    mockFetch(() => jsonResponse(CG_ROWS));
    const res = await fetchCoinGecko();
    expect(res.tokens).toHaveLength(10);
    expect(res.tokens[0].symbol).toBe('BTC');
    expect(res.provenance).toBe('live');
  });

  it('fetchDexScreener devolve pares reais com par e liquidez', async () => {
    mockFetch(() => jsonResponse([DS_PAIR]));
    const res = await fetchDexScreener();
    expect(res.provenance).toBe('live');
    expect(res.pairs.length).toBeGreaterThan(0);
    expect(res.pairs[0].pair).toContain('WETH');
    expect(res.pairs[0].liquidityUsd).toBeGreaterThan(0);
  });

  it('fetchGoPlus devolve audits reais (sem honeypot forçado)', async () => {
    mockFetch(() => jsonResponse(GP_RESULT));
    const res = await fetchGoPlus([{ chain: 'ethereum', tokenId: '0xWeth' }]);
    expect(res.provenance).toBe('live');
    expect(res.audits).toHaveLength(1);
    expect(res.audits[0].isHoneypot).toBe(false);
    expect(res.audits[0].contractVerified).toBe(true);
  });

  it('fetchEtherscan em NODE_ENV=test declara provenance mock (não finge live)', async () => {
    const res = await fetchEtherscan();
    expect(res.provenance).toBe('mock');
    expect(res.source).toContain('mock');
  });

  it('runETL reporta contagens + proveniência por fonte', async () => {
    mockFetch((url) => {
      if (url.includes('coingecko')) return jsonResponse(CG_ROWS);
      if (url.includes('dexscreener')) return jsonResponse([DS_PAIR]);
      if (url.includes('gopluslabs')) return jsonResponse(GP_RESULT);
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await runETL();
    expect(res.tokens).toBe(10);
    expect(res.pairs).toBeGreaterThan(0);
    expect(res.audits).toBeGreaterThan(0);
    expect(res.dataSources).toBe(4);
    expect(res.embeddings).toBeGreaterThan(0);
    const cg = res.sources.find((s) => s.name === 'CoinGecko');
    expect(cg?.status).toBe('ok');
  }, 30000);
});
