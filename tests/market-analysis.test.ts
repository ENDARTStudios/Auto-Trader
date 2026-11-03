// tests/market-analysis.test.ts — indicadores numéricos + OHLCV REAL (sem síntese)
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ema,
  rsi,
  macd,
  bollinger,
  analyzeMarket,
  MarketDataUnavailableError,
} from '@/lib/trading/market-analysis';
import type { TokenCandidate } from '@/lib/trading/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Handler = (url: string) => Response | Promise<Response>;
function mockFetch(handler: Handler) {
  const fn = vi.fn((input: unknown) => handler(String(input)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// 60 klines Binance: [openTime, open, high, low, close, volume, ...]
function binanceKlines(n: number): unknown[][] {
  return Array.from({ length: n }, (_, i) => {
    const price = 100 + i * 0.5;
    return [1_700_000_000_000 + i * 3_600_000, String(price - 0.2), String(price + 0.4), String(price - 0.5), String(price), '12.5'];
  });
}

function geckoOhlcv(n: number): number[][] {
  // GeckoTerminal devolve [ts, open, high, low, close, volume] DESC
  return Array.from({ length: n }, (_, i) => {
    const idx = n - 1 - i; // decrescente no tempo
    const price = 0.0008 + idx * 0.000001;
    return [1_700_000_000 + idx * 300, price, price * 1.01, price * 0.99, price, 1000 + idx];
  });
}

function sentimentMocks(url: string): Response | null {
  if (url.includes('alternative.me')) {
    return jsonResponse({ data: [{ value: '55', value_classification: 'Neutral', timestamp: '1700000000' }] });
  }
  if (url.includes('coingecko.com/api/v3/search/trending')) return jsonResponse({ coins: [] });
  return null;
}

describe('indicadores técnicos (fórmulas de livro)', () => {
  it('ema usa k = 2/(period+1)', () => {
    expect(ema([1, 2, 3, 4], 3)).toEqual([1, 1.5, 2.25, 3.125]);
    expect(ema([], 3)).toEqual([]);
  });

  it('rsi = 100 numa série monotônica de alta', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const out = rsi(closes, 14);
    expect(out).toHaveLength(20);
    expect(out[out.length - 1]).toBe(100);
  });

  it('rsi = 0 numa série monotônica de baixa', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 200 - i);
    const out = rsi(closes, 14);
    expect(out[out.length - 1]).toBeCloseTo(0, 6);
  });

  it('macd: histograma positivo em tendência de alta', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 * Math.pow(1.01, i));
    const m = macd(closes);
    expect(m.macd).toHaveLength(60);
    expect(m.hist[m.hist.length - 1]).toBeGreaterThan(0);
  });

  it('bollinger: série constante -> bandas coladas e percent 0.5', () => {
    const b = bollinger(Array(20).fill(100), 20, 2);
    expect(b).not.toBeNull();
    expect(b!.upper).toBeCloseTo(100, 9);
    expect(b!.lower).toBeCloseTo(100, 9);
    expect(b!.percent).toBeCloseTo(0.5, 9);
    expect(bollinger([1, 2, 3], 20)).toBeNull();
  });
});

describe('analyzeMarket — CEX (Binance real mockada)', () => {
  it('calcula indicadores sobre candles reais e marca dataQuality=live', async () => {
    mockFetch((url) => {
      const senti = sentimentMocks(url);
      if (senti) return senti;
      if (url.includes('api.binance.com/api/v3/klines')) return jsonResponse(binanceKlines(60));
      throw new Error(`fetch inesperado: ${url}`);
    });

    const candidate: TokenCandidate = {
      symbol: 'BTC/USDT',
      source: 'cex',
      priceUsd: 0,
      volume24hUsd: 0,
      liquidityUsd: 0,
    };
    const signal = await analyzeMarket(candidate);

    expect(signal.dataQuality).toBe('live');
    expect(signal.raw.candle_source).toBe('binance');
    expect(signal.raw.candle_count).toBe(60);
    expect(signal.rsi14).not.toBeNull();
    expect(signal.rsi14!).toBeGreaterThan(99); // série só de alta
    expect(signal.ema20).not.toBeNull();
    expect(signal.ema50).not.toBeNull();
    expect(signal.ema20!).toBeGreaterThan(signal.ema50!);
    expect(signal.macdHist).not.toBeNull();
    expect(signal.bollPercent).not.toBeNull();
    expect(signal.priceUsd).toBeCloseTo(100 + 59 * 0.5, 6);
    expect(signal.signalScore).toBeGreaterThanOrEqual(0);
    expect(signal.signalScore).toBeLessThanOrEqual(100);
  }, 20000);

  it('Binance indisponível: lança MarketDataUnavailableError (nunca sintetiza)', async () => {
    mockFetch((url) => {
      const senti = sentimentMocks(url);
      if (senti) return senti;
      if (url.includes('api.binance.com')) return jsonResponse({ msg: 'down' }, 503);
      throw new Error(`fetch inesperado: ${url}`);
    });

    const candidate: TokenCandidate = {
      symbol: 'BTC/USDT',
      source: 'cex',
      priceUsd: 12345,
      volume24hUsd: 0,
      liquidityUsd: 0,
    };
    await expect(analyzeMarket(candidate)).rejects.toBeInstanceOf(MarketDataUnavailableError);
    await expect(analyzeMarket(candidate)).rejects.toMatchObject({ code: 'MARKET_DATA_UNAVAILABLE' });
  }, 20000);
});

