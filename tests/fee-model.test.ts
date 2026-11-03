import { describe, it, expect, afterAll } from 'vitest';
import { db } from '@/lib/db';
import {
  computeFeeBreakdown,
  computeRoundTripCost,
  computeBuySpendBreakdown,
  compoundBreakevenMovePct,
  recordFeeAuditLog,
  getFeeStats,
} from '@/lib/trading/fee-model';
import { computePaperBuyFill, computePaperSellFill } from '@/lib/trading/paper-trader';

describe('Fee model — pure math (feeBps/slippageBps, doc example)', () => {
  it('buy leg: fee + slippage added on top', () => {
    const b = computeFeeBreakdown(1000, 10, 30, 'buy');
    expect(b.feeUsd).toBeCloseTo(1.0, 10);
    expect(b.slippageUsd).toBeCloseTo(3.0, 10);
    expect(b.totalCostUsd).toBeCloseTo(4.0, 10);
    expect(b.netAmountUsd).toBeCloseTo(1004.0, 10);
  });

  it('sell leg: fee + slippage subtracted', () => {
    const b = computeFeeBreakdown(1000, 10, 30, 'sell');
    expect(b.totalCostUsd).toBeCloseTo(4.0, 10);
    expect(b.netAmountUsd).toBeCloseTo(996.0, 10);
  });

  it('custo linear do round-trip: feeBps=10, slippageBps=30 → 80bps = 0.80%', () => {
    const rtc = computeRoundTripCost(1000, 10, 30);
    expect(rtc.costUsd).toBeCloseTo(8.0, 10);
    expect(rtc.costPct).toBeCloseTo(0.8, 10);
    // breakeven é COMPOSTO (não a soma 0.80%): 0.8032128514%
    expect(rtc.breakevenMovePct).toBeCloseTo(0.8032128514, 10);
  });

  it('breakeven composto é estritamente maior que a soma ingênua de percentuais', () => {
    const naive = ((10 + 30) / 10_000) * 2 * 100; // 0.8
    expect(compoundBreakevenMovePct(10, 30)).toBeGreaterThan(naive);
    expect(compoundBreakevenMovePct(10, 30) - naive).toBeCloseTo(0.0032128514, 10);
  });

  it('breakeven composto bate com o valor de referência da auditoria (0.80321%)', () => {
    expect(compoundBreakevenMovePct(10, 30).toFixed(5)).toBe('0.80321');
    // custo real por $1000 = 0.032 extra vs a soma ingênua
    const c = 0.004;
    const exact = (1000 * (1 + c)) / (1 - c);
    expect(exact - 1000).toBeCloseTo(8.0321285141, 8);
  });

  it('custo escala linearmente com o tamanho', () => {
    const small = computeRoundTripCost(100, 10, 30);
    const big = computeRoundTripCost(1000, 10, 30);
    expect(big.costUsd).toBeCloseTo(small.costUsd * 10, 8);
    expect(big.breakevenMovePct).toBeCloseTo(small.breakevenMovePct, 10);
  });

  it('zero fees → custo zero (sem NaN)', () => {
    const rtc = computeRoundTripCost(500, 0, 0);
    expect(rtc.costUsd).toBe(0);
    expect(rtc.costPct).toBe(0);
    expect(rtc.breakevenMovePct).toBe(0);
  });

  it('computeRoundTripCost(0) → sem NaN (regressão)', () => {
    const rtc = computeRoundTripCost(0, 10, 30);
    expect(Number.isNaN(rtc.costUsd)).toBe(false);
    expect(Number.isNaN(rtc.costPct)).toBe(false);
    expect(Number.isNaN(rtc.breakevenMovePct)).toBe(false);
    expect(rtc.costUsd).toBe(0);
    expect(rtc.costPct).toBeCloseTo(0.8, 10);
    expect(rtc.breakevenMovePct).toBeCloseTo(0.8032128514, 10);
  });

  it('tamanho negativo/inválido → sem NaN', () => {
    for (const size of [-1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const rtc = computeRoundTripCost(size, 10, 30);
      expect(Number.isFinite(rtc.costUsd)).toBe(true);
      expect(Number.isFinite(rtc.breakevenMovePct)).toBe(true);
    }
  });

  it('feeBps negativo é tratado como 0 (nunca credita fee)', () => {
    const rtc = computeRoundTripCost(1000, -50, 0);
    expect(rtc.costUsd).toBe(0);
    expect(rtc.breakevenMovePct).toBe(0);
  });

  it('computeBuySpendBreakdown: caixa fixo, fee/slippage dentro do caixa', () => {
    const b = computeBuySpendBreakdown(1000, 10, 30);
    expect(b.grossAmountUsd).toBe(1000);
    expect(b.feeUsd).toBeCloseTo(1, 10);
    expect(b.slippageUsd).toBeCloseTo(3, 10);
    expect(b.totalCostUsd).toBeCloseTo(4, 10);
    expect(b.netAmountUsd).toBeCloseTo(996, 10);
    // invariante do log: gross = net + custos
    expect(b.grossAmountUsd).toBeCloseTo(b.netAmountUsd + b.totalCostUsd, 10);
  });
});

// ---------------------------------------------------------------------------
// Paper fills — fee REAL cobrada no preço/qty (net), não só slippage
// ---------------------------------------------------------------------------
describe('paper fills — fees exatas aplicadas no preço/quantidade', () => {
  const BUY_MID = 1.0;
  const SELL_MID = 1.0;
  const AMOUNT = 1000;
  const FEE_BPS = 10; // 0.10%
  const SLIP_BPS = 30; // 0.30%

  it('buy: slippage no preço, fee debitada do caixa, qty net', () => {
    const fill = computePaperBuyFill(BUY_MID, AMOUNT, FEE_BPS, SLIP_BPS);
    expect(fill).not.toBeNull();
    if (!fill) return;
    expect(fill.executedPriceUsd).toBeCloseTo(1.003, 12);
    expect(fill.feeUsd).toBeCloseTo(1.0, 12);
    expect(fill.slippageUsd).toBeCloseTo(3.0, 12);
    expect(fill.cashAmountUsd).toBe(1000);
    expect(fill.qty).toBeCloseTo(999 / 1.003, 12);
    expect(fill.grossAmountUsd).toBeCloseTo(999 / 1.003, 12);
    expect(fill.breakdown.netAmountUsd).toBeCloseTo(996, 10);
  });

  it('sell: slippage no preço, fee cobrada sobre os proventos; cash net', () => {
    const qty = 999 / 1.003;
    const fill = computePaperSellFill(SELL_MID, qty, FEE_BPS, SLIP_BPS);
    expect(fill).not.toBeNull();
    if (!fill) return;
    const grossProceeds = qty * 0.997;
    expect(fill.executedPriceUsd).toBeCloseTo(0.997, 12);
    expect(fill.grossAmountUsd).toBeCloseTo(qty, 12);
    expect(fill.feeUsd).toBeCloseTo(grossProceeds * 0.001, 12);
    expect(fill.cashAmountUsd).toBeCloseTo(grossProceeds * 0.999, 12);
    expect(fill.breakdown.totalCostUsd).toBeCloseTo(
      fill.feeUsd + fill.slippageUsd,
      12
    );
    expect(fill.breakdown.grossAmountUsd).toBeCloseTo(
      fill.breakdown.netAmountUsd + fill.breakdown.totalCostUsd,
      8
    );
  });

  it('round-trip no mesmo preço perde fee+slippage dos dois lados (~0.797%)', () => {
    const buy = computePaperBuyFill(1.0, AMOUNT, FEE_BPS, SLIP_BPS);
    if (!buy) throw new Error('buy fill nulo');
    const sell = computePaperSellFill(1.0, buy.qty, FEE_BPS, SLIP_BPS);
    if (!sell) throw new Error('sell fill nulo');
    const loss = AMOUNT - sell.cashAmountUsd;
    expect(loss).toBeGreaterThan(0);
    // honesto: a perda já inclui fee (não só slippage)
    expect(loss).toBeCloseTo(7.9690957, 3);
    expect(loss / AMOUNT * 100).toBeGreaterThan(0.79);
    expect(loss / AMOUNT * 100).toBeLessThan(0.81);
  });

  it('sem fees e sem slippage o round-trip não perde nada', () => {
    const buy = computePaperBuyFill(1.0, AMOUNT, 0, 0);
    if (!buy) throw new Error('buy fill nulo');
    expect(buy.qty).toBeCloseTo(AMOUNT, 10);
    const sell = computePaperSellFill(1.0, buy.qty, 0, 0);
    if (!sell) throw new Error('sell fill nulo');
    expect(sell.cashAmountUsd).toBeCloseTo(AMOUNT, 10);
  });

  it('fills inválidos retornam null (preço/qty/caixa não positivos)', () => {
    expect(computePaperBuyFill(0, 1000, 10, 30)).toBeNull();
    expect(computePaperBuyFill(1, 0, 10, 30)).toBeNull();
    expect(computePaperBuyFill(1, -5, 10, 30)).toBeNull();
    expect(computePaperSellFill(0, 10, 10, 30)).toBeNull();
    expect(computePaperSellFill(1, 0, 10, 30)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FeeAuditLog — a razão de /api/fees deixar de ser zerado
// ---------------------------------------------------------------------------
describe('FeeAuditLog persiste fee real (integração DB)', () => {
  const positionId = `vitest-fee-${process.pid}-${Date.now()}`;

  afterAll(async () => {
    await db.feeAuditLog.deleteMany({ where: { positionId } });
  });

  it('registra buy+sell com preço/qty reais e agrega em getFeeStats', async () => {
    const buy = computePaperBuyFill(1.0, 1000, 10, 30);
    const sell = computePaperSellFill(1.0, buy!.qty, 10, 30);
    await recordFeeAuditLog(positionId, 'VITEST/FEES', 'buy', buy!.breakdown, {
      strategy: 'vitest',
      exchange: 'dex',
      executedPriceUsd: buy!.executedPriceUsd,
      qty: buy!.qty,
    });
    await recordFeeAuditLog(positionId, 'VITEST/FEES', 'sell', sell!.breakdown, {
      strategy: 'vitest',
      exchange: 'dex',
      executedPriceUsd: sell!.executedPriceUsd,
      qty: sell!.qty,
    });

    const stats = await getFeeStats({ positionId });
    expect(stats.tradeCount).toBe(2);
    expect(stats.buyCount).toBe(1);
    expect(stats.sellCount).toBe(1);
    // ~1.99 USD de fee (1.00 no buy + ~0.993 no sell)
    expect(stats.totalFeesUsd).toBeGreaterThan(1.9);
    expect(stats.totalCostUsd).toBeGreaterThan(stats.totalFeesUsd);
    expect(stats.totalVolumeUsd).toBeGreaterThan(1900);

    const rows = await db.feeAuditLog.findMany({ where: { positionId } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // antes estava hardcoded 0 — /api/fees mostrava preço/qty zerados
      expect(row.executedPriceUsd).toBeGreaterThan(0);
      expect(row.qty).toBeGreaterThan(0);
      expect(row.feeUsd).toBeGreaterThan(0);
      expect(row.strategy).toBe('vitest');
      expect(row.exchange).toBe('dex');
    }
  });
});

