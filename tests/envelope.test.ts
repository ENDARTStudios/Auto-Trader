import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadEnvelope, learnerWrite, runtimeSetMode,
} from '@/lib/trading/envelope';
import { weeklyPromotionCycle } from '@/lib/trading/challenger-loop';
import { runWeeklyEvolution } from '@/lib/trading/cron-evolution';
import type { ChallengerLangRecord } from '@/lib/trading/tradingagents-adapter';

const ROOT = '.';
const SEVERITY: Record<string, number> = {
  ok: 0, lang_degraded: 1, unknown_regime: 2, frozen_autonomy: 3, crisis_lock: 4,
};

// Backup/restore de arquivos que o fence/cron escrevem de verdade.
const MODE_PATH = resolve('state/mode.json');
const QUAR_PATH = resolve('config/dag_edges_quarantine.json');
const WEIGHTS_PATH = resolve('state/model_param_weights.json');
const saved: Record<string, string | null> = {};
function backup(p: string) {
  if (!(p in saved)) saved[p] = existsSync(p) ? readFileSync(p, 'utf8') : null;
}
function restoreAll() {
  for (const [p, content] of Object.entries(saved)) {
    if (content === null) { if (existsSync(p)) unlinkSync(p); }
    else writeFileSync(p, content, 'utf8');
  }
  for (const k of Object.keys(saved)) delete saved[k];
}
afterEach(() => restoreAll());

const logs: string[] = [];
const auditLog = (m: string) => { logs.push(m); };

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

