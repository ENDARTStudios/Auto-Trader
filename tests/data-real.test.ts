// tests/data-real.test.ts — ETL com HTTP REAL mockado: prova feliz, erro, fallback
// CoinGecko e proveniência (status "ok" SÓ para HTTP 2xx).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCoinGecko } from '@/lib/etl/coingecko';
import { fetchDexScreener } from '@/lib/etl/dexscreener';
import { fetchGoPlus } from '@/lib/etl/goplus';
import { runETL } from '@/lib/etl/run';
import { __resetEnvCache } from '@/lib/env';

const CG_ROWS = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 50000, market_cap: 1_000_000_000_000, total_volume: 25_000_000_000 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', current_price: 2500, market_cap: 300_000_000_000, total_volume: 12_000_000_000 },
  { id: 'degen-base', symbol: 'degen', name: 'Degen', current_price: 0.0009, market_cap: 90_000_000, total_volume: 5_000_000 },
];

const DS_PAIR = {
  chainId: 'base',
  dexId: 'uniswap',
  pairAddress: '0xPairBaseDegen',
  baseToken: { address: '0xTokenDegen', symbol: 'DEGEN' },
  quoteToken: { address: '0xWeth', symbol: 'WETH' },
  priceUsd: '0.0009',
  liquidity: { usd: 250000 },
  volume: { h24: 30000 },
};

