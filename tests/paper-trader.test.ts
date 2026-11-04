// tests/paper-trader.test.ts — fills puros (fees/slippage) + wrapper paperBuy/paperSell
import { describe, it, expect, vi, beforeEach } from 'vitest';

const balanceFindUnique = vi.fn();
const balanceUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    tradingBalance: {
      findUnique: (...a: unknown[]) => balanceFindUnique(...a),
      update: (...a: unknown[]) => balanceUpdate(...a),
    },
  },
}));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

import {
  DEFAULT_FEE_BPS,
  DEFAULT_SLIPPAGE_BPS,
  computePaperBuyFill,
  computePaperSellFill,
  paperBuy,
  paperSell,
} from '@/lib/trading/paper-trader';
import type { TokenCandidate } from '@/lib/trading/types';

const CANDIDATE: TokenCandidate = {
  symbol: 'BTC/USDT', source: 'cex', priceUsd: 100, volume24hUsd: 1e9, liquidityUsd: 1e9,
};

beforeEach(() => {
  balanceFindUnique.mockReset().mockResolvedValue({ id: 'singleton', balanceUsd: 10_000 });
  balanceUpdate.mockReset().mockResolvedValue({});
});

describe('computePaperBuyFill', () => {
  it('aplica slippage no preço e fee no budget (convenção net)', () => {
    const fill = computePaperBuyFill(100, 1000, 10, 30)!; // 0.10% fee, 0.30% slip
    expect(fill.side).toBe('buy');
    expect(fill.executedPriceUsd).toBeCloseTo(100.3, 9);
    expect(fill.feeUsd).toBeCloseTo(1, 9);              // 1000 * 0.001
    expect(fill.qty).toBeCloseTo((1000 - 1) / 100.3, 9);
    expect(fill.cashAmountUsd).toBe(1000);
    expect(fill.grossAmountUsd).toBeCloseTo(fill.qty * 100, 9);
    expect(fill.breakdown.totalCostUsd).toBeGreaterThan(0);
    expect(fill.breakdown.side).toBe('buy');
  });

  it('fee/slippage zerados => executa no mid sem custo', () => {
    const fill = computePaperBuyFill(50, 500, 0, 0)!;
    expect(fill.executedPriceUsd).toBe(50);
    expect(fill.feeUsd).toBe(0);
    expect(fill.qty).toBeCloseTo(10, 9);
  });

  it('bps negativos são normalizados para 0', () => {
    const fill = computePaperBuyFill(100, 1000, -5, -30)!;
    expect(fill.feeUsd).toBe(0);
    expect(fill.executedPriceUsd).toBe(100);
  });

  it.each([
    [0, 1000],
    [-1, 1000],
    [NaN, 1000],
    [100, 0],
    [100, -5],
    [100, NaN],
  ])('entrada inválida (price=%s, amount=%s) => null', (price, amount) => {
    expect(computePaperBuyFill(price as number, amount as number, 10, 30)).toBeNull();
  });
});

describe('computePaperSellFill', () => {
  it('slippage reduz o preço e fee incide sobre o bruto pós-slippage', () => {
    const fill = computePaperSellFill(100, 10, 10, 30)!;
    expect(fill.side).toBe('sell');
    expect(fill.executedPriceUsd).toBeCloseTo(99.7, 9);
    expect(fill.grossAmountUsd).toBeCloseTo(1000, 9); // mid notional
    expect(fill.feeUsd).toBeCloseTo(997 * 0.001, 9);
    expect(fill.cashAmountUsd).toBeCloseTo(997 - fill.feeUsd, 9);
    expect(fill.slippageUsd).toBeCloseTo(3, 9);
    expect(fill.breakdown.side).toBe('sell');
  });

  it.each([[0, 10], [100, 0], [100, -2], [NaN, 10]])('entrada inválida (price=%s, qty=%s) => null', (price, qty) => {
    expect(computePaperSellFill(price as number, qty as number, 10, 30)).toBeNull();
  });

  it('round-trip buy+sell no mesmo mid perde exatamente os custos (fees+slippage)', () => {
    const buy = computePaperBuyFill(100, 1000, DEFAULT_FEE_BPS, DEFAULT_SLIPPAGE_BPS)!;
    const sell = computePaperSellFill(100, buy.qty, DEFAULT_FEE_BPS, DEFAULT_SLIPPAGE_BPS)!;
    const loss = 1000 - sell.cashAmountUsd;
    // Fees + slippage das duas pernas consomem o capital (sem ganho no mesmo mid).
    expect(loss).toBeGreaterThan(0);
    expect(loss).toBeLessThan(1000 * 0.02); // < 2% (fees 0.2% + slippage 0.6%)
    expect(loss).toBeGreaterThan(buy.feeUsd + sell.feeUsd); // custos explícitos cabem no loss
  });
});

describe('paperBuy (wrapper com saldo)', () => {
  it('sucesso: debita o saldo e devolve breakdown', async () => {
    const res = await paperBuy(CANDIDATE, 1000, { feeBps: 10, slippageBps: 30 });
    expect(res.ok).toBe(true);
    expect(res.amountUsd).toBe(1000);
    expect(res.qty).toBeGreaterThan(0);
    expect(res.feeUsd).toBeGreaterThan(0);
    expect(res.breakdown).toBeDefined();
    expect(balanceUpdate).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { balanceUsd: { decrement: 1000 } },
    });
  });

  it('saldo insuficiente => recusa SEM debitar', async () => {
    balanceFindUnique.mockResolvedValue({ id: 'singleton', balanceUsd: 500 });
    const res = await paperBuy(CANDIDATE, 1000);
    expect(res).toMatchObject({ ok: false, error: 'Saldo insuficiente', executedPriceUsd: 0 });
    expect(balanceUpdate).not.toHaveBeenCalled();
  });

  it('sem linha de saldo => recusa (fail-closed)', async () => {
    balanceFindUnique.mockResolvedValue(null);
    const res = await paperBuy(CANDIDATE, 100);
    expect(res.ok).toBe(false);
    expect(balanceUpdate).not.toHaveBeenCalled();
  });

  it('preço inválido => falha antes de tocar no saldo', async () => {
    const res = await paperBuy({ ...CANDIDATE, priceUsd: 0 }, 1000);
    expect(res).toMatchObject({ ok: false, error: 'Parâmetros inválidos' });
    expect(balanceFindUnique).not.toHaveBeenCalled();
  });
});

describe('paperSell (wrapper)', () => {
  it('sucesso: credita o líquido (bruto - fee)', async () => {
    const res = await paperSell('BTC/USDT', 10, 100, { feeBps: 10, slippageBps: 30 });
    expect(res.ok).toBe(true);
    expect(res.amountUsd).toBeCloseTo(997 - 0.997, 6);
    expect(balanceUpdate).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { balanceUsd: { increment: res.amountUsd } },
    });
  });

  it('qty/preço inválidos => falha informando os valores de entrada', async () => {
    const res = await paperSell('BTC/USDT', 0, 100);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Parâmetros inválidos');
    expect(res.qty).toBe(0);
    expect(res.executedPriceUsd).toBe(100);
    expect(balanceUpdate).not.toHaveBeenCalled();
  });
});
