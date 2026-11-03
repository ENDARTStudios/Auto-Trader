// tests/risk-scaling.test.ts — bandas de risk scaling (DB mockado, zero rede)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();

vi.mock('@/lib/db', () => ({
  db: { tradingBalance: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

import {
  assessRiskScale,
  getCurrentRiskScale,
  RISK_SCALE_BANDS,
  type RiskScaleBand,
} from '@/lib/trading/risk-scaling';

function balance(tradesClosed: number, wins: number) {
  return { id: 'singleton', tradesClosed, wins };
}

beforeEach(() => {
  findUnique.mockReset();
});

describe('RISK_SCALE_BANDS', () => {
  it('cobre 0-101% sem buracos e em ordem crescente de multiplicador', () => {
    expect(RISK_SCALE_BANDS).toHaveLength(5);
    expect(RISK_SCALE_BANDS[0].minWinRate).toBe(0);
    expect(RISK_SCALE_BANDS[RISK_SCALE_BANDS.length - 1].maxWinRate).toBe(101);
    for (let i = 1; i < RISK_SCALE_BANDS.length; i++) {
      const prev: RiskScaleBand = RISK_SCALE_BANDS[i - 1];
      const cur: RiskScaleBand = RISK_SCALE_BANDS[i];
      expect(cur.minWinRate).toBe(prev.maxWinRate); // sem gap
      expect(cur.multiplier).toBeGreaterThan(prev.multiplier);
    }
  });
});

describe('assessRiskScale', () => {
  it('scaling desabilitado => baseline 1.0x, applied=false', async () => {
    findUnique.mockResolvedValue(balance(200, 190));
    const r = await assessRiskScale(1000, false);
    expect(r.applied).toBe(false);
    expect(r.multiplier).toBe(1);
    expect(r.scaledAmountUsd).toBe(1000);
    expect(r.band.label).toBe('Baseline');
    expect(r.reason).toContain('disabled');
  });

  it('menos de 10 trades => não escala (baseline) com razão de dados insuficientes', async () => {
    findUnique.mockResolvedValue(balance(5, 5));
    const r = await assessRiskScale(1000, true);
    expect(r.applied).toBe(false);
    expect(r.multiplier).toBe(1);
    expect(r.scaledAmountUsd).toBe(1000);
    expect(r.tradesClosed).toBe(5);
    expect(r.winRate).toBe(100);
    expect(r.reason).toContain('5/10');
  });

  it('sem linha de balance => tratado como 0 trades (não escala)', async () => {
    findUnique.mockResolvedValue(null);
    const r = await assessRiskScale(500, true);
    expect(r.applied).toBe(false);
    expect(r.tradesClosed).toBe(0);
    expect(r.winRate).toBe(0);
  });

  it.each([
    [2, 10, 'Defensive', 0.5],   // 20%
    [4, 10, 'Cautious', 0.75],   // 40%
    [6, 10, 'Baseline', 1.0],    // 60%
    [7, 10, 'Aggressive', 1.25], // 70%
    [9, 10, 'Maximum', 1.5],     // 90%
  ])('winRate %s/%s => %s (%sx) e aplica no montante', async (wins, total, label, mult) => {
    findUnique.mockResolvedValue(balance(total, wins));
    const r = await assessRiskScale(1000, true);
    expect(r.applied).toBe(true);
    expect(r.band.label).toBe(label);
    expect(r.multiplier).toBe(mult);
    expect(r.scaledAmountUsd).toBeCloseTo(1000 * mult, 6);
    expect(r.reason).toContain(label);
  });

  it.each([
    [33, 'Cautious', 0.75],  // fronteira inclusive
    [50, 'Baseline', 1.0],
    [65, 'Aggressive', 1.25],
    [80, 'Maximum', 1.5],
  ])('boundary winRate=%s => %s', async (pct, label) => {
    findUnique.mockResolvedValue(balance(100, pct));
    const r = await assessRiskScale(100, true);
    expect(r.band.label).toBe(label);
    expect(r.winRate).toBe(pct);
  });

  it('winRate 100% cai na última banda (maxWinRate exclusivo = 101)', async () => {
    findUnique.mockResolvedValue(balance(10, 10));
    const r = await assessRiskScale(1000, true);
    expect(r.band.label).toBe('Maximum');
    expect(r.scaledAmountUsd).toBe(1500);
  });
});

describe('getCurrentRiskScale', () => {
  it('devolve a banda corrente sem aplicar montante (base 0)', async () => {
    findUnique.mockResolvedValue(balance(20, 15)); // 75%
    const r = await getCurrentRiskScale();
    expect(r.multiplier).toBe(1.25);
    expect(r.band.label).toBe('Aggressive');
    expect(r.applied).toBe(true);
    expect(r.tradesClosed).toBe(20);
    expect(Object.keys(r)).not.toContain('scaledAmountUsd');
  });
});
