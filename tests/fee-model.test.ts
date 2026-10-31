import { describe, it, expect } from 'vitest';
import { computeFeeBreakdown, computeRoundTripCost } from '@/lib/trading/fee-model';

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

  it('round-trip do exemplo do módulo: feeBps=10, slippageBps=30 → 80bps = 0.80%', () => {
    const rtc = computeRoundTripCost(1000, 10, 30);
    expect(rtc.costUsd).toBeCloseTo(8.0, 10);
    expect(rtc.costPct).toBeCloseTo(0.8, 10);
    expect(rtc.breakevenMovePct).toBeCloseTo(0.8, 10);
  });

  it('custo escala linearmente com o tamanho', () => {
    const small = computeRoundTripCost(100, 10, 30);
    const big = computeRoundTripCost(1000, 10, 30);
    expect(big.costUsd).toBeCloseTo(small.costUsd * 10, 8);
    expect(big.breakevenMovePct).toBeCloseTo(small.breakevenMovePct, 10);
  });

  it('zero fees → custo zero', () => {
    const rtc = computeRoundTripCost(500, 0, 0);
    expect(rtc.costUsd).toBe(0);
    expect(rtc.breakevenMovePct).toBe(0);
  });
});
