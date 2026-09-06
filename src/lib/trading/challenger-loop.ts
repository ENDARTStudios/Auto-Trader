/**
 * Fase 3 — challenger_lang_tradingagents no loop de evolução dual (§5.4).
 * O TA é UM challenger_lang; promovido por forward_hit_rate OOS (§5.12),
 * NUNCA por red-team. Champion nativo opera durante coleta (5.12b).
 * Guardrails: §5.4 (dual) §5.11 (canary+kill) §5.12b (latência) §5.14 (SLA)
 *             §8c (precedência: crise/frozen bloqueiam promoção) §5.5b (aplicar fora de crise).
 */

import type {
  ChallengerLangRecord, ForwardOutcome,
} from './tradingagents-adapter';
import { scoreChallengerLang, recordForwardOutcome } from './tradingagents-adapter';

/* ===================== estado de modo (§8) ===================== */
export type ModeState = 'ok' | 'lang_degraded' | 'unknown_regime' | 'crisis_lock' | 'frozen_autonomy';

export interface ModeFile {
  state: ModeState;
  reason?: string;
  timestamp: number;
}

/** Precedência monótona em conservadorismo (§8c): crisis_lock ≥ frozen > unknown > degraded > ok. */
const SEVERITY: Record<ModeState, number> = {
  ok: 0, lang_degraded: 1, unknown_regime: 2, frozen_autonomy: 3, crisis_lock: 4,
};
export const mostConservative = (a: ModeState, b: ModeState): ModeState =>
  SEVERITY[a] >= SEVERITY[b] ? a : b;

/** Promoção de challenger só fora do envelope absorvente (crise/frozen). §5.5b/§8c. */
export function canPromote(mode: ModeState): boolean {
  return mode !== 'crisis_lock' && mode !== 'frozen_autonomy';
}

/* ===================== canary + kill (§5.11) ===================== */
export type CanaryStage = 0 | 10 | 50 | 100; // % capital do challenger

export interface CanaryState {
  version: string;
  stage: CanaryStage;
  brierBaseline: number;   // champion Brier ao entrar em canary
  brier7d: number;         // challenger Brier últimos 7d
  drawdownBreach: boolean; // drawdown > limite do estágio
  startedAt: number;
}

/** Avança canary 10→50→100 só se sem kill. Kill 5.11: Brier 7d piora >10% OU drawdown. */
export function advanceCanary(c: CanaryState): CanaryState {
  if (checkCanaryKill(c)) return { ...c, stage: 0 }; // rebaixa imediato
  const next: Record<CanaryStage, CanaryStage> = { 0: 10, 10: 50, 50: 100, 100: 100 };
  return { ...c, stage: next[c.stage] };
}

export function checkCanaryKill(c: CanaryState): boolean {
  const brierWorse = c.brierBaseline > 0 && c.brier7d > c.brierBaseline * 1.10;
  return brierWorse || c.drawdownBreach;
}

/* ===================== latência declarada (§5.12b) ===================== */
export interface EvolutionConfig {
  nMinForward: number;        // amostra OOS mínima p/ promover
  forwardDeadlineDays: number;
  minEvolutionPeriodDays: number; // = max(deadline, 2*nMin) — calculado
  tSlaDays: number;           // SLA envelope humano (§5.14)
}
export function computeMinEvolutionPeriod(cfg: Pick<EvolutionConfig, 'forwardDeadlineDays' | 'nMinForward'>): number {
  return Math.max(cfg.forwardDeadlineDays, 2 * cfg.nMinForward);
}

/* ===================== registro de challengers ===================== */
export interface RegisteredChallenger {
  record: ChallengerLangRecord;
  createdAt: number;
  canary: CanaryState;
  /** precisa de revisão humana (ex: DAG obsoleto) — dispara SLA (§5.14). */
  needsHumanReview: boolean;
  reviewRequestedAt?: number;
}

export interface Registry {
  champion: ChallengerLangRecord; // nativo, opera sempre (5.12b)
  challengers: RegisteredChallenger[]; // inclui 'tradingagents'
}

