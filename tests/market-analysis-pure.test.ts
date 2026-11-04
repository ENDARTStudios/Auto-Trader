// tests/market-analysis-pure.test.ts — constantes/erros puros do market-analysis
import { describe, it, expect } from 'vitest';
import {
  CHAIN_TO_GECKO_NETWORK,
  MarketDataUnavailableError,
  bollinger,
  ema,
  macd,
  rsi,
} from '@/lib/trading/market-analysis';

describe('CHAIN_TO_GECKO_NETWORK', () => {
  it('mapeia todos os slugs internos para networks do GeckoTerminal', () => {
    expect(CHAIN_TO_GECKO_NETWORK).toEqual({
      ethereum: 'eth',
      eth: 'eth',
      bsc: 'bsc',
      base: 'base',
      arbitrum: 'arbitrum',
      optimism: 'optimism',
      polygon: 'polygon_pos',
      polygon_pos: 'polygon_pos',
    });
  });

  it('não contém chains não suportadas (fallback é throw, não adivinhação)', () => {
    expect(CHAIN_TO_GECKO_NETWORK.solana).toBeUndefined();
    expect(CHAIN_TO_GECKO_NETWORK.avalanche).toBeUndefined();
  });
});

describe('MarketDataUnavailableError', () => {
  it('carrega code estável e metadados do candidato', () => {
    const err = new MarketDataUnavailableError('sem OHLCV', {
      symbol: 'DEGEN/WETH',
      chain: 'base',
      tokenId: '0xabc',
      source: 'geckoterminal',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('MarketDataUnavailableError');
    expect(err.code).toBe('MARKET_DATA_UNAVAILABLE');
    expect(err.message).toBe('sem OHLCV');
    expect(err.meta).toMatchObject({ chain: 'base', source: 'geckoterminal' });
  });

  it('meta é opcional', () => {
    const err = new MarketDataUnavailableError('x');
    expect(err.meta).toBeUndefined();
    expect(err.code).toBe('MARKET_DATA_UNAVAILABLE');
  });
});

describe('indicadores — casos de borda adicionais', () => {
  it('rsi devolve [] quando há menos candles que period+1', () => {
    expect(rsi([1, 2, 3], 14)).toEqual([]);
  });

  it('macd/ema de série curta mantêm o tamanho da entrada', () => {
    const closes = [10, 11, 12];
    expect(ema(closes, 5)).toHaveLength(3);
    expect(macd(closes).hist).toHaveLength(3);
  });

  it('bollinger com desvio zero não divide por zero (percent=0.5)', () => {
    const b = bollinger([50, 50, 50, 50, 50], 5, 2)!;
    expect(b.percent).toBe(0.5);
    expect(b.upper).toBe(b.lower);
  });

  it('bollinger percent reflete posição do último preço na banda', () => {
    const b = bollinger([10, 12, 11, 13, 12], 5, 2)!;
    expect(b.percent).toBeGreaterThan(0);
    expect(b.percent).toBeLessThanOrEqual(1);
    expect(b.upper).toBeGreaterThan(b.mid);
  });
});
