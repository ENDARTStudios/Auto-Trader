// tests/engine.test.ts — engine.ts (getEngineSnapshot) + helpers puros com DB mockado.
//
// A classe Engine tem loop/timer privados (não testável de forma determinística
// sem rede/DB). O contrato público testável é getEngineSnapshot() + os helpers
// puros de engine-correctness.ts. Todos os imports pesados do engine são
// mockados (sem rede, sem Postgres, sem LLM).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setEngineRunning: vi.fn(),
  tradingBalanceFindUnique: vi.fn(),
  reserveFindUnique: vi.fn(),
  positionCount: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    tradingBalance: { findUnique: (...a: unknown[]) => h.tradingBalanceFindUnique(...a) },
    reserve: { findUnique: (...a: unknown[]) => h.reserveFindUnique(...a) },
  },
}));

vi.mock('@/lib/auth/rls-context', () => ({
  withSystemRls: async (fn: (tx: unknown) => unknown) =>
    fn({ position: { count: (...a: unknown[]) => h.positionCount(...a) } }),
  withUserRls: async (_s: unknown, fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('@/lib/trading/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trading/config')>();
  return {
    ...actual, // mantém DEFAULT_CONFIG real (fixture dos testes)
    getConfig: (...a: unknown[]) => h.getConfig(...a),
    setEngineRunning: (...a: unknown[]) => h.setEngineRunning(...a),
  };
});

vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});
vi.mock('@/lib/trading/risk-manager', () => ({
  assessTradeRisk: async () => undefined,
  triggerKillSwitch: async () => undefined,
  updatePeakBalance: async () => undefined,
  recordRiskEvent: async () => undefined,
}));
vi.mock('@/lib/trading/scam-detector', () => ({ analyzeToken: async () => undefined }));
vi.mock('@/lib/trading/token-selector', () => ({ selectCandidates: async () => [] }));
vi.mock('@/lib/trading/rising-tokens', () => ({ getRisingCandidates: async () => [] }));
vi.mock('@/lib/trading/price-feed', () => ({ fetchPricesBatch: async () => new Map() }));
vi.mock('@/lib/trading/goplus-scanner', () => ({ scanTokenWithGoPlus: async () => undefined }));
vi.mock('@/lib/trading/market-analysis', () => ({ analyzeMarket: async () => undefined }));
vi.mock('@/lib/trading/ai-agent', () => ({ runAgentSquad: async () => undefined }));
vi.mock('@/lib/trading/position-surveillance', () => ({
  runSurveillance: async () => [],
  resolveAlertsForPosition: async () => undefined,
}));
vi.mock('@/lib/trading/exit-planner', () => ({
  planExit: async () => undefined,
  applyExitPlan: async () => undefined,
}));
vi.mock('@/lib/trading/platform-scanner', () => ({ getApprovedPlatformIds: async () => new Set() }));
vi.mock('@/lib/trading/event-bus', () => ({ eventBus: { push: () => undefined } }));
vi.mock('@/lib/trading/performance-snapshot', () => ({ recordSnapshotIfDue: async () => undefined }));
vi.mock('@/lib/trading/notifier', () => ({ notifyEvent: async () => undefined }));
vi.mock('@/lib/trading/schedule', () => ({
  canScoutNow: async () => true,
  forceCloseAllIfOutsideWindow: async () => undefined,
}));
vi.mock('@/lib/trading/portfolio', () => ({
  ensureInitialized: async () => undefined,
  openPosition: async () => undefined,
  closePosition: async () => undefined,
  rebalanceRound: async () => undefined,
  getSystemOwnerId: async () => 'admin-1',
  systemOwnerScope: (id: string | null) => (id ? { ownerId: id } : {}),
}));
vi.mock('@/lib/trading/diversification', () => ({
  checkDiversification: async () => ({ allowed: true, reasons: [] }),
  pickStrategyForCandidate: async () => 'day',
}));
vi.mock('@/lib/trading/graduation', () => ({ recordPaperCycleAttempt: async () => undefined }));
vi.mock('@/lib/trading/source-health', () => ({
  evaluateSourceHealthForScout: async () => ({ ok: true }),
}));

import { engine, getEngineSnapshot } from '@/lib/trading/engine';
import {
  decideMechanicalExit,
  evaluateAiSquadOutcome,
  evaluateDataQualityGate,
  finalizeRoundPnl,
  getMaxEntryDeviationPct,
  validateEntryPrice,
} from '@/lib/trading/engine-correctness';
import { DEFAULT_CONFIG } from '@/lib/trading/config';

