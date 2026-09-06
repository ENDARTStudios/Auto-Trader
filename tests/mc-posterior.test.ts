import { describe, it, expect } from 'vitest';
import { normalCdf, mcPosterior, passesPosterior } from '@/lib/trading/mc-posterior';

describe('Fase 5 — posterior MC com sizing real (§5.4c)', () => {
  it('normalCdf: âncoras conhecidas', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it('amostras fortes → posterior > 0.95 (promove)', () => {
    const samples = Array.from({ length: 30 }, (_, i) => 1.8 + (i % 2 === 0 ? 0.1 : -0.1));
    const post = mcPosterior(samples, 1.0);
    expect(post).toBeGreaterThan(0.95);
    expect(passesPosterior(post)).toBe(true);
  });

  it('amostras fracas → posterior < 0.95 (segura)', () => {
    const samples = Array.from({ length: 30 }, (_, i) => 0.2 + (i % 2 === 0 ? 0.5 : -0.5));
    const post = mcPosterior(samples, 1.0);
    expect(post).toBeLessThan(0.95);
    expect(passesPosterior(post)).toBe(false);
  });

  it('sem dados (n=0) ou n=1 → 0, fail-closed (nunca promove sem evidência)', () => {
    expect(mcPosterior([], 1.0)).toBe(0);
    expect(mcPosterior([2.5], 1.0)).toBe(0);
  });
});
