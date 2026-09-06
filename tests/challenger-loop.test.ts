import { describe, it, expect } from 'vitest';
import {
  canPromote,
  mostConservative,
  advanceCanary,
  checkCanaryKill,
  computeMinEvolutionPeriod,
  weeklyPromotionCycle,
  type Registry,
  type EvolutionConfig,
  type CanaryState,
} from '@/lib/trading/challenger-loop';
import type { ChallengerLangRecord, ForwardOutcome } from '@/lib/trading/tradingagents-adapter';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function mkRecord(version: string, hits: number, n: number, dag: number): ChallengerLangRecord {
  return {
    version,
    forward_samples: Array.from({ length: n }, (_, i) => ({
      episode_id: `e${i}`, lang_version: version,
      forward: { event: 'x', deadline_days: 20 }, hit: i < hits,
    })),
    forward_hit_rate: n ? hits / n : 0,
    dag_pass_rate: dag,
    eligible_for_promotion: false,
  };
}

function mkReg(ta: ChallengerLangRecord, createdDaysAgo = 60): Registry {
  return {
    champion: mkRecord('internal_v10', 11, 20, 0.9),
    challengers: [{
      record: ta,
      createdAt: NOW - createdDaysAgo * DAY,
      canary: { version: ta.version, stage: 0, brierBaseline: 0.2, brier7d: 0.18, drawdownBreach: false, startedAt: NOW - createdDaysAgo * DAY },
      needsHumanReview: false,
    }],
  };
}

const CFG: EvolutionConfig = {
  nMinForward: 10, forwardDeadlineDays: 20,
  minEvolutionPeriodDays: computeMinEvolutionPeriod({ forwardDeadlineDays: 20, nMinForward: 10 }),
  tSlaDays: 30,
};
const noResolve = (samples: ForwardOutcome[]) => samples.slice(0, 0); // nada novo vence

describe('Fase 3 — challenger loop (skill §5.4/§5.11/§5.12b/§5.14/§8c)', () => {
  it('6. promoção em crise: crisis_lock/frozen → blockedByMode, nenhuma promoção', () => {
    expect(canPromote('crisis_lock')).toBe(false);
    expect(canPromote('frozen_autonomy')).toBe(false);
    expect(canPromote('ok')).toBe(true);
    const reg = mkReg(mkRecord('tradingagents', 9, 10, 0.95));
    const r = weeklyPromotionCycle(reg, CFG, { state: 'crisis_lock', timestamp: NOW }, NOW, noResolve);
    expect(r.blockedByMode).toBe(true);
    expect(r.promoted).toBeNull();
    expect(mostConservative('crisis_lock', 'frozen_autonomy')).toBe('crisis_lock');
  });

  it('7. kill canary: brier7d > baseline*1.10 OU drawdown → stage 0 + demoted', () => {
    const bad: CanaryState = { version: 'ta', stage: 50, brierBaseline: 0.2, brier7d: 0.25, drawdownBreach: false, startedAt: NOW };
    expect(checkCanaryKill(bad)).toBe(true);
    expect(advanceCanary(bad).stage).toBe(0);

    const dd: CanaryState = { version: 'ta', stage: 10, brierBaseline: 0.2, brier7d: 0.18, drawdownBreach: true, startedAt: NOW };
    expect(checkCanaryKill(dd)).toBe(true);

    const ok: CanaryState = { version: 'ta', stage: 10, brierBaseline: 0.2, brier7d: 0.18, drawdownBreach: false, startedAt: NOW };
    expect(advanceCanary(ok).stage).toBe(50);
  });

  it('8. latência §5.12b: ageDays < minEvolutionPeriod → não promove mesmo com forward bom', () => {
    expect(CFG.minEvolutionPeriodDays).toBe(20); // max(20, 2*10)
    const reg = mkReg(mkRecord('tradingagents', 9, 10, 0.95), 5); // 5 dias < 20
    const r = weeklyPromotionCycle(reg, CFG, { state: 'ok', timestamp: NOW }, NOW, noResolve);
    expect(r.promoted).toBeNull();
    expect(r.advancedCanary).toEqual([]);
  });

  it('9. SLA §5.14: needsHumanReview + review > T_sla → slaEscalated, não promove', () => {
    const reg = mkReg(mkRecord('tradingagents', 9, 10, 0.95));
    reg.challengers[0].needsHumanReview = true;
    reg.challengers[0].reviewRequestedAt = NOW - 31 * DAY;
    const r = weeklyPromotionCycle(reg, CFG, { state: 'ok', timestamp: NOW }, NOW, noResolve);
    expect(r.slaEscalated).toEqual(['tradingagents']);
    expect(r.promoted).toBeNull();
  });

  it('10. champion nunca em limbo: init+advance no mesmo ciclo; 0→50→100 em 2 ciclos', () => {
    const reg = mkReg(mkRecord('tradingagents', 9, 10, 0.95));
    const mode = { state: 'ok' as const, timestamp: NOW };
    // ciclo 1: init 0→10 + advance 10→50 (sem promoção, champion intacto)
    const r1 = weeklyPromotionCycle(reg, CFG, mode, NOW, noResolve);
    expect(reg.champion.version).toBe('internal_v10');
    expect(r1.promoted).toBeNull();
    expect(r1.advancedCanary).toEqual(['tradingagents']);
    // ciclo 2: 50→100 → promove, antigo champion vira challenger (rollback)
    const r2 = weeklyPromotionCycle(reg, CFG, mode, NOW + 7 * DAY, noResolve);
    expect(r2.promoted).toBe('tradingagents');
    expect(reg.champion.version).toBe('tradingagents');
    expect(reg.challengers.some((c) => c.record.version === 'internal_v10')).toBe(true);
  });
});