const NOW = new Date('2026-11-03T12:00:00Z');

const liveCfg = {
  ...DEFAULT_CONFIG,
  mode: 'paper' as const,
  killSwitchActive: false,
  killSwitchReason: null,
  paperCyclesPassed: 3,
  paperCyclesRequired: 50,
  graduatedToLive: false,
  loopIntervalSec: 60,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const fn of Object.values(h)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset: () => void }).mockReset();
  }
  h.getConfig.mockResolvedValue(liveCfg);
  h.tradingBalanceFindUnique.mockResolvedValue({
    balanceUsd: 500,
    peakBalanceUsd: 600,
    realizedPnlUsd: 25,
    tradesOpened: 3,
    tradesClosed: 2,
    wins: 1,
    losses: 1,
  });
  h.reserveFindUnique.mockResolvedValue({ balanceUsd: 100 });
  h.positionCount.mockResolvedValue(1);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('getEngineSnapshot', () => {
  it('engine parada: status stopped, saldos, contadores e winRate', async () => {
    const snap = await getEngineSnapshot();
    expect(snap.status).toBe('stopped');
    expect(snap.mode).toBe('paper');
    expect(snap.loopState).toBe('scout');
    expect(snap.tradingBalanceUsd).toBe(500);
    expect(snap.reserveBalanceUsd).toBe(100);
    expect(snap.peakBalanceUsd).toBe(600);
    expect(snap.realizedPnlUsd).toBe(25);
    expect(snap.openPositionsCount).toBe(1);
    expect(snap.totalPositionsOpened).toBe(3);
    expect(snap.totalPositionsClosed).toBe(2);
    expect(snap.wins).toBe(1);
    expect(snap.losses).toBe(1);
    expect(snap.winRate).toBeCloseTo(50, 10);
    expect(snap.nextLoopAt).toBeNull();
    expect(snap.paperCyclesPassed).toBe(3);
    expect(snap.paperCyclesRequired).toBe(50);
    expect(snap.killSwitchActive).toBe(false);
    expect(snap.currentRoundId).toBeNull();
    expect(snap.loopIteration).toBe(0);
  });

  it('kill switch ativo → status killed + reason', async () => {
    h.getConfig.mockResolvedValue({
      ...liveCfg,
      killSwitchActive: true,
      killSwitchReason: 'drawdown crítico',
    });
    const snap = await getEngineSnapshot();
    expect(snap.status).toBe('killed');
    expect(snap.killSwitchActive).toBe(true);
    expect(snap.killSwitchReason).toBe('drawdown crítico');
  });

  it('engine rodando: nextLoopAt = agora + loopIntervalSec', async () => {
    vi.spyOn(engine, 'isRunning').mockReturnValue(true);
    const snap = await getEngineSnapshot();
    expect(snap.status).toBe('running');
    expect(snap.nextLoopAt).toBe(
      new Date(NOW.getTime() + liveCfg.loopIntervalSec * 1000).toISOString()
    );
  });

  it('sem TradingBalance/reserve: defaults zerados e winRate 0', async () => {
    h.tradingBalanceFindUnique.mockResolvedValue(null);
    h.reserveFindUnique.mockResolvedValue(null);
    h.positionCount.mockResolvedValue(0);
    const snap = await getEngineSnapshot();
    expect(snap.tradingBalanceUsd).toBe(0);
    expect(snap.reserveBalanceUsd).toBe(0);
    expect(snap.peakBalanceUsd).toBe(0);
    expect(snap.realizedPnlUsd).toBe(0);
    expect(snap.openPositionsCount).toBe(0);
    expect(snap.totalPositionsOpened).toBe(0);
    expect(snap.totalPositionsClosed).toBe(0);
    expect(snap.winRate).toBe(0);
  });

  it('usa withSystemRls para contar posições abertas (RLS strict 4/4)', async () => {
    await getEngineSnapshot();
    expect(h.positionCount).toHaveBeenCalledWith({ where: { status: 'open' } });
  });
});

