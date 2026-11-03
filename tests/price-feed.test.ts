// tests/price-feed.test.ts — price-feed sem rede/DB (fetch e source-health mockados)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/trading/source-health', () => ({
  recordSuccess: vi.fn(async () => undefined),
  recordError: vi.fn(async () => undefined),
}));

vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

import { fetchPriceUsd, fetchPricesBatch } from '@/lib/trading/price-feed';
import { recordSuccess, recordError } from '@/lib/trading/source-health';

const mockedSuccess = vi.mocked(recordSuccess);
const mockedError = vi.mocked(recordError);

type Handler = (url: string) => Response;
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function mockFetch(handler: Handler) {
  const fn = vi.fn((input: unknown) => handler(String(input)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  mockedSuccess.mockClear();
  mockedError.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPriceUsd — CEX (Binance)', () => {
  it('normaliza BTC/USDT -> BTCUSDT e devolve o preço real', async () => {
    const fn = mockFetch((url) => {
      expect(url).toContain('/api/v3/ticker/price?symbol=BTCUSDT');
      return jsonResponse({ symbol: 'BTCUSDT', price: '50000.25' });
    });

    const price = await fetchPriceUsd('BTC/USDT', 'cex');
    expect(price).toBe(50000.25);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockedSuccess).toHaveBeenCalledWith('binance');
    expect(mockedError).not.toHaveBeenCalled();
  });

  it('HTTP não-ok => 0 e recordError(binance)', async () => {
    mockFetch(() => jsonResponse({ msg: 'boom' }, 503));
    const price = await fetchPriceUsd('SOL/USDT', 'cex');
    expect(price).toBe(0);
    expect(mockedError).toHaveBeenCalledWith('binance', expect.stringContaining('HTTP 503'));
  });

  it('símbolo sem "/" => 0 sem chamar a rede', async () => {
    const fn = mockFetch(() => jsonResponse({}));
    const price = await fetchPriceUsd('BTCUSDT', 'cex');
    expect(price).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('erro de rede => 0 + recordError (não lança)', async () => {
    mockFetch(() => {
      throw new Error('ECONNRESET');
    });
    const price = await fetchPriceUsd('XRP/USDT', 'cex');
    expect(price).toBe(0);
    expect(mockedError).toHaveBeenCalledWith('binance', expect.stringContaining('ECONNRESET'));
  });

  it('cache: segunda chamada no TTL não bate na rede', async () => {
    const fn = mockFetch(() => jsonResponse({ price: '123.4' }));
    expect(await fetchPriceUsd('ADA/USDT', 'cex')).toBe(123.4);
    expect(await fetchPriceUsd('ADA/USDT', 'cex')).toBe(123.4);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('fetchPriceUsd — DEX (DexScreener)', () => {
  it('usa /tokens/v1/{chain}/{tokenId} e devolve priceUsd', async () => {
    const tokenId = '0xAbCdEf0000000000000000000000000000000001';
    const fn = mockFetch((url) => {
      expect(url).toBe(`https://api.dexscreener.com/tokens/v1/base/${tokenId}`);
      return jsonResponse([{ priceUsd: '0.0008626', liquidity: { usd: 237357 } }]);
    });

    const price = await fetchPriceUsd('DEGEN/WETH', 'dex', 'base', tokenId);
    expect(price).toBeCloseTo(0.0008626, 9);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockedSuccess).toHaveBeenCalledWith('dexscreener');
  });

  it('lista vazia / HTTP erro => 0 + recordError(dexscreener)', async () => {
    mockFetch(() => jsonResponse([], 200));
    const price = await fetchPriceUsd('FOO/WETH', 'dex', 'base', '0xTokenFoo0000000000000000000000000000000002');
    expect(price).toBe(0);
    expect(mockedError).toHaveBeenCalledWith('dexscreener', expect.stringContaining('sem preço'));
  });

  it('dex sem chain/tokenId => 0 sem chamar a rede', async () => {
    const fn = mockFetch(() => jsonResponse([]));
    const price = await fetchPriceUsd('FOO/WETH', 'dex');
    expect(price).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('tokenId é normalizado em lowercase no cache key (repete sem fetch)', async () => {
    const fn = mockFetch(() => jsonResponse([{ priceUsd: '1.5' }]));
    const a = '0xAAA0000000000000000000000000000000000003';
    expect(await fetchPriceUsd('A/WETH', 'dex', 'base', a)).toBe(1.5);
    expect(await fetchPriceUsd('A/WETH', 'dex', 'base', a.toLowerCase())).toBe(1.5);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('fetchPricesBatch', () => {
  it('deduplica chaves, agrupa em lotes e mapeia por id (preço 0 quando indisponível)', async () => {
    mockFetch((url) => {
      if (url.includes('symbol=BNBUSDT')) return jsonResponse({ price: '600' });
      if (url.includes('symbol=LTCUSDT')) return jsonResponse({ price: '90' });
      if (url.includes('symbol=DOGEUSDT')) return jsonResponse({ price: '0.2' });
      return jsonResponse([{ priceUsd: '0.5' }]);
    });

    const positions = [
      { id: 'p1', symbol: 'BNB/USDT', source: 'cex' as const },
      { id: 'p2', symbol: 'BNB/USDT', source: 'cex' as const }, // mesma chave de cache
      { id: 'p3', symbol: 'LTC/USDT', source: 'cex' as const },
      { id: 'p4', symbol: 'DEGEN/WETH', source: 'dex' as const, chain: 'base', tokenId: '0xBBB0000000000000000000000000000000000004' },
    ];

    const prices = await fetchPricesBatch(positions);
    expect(prices.get('p1')).toBe(600);
    expect(prices.get('p2')).toBe(600);
    expect(prices.get('p3')).toBe(90);
    expect(prices.get('p4')).toBe(0.5);
    expect(prices.size).toBe(4);
  });
});
