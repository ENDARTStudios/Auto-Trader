import { describe, it, expect } from 'vitest';
import {
  iterateFixedPoint, detectPeriod2, holdsConstraint, convergenceRate,
} from '@/lib/trading/sizing-fixed-point';

const LIQUID = {
  kellySizeUsd: 1000, edgeRate: 0.02, advUsd: 50_000_000,
  impactK: 0.5, feeProp: 0.001, feeFixUsd: 1,
};

describe('Fase 5 — ponto-fixo robusto (§4.7b/§4.7c)', () => {
  it('líquido: converge perto do Kelly em ≤3 iterações, constraint vale', () => {
    const r = iterateFixedPoint(LIQUID);
    expect(r.reason).toBe('converged');
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThanOrEqual(3);
    expect(r.sizeUsd).toBeGreaterThan(0);
    expect(r.sizeUsd).toBeLessThanOrEqual(1000);
    expect(holdsConstraint(r.sizeUsd, 0.02, 0.001, 1, 0.5, 50_000_000)).toBe(true);
    expect(r.evRealUsd).toBeGreaterThan(0);
  });

  it('ilíquido: encolhe abaixo do Kelly (nunca NO_TRADE por oscilação)', () => {
    const r = iterateFixedPoint({ ...LIQUID, advUsd: 200_000, impactK: 1.2 });
    expect(r.sizeUsd).toBeLessThan(1000);
    if (r.sizeUsd > 0) {
      expect(holdsConstraint(r.sizeUsd, 0.02, 0.001, 1, 1.2, 200_000)).toBe(true);
      expect(r.reason).not.toBe('cost_floor');
    }
  });

  it('custo fixo domina: feeFix alto → cost_floor com size 0', () => {
    const r = iterateFixedPoint({ ...LIQUID, feeFixUsd: 500 });
    expect(r.reason).toBe('cost_floor');
    expect(r.sizeUsd).toBe(0);
  });

  it('sem edge: edgeRate ≤ feeProp → no_edge', () => {
    const r = iterateFixedPoint({ ...LIQUID, edgeRate: 0.0005 });
    expect(r.reason).toBe('no_edge');
    expect(r.sizeUsd).toBe(0);
  });

  it('input inválido → throw (fail-fast de config)', () => {
    expect(() => iterateFixedPoint({ ...LIQUID, advUsd: 0 })).toThrow('FIXED_POINT_INVALID_INPUT');
    expect(() => iterateFixedPoint({ ...LIQUID, kellySizeUsd: -5 })).toThrow('FIXED_POINT_INVALID_INPUT');
  });

  it('detectPeriod2: período-2 sintético → menor do ciclo; sem ciclo → null', () => {
    expect(detectPeriod2([100, 40, 100.2, 40.1], 0.01)).toBeCloseTo(40, 5);
    expect(detectPeriod2([100, 80, 64, 51.2], 0.01)).toBeNull();
    expect(detectPeriod2([100, 90], 0.01)).toBeNull();
  });

  it('determinismo + history ≤ maxIter+1', () => {
    const a = iterateFixedPoint(LIQUID);
    const b = iterateFixedPoint(LIQUID);
    expect(a).toEqual(b);
    expect(a.history.length).toBeLessThanOrEqual(4);
  });

  it('métrica §5.14: convergenceRate agrega lote sem paralisar', () => {
    const st = convergenceRate([
      LIQUID,
      { ...LIQUID, advUsd: 200_000, impactK: 1.2 },
      { ...LIQUID, feeFixUsd: 500 },
      { ...LIQUID, edgeRate: 0.0005 },
    ]);
    expect(st.n).toBe(4);
    expect(st.converged + st.oscillation + st.maxIter + st.costFloor + st.noEdge).toBe(4);
    expect(st.rate).toBeGreaterThanOrEqual(0);
    expect(st.rate).toBeLessThanOrEqual(1);
  });
});
