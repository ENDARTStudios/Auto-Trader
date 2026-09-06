/**
 * Fase 5 — Timer de recuperação lang_degraded→ok (§5.13b/§5.13c).
 * Skill v1.6. Módulo PURO: mede dias até saída, NÃO transiciona modo.
 * A transição real é do runtime/cron (challenger-loop + envelope); aqui o
 * observador que prova contra conservadorismo paralisante (§5.14):
 * "quantos dias de coleta até o canal curar ou escalar p/ DAG_OBSOLESCENCE".
 *
 * Regra 5.13c: saída p/ ok exige AMBAS — forward_hit recupera n_min OOS
 * (hitRate ≥ bar) E dag_fail_rate < limiar. Forward bom + dag ruim →
 * DAG_OBSOLESCENCE (vocabulário obsoleto é fronteira, não cura de modelo).
 */

export interface RecoveryInput {
  forwardHits: boolean[]; // forwards OOS resolvidos, cronológicos
  dagFailRate: number;    // 0–1 atual
  nMin: number;           // amostra OOS mínima
  dagThreshold: number;   // saída exige dagFail < threshold
  daysPerForward: number; // latência média por forward
  hitRateBar?: number;    // default 0.5 (envelope-tunable)
}

export interface RecoveryResult {
  days: number;
  exitsTo: 'ok' | 'dag_obsolescence' | 'still_degraded';
  forwardHitRate: number;
  n: number;
}

export function simulateRecovery(inp: RecoveryInput): RecoveryResult {
  const n = inp.forwardHits.length;
  const hits = inp.forwardHits.filter(Boolean).length;
  const rate = n ? hits / n : 0;
  const bar = inp.hitRateBar ?? 0.5;
  const forwardOk = n >= inp.nMin && rate >= bar;
  const dagOk = inp.dagFailRate < inp.dagThreshold;
  const exitsTo = forwardOk && dagOk
    ? 'ok'
    : forwardOk && !dagOk
      ? 'dag_obsolescence'
      : 'still_degraded';
  return { days: n * inp.daysPerForward, exitsTo, forwardHitRate: rate, n };
}
