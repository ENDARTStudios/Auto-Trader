// tests/token-selector.test.ts — seleção de candidatos sem rede (fetch mockado, caches isolados)
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

/** Cada teste carrega um módulo novo para zerar os caches em nível de módulo. */
async function loadSelector() {
  vi.resetModules();
  return await import('@/lib/trading/token-selector');
}

function cexConfig(over: Partial<Record<string, unknown>> = {}): EngineConfig {
  return {
    scanCex: true,
    scanDex: false,
    cexSymbols: ['BTC/USDT', 'ETH/USDT'],
    minVolume24hUsd: 1_000_000,
    minLiquidityUsd: 250_000,
    dexChains: [],
    ...over,
  } as unknown as EngineConfig;
}

function dexConfig(over: Partial<Record<string, unknown>> = {}): EngineConfig {
  return {
    scanCex: false,
    scanDex: true,
    cexSymbols: [],
    minVolume24hUsd: 10_000,
    minLiquidityUsd: 50_000,
    dexChains: ['base'],
    ...over,
  } as unknown as EngineConfig;
}

const DEX_PAIRS = [
  {
    chainId: 'base',
    dexId: 'uniswap',
    baseToken: { address: '0xDegen', symbol: 'DEGEN', name: 'Degen' },
    quoteToken: { address: '0xWeth', symbol: 'WETH', name: 'WETH' },
    priceUsd: '0.00086',
    liquidity: { usd: 200_000 },
    volume: { h24: 30_000 },
    pairCreatedAt: Date.now() - 48 * 3_600_000,
    info: { holders: 12345 },
  },
  // filtrada: chain errada
  { chainId: 'ethereum', dexId: 'uniswap', baseToken: { address: '0xEth', symbol: 'ETH', name: 'Eth' }, quoteToken: { address: '0xUsdc', symbol: 'USDC', name: 'USDC' }, priceUsd: '2500', liquidity: { usd: 900_000 }, volume: { h24: 900_000 } },
  // filtrada: preço zero
  { chainId: 'base', dexId: 'aerodrome', baseToken: { address: '0xZero', symbol: 'ZERO', name: 'Zero' }, quoteToken: { address: '0xWeth', symbol: 'WETH', name: 'WETH' }, priceUsd: '0', liquidity: { usd: 900_000 }, volume: { h24: 900_000 } },
  // filtrada: liquidez baixa
  { chainId: 'base', dexId: 'aerodrome', baseToken: { address: '0xThin', symbol: 'THIN', name: 'Thin' }, quoteToken: { address: '0xWeth', symbol: 'WETH', name: 'WETH' }, priceUsd: '1', liquidity: { usd: 1_000 }, volume: { h24: 900_000 } },
  // duplicata exata (mesmo token/chain) -> dedupe
  {
    chainId: 'base',
    dexId: 'sushiswap',
    baseToken: { address: '0xDegen', symbol: 'DEGEN', name: 'Degen' },
    quoteToken: { address: '0xUsdc', symbol: 'USDC', name: 'USDC' },
    priceUsd: '0.00087',
    liquidity: { usd: 250_000 },
    volume: { h24: 40_000 },
  },
];

