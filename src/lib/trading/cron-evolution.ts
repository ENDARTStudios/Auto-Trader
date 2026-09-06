/**
 * Fase 4 — Cron semanal de evolucao dual (§5.4/§7).
 * Integra weeklyPromotionCycle (Fase 3) ao mode.json (envelope) e ao
 * write-fence (learner so escreve em paths permitidos).
 * Guardrails: §5.5b (medir sempre, aplicar fora de crise) §8c (precedencia)
 *             §5.14 (SLA) §5.12b (latencia) write-fence (risco imutavel).
 */

import { loadEnvelope, learnerWrite, runtimeSetMode } from './envelope';
import {
  weeklyPromotionCycle, type Registry, type CycleResult, type ModeFile,
} from './challenger-loop';
import type { ForwardOutcome } from './tradingagents-adapter';

const SEVERITY: Record<string, number> = {
  ok: 0, lang_degraded: 1, unknown_regime: 2, frozen_autonomy: 3, crisis_lock: 4,
};

export interface CronDeps {
  root: string;
  registry: Registry;
  resolveExpired: (samples: ForwardOutcome[], now: number) => ForwardOutcome[];
  auditLog: (msg: string) => void;
  /** detector externo (Camada 3) diz o modo atual do mercado. */
  readMarketMode: () => ModeFile;
}

/** Executa um ciclo semanal. Retorna resultado p/ dashboard (5.6b). */
export function runWeeklyEvolution(deps: CronDeps): CycleResult {
  const env = loadEnvelope(deps.root);
  const now = Date.now();

  // 1) modo do mercado (Camada 3) -> aplica precedencia monotonica (8c) via runtime.
  const marketMode = deps.readMarketMode();
  runtimeSetMode(env, { state: marketMode.state, reason: marketMode.reason ?? 'market' }, SEVERITY, deps.auditLog);
  const mode: ModeFile = { state: env.mode.state as ModeFile['state'], reason: env.mode.reason, timestamp: env.mode.timestamp };

  // 2) ciclo de promocao (Fase 3) — mede sempre (5.5b), aplica so fora de crise/frozen (8c).
  const result = weeklyPromotionCycle(
    deps.registry,
    {
      nMinForward: env.cfg.n_min_forward,
      forwardDeadlineDays: env.cfg.forward_deadline_days,
      minEvolutionPeriodDays: Math.max(env.cfg.forward_deadline_days, 2 * env.cfg.n_min_forward),
      tSlaDays: env.cfg.sla_days,
    },
    mode,
    now,
    deps.resolveExpired,
  );

  // 3) persistir pesos/prompts do learner SO via write-fence (risco imutavel).
  for (const ch of deps.registry.challengers) {
    const isChampion = ch.record.version === deps.registry.champion.version;
    if (isChampion) continue;
    // learner escreve pesos param / prompts lang / quarentena — NUNCA risk/dag vivo/mode.
    try {
      learnerWrite(env, 'state/model_param_weights.json', JSON.stringify({ [ch.record.version]: ch.record }, null, 2), deps.auditLog);
    } catch (e) {
      deps.auditLog(`CRON_WRITE_BLOCKED: ${(e as Error).message}`); // fence ativo
    }
  }

  // 4) escalacao SLA (5.14): challenger precisa de revisao humana (DAG obsoleto) e nao veio em T_sla.
  for (const v of result.slaEscalated) {
    deps.auditLog(`SLA_ESCALATION: ${v} — revisao humana pendente > ${env.cfg.sla_days}d. Modo conservador ate resposta.`);
    runtimeSetMode(env, { state: 'frozen_autonomy', reason: `SLA_${v}` }, SEVERITY, deps.auditLog);
  }

  // 5) log do ciclo para auditoria (5.14/§6.5).
  deps.auditLog(`CRON_CYCLE: promoted=${result.promoted} demoted=[${result.demoted}] canary=[${result.advancedCanary}] blocked=${result.blockedByMode} mode=${mode.state}`);
  return result;
}
