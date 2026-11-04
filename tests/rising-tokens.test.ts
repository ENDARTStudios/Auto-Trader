// tests/rising-tokens.test.ts — descoberta sem rede real (fetch mockado, caches isolados)
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { EngineConfig } from '@/lib/trading/config';

vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

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
  vi.resetModules();
});

async function loadRising() {
  vi.resetModules();
  return await import('@/lib/trading/rising-tokens');
}

const CFG = { scanCex: true, scanDex: true } as unknown as EngineConfig;

const TRENDING = {
  coins: [
    { item: { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, data: { price: 50000, total_volume: { usd: 9_000_000_000 }, price_change_percentage_24h: { usd: 2 } } } },
    { item: { id: 'degen-base', symbol: 'degen', name: 'Degen', data: { price: 0.001, total_volume: { usd: 1_000_000 }, price_change_percentage_24h: { usd: 12 } } } },
  ],
};

const MARKETS = [
  { id: 'solana', symbol: 'sol', name: 'Solana', current_price: 150, market_cap_rank: 5, total_volume: 2_000_000_000, price_change_percentage_1h_in_currency: 1.2, price_change_percentage_24h: 8 },
  { id: 'pumpfun-token', symbol: 'pump', name: 'Pump', current_price: 0.01, market_cap_rank: 400, total_volume: 30_000_000, price_change_percentage_1h_in_currency: 0.5, price_change_percentage_24h: 20 },
  { id: 'degen-base', symbol: 'degen', name: 'Degen', current_price: 0.001, market_cap_rank: 900, total_volume: 1_000_000, price_change_percentage_1h_in_currency: 0.9, price_change_percentage_24h: 10 },
  // excluídos pelos filtros: 24h <= 5 ou 1h <= 0
  { id: 'flat-coin', symbol: 'flat', name: 'Flat', current_price: 1, market_cap_rank: 100, total_volume: 1_000_000, price_change_percentage_1h_in_currency: 1, price_change_percentage_24h: 1 },
  { id: 'dumping', symbol: 'dmp', name: 'Dumping', current_price: 2, market_cap_rank: 300, total_volume: 2_000_000, price_change_percentage_1h_in_currency: -1, price_change_percentage_24h: 15 },
];

function handler(url: string): Response {
  if (url.includes('/search/trending')) return jsonResponse(TRENDING);
  if (url.includes('/coins/markets')) return jsonResponse(MARKETS);
  throw new Error(`fetch inesperado: ${url}`);
}

describe('discoverRisingTokens — CoinGecko trending', () => {
  it('mapeia majors como CEX e tokens sem rank como DEX', async () => {
    mockFetch(handler);
    const { discoverRisingTokens } = await loadRising();
    const out = await discoverRisingTokens(CFG, 50);
    const btc = out.find((t) => t.symbol === 'BTC/USDT')!;
    const degen = out.find((t) => t.symbol === 'DEGEN')!;
    expect(btc).toMatchObject({ source: 'cex', platformId: 'binance', trendingRank: 1 });
    expect(btc.tokenId).toBeUndefined();
    expect(degen).toMatchObject({ source: 'dex', chain: 'coingecko', tokenId: 'degen-base' });
    expect(degen.discoverySource).toContain('coingecko_trending');
  });

  it('atribui trendingRank crescente (1 = mais quente)', async () => {
    mockFetch(handler);
    const { discoverRisingTokens } = await loadRising();
    const out = await discoverRisingTokens(CFG, 50);
    expect(out.find((t) => t.symbol === 'BTC/USDT')?.trendingRank).toBe(1);
    expect(out.find((t) => t.symbol === 'DEGEN')?.trendingRank).toBe(2);
  });
});

describe('discoverRisingTokens — top gainers', () => {
  it('filtra 24h>5% E 1h>0, ordena por 24h desc', async () => {
    mockFetch(handler);
    const { discoverRisingTokens } = await loadRising();
    const out = await discoverRisingTokens(CFG, 50);
    const symbols = out.map((t) => t.symbol);
    expect(symbols).toContain('SOL/USDT');
    expect(symbols).toContain('PUMP');
    expect(symbols).not.toContain('FLAT/USDT');
    expect(symbols).not.toContain('DMP');
    expect(out.find((t) => t.symbol === 'PUMP')?.priceChange24hPct).toBe(20);
    expect(out.find((t) => t.symbol === 'SOL/USDT')?.priceChange1hPct).toBe(1.2);
    expect(out.find((t) => t.symbol === 'SOL/USDT')?.discoverySource).toContain('coingecko_gainers');
  });

  it('token DEX de gainers usa market_cap_rank>200 => source dex', async () => {
    mockFetch(handler);
    const { discoverRisingTokens } = await loadRising();
    const out = await discoverRisingTokens(CFG, 50);
    const pump = out.find((t) => t.symbol === 'PUMP')!;
    expect(pump.source).toBe('dex');
    expect(pump.chain).toBe('coingecko');
    expect(pump.tokenId).toBe('pumpfun-token');
  });
});