describe('Fase 4 — envelope operacional (skill §5.5/§7/§8c)', () => {
  it('1. write-fence ativo: learner em risk_config → RISK_FENCE_VIOLATION + escalada', () => {
    const env = loadEnvelope(ROOT);
    logs.length = 0;
    expect(() => learnerWrite(env, 'config/risk_config.json', '{}', auditLog))
      .toThrow('RISK_FENCE_VIOLATION');
    expect(logs.some((m) => m.includes('RISK_FENCE_VIOLATION'))).toBe(true);
  });

  it('2. default-deny: path não-listado → RISK_FENCE_UNKNOWN_PATH', () => {
    const env = loadEnvelope(ROOT);
    expect(() => learnerWrite(env, 'src/lib/trading/engine.ts', 'x', auditLog))
      .toThrow('RISK_FENCE_UNKNOWN_PATH');
  });

  it('3. quarentena writable: dag_edges_quarantine.json → passa', () => {
    backup(QUAR_PATH);
    const env = loadEnvelope(ROOT);
    logs.length = 0;
    learnerWrite(env, 'config/dag_edges_quarantine.json', '{"quarantine":[]}', auditLog);
    expect(logs.some((m) => m.includes('LEARNER_WRITE'))).toBe(true);
  });

  it('4. DAG vivo forbidden: dag_edges.json → bloqueado', () => {
    const env = loadEnvelope(ROOT);
    expect(() => learnerWrite(env, 'config/dag_edges.json', '{}', auditLog))
      .toThrow('RISK_FENCE_VIOLATION');
  });

  it('5. crisis_lock absorvente: crisis→frozen → MODE_BLOCK, permanece crisis', () => {
    const env = loadEnvelope(ROOT);
    env.mode = { state: 'crisis_lock', reason: 'test', timestamp: Date.now() };
    logs.length = 0;
    runtimeSetMode(env, { state: 'frozen_autonomy', reason: 'SLA' }, SEVERITY, auditLog);
    expect(env.mode.state).toBe('crisis_lock');
    expect(logs.some((m) => m.includes('MODE_BLOCK'))).toBe(true);
  });

  it('6. precedência monótona: ok→unknown aceita; unknown→ok mantém unknown', () => {
    backup(MODE_PATH);
    const env = loadEnvelope(ROOT);
    env.mode = { state: 'ok', reason: null, timestamp: Date.now() };
    runtimeSetMode(env, { state: 'unknown_regime', reason: 'conf<0.5' }, SEVERITY, auditLog);
    expect(env.mode.state).toBe('unknown_regime');
    // sem gatilho de recuperação: tentativa de voltar p/ ok é ignorada (conservador)
    runtimeSetMode(env, { state: 'ok', reason: 'recuperado?' }, SEVERITY, auditLog);
    expect(env.mode.state).toBe('unknown_regime');
  });

  it('7. medir sempre, aplicar fora de crise: crisis resolve forwards mas blockedByMode', () => {
    const reg = {
      champion: mkRecord('internal_v10', 11, 20, 0.9),
      challengers: [{
        record: mkRecord('tradingagents', 0, 0, 0.95), createdAt: Date.now(),
        canary: { version: 'tradingagents', stage: 0 as const, brierBaseline: 0, brier7d: 0, drawdownBreach: false, startedAt: Date.now() },
        needsHumanReview: false,
      }],
    };
    const pending = [{
      episode_id: 'e99', lang_version: 'tradingagents',
      forward: { event: 'x', deadline_days: 20 }, hit: true,
    }];
    const r = weeklyPromotionCycle(
      reg,
      { nMinForward: 10, forwardDeadlineDays: 20, minEvolutionPeriodDays: 20, tSlaDays: 30 },
      { state: 'crisis_lock', timestamp: Date.now() },
      Date.now(),
      (samples) => (samples.length ? [] : pending),
    );
    expect(r.blockedByMode).toBe(true);
    expect(r.promoted).toBeNull();
    // mediu: o forward pendente entrou no record do challenger
    expect(reg.challengers[0].record.forward_samples.length).toBe(1);
  });

  it('8. SLA: review pendente > T_sla → frozen_autonomy via runtimeSetMode', () => {
    backup(MODE_PATH);
    const env = loadEnvelope(ROOT);
    env.mode = { state: 'ok', reason: null, timestamp: Date.now() };
    const now = Date.now();
    const reg = {
      champion: mkRecord('internal_v10', 11, 20, 0.9),
      challengers: [{
        record: mkRecord('tradingagents', 9, 10, 0.95), createdAt: now - 60 * 86_400_000,
        canary: { version: 'tradingagents', stage: 0 as const, brierBaseline: 0.2, brier7d: 0.18, drawdownBreach: false, startedAt: now - 60 * 86_400_000 },
        needsHumanReview: true, reviewRequestedAt: now - 31 * 86_400_000,
      }],
    };
    const r = weeklyPromotionCycle(
      reg,
      { nMinForward: 10, forwardDeadlineDays: 20, minEvolutionPeriodDays: 20, tSlaDays: 30 },
      { state: 'ok', timestamp: now },
      now,
      () => [],
    );
    expect(r.slaEscalated).toEqual(['tradingagents']);
    runtimeSetMode(env, { state: 'frozen_autonomy', reason: 'SLA_tradingagents' }, SEVERITY, auditLog);
    expect(env.mode.state).toBe('frozen_autonomy');
  });

  it('9. envelope incompleto: root sem risk_config → ENVELOPE_INCOMPLETE (não opera sem limites)', () => {
    expect(() => loadEnvelope('/nonexistent-root-xyz')).toThrow('ENVELOPE_INCOMPLETE');
  });

  it('10. integração: runWeeklyEvolution lê n_min/deadline do envelope (não hardcoded)', () => {
    backup(WEIGHTS_PATH);
    if (existsSync(WEIGHTS_PATH)) unlinkSync(WEIGHTS_PATH);
    const localLogs: string[] = [];
    const reg = {
      champion: mkRecord('internal_v10', 11, 20, 0.9),
      challengers: [{
        record: mkRecord('tradingagents', 5, 10, 0.95), createdAt: Date.now() - 60 * 86_400_000,
        canary: { version: 'tradingagents', stage: 0 as const, brierBaseline: 0.2, brier7d: 0.18, drawdownBreach: false, startedAt: Date.now() - 60 * 86_400_000 },
        needsHumanReview: false,
      }],
    };
    const r = runWeeklyEvolution({
      root: ROOT,
      registry: reg,
      resolveExpired: () => [],
      auditLog: (m) => { localLogs.push(m); },
      readMarketMode: () => ({ state: 'ok', timestamp: Date.now() }),
    });
    expect(r.blockedByMode).toBe(false);
    expect(localLogs.some((m) => m.includes('CRON_CYCLE'))).toBe(true);
    // learner persistiu via fence (não em risk/dag vivo/mode)
    expect(existsSync(WEIGHTS_PATH)).toBe(true);
    if (existsSync(WEIGHTS_PATH)) unlinkSync(WEIGHTS_PATH);
    delete saved[WEIGHTS_PATH];
  });
});
