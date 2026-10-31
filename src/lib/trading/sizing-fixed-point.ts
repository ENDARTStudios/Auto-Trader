/**
 * Fase 5 — Ponto-fixo robusto de sizing (§4.7b/§4.7c) + métrica de convergência (§5.14).
 * Skill v1.6. Módulo PURO: calcula tamanho convergido, NÃO decide nem executa.
 * A decisão (EV/sizing/kill) continua na Camada 4; aqui só a matemática auditável
 * (alimenta `size_iterations`/`size_converged`/`slippage_final` do contrato §4).
 *
 * Modelo:
 *   slippage(s)  = k·s·√(s/ADV)                       (4.7, k por liquidez)
 *   edgePost(s)  = (edgeRate − feeProp)·s − feeFix     (EV pós-custos, pré-impacto)
 *   holds(s)     ⟺ edgePost(s) > 0 ∧ slippage(s) ≤ 0.3·edgePost(s)   (4.7b)
 *   EV_real(s)   = edgePost(s) − slippage(s)          (4.7c, custo fixo incluído)
 *   floor        = feeFix / (edgeRate − feeProp)      (break-even sem impacto)
 *   abaixo do floor → NO_TRADE reason=cost_floor (distinto de não-convergência).
 * Iteração de Picard 2–3x sobre h(s) = min(kelly, 0.3·edgePost(s)/frac(s));
 * período-2 detectado → MENOR do ciclo (conservador), nunca NO_TRADE (4.7c).
 */

export interface FixedPointInput {
  kellySizeUsd: number;  // Kelly_frac_0.25 base (M_param)
  edgeRate: number;      // EV bruto por USD (antes de impacto/custos)
  advUsd: number;        // ADV do venue
  impactK: number;       // k: ~0.5 líquidas, 1.0–1.5 small/cripto
  feeProp: number;       // taxa proporcional (ex: 0.001)
  feeFixUsd: number;     // custo fixo por trade (ex: gas)
  tolRel?: number;       // default 0.005 (0.5%)
  maxIter?: number;      // default 3 (spec: 2–3x)
}

export type FixedPointReason =
  | 'converged'
  | 'oscillation_min'
  | 'max_iter_min'
  | 'cost_floor'
  | 'no_edge';

export interface FixedPointResult {
  sizeUsd: number;       // 0 quando NO_TRADE (cost_floor/no_edge)
  iterations: number;    // passos de Picard executados
  converged: boolean;
  reason: FixedPointReason;
  evRealUsd: number;
  slippageUsd: number;
  history: number[];
}

export function slippageUsd(size: number, k: number, adv: number): number {
  return k * size * Math.sqrt(size / adv);
}

export function edgePost(size: number, edgeRate: number, feeProp: number, feeFix: number): number {
  return (edgeRate - feeProp) * size - feeFix;
}

/** Constraint 4.7b no próprio tamanho final (self-consistente). */
export function holdsConstraint(
  size: number, edgeRate: number, feeProp: number, feeFix: number, k: number, adv: number,
): boolean {
  const ep = edgePost(size, edgeRate, feeProp, feeFix);
  if (!(ep > 0)) return false;
  return slippageUsd(size, k, adv) <= 0.3 * ep;
}

/**
 * Detecta período-2 no histórico (comum em ilíquidos, 4.7c).
 * Retorna o MENOR do ciclo ou null. Helper puro, usado pelo iterador.
 */
export function detectPeriod2(history: number[], tolRel: number): number | null {
  for (let i = 2; i < history.length; i++) {
    const a = history[i - 2];
    const b = history[i - 1];
    const c = history[i];
    if (a <= 0 || b <= 0 || c <= 0) continue;
    const same = Math.abs(c - a) / a <= tolRel;
    const moves = Math.abs(c - b) / b > tolRel;
    if (same && moves) return Math.min(a, b, c);
  }
  return null;
}

export function iterateFixedPoint(inp: FixedPointInput): FixedPointResult {
  const { kellySizeUsd: kelly, edgeRate: r, advUsd: adv, impactK: k } = inp;
  const feeProp = inp.feeProp;
  const feeFix = inp.feeFixUsd;
  const tol = inp.tolRel ?? 0.005;
  const maxIter = inp.maxIter ?? 3;

  if (!(kelly > 0 && adv > 0 && k >= 0 && feeProp >= 0 && feeFix >= 0)) {
    throw new Error('FIXED_POINT_INVALID_INPUT: kelly/adv/k/fees devem ser não-negativos (kelly,adv > 0)');
  }
  const net = r - feeProp;
  if (!(net > 0)) {
    return { sizeUsd: 0, iterations: 0, converged: false, reason: 'no_edge', evRealUsd: 0, slippageUsd: 0, history: [kelly] };
  }
  const floor = feeFix / net;
  if (kelly < floor) {
    return { sizeUsd: 0, iterations: 0, converged: false, reason: 'cost_floor', evRealUsd: 0, slippageUsd: 0, history: [kelly] };
  }

  const frac = (s: number) => (s <= 0 ? Infinity : k * Math.sqrt(s / adv));
  const h = (s: number) => {
    const ep = edgePost(s, r, feeProp, feeFix);
    if (!(ep > 0)) return 0;
    return Math.min(kelly, (0.3 * ep) / Math.max(frac(s), 1e-12));
  };

  const history = [kelly];
  let s = kelly;
  let converged = false;
  for (let i = 0; i < maxIter; i++) {
    const next = Math.max(0, h(s));
    history.push(next);
    if (s > 0 && Math.abs(next - s) / s <= tol) {
      s = next;
      converged = true;
      break;
    }
    s = next;
    if (s <= 0) break;
  }

  let candidate = s;
  let reason: FixedPointReason = converged ? 'converged' : 'max_iter_min';
  const cycMin = detectPeriod2(history, tol);
  if (cycMin !== null) {
    candidate = cycMin;
    reason = 'oscillation_min';
  }
  if (!holdsConstraint(candidate, r, feeProp, feeFix, k, adv)) {
    return { sizeUsd: 0, iterations: history.length - 1, converged: false, reason: 'cost_floor', evRealUsd: 0, slippageUsd: 0, history };
  }
  return {
    sizeUsd: candidate,
    iterations: history.length - 1,
    converged: reason === 'converged',
    reason,
    evRealUsd: edgePost(candidate, r, feeProp, feeFix) - slippageUsd(candidate, k, adv),
    slippageUsd: slippageUsd(candidate, k, adv),
    history,
  };
}

/** Métrica §5.14: taxa de convergência do ponto-fixo por lote de cenários. */
export interface ConvergenceStats {
  n: number;
  converged: number;
  oscillation: number;
  maxIter: number;
  costFloor: number;
  noEdge: number;
  rate: number; // (converged + oscillation) / n — opera sem paralisar
}

export function convergenceRate(scenarios: FixedPointInput[]): ConvergenceStats {
  const st: ConvergenceStats = { n: scenarios.length, converged: 0, oscillation: 0, maxIter: 0, costFloor: 0, noEdge: 0, rate: 0 };
  for (const sc of scenarios) {
    const r = iterateFixedPoint(sc);
    if (r.reason === 'converged') st.converged++;
    else if (r.reason === 'oscillation_min') st.oscillation++;
    else if (r.reason === 'max_iter_min') st.maxIter++;
    else if (r.reason === 'cost_floor') st.costFloor++;
    else st.noEdge++;
  }
  st.rate = st.n ? (st.converged + st.oscillation) / st.n : 0;
  return st;
}