describe('dedupe e score', () => {
  it('mesmo token em trending + gainers vira UMA entrada com fontes mescladas', async () => {
    mockFetch(handler);
    const { discoverRisingTokens } = await loadRising();
    const out = await discoverRisingTokens(CFG, 50);
    const degens = out.filter((t) => t.symbol === 'DEGEN');
    expect(degens).toHaveLength(1);
    expect(degens[0].discoverySource.sort()).toEqual(['coingecko_gainers', 'coingecko_trending']);
    // mantém o MAIOR priceChange e o MELHOR trendingRank
    expect(degens[0].priceChange24hPct).toBe(12);
    expect(degens[0].trendingRank).toBe(2);
  });

  it('risingScore é 0-100, > 0 para moedas em alta e lista ordenada desc', async () => {
    mockFetch(handler);
    const { discoverRisingTokens } = await loadRising();
    const out = await discoverRisingTokens(CFG, 50);
    expect(out.length).toBeGreaterThan(0);
    for (const t of out) {
      expect(t.risingScore).toBeGreaterThanOrEqual(0);
      expect(t.risingScore).toBeLessThanOrEqual(100);
    }
    expect(out[0].risingScore).toBeGreaterThan(0);
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].risingScore).toBeGreaterThanOrEqual(out[i].risingScore);
    }
  });

  it('respeita o limite pedido', async () => {
    mockFetch(handler);
    const { discoverRisingTokens } = await loadRising();
    expect(await discoverRisingTokens(CFG, 1)).toHaveLength(1);
    // únicos: BTC/USDT, DEGEN, SOL/USDT, PUMP (FLAT e DMP são filtrados)
    expect(await discoverRisingTokens(CFG, 50)).toHaveLength(4);
  });
});

describe('falhas de fonte e cache', () => {
  it('HTTP não-ok em ambas => lista vazia (degrada sem lançar)', async () => {
    mockFetch(() => jsonResponse({ error: 'down' }, 503));
    const { discoverRisingTokens } = await loadRising();
    expect(await discoverRisingTokens(CFG, 10)).toEqual([]);
  });

  it('erro de rede => lista vazia (catch)', async () => {
    mockFetch(() => { throw new Error('ECONNRESET'); });
    const { discoverRisingTokens } = await loadRising();
    expect(await discoverRisingTokens(CFG, 10)).toEqual([]);
  });

  it('falha parcial: trending 500 mas markets ok => gainers continuam', async () => {
    mockFetch((url) => (url.includes('/search/trending') ? jsonResponse({}, 500) : jsonResponse(MARKETS)));
    const { discoverRisingTokens } = await loadRising();
    const out = await discoverRisingTokens(CFG, 50);
    expect(out.map((t) => t.symbol)).toContain('SOL/USDT');
  });

  it('cache de 90s evita re-fetch na segunda chamada', async () => {
    const fn = mockFetch(handler);
    const { discoverRisingTokens } = await loadRising();
    await discoverRisingTokens(CFG, 50);
    const callsAfterFirst = fn.mock.calls.length;
    await discoverRisingTokens(CFG, 50);
    expect(fn.mock.calls.length).toBe(callsAfterFirst);
  });

  it('getRisingCandidates filtra por minScore e devolve TokenCandidate puro', async () => {
    mockFetch(handler);
    const { getRisingCandidates } = await loadRising();
    const all = await getRisingCandidates(CFG, 10, 0);
    expect(all.length).toBeGreaterThan(0);
    const first = all[0] as unknown as Record<string, unknown>;
    expect(first.risingScore).toBeUndefined();
    expect(typeof first.symbol).toBe('string');
    // minScore impossível => vazio
    expect(await getRisingCandidates(CFG, 10, 101)).toEqual([]);
  });
});
