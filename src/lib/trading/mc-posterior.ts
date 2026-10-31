/**
 * Fase 5 — Posterior do Monte Carlo com sizing real (§5.4c).
 * Skill v1.6. Módulo PURO: P(Sharpe_verdadeiro > limiar | amostras).
 * Contrato: as amostras DEVEM vir de simulações com ponto-fixo 4.7b/4.7c
 * aplicado (ou aproximação documentada) — `Sharpe_MC = Sharpe com sizing
 * real`. Este helper só computa o posterior; sizing-real é do chamador.
 * Promoção exige posterior > 0.95. Sem dados (n=0) ou sem variância
 * estimável (n=1) → 0 (fail-closed: nunca promove sem evidência).
 */

export function normalCdf(x: number): number {
  // Abramowitz–Stegun 7.1.26, |erro| ≤ 7.5e-8.
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-(x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Posterior normal-aproximado de que o Sharpe verdadeiro supera o limiar. */
export function mcPosterior(sharpeSamples: number[], threshold: number): number {
  const n = sharpeSamples.length;
  if (n < 2) return 0; // fail-closed: sem variância estimável, sem promoção
  const mean = sharpeSamples.reduce((a, b) => a + b, 0) / n;
  const variance = sharpeSamples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  if (!(variance > 0)) return mean > threshold ? 1 : 0;
  const se = Math.sqrt(variance / n);
  return 1 - normalCdf((threshold - mean) / se);
}

/** Gate de promoção §5.4: posterior > bar (default 0.95). */
export function passesPosterior(posterior: number, bar = 0.95): boolean {
  return posterior > bar;
}