describe('analyzeMarket — DEX (DexScreener + GeckoTerminal reais mockados)', () => {
  const tokenId = '0xTokenDegen';
  const pairs = [
    {
      chainId: 'base',
      dexId: 'uniswap',
      pairAddress: '0xSmallPool',
      baseToken: { address: tokenId, symbol: 'DEGEN' },
      quoteToken: { address: '0xWeth', symbol: 'WETH' },
      priceUsd: '0.0009',
      liquidity: { usd: 50000 },
    },
    {
      chainId: 'base',
      dexId: 'aerodrome',
      pairAddress: '0xBigPool',
      baseToken: { address: tokenId, symbol: 'DEGEN' },
      quoteToken: { address: '0xWeth', symbol: 'WETH' },
      priceUsd: '0.0009',
      liquidity: { usd: 900000 },
    },
  ];

  it('descobre o pool de maior liquidez e usa OHLCV real do GeckoTerminal', async () => {
    const requestedPools: string[] = [];
    mockFetch((url) => {
      const senti = sentimentMocks(url);
      if (senti) return senti;
      if (url.includes('api.dexscreener.com/tokens/v1/base/')) return jsonResponse(pairs);
      if (url.includes('api.geckoterminal.com')) {
        requestedPools.push(url);
        return jsonResponse({ data: { attributes: { ohlcv_list: geckoOhlcv(100) } } });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    const candidate: TokenCandidate = {
      symbol: 'DEGEN/WETH',
      source: 'dex',
      chain: 'base',
      tokenId,
      priceUsd: 0.0009,
      volume24hUsd: 30000,
      liquidityUsd: 900000,
    };
    const signal = await analyzeMarket(candidate);

    expect(signal.dataQuality).toBe('live');
    expect(signal.raw.candle_source).toBe('geckoterminal');
    expect(signal.raw.gecko_network).toBe('base');
    expect(signal.raw.pool_address).toBe('0xBigPool');
    expect(signal.raw.candle_count).toBe(100);
    expect(signal.raw.price_inverted).toBe(false);
    expect(requestedPools[0]).toContain('/networks/base/pools/0xBigPool/ohlcv/minute');
    expect(requestedPools[0]).toContain('aggregate=5');
    expect(requestedPools[0]).toContain('limit=100');
    expect(signal.rsi14).not.toBeNull();
    expect(signal.priceUsd).toBeGreaterThan(0);
  }, 20000);

  it('DEX sem OHLCV: lança MarketDataUnavailableError', async () => {
    mockFetch((url) => {
      const senti = sentimentMocks(url);
      if (senti) return senti;
      if (url.includes('api.dexscreener.com')) return jsonResponse(pairs);
      if (url.includes('api.geckoterminal.com')) return jsonResponse({ data: { attributes: { ohlcv_list: [] } } });
      throw new Error(`fetch inesperado: ${url}`);
    });

    const candidate: TokenCandidate = {
      symbol: 'DEGEN/WETH',
      source: 'dex',
      chain: 'base',
      tokenId,
      priceUsd: 0.0009,
      volume24hUsd: 30000,
      liquidityUsd: 900000,
    };
    await expect(analyzeMarket(candidate)).rejects.toMatchObject({ code: 'MARKET_DATA_UNAVAILABLE' });
  }, 20000);

  it('DEX sem chain/tokenId: lança MarketDataUnavailableError', async () => {
    mockFetch((url) => {
      const senti = sentimentMocks(url);
      if (senti) return senti;
      throw new Error(`fetch inesperado: ${url}`);
    });
    const candidate: TokenCandidate = {
      symbol: 'MYSTERY',
      source: 'dex',
      priceUsd: 1,
      volume24hUsd: 0,
      liquidityUsd: 0,
    };
    await expect(analyzeMarket(candidate)).rejects.toMatchObject({ code: 'MARKET_DATA_UNAVAILABLE' });
  }, 20000);
});