describe('fetchCexCandidates', () => {
  it('mapeia tickers, filtra volume baixo e marca platformId binance', async () => {
    const fn = mockFetch((url) => {
      expect(url).toContain('/api/v3/ticker/24hr?symbols=');
      return jsonResponse([
        { symbol: 'BTCUSDT', lastPrice: '50000', quoteVolume: '9000000' },
        { symbol: 'ETHUSDT', lastPrice: '2500', quoteVolume: '500' }, // volume < min
      ]);
    });
    const { fetchCexCandidates } = await loadSelector();

    const out = await fetchCexCandidates(cexConfig());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      symbol: 'BTC/USDT',
      source: 'cex',
      platformId: 'binance',
      priceUsd: 50000,
      volume24hUsd: 9000000,
      liquidityUsd: 9000000,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('scanCex=false => [] sem rede', async () => {
    const fn = mockFetch(() => jsonResponse([]));
    const { fetchCexCandidates } = await loadSelector();
    expect(await fetchCexCandidates(cexConfig({ scanCex: false }))).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('símbolos inválidos (sem "/") => [] sem rede', async () => {
    const fn = mockFetch(() => jsonResponse([]));
    const { fetchCexCandidates } = await loadSelector();
    expect(await fetchCexCandidates(cexConfig({ cexSymbols: ['BTCUSDT'] }))).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('HTTP não-ok => devolve cache vazio (degrada sem lançar)', async () => {
    mockFetch(() => jsonResponse({ msg: 'down' }, 500));
    const { fetchCexCandidates } = await loadSelector();
    expect(await fetchCexCandidates(cexConfig())).toEqual([]);
  });

  it('cache de 30s evita segunda chamada de rede', async () => {
    const fn = mockFetch(() => jsonResponse([{ symbol: 'BTCUSDT', lastPrice: '50000', quoteVolume: '9000000' }]));
    const { fetchCexCandidates } = await loadSelector();
    await fetchCexCandidates(cexConfig());
    await fetchCexCandidates(cexConfig());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ticker não mapeado é ignorado', async () => {
    mockFetch(() => jsonResponse([
      { symbol: 'DOGEUSDT', lastPrice: '0.1', quoteVolume: '9000000' },
      { symbol: 'BTCUSDT', lastPrice: '50000', quoteVolume: '9000000' },
    ]));
    const { fetchCexCandidates } = await loadSelector();
    const out = await fetchCexCandidates(cexConfig());
    expect(out.map((c) => c.symbol)).toEqual(['BTC/USDT']);
  });
});

describe('fetchDexCandidates', () => {
  it('filtra por chain/preço/liquidez/volume, deduplica e mapeia plataforma', async () => {
    mockFetch((url) => {
      expect(url).toContain('/latest/dex/search?q=base');
      return jsonResponse({ pairs: DEX_PAIRS });
    });
    const { fetchDexCandidates } = await loadSelector();

    const out = await fetchDexCandidates(dexConfig());
    // Dedupe por (chain, tokenId): sobrevive o par de MAIOR volume (sushiswap, 40k)
    expect(out).toHaveLength(1);
    const degen = out[0];
    expect(degen.symbol).toBe('DEGEN');
    expect(degen.source).toBe('dex');
    expect(degen.chain).toBe('base');
    expect(degen.tokenId).toBe('0xDegen');
    expect(degen.platformId).toBe('sushiswap');
    expect(degen.priceUsd).toBeCloseTo(0.00087, 9);
    expect(degen.liquidityUsd).toBe(250_000);
    expect(degen.volume24hUsd).toBe(40_000);
    // o par vencedor não traz pairCreatedAt/info
    expect(degen.holderCount).toBeUndefined();
    expect(degen.ageHours).toBeUndefined();
  });

  it('scanDex=false => [] sem rede', async () => {
    const fn = mockFetch(() => jsonResponse({ pairs: [] }));
    const { fetchDexCandidates } = await loadSelector();
    expect(await fetchDexCandidates(dexConfig({ scanDex: false }))).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('HTTP não-ok numa chain => continua e devolve [] sem lançar', async () => {
    mockFetch(() => jsonResponse({ msg: 'down' }, 502));
    const { fetchDexCandidates } = await loadSelector();
    expect(await fetchDexCandidates(dexConfig())).toEqual([]);
  });

  it('erro de rede => [] (catch) sem lançar', async () => {
    mockFetch(() => {
      throw new Error('ECONNRESET');
    });
    const { fetchDexCandidates } = await loadSelector();
    expect(await fetchDexCandidates(dexConfig())).toEqual([]);
  });

  it('pair sem pairCreatedAt => ageHours undefined', async () => {
    mockFetch(() => jsonResponse({ pairs: [{
      chainId: 'base',
      dexId: 'aerodrome',
      baseToken: { address: '0xNoAge', symbol: 'NOAGE', name: 'NoAge' },
      quoteToken: { address: '0xWeth', symbol: 'WETH', name: 'WETH' },
      priceUsd: '2',
      liquidity: { usd: 100_000 },
      volume: { h24: 20_000 },
    }] }));
    const { fetchDexCandidates } = await loadSelector();
    const out = await fetchDexCandidates(dexConfig());
    expect(out).toHaveLength(1);
    expect(out[0].ageHours).toBeUndefined();
    expect(out[0].holderCount).toBeUndefined();
    expect(out[0].platformId).toBe('aerodrome');
  });
});

describe('selectCandidates', () => {
  it('mescla CEX+DEX, ordena por volume desc, deduplica e aplica o limite', async () => {
    mockFetch((url) => {
      if (url.includes('ticker/24hr')) {
        return jsonResponse([
          { symbol: 'BTCUSDT', lastPrice: '50000', quoteVolume: '9000000' },
          { symbol: 'ETHUSDT', lastPrice: '2500', quoteVolume: '5000000' },
        ]);
      }
      return jsonResponse({ pairs: DEX_PAIRS });
    });
    const { selectCandidates } = await loadSelector();
    const cfg = cexConfig({ scanDex: true, dexChains: ['base'] });

    const out = await selectCandidates(cfg, 2);
    expect(out).toHaveLength(2);
    expect(out[0].symbol).toBe('BTC/USDT');
    expect(out[1].symbol).toBe('ETH/USDT');
    // todos os itens respeitam o limite e a ordenação por volume
    expect(out.every((c) => c.volume24hUsd > 0)).toBe(true);
  });
});