const GP_RESULT = {
  code: 1,
  message: 'OK',
  result: {
    '0xtokendegen': {
      is_honeypot: '1',
      buy_tax: '0.05',
      sell_tax: '0.99',
      cannot_sell_all: '1',
      is_open_source: '0',
      is_proxy: '0',
      is_mintable: '1',
      is_blacklisted: '0',
    },
  },
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(handler: Handler) {
  const fn = vi.fn((input: unknown, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function fetchCalls(fn: ReturnType<typeof mockFetch>): Array<{ url: string; init?: RequestInit }> {
  return fn.mock.calls.map((c) => ({ url: String(c[0]), init: c[1] as RequestInit | undefined }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COINGECKO_API_KEY;
  __resetEnvCache();
});

describe('CoinGecko ETL (HTTP real)', () => {
  it('sucesso: devolve tokens reais com provenance live', async () => {
    const fn = mockFetch((url) => {
      expect(url).toContain('api.coingecko.com/api/v3/coins/markets');
      return jsonResponse(CG_ROWS);
    });

    const res = await fetchCoinGecko();
    expect(res.provenance).toBe('live');
    expect(res.tokens).toHaveLength(3);
    expect(res.tokens[0].symbol).toBe('BTC');
    expect(res.tokens[2].chain).toBe('base');
    expect(res.source).toContain('CoinGecko');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('chave demo inválida (401): fallback para endpoint público sem a chave', async () => {
    process.env.COINGECKO_API_KEY = 'chave-invalida';
    __resetEnvCache();
    const fn = mockFetch((_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers['x-cg-demo-api-key']) return jsonResponse({ error: 'invalid key' }, 401);
      return jsonResponse(CG_ROWS);
    });

    const res = await fetchCoinGecko();
    expect(res.provenance).toBe('live');
    expect(res.source).toContain('fallback');
    const calls = fetchCalls(fn);
    expect(calls).toHaveLength(2);
    expect((calls[0].init?.headers as Record<string, string>)['x-cg-demo-api-key']).toBe('chave-invalida');
    expect((calls[1].init?.headers as Record<string, string>)['x-cg-demo-api-key']).toBeUndefined();
  });

  it('sem chave: usa endpoint público', async () => {
    const fn = mockFetch(() => jsonResponse(CG_ROWS));
    const res = await fetchCoinGecko();
    expect(res.source).toContain('sem chave');
    const calls = fetchCalls(fn);
    expect((calls[0].init?.headers as Record<string, string>)['x-cg-demo-api-key']).toBeUndefined();
  });

  it('falha total: lança erro real (NUNCA devolve mock)', async () => {
    mockFetch((_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers['x-cg-demo-api-key']) return jsonResponse({ error: 'invalid key' }, 401);
      return jsonResponse({ error: 'boom' }, 502);
    });
    process.env.COINGECKO_API_KEY = 'chave-invalida';
    __resetEnvCache();
    await expect(fetchCoinGecko()).rejects.toThrow(/CoinGecko HTTP 502/);
  });
});

describe('DexScreener ETL (HTTP real)', () => {
  it('sucesso: pares reais com pairAddress e provenance live', async () => {
    mockFetch(() => jsonResponse([DS_PAIR]));
    const res = await fetchDexScreener();
    expect(res.provenance).toBe('live');
    expect(res.pairs.length).toBeGreaterThan(0);
    expect(res.pairs[0].pairAddress).toBe('0xPairBaseDegen');
    expect(res.pairs[0].pair).toBe('DEGEN/WETH');
    expect(res.pairs[0].liquidityUsd).toBe(250000);
  });

  it('HTTP 500 em todos os tokens: lança (sem pares inventados)', async () => {
    mockFetch(() => jsonResponse({ error: 'down' }, 500));
    await expect(fetchDexScreener()).rejects.toThrow(/DexScreener/);
  });
});

describe('GoPlus ETL (HTTP real)', () => {
  it('sucesso: audits reais com honeypot/tax parseados', async () => {
    const fn = mockFetch((url) => {
      expect(url).toContain('api.gopluslabs.io/api/v1/token_security/');
      return jsonResponse(GP_RESULT);
    });
    const res = await fetchGoPlus([{ chain: 'base', tokenId: '0xTokenDegen' }]);
    expect(res.provenance).toBe('live');
    expect(res.audits).toHaveLength(1);
    const a = res.audits[0];
    expect(a.isHoneypot).toBe(true);
    expect(a.cannotSell).toBe(true);
    expect(a.contractVerified).toBe(false);
    expect(a.sellTax).toBeCloseTo(0.99);
    expect(a.riskScore).toBeGreaterThan(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('HTTP 500: lança (não inventa audit)', async () => {
    mockFetch(() => jsonResponse({ error: 'down' }, 500));
    await expect(fetchGoPlus([{ chain: 'base', tokenId: '0xTokenDegen' }])).rejects.toThrow(/GoPlus/);
  });
});

describe('runETL — proveniência persistida', () => {
  it('status ok SÓ para fonte que veio de HTTP 2xx; erro mantém o source', async () => {
    mockFetch((url) => {
      if (url.includes('coingecko')) return jsonResponse(CG_ROWS);
      if (url.includes('dexscreener')) return jsonResponse([DS_PAIR]);
      if (url.includes('gopluslabs')) return jsonResponse({ error: 'down' }, 500);
      throw new Error(`fetch inesperado: ${url}`);
    });

    const res = await runETL();
    const byName = new Map(res.sources.map((s) => [s.name, s]));

    expect(byName.get('CoinGecko')?.status).toBe('ok');
    expect(byName.get('CoinGecko')?.provenance).toBe('live');
    expect(byName.get('CoinGecko')?.source).toContain('CoinGecko live');
    expect(byName.get('CoinGecko')?.recordsCount).toBe(3);

    expect(byName.get('DexScreener')?.status).toBe('ok');
    expect(byName.get('DexScreener')?.recordsCount).toBeGreaterThan(0);

    // GoPlus falhou (HTTP 500) -> error, e o source do connector não é descartado
    const goplus = byName.get('GoPlus');
    expect(goplus?.status).toBe('error');
    expect(goplus?.provenance).toBe('error');
    expect(goplus?.error).toMatch(/GoPlus/i);

    // Etherscan em NODE_ENV=test devolve mock -> declarado não-live => error
    const etherscan = byName.get('Etherscan');
    expect(etherscan?.status).toBe('error');
    expect(etherscan?.provenance).toBe('mock');

    expect(res.tokens).toBe(3);
    expect(res.pairs).toBeGreaterThan(0);
    expect(res.audits).toBe(0);
    expect(res.dataSources).toBe(4);
    expect(typeof res.startedAt).toBe('string');
    expect(typeof res.finishedAt).toBe('string');
  }, 30000);
});
