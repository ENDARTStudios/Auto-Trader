// tests/cex-adapter.test.ts — CCXT adapter: helpers puros + ordem real (mock ccxt).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  ctors: [] as Array<Record<string, unknown>>,
  sandboxCalls: [] as boolean[],
}));

vi.mock('ccxt', () => {
  class FakeBinance {
    id = 'binance';
    config: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
      hoisted.ctors.push(config);
    }
    setSandboxMode(value: boolean) {
      hoisted.sandboxCalls.push(value);
    }
  }
  return { default: { binance: FakeBinance }, binance: FakeBinance };
});

import {
  CexAdapterError,
  computeAmountFromUsd,
  createCexClient,
  fetchCexBalances,
  normalizeSymbol,
  parseFee,
  parseOrderFill,
  placeLimitOrder,
  placeMarketOrder,
  type CexClient,
  type CcxtOrder,
} from '@/lib/chain/cex-adapter';

const CREDS = {
  source: 'env' as const,
  exchange: 'binance',
  apiKey: 'test-api-key',
  apiSecret: 'test-api-secret',
  testnet: true,
};

function fakeClient(overrides: Partial<CexClient> = {}): CexClient {
  return {
    id: 'binance',
    loadMarkets: async () => ({}),
    fetchTicker: async () => ({ last: 100 }),
    createMarketOrder: async (_symbol, _side, amount) =>
      ({
        id: 'order-123',
        amount,
        filled: amount,
        price: 100,
        average: 100,
        fee: { cost: 0.5, currency: 'USDT' },
      }) as CcxtOrder,
    createOrder: async (_symbol, _type, _side, amount, price) =>
      ({ id: 'limit-1', amount, filled: 0, price }) as CcxtOrder,
    fetchBalance: async () => ({
      free: { BTC: 0.5, USDT: 1000 },
      used: { ETH: 1.5 },
      total: { BTC: 0.5, USDT: 1000, ETH: 1.5 },
    }),
    ...overrides,
  };
}

beforeEach(() => {
  hoisted.ctors.length = 0;
  hoisted.sandboxCalls.length = 0;
});

describe('helpers puros', () => {
  it('normalizeSymbol', () => {
    expect(normalizeSymbol('BTCUSDT')).toBe('BTC/USDT');
    expect(normalizeSymbol('btcusdt')).toBe('BTC/USDT');
    expect(normalizeSymbol('eth/usdc')).toBe('ETH/USDC');
    expect(normalizeSymbol('SOLUSDC')).toBe('SOL/USDC');
    expect(normalizeSymbol('ETHBTC')).toBe('ETH/BTC');
    expect(normalizeSymbol('FOO')).toBe('FOO');
    expect(normalizeSymbol('')).toBe('');
  });

  it('computeAmountFromUsd', () => {
    expect(computeAmountFromUsd(1000, 50000)).toBeCloseTo(0.02, 12);
    expect(computeAmountFromUsd(0, 100)).toBeNull();
    expect(computeAmountFromUsd(-5, 100)).toBeNull();
    expect(computeAmountFromUsd(100, 0)).toBeNull();
    expect(computeAmountFromUsd(100, Number.NaN)).toBeNull();
  });

  it('parseFee soma apenas fees em stable (ignora BNB/base)', () => {
    expect(parseFee({ fee: { cost: 1.5, currency: 'USDT' } })).toBeCloseTo(1.5);
    expect(parseFee({ fees: [{ cost: 1, currency: 'USDT' }, { cost: 2, currency: 'USDC' }] })).toBeCloseTo(3);
    expect(
      parseFee({
        trades: [{ fee: { cost: 0.75, currency: 'USD' } }, { fee: { cost: 9, currency: 'BNB' } }],
      })
    ).toBeCloseTo(0.75);
    expect(parseFee({ fee: { cost: 1, currency: 'BNB' } })).toBe(0);
    expect(parseFee(null)).toBe(0);
  });

  it('parseOrderFill usa average, depois price, depois fallback', () => {
    expect(parseOrderFill({ average: 101, filled: 2 }, 100)).toEqual({ filledPrice: 101, filledQty: 2 });
    expect(parseOrderFill({ price: 99, amount: 3 }, 100)).toEqual({ filledPrice: 99, filledQty: 3 });
    expect(parseOrderFill({}, 100)).toBeNull();
  });
});

