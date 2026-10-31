import { describe, it, expect } from 'vitest';
import { simulateRecovery } from '@/lib/trading/degraded-recovery';

const BASE = { nMin: 5, dagThreshold: 0.3, daysPerForward: 4, dagFailRate: 0.1 };

describe('Fase 5 — timer degraded→ok (§5.13b/§5.13c)', () => {
  it('forward recupera + dag ok → ok, com dias = n × diasPorForward', () => {
    const r = simulateRecovery({ ...BASE, forwardHits: [true, true, false, true, true, true] });
    expect(r.exitsTo).toBe('ok');
    expect(r.days).toBe(6 * 4);
    expect(r.forwardHitRate).toBeCloseTo(5 / 6, 5);
  });

  it('forward bom + dag ruim → dag_obsolescence (fronteira, não cura)', () => {
    const r = simulateRecovery({ ...BASE, forwardHits: [true, true, true, true, true], dagFailRate: 0.45 });
    expect(r.exitsTo).toBe('dag_obsolescence');
  });

  it('amostra insuficiente → still_degraded (não sai cedo)', () => {
    const r = simulateRecovery({ ...BASE, forwardHits: [true, true] });
    expect(r.exitsTo).toBe('still_degraded');
    expect(r.days).toBe(8);
  });

  it('vazio → still_degraded com 0 dias (fail-closed)', () => {
    const r = simulateRecovery({ ...BASE, forwardHits: [] });
    expect(r.exitsTo).toBe('still_degraded');
    expect(r.days).toBe(0);
    expect(r.forwardHitRate).toBe(0);
  });
});