describe('Engine singleton — estado público e ciclo start/stop', () => {
  it('estado inicial: parada, scout, sem rodada/iteração', () => {
    expect(engine.isRunning()).toBe(false);
    expect(engine.getLoopState()).toBe('scout');
    expect(engine.getIteration()).toBe(0);
    expect(engine.getCurrentRoundId()).toBeNull();
    expect(engine.getLastLoopAt()).toBeNull();
  });

  it('start é bloqueado em serverless (VERCEL) e no kill switch', async () => {
    process.env.VERCEL = '1';
    try {
      await engine.start();
    } finally {
      delete process.env.VERCEL;
    }
    expect(engine.isRunning()).toBe(false);
    expect(h.setEngineRunning).not.toHaveBeenCalled();

    h.getConfig.mockResolvedValue({ ...liveCfg, killSwitchActive: true, killSwitchReason: 'teste' });
    await engine.start();
    expect(engine.isRunning()).toBe(false);
    expect(h.setEngineRunning).not.toHaveBeenCalled();
  });

  it('start liga o loop (setEngineRunning(true)) e stop desliga', async () => {
    h.getConfig.mockResolvedValue(liveCfg);
    await engine.start();
    expect(h.setEngineRunning).toHaveBeenCalledWith(true);
    expect(engine.isRunning()).toBe(true);
    // segundo start é no-op (loop já rodando)
    await engine.start();
    expect(h.setEngineRunning).toHaveBeenCalledTimes(1);

    await engine.stop();
    expect(engine.isRunning()).toBe(false);
    expect(h.setEngineRunning).toHaveBeenLastCalledWith(false);
  });
});

describe('helpers puros do engine (lacunas de cobertura)', () => {
  it('decideMechanicalExit: maxExitAt inválido (NaN) nunca dispara timeout', () => {
    const d = decideMechanicalExit(
      {
        entryPriceUsd: 1,
        takeProfitPrice: 1.15,
        stopLossPrice: 0.9,
        maxExitAt: new Date(Number.NaN),
      },
      1.0,
      new Date(NOW.getTime() + 10_000_000)
    );
    expect(d.action).toBe('none');
    expect(d.priced).toBe(true);
  });

  it('validateEntryPrice usa default do processo quando env ausente', () => {
    const original = process.env.MAX_ENTRY_DEVIATION_PCT;
    delete process.env.MAX_ENTRY_DEVIATION_PCT;
    try {
      expect(getMaxEntryDeviationPct()).toBe(2.0);
      // 3% de desvio com default 2% → rejeita
      expect(validateEntryPrice(100, 103).ok).toBe(false);
    } finally {
      if (original === undefined) delete process.env.MAX_ENTRY_DEVIATION_PCT;
      else process.env.MAX_ENTRY_DEVIATION_PCT = original;
    }
  });

  it('validateEntryPrice aceita override maior via env', () => {
    const original = process.env.MAX_ENTRY_DEVIATION_PCT;
    process.env.MAX_ENTRY_DEVIATION_PCT = '5';
    try {
      expect(validateEntryPrice(100, 103).ok).toBe(true);
    } finally {
      if (original === undefined) delete process.env.MAX_ENTRY_DEVIATION_PCT;
      else process.env.MAX_ENTRY_DEVIATION_PCT = original;
    }
  });

  it('evaluateDataQualityGate: CEX ignora dataQuality ausente', () => {
    const gate = evaluateDataQualityGate('cex', {});
    expect(gate.skip).toBe(false);
    expect(gate.dataQuality).toBeNull();
  });

  it('finalizeRoundPnl: percentuais limitados a 100 (não gera corte > lucro)', () => {
    const f = finalizeRoundPnl([100], 150, -50);
    expect(f.reserveCutUsd).toBe(100);
    expect(f.reinvestCutUsd).toBe(0);
  });
});
describe('engine-correctness — branches restantes', () => {
  it('validateEntryPrice com maxDeviationPct inválido cai no default 2%', () => {
    // NaN forçado no parâmetro: usa DEFAULT_MAX_ENTRY_DEVIATION_PCT.
    expect(validateEntryPrice(100, 101, Number.NaN).maxDeviationPct).toBe(2.0);
    expect(validateEntryPrice(100, 101, -5).maxDeviationPct).toBe(2.0);
  });

  it('evaluateAiSquadOutcome com confiança NaN usa 0 e não veta', () => {
    const outcome = evaluateAiSquadOutcome({
      ok: true,
      consensus: 'avoid',
      consensusConfidence: Number.NaN,
    });
    expect(outcome.confidence).toBe(0);
    expect(outcome.veto).toBe(false);
  });
});