describe('createCexClient (ccxt mockado)', () => {
  it('configura credenciais, rate limit, time adjustment e sandbox', async () => {
    const client = await createCexClient(CREDS);
    expect(client.id).toBe('binance');
    expect(hoisted.ctors).toHaveLength(1);
    const cfg = hoisted.ctors[0];
    expect(cfg.apiKey).toBe('test-api-key');
    expect(cfg.secret).toBe('test-api-secret');
    expect(cfg.enableRateLimit).toBe(true);
    expect(cfg.options).toEqual({ adjustForTimeDifference: true });
    expect(hoisted.sandboxCalls).toEqual([true]);
  });

  it('testnet=false NÃO ativa sandbox', async () => {
    await createCexClient({ ...CREDS, testnet: false });
    expect(hoisted.sandboxCalls).toEqual([]);
  });

  it('exchange não suportado → CEX_UNSUPPORTED_EXCHANGE', async () => {
    await expect(createCexClient({ ...CREDS, exchange: 'not-an-exchange' })).rejects.toMatchObject({
      code: 'CEX_UNSUPPORTED_EXCHANGE',
    });
  });
});

describe('placeMarketOrder', () => {
  it('sucesso: calcula amount por last, usa fill e fee reais', async () => {
    const r = await placeMarketOrder(fakeClient(), {
      symbol: 'BTCUSDT',
      side: 'buy',
      amountUsd: 1000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderId).toBe('order-123');
    expect(r.filledPrice).toBe(100);
    expect(r.filledQty).toBeCloseTo(10, 12);
    expect(r.amountUsd).toBeCloseTo(1000, 6);
    expect(r.feeUsd).toBeCloseTo(0.5, 12);
  });

  it('sell aceita amount explícito (qty da posição)', async () => {
    const r = await placeMarketOrder(fakeClient(), {
      symbol: 'BTC/USDT',
      side: 'sell',
      amountUsd: 0,
      amount: 0.25,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filledQty).toBeCloseTo(0.25, 12);
  });

  it('sem last price → CEX_PRICE_UNAVAILABLE', async () => {
    const r = await placeMarketOrder(
      fakeClient({ fetchTicker: async () => ({}) }),
      { symbol: 'BTC/USDT', side: 'buy', amountUsd: 100 }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('CEX_PRICE_UNAVAILABLE');
  });

  it('amountUsd inválido → CEX_INVALID_AMOUNT', async () => {
    const r = await placeMarketOrder(fakeClient(), { symbol: 'BTC/USDT', side: 'buy', amountUsd: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('CEX_INVALID_AMOUNT');
  });

  it('erro do exchange → CEX_EXECUTION_FAILED (nunca fill fake)', async () => {
    const r = await placeMarketOrder(
      fakeClient({
        createMarketOrder: async () => {
          throw new Error('InsufficientFunds');
        },
      }),
      { symbol: 'BTC/USDT', side: 'buy', amountUsd: 100 }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('CEX_EXECUTION_FAILED');
    expect(r.reason).toContain('InsufficientFunds');
  });

  it('ordem sem fill → CEX_EXECUTION_FAILED', async () => {
    const r = await placeMarketOrder(
      fakeClient({
        createMarketOrder: async () => ({ id: 'x', amount: 0, filled: 0 }) as CcxtOrder,
      }),
      { symbol: 'BTC/USDT', side: 'buy', amountUsd: 100 }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('CEX_EXECUTION_FAILED');
  });

  it('fetchOrder opcional enriquece o fill', async () => {
    const client = fakeClient({
      createMarketOrder: async () => ({ id: 'abc', amount: 1 }) as CcxtOrder,
      fetchOrder: async () =>
        ({ id: 'abc', amount: 1, filled: 1, average: 102, fee: { cost: 0.1, currency: 'USDT' } }) as CcxtOrder,
    });
    const r = await placeMarketOrder(client, { symbol: 'BTC/USDT', side: 'buy', amountUsd: 102 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filledPrice).toBe(102);
  });
});

describe('placeLimitOrder / fetchCexBalances', () => {
  it('limite exige limitPrice válido e usa createOrder', async () => {
    const bad = await placeLimitOrder(fakeClient(), {
      symbol: 'BTC/USDT',
      side: 'buy',
      amountUsd: 100,
      limitPrice: 0,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toBe('CEX_INVALID_PRICE');

    const ok = await placeLimitOrder(fakeClient(), {
      symbol: 'BTC/USDT',
      side: 'buy',
      amountUsd: 100,
      limitPrice: 100,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.orderId).toBe('limit-1');
    expect(ok.filledPrice).toBe(100);
  });

  it('fetchCexBalances devolve free/locked reais e ignora zeros', async () => {
    const rows = await fetchCexBalances(fakeClient());
    expect(rows).toEqual([
      { asset: 'BTC', free: 0.5, locked: 0 },
      { asset: 'ETH', free: 0, locked: 1.5 },
      { asset: 'USDT', free: 1000, locked: 0 },
    ]);
  });

  it('fetchCexBalances erro → CexAdapterError CEX_BALANCE_UNAVAILABLE', async () => {
    await expect(
      fetchCexBalances(
        fakeClient({
          fetchBalance: async () => {
            throw new Error('auth failed');
          },
        })
      )
    ).rejects.toBeInstanceOf(CexAdapterError);
  });
});