/* ===================== ciclo semanal (§5.4 / §7) ===================== */
export interface CycleResult {
  promoted: string | null;
  demoted: string[];
  advancedCanary: string[];
  slaEscalated: string[];
  blockedByMode: boolean;
}

/**
 * Cron semanal: resolve forwards vencidos, pontua challengers, aplica canary/kill,
 * respeita modo (§8c) e SLA (§5.14). Champion nativo NUNCA em limbo.
 */
export function weeklyPromotionCycle(
  reg: Registry,
  cfg: EvolutionConfig,
  mode: ModeFile,
  now: number,
  resolveExpired: (samples: ForwardOutcome[], now: number) => ForwardOutcome[],
): CycleResult {
  const result: CycleResult = {
    promoted: null, demoted: [], advancedCanary: [], slaEscalated: [],
    blockedByMode: !canPromote(mode.state),
  };

  // 1) resolver forwards vencidos de todos (champion + challengers) — medir sempre (§5.5b).
  for (const ch of reg.challengers) {
    const resolved = resolveExpired(ch.record.forward_samples, now);
    for (const o of resolved) ch.record = recordForwardOutcome(ch.record, o);
  }
  const resolvedChamp = resolveExpired(reg.champion.forward_samples, now);
  for (const o of resolvedChamp) reg.champion = recordForwardOutcome(reg.champion, o);

  // 2) SLA envelope humano (§5.14): revisão pendente > T_sla -> escala (não promove).
  for (const ch of reg.challengers) {
    if (ch.needsHumanReview && ch.reviewRequestedAt) {
      const days = (now - ch.reviewRequestedAt) / 86_400_000;
      if (days >= cfg.tSlaDays) result.slaEscalated.push(ch.record.version);
    }
  }

  // 3) promoção bloqueada em crisis_lock/frozen_autonomy (§8c, §5.5b).
  if (result.blockedByMode) return result;

  // 4) pontuar + canary. Nota: degraded/unknown iniciam no mesmo 10
  // (CanaryStage não tem 5%; conservadorismo vem do forward encurtado §0.5b).
  const startStage: CanaryStage = 10;
  for (const ch of reg.challengers) {
    const scored = scoreChallengerLang(ch.record, reg.champion, cfg.nMinForward);
    ch.record = scored;

    const ageDays = (now - ch.createdAt) / 86_400_000;
    const pastLatency = ageDays >= cfg.minEvolutionPeriodDays; // §5.12b
    const eligible = scored.eligible_for_promotion && pastLatency && !ch.needsHumanReview;

    if (!eligible) {
      // kill de canary já em curso?
      if (ch.canary.stage > 0 && checkCanaryKill(ch.canary)) {
        ch.canary = { ...ch.canary, stage: 0 };
        result.demoted.push(ch.record.version);
      }
      continue;
    }

    // avança canary 10→50→100 com kill 5.11.
    if (ch.canary.stage === 0) ch.canary = { version: ch.record.version, stage: startStage, brierBaseline: reg.champion.forward_hit_rate ? ch.canary.brierBaseline : 0, brier7d: 1 - scored.forward_hit_rate, drawdownBreach: false, startedAt: now };
    const adv = advanceCanary(ch.canary);
    if (adv.stage === 0 && ch.canary.stage > 0) {
      result.demoted.push(ch.record.version);
    } else if (adv.stage > ch.canary.stage) {
      result.advancedCanary.push(ch.record.version);
    }
    ch.canary = adv;

    if (adv.stage === 100) {
      // promove: challenger vira champion; antigo champion vira challenger (rollback).
      const prevChampion: RegisteredChallenger = {
        record: reg.champion, createdAt: now,
        canary: { version: reg.champion.version, stage: 0, brierBaseline: 0, brier7d: 0, drawdownBreach: false, startedAt: now },
        needsHumanReview: false,
      };
      reg.champion = ch.record;
      reg.challengers = reg.challengers.filter((x) => x !== ch).concat(prevChampion);
      result.promoted = ch.record.version;
    }
  }

  return result;
}
