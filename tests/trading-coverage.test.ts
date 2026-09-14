// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  assessTradeRisk,
  triggerKillSwitch,
  clearKillSwitch,
  recordRiskEvent,
  updatePeakBalance,
} from '@/lib/trading/risk-manager';
import {
  recordScoutSkip,
  getScoutSkipStats,
  resetScoutSkipStats,
  type ScoutSkipReason,
} from '@/lib/trading/scout-skip-stats';
import {
  checkDiversification,
  getDiversificationSnapshot,
  pickStrategyForCandidate,
} from '@/lib/trading/diversification';
import {
  paperBuy,
  paperSell,
  liveBuy,
  liveSell,
} from '@/lib/trading/paper-trader';
import { EngineConfig } from '@/lib/trading/config';
import { logger } from '@/lib/trading/logger';

const FAKE_HASH = '$2b$10$fakehashtestingpurposesonlyxxxxxxxxxxxxxxxxxxxxxx';
const TEST_SYMBOL = 'E2E-COVERAGE-TEST';

async function cleanTestData() {
  // Create test user if not exists
  let testUser = await db.user.findUnique({ where: { email: 'test-coverage@local' } });
  if (!testUser) {
    testUser = await db.user.create({
      data: { email: 'test-coverage@local', passwordHash: FAKE_HASH, role: 'trader', isActive: true },
    });
  }
  const TEST_USER_ID = testUser.id;

  // Clean up test positions - scoped to this suite to avoid cross-suite deletion (e.g. position-rls uses E2E-RLS-*)
  await db.position.deleteMany({
    where: {
      OR: [
        { symbol: { startsWith: 'E2E-COVERAGE' } },
        { symbol: { startsWith: 'E2E-DAILY' } },
        { symbol: { in: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'DOTUSDT', 'NEWUSDT'] }, ownerId: TEST_USER_ID },
      ],
    },
  });
  await db.riskEvent.deleteMany({ where: { message: { contains: 'E2E' } } });
  await db.scoutSkipStat.deleteMany({ where: { reason: { in: ['schedule', 'sourceHealth', 'pauseWindow', 'roundActive', 'ok'] } } });
  await db.tradingBalance.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', balanceUsd: 10000, peakBalanceUsd: 10000, realizedPnlUsd: 0 },
    update: { balanceUsd: 10000, peakBalanceUsd: 10000, realizedPnlUsd: 0 },
  });
  await db.reserve.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', balanceUsd: 10000 },
    update: { balanceUsd: 10000 },
  });
  await db.config.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });
  return TEST_USER_ID;
}

async function createTestConfig(overrides: Partial<EngineConfig> = {}): Promise<EngineConfig> {
  const baseConfig: EngineConfig = {
    mode: 'paper',
    graduatedToLive: false,
    paperCyclesPassed: 0,
    paperCyclesRequired: 3,
    killSwitchActive: false,
    killSwitchReason: null,
    maxDrawdownPct: 10,
    maxDailyLossPct: 5,
    maxExposurePerTokenPct: 20,
    maxLossPerTradePct: 2,
    stopLossPct: 5,
    capitalPctPerRound: 10,
    maxPositionsPerSymbol: 2,
    maxPositionsPerChain: 3,
    maxPositionsPerStrategy: 2,
    maxPositionsPerRound: 5,
    enabledStrategies: ['scalp', 'day', 'swing'],
    tradingPairs: [],
    ...overrides,
  };
  return baseConfig;
}

describe('T049b — Trading Coverage (≥40% per module)', () => {
  let TEST_USER_ID: string;

  beforeAll(async () => {
    TEST_USER_ID = await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await db.$disconnect();
  });

  beforeEach(async () => {
    TEST_USER_ID = await cleanTestData();
  });

  describe('risk-manager.ts', () => {
    it('allows trade when all risk checks pass', async () => {
      const cfg = await createTestConfig({ killSwitchActive: false });
      const result = await assessTradeRisk(cfg, 'BTCUSDT', 1000);
      expect(result.allowed).toBe(true);
      expect(result.reasons.length).toBe(0);
      expect(result.maxRoundAllocationUsd).toBeGreaterThan(0);
      expect(result.maxPerTokenUsd).toBeGreaterThan(0);
    });

    it('blocks trade when kill switch is active', async () => {
      await triggerKillSwitch('E2E test kill switch');
      const cfg = await createTestConfig({ killSwitchActive: true });
      const result = await assessTradeRisk(cfg, 'BTCUSDT', 1000);
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('Kill switch ativo'))).toBe(true);
      await clearKillSwitch();
    });

    it('blocks live trade when not graduated', async () => {
      const cfg = await createTestConfig({ mode: 'live', graduatedToLive: false });
      const result = await assessTradeRisk(cfg, 'BTCUSDT', 1000);
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('graduação'))).toBe(true);
    });

    it('allows live trade when graduated', async () => {
      const cfg = await createTestConfig({ mode: 'live', graduatedToLive: true, paperCyclesPassed: 3 });
      const result = await assessTradeRisk(cfg, 'BTCUSDT', 1000);
      expect(result.allowed).toBe(true);
    });

    it('blocks trade when max drawdown exceeded', async () => {
      await db.tradingBalance.update({
        where: { id: 'singleton' },
        data: { realizedPnlUsd: -1500, peakBalanceUsd: 10000 },
      });
      const cfg = await createTestConfig({ maxDrawdownPct: 10 });
      const result = await assessTradeRisk(cfg, 'BTCUSDT', 1000);
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('Drawdown'))).toBe(true);
    });

    it('blocks trade when max daily loss exceeded', async () => {
      await db.position.create({
        data: {
          symbol: 'E2E-DAILY-LOSS',
          chain: 'cex',
          
          entryPriceUsd: 100,
          entryAmountUsd: 1000,
          entryQty: 10,
          status: 'closed',
          exitPriceUsd: 80,
          exitAt: new Date(),
          pnlUsd: -200,
          source: 'cex',
          takeProfitPrice: 110,
          stopLossPrice: 90,
          maxExitAt: new Date(Date.now() + 60 * 60 * 1000),
          ownerId: TEST_USER_ID,
            roundId: 1,
        },
      });
      const cfg = await createTestConfig({ maxDailyLossPct: 1 });
      const result = await assessTradeRisk(cfg, 'BTCUSDT', 1000);
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('Perda diária'))).toBe(true);
    });

    it('blocks trade when max exposure per token exceeded', async () => {
      await db.position.create({
        data: {
          symbol: 'ETHUSDT',
          chain: 'cex',
          
          entryPriceUsd: 2000,
          entryAmountUsd: 2000,
          entryQty: 1,
          status: 'open',
          source: 'cex',
          takeProfitPrice: 2200,
          stopLossPrice: 1800,
          maxExitAt: new Date(Date.now() + 60 * 60 * 1000),
          ownerId: TEST_USER_ID,
            roundId: 1,
        },
      });
      const cfg = await createTestConfig({ maxExposurePerTokenPct: 10 });
      const result = await assessTradeRisk(cfg, 'ETHUSDT', 2000);
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('Exposição por token'))).toBe(true);
    });

    it('blocks trade when max loss per trade exceeded', async () => {
      const cfg = await createTestConfig({ maxLossPerTradePct: 1, stopLossPct: 15 });
      const result = await assessTradeRisk(cfg, 'BTCUSDT', 1000);
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('Pior caso de perda'))).toBe(true);
    });

    it('records risk event correctly', async () => {
      await recordRiskEvent('test_event', 'warning', 'E2E test risk event', { test: true });
      const events = await db.riskEvent.findMany({ where: { message: { contains: 'E2E test risk event' } } });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('test_event');
      expect(events[0].severity).toBe('warning');
    });

    it('updates peak balance when current exceeds peak', async () => {
      await db.tradingBalance.update({
        where: { id: 'singleton' },
        data: { balanceUsd: 12000, peakBalanceUsd: 10000 },
      });
      await updatePeakBalance();
      const balance = await db.tradingBalance.findUnique({ where: { id: 'singleton' } });
      expect(balance?.peakBalanceUsd).toBe(12000);
    });

    it('triggerKillSwitch sets config and records event', async () => {
      await triggerKillSwitch('E2E manual kill');
      const config = await db.config.findUnique({ where: { id: 'singleton' } });
      expect(config?.killSwitchActive).toBe(true);
      expect(config?.killSwitchReason).toBe('E2E manual kill');
      expect(config?.engineRunning).toBe(false);
      const events = await db.riskEvent.findMany({ where: { message: { contains: 'E2E manual kill' } } });
      expect(events.length).toBeGreaterThan(0);
      await clearKillSwitch();
    });

    it('clearKillSwitch resets config and records event', async () => {
      await triggerKillSwitch('E2E test');
      await clearKillSwitch();
      const config = await db.config.findUnique({ where: { id: 'singleton' } });
      expect(config?.killSwitchActive).toBe(false);
      expect(config?.killSwitchReason).toBeNull();
      const events = await db.riskEvent.findMany({ where: { message: { contains: 'desativado' } } });
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('scout-skip-stats.ts', () => {
    it('records skip for each reason', async () => {
      const reasons: ScoutSkipReason[] = ['schedule', 'sourceHealth', 'pauseWindow', 'roundActive', 'ok'];
      for (const reason of reasons) {
        await recordScoutSkip(reason);
      }
      const stats = await getScoutSkipStats();
      for (const reason of reasons) {
        expect(stats[reason].count).toBe(1);
        expect(stats[reason].lastAt).not.toBeNull();
      }
    });

    it('increments counter on repeated calls', async () => {
      await recordScoutSkip('schedule');
      await recordScoutSkip('schedule');
      const stats = await getScoutSkipStats();
      expect(stats.schedule.count).toBe(2);
    });

    it('returns zero counts for missing reasons', async () => {
      await db.scoutSkipStat.deleteMany({ where: { reason: { in: ['schedule', 'sourceHealth', 'pauseWindow', 'roundActive', 'ok'] } } });
      const stats = await getScoutSkipStats();
      expect(stats.schedule.count).toBe(0);
      expect(stats.schedule.lastAt).toBeNull();
      expect(stats.sourceHealth.count).toBe(0);
      expect(stats.ok.count).toBe(0);
    });

    it('resets all counters', async () => {
      await recordScoutSkip('schedule');
      await recordScoutSkip('sourceHealth');
      await recordScoutSkip('ok');
      const result = await resetScoutSkipStats();
      expect(result.reset).toBe(3);
      const stats = await getScoutSkipStats();
      expect(stats.schedule.count).toBe(0);
      expect(stats.sourceHealth.count).toBe(0);
      expect(stats.ok.count).toBe(0);
    });

    it('returns reset=0 when no rows exist', async () => {
      await db.scoutSkipStat.deleteMany({ where: { reason: { in: ['schedule', 'sourceHealth', 'pauseWindow', 'roundActive', 'ok'] } } });
      const result = await resetScoutSkipStats();
      expect(result.reset).toBe(0);
    });

    it('handles upsert silently on error', async () => {
      const originalUpsert = db.scoutSkipStat.upsert;
      (db.scoutSkipStat as any).upsert = async () => { throw new Error('DB error'); };
      await expect(recordScoutSkip('schedule')).resolves.not.toThrow();
      (db.scoutSkipStat as any).upsert = originalUpsert;
    });
  });

  describe('diversification.ts', () => {
    const mockCandidate = (overrides = {}) => ({
      symbol: overrides.symbol ?? 'BTCUSDT',
      chain: overrides.chain ?? 'cex',
      priceUsd: overrides.priceUsd ?? 50000,
    });

    const mockConfig = (overrides = {}) => ({
      mode: 'paper',
      graduatedToLive: false,
      paperCyclesPassed: 0,
      paperCyclesRequired: 3,
      killSwitchActive: false,
      maxDrawdownPct: 10,
      maxDailyLossPct: 5,
      maxExposurePerTokenPct: 20,
      maxLossPerTradePct: 2,
      stopLossPct: 5,
      capitalPctPerRound: 10,
      maxPositionsPerSymbol: 2,
      maxPositionsPerChain: 3,
      maxPositionsPerStrategy: 2,
      maxPositionsPerRound: 5,
      enabledStrategies: ['scalp', 'day', 'swing'],
      tradingPairs: [],
      ...overrides,
    });

    it('allows new position when under all caps', async () => {
      const cfg = mockConfig();
      const candidate = mockCandidate();
      const result = await checkDiversification(cfg, candidate, 'day');
      expect(result.allowed).toBe(true);
      expect(result.reasons.length).toBe(0);
    });

    it('blocks when max positions per symbol reached', async () => {
      await db.position.createMany({
        data: [
          { symbol: 'BTCUSDT', chain: 'cex',  entryPriceUsd: 50000, entryAmountUsd: 1000, entryQty: 0.02, status: 'open', source: 'cex', takeProfitPrice: 55000, stopLossPrice: 45000, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'BTCUSDT', chain: 'cex',  entryPriceUsd: 50000, entryAmountUsd: 1000, entryQty: 0.02, status: 'open', source: 'cex', takeProfitPrice: 55000, stopLossPrice: 45000, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
        ],
      });
      const cfg = mockConfig({ maxPositionsPerSymbol: 2 });
      const candidate = mockCandidate({ symbol: 'BTCUSDT' });
      const result = await checkDiversification(cfg, candidate, 'day');
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('Max positions per symbol'))).toBe(true);
    });

it('blocks when max positions per chain reached', async () => {
      await db.position.createMany({
        data: [
          { symbol: 'BTCUSDT', chain: 'cex',  entryPriceUsd: 50000, entryAmountUsd: 1000, entryQty: 0.02, status: 'open', source: 'cex', takeProfitPrice: 55000, stopLossPrice: 45000, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'ETHUSDT', chain: 'cex',  entryPriceUsd: 3000, entryAmountUsd: 1000, entryQty: 0.33, status: 'open', source: 'cex', takeProfitPrice: 3300, stopLossPrice: 2700, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'SOLUSDT', chain: 'cex',  entryPriceUsd: 100, entryAmountUsd: 1000, entryQty: 10, status: 'open', source: 'cex', takeProfitPrice: 110, stopLossPrice: 90, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
        ],
      });
      const cfg = mockConfig({ maxPositionsPerChain: 3 });
      const candidate = mockCandidate({ chain: 'cex' });
      const result = await checkDiversification(cfg, candidate, 'day');
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('Max positions per chain'))).toBe(true);
    });

it('blocks when max positions per strategy reached', async () => {
      await db.position.createMany({
        data: [
          { symbol: 'BTCUSDT', chain: 'cex',  entryPriceUsd: 50000, entryAmountUsd: 1000, entryQty: 0.02, status: 'open', strategy: 'day', source: 'cex', takeProfitPrice: 55000, stopLossPrice: 45000, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'ETHUSDT', chain: 'cex',  entryPriceUsd: 3000, entryAmountUsd: 1000, entryQty: 0.33, status: 'open', strategy: 'day', source: 'cex', takeProfitPrice: 3300, stopLossPrice: 2700, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
        ],
      });
      const cfg = mockConfig({ maxPositionsPerStrategy: 2 });
      const candidate = mockCandidate();
      const result = await checkDiversification(cfg, candidate, 'day');
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('Max positions per strategy'))).toBe(true);
    });

it('blocks when max positions per round reached', async () => {
      await db.position.createMany({
        data: [
          { symbol: 'BTCUSDT', chain: 'cex',  entryPriceUsd: 50000, entryAmountUsd: 1000, entryQty: 0.02, status: 'open', source: 'cex', takeProfitPrice: 55000, stopLossPrice: 45000, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'ETHUSDT', chain: 'cex',  entryPriceUsd: 3000, entryAmountUsd: 1000, entryQty: 0.33, status: 'open', source: 'cex', takeProfitPrice: 3300, stopLossPrice: 2700, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'SOLUSDT', chain: 'cex',  entryPriceUsd: 100, entryAmountUsd: 1000, entryQty: 10, status: 'open', source: 'cex', takeProfitPrice: 110, stopLossPrice: 90, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'AVAXUSDT', chain: 'cex',  entryPriceUsd: 20, entryAmountUsd: 1000, entryQty: 50, status: 'open', source: 'cex', takeProfitPrice: 22, stopLossPrice: 18, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'DOTUSDT', chain: 'cex',  entryPriceUsd: 5, entryAmountUsd: 1000, entryQty: 200, status: 'open', source: 'cex', takeProfitPrice: 5.5, stopLossPrice: 4.5, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
        ],
      });
      const cfg = mockConfig({ maxPositionsPerRound: 5 });
      const candidate = mockCandidate({ symbol: 'NEWUSDT' });
      const result = await checkDiversification(cfg, candidate, 'day');
      expect(result.allowed).toBe(false);
      expect(result.reasons.some(r => r.includes('Max total positions per round'))).toBe(true);
    });

it('returns correct current counts and caps', async () => {
      await db.position.createMany({
        data: [
          { symbol: 'BTCUSDT', chain: 'cex',  entryPriceUsd: 50000, entryAmountUsd: 1000, entryQty: 0.02, status: 'open', strategy: 'day', source: 'cex', takeProfitPrice: 55000, stopLossPrice: 45000, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'ETHUSDT', chain: 'cex',  entryPriceUsd: 3000, entryAmountUsd: 1000, entryQty: 0.33, status: 'open', strategy: 'day', source: 'cex', takeProfitPrice: 3300, stopLossPrice: 2700, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'SOLUSDT', chain: 'cex',  entryPriceUsd: 100, entryAmountUsd: 1000, entryQty: 10, status: 'open', strategy: 'swing', source: 'cex', takeProfitPrice: 110, stopLossPrice: 90, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
        ],
      });
      const cfg = mockConfig({ maxPositionsPerSymbol: 2, maxPositionsPerChain: 3, maxPositionsPerStrategy: 2, maxPositionsPerRound: 5 });
      const candidate = mockCandidate({ symbol: 'BTCUSDT' });
      const result = await checkDiversification(cfg, candidate, 'day');
      expect(result.current.perSymbol).toBe(1);
      expect(result.current.perChain).toBe(3);
      expect(result.current.perStrategy).toBe(2);
      expect(result.current.total).toBe(3);
      expect(result.caps.maxPositionsPerSymbol).toBe(2);
      expect(result.caps.maxPositionsPerChain).toBe(3);
      expect(result.caps.maxPositionsPerStrategy).toBe(2);
      expect(result.caps.maxPositionsPerRound).toBe(5);
    });

    it('getDiversificationSnapshot returns correct snapshot', async () => {
      await db.position.createMany({
        data: [
          { symbol: 'BTCUSDT', chain: 'cex',  entryPriceUsd: 50000, entryAmountUsd: 1000, entryQty: 0.02, status: 'open', strategy: 'day', source: 'cex', takeProfitPrice: 55000, stopLossPrice: 45000, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'BTCUSDT', chain: 'cex',  entryPriceUsd: 50000, entryAmountUsd: 1000, entryQty: 0.02, status: 'open', strategy: 'swing', source: 'cex', takeProfitPrice: 55000, stopLossPrice: 45000, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'ETHUSDT', chain: 'ethereum',  entryPriceUsd: 3000, entryAmountUsd: 1000, entryQty: 0.33, status: 'open', strategy: 'day', source: 'cex', takeProfitPrice: 3300, stopLossPrice: 2700, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
        ],
      });
      const snapshot = await getDiversificationSnapshot();
      expect(snapshot.totalOpen).toBe(3);
      expect(snapshot.bySymbol.BTCUSDT).toBe(2);
      expect(snapshot.bySymbol.ETHUSDT).toBe(1);
      expect(snapshot.byChain.cex).toBe(2);
      expect(snapshot.byChain.ethereum).toBe(1);
      expect(snapshot.byStrategy.day).toBe(2);
      expect(snapshot.byStrategy.swing).toBe(1);
      expect(snapshot.uniqueSymbols).toBe(2);
      expect(snapshot.uniqueChains).toBe(2);
      expect(snapshot.uniqueStrategies).toBe(2);
      expect(snapshot.diversityScore).toBeGreaterThan(0);
      expect(snapshot.diversityScore).toBeLessThanOrEqual(100);
    });

    it('getDiversificationSnapshot returns 0 when no positions', async () => {
      const snapshot = await getDiversificationSnapshot();
      expect(snapshot.totalOpen).toBe(0);
      expect(snapshot.diversityScore).toBe(0);
      expect(snapshot.uniqueSymbols).toBe(0);
      expect(snapshot.uniqueChains).toBe(0);
      expect(snapshot.uniqueStrategies).toBe(0);
    });

    it('pickStrategyForCandidate returns strategy with fewest positions', async () => {
      await db.position.createMany({
        data: [
          { symbol: 'BTCUSDT', chain: 'cex',  entryPriceUsd: 50000, entryAmountUsd: 1000, entryQty: 0.02, status: 'open', strategy: 'day', source: 'cex', takeProfitPrice: 55000, stopLossPrice: 45000, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'ETHUSDT', chain: 'cex',  entryPriceUsd: 3000, entryAmountUsd: 1000, entryQty: 0.33, status: 'open', strategy: 'day', source: 'cex', takeProfitPrice: 3300, stopLossPrice: 2700, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
        ],
      });
      const cfg = mockConfig({ enabledStrategies: ['scalp', 'day', 'swing'] });
      const strategy = await pickStrategyForCandidate(cfg);
      expect(strategy).toBe('scalp');
    });

    it('pickStrategyForCandidate returns null when all strategies at cap', async () => {
      await db.position.createMany({
        data: [
          { symbol: 'BTCUSDT', chain: 'cex',  entryPriceUsd: 50000, entryAmountUsd: 1000, entryQty: 0.02, status: 'open', strategy: 'scalp', source: 'cex', takeProfitPrice: 55000, stopLossPrice: 45000, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
          { symbol: 'ETHUSDT', chain: 'cex',  entryPriceUsd: 3000, entryAmountUsd: 1000, entryQty: 0.33, status: 'open', strategy: 'day', source: 'cex', takeProfitPrice: 3300, stopLossPrice: 2700, maxExitAt: new Date(Date.now() + 60 * 60 * 1000), scamScore: 0, ownerId: TEST_USER_ID, roundId: 1 },
        ],
      });
      const cfg = mockConfig({ enabledStrategies: ['scalp', 'day'], maxPositionsPerStrategy: 1 });
      const strategy = await pickStrategyForCandidate(cfg);
      expect(strategy).toBeNull();
    });

    it('pickStrategyForCandidate uses default strategies when enabledStrategies empty', async () => {
      const cfg = mockConfig({ enabledStrategies: [] });
      const strategy = await pickStrategyForCandidate(cfg);
      expect(['scalp', 'day', 'swing']).toContain(strategy);
    });
  });

  describe('paper-trader.ts', () => {
    const mockCandidate = (overrides = {}) => ({
      symbol: overrides.symbol ?? 'BTCUSDT',
      chain: overrides.chain ?? 'cex',
      priceUsd: overrides.priceUsd ?? 50000,
      source: overrides.source ?? 'binance',
    });

    it('paperBuy executes successfully with valid params', async () => {
      const candidate = mockCandidate({ priceUsd: 100 });
      const result = await paperBuy(candidate, 1000);
      expect(result.ok).toBe(true);
      expect(result.executedPriceUsd).toBeGreaterThan(100);
      expect(result.qty).toBeGreaterThan(0);
      expect(result.amountUsd).toBe(1000);
      expect(result.error).toBeUndefined();
    });

    it('paperBuy fails with invalid amount', async () => {
      const candidate = mockCandidate({ priceUsd: 100 });
      const result = await paperBuy(candidate, -100);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Parâmetros inválidos');
    });

    it('paperBuy fails with zero price', async () => {
      const candidate = mockCandidate({ priceUsd: 0 });
      const result = await paperBuy(candidate, 1000);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Parâmetros inválidos');
    });

    it('paperSell executes successfully with valid params', async () => {
      const result = await paperSell('BTCUSDT', 10, 50000);
      expect(result.ok).toBe(true);
      expect(result.executedPriceUsd).toBeLessThan(50000);
      expect(result.qty).toBe(10);
      expect(result.amountUsd).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    it('paperSell fails with invalid qty', async () => {
      const result = await paperSell('BTCUSDT', -10, 50000);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Parâmetros inválidos');
    });

    it('paperSell fails with zero price', async () => {
      const result = await paperSell('BTCUSDT', 10, 0);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Parâmetros inválidos');
    });

    it('paperBuy applies slippage correctly (buy: price * 1.003)', async () => {
      const candidate = mockCandidate({ priceUsd: 100 });
      const result = await paperBuy(candidate, 1000);
      const expectedPrice = 100 * 1.003;
      expect(result.executedPriceUsd).toBeCloseTo(expectedPrice, 4);
    });

    it('paperSell applies slippage correctly (sell: price * 0.997)', async () => {
      const result = await paperSell('BTCUSDT', 10, 50000);
      const expectedPrice = 50000 * 0.997;
      expect(result.executedPriceUsd).toBeCloseTo(expectedPrice, 0);
    });

    it('liveBuy returns not implemented error', async () => {
      const candidate = mockCandidate();
      const result = await liveBuy(candidate, 1000);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('graduation required');
    });

    it('liveSell returns not implemented error', async () => {
      const result = await liveSell('BTCUSDT', 10, 50000);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Live trading não implementado');
    });
  });

  describe('config.ts (EngineConfig type)', () => {
    it('creates valid config with all required fields', () => {
      const cfg: EngineConfig = {
        mode: 'paper',
        graduatedToLive: false,
        paperCyclesPassed: 0,
        paperCyclesRequired: 3,
        killSwitchActive: false,
        maxDrawdownPct: 10,
        maxDailyLossPct: 5,
        maxExposurePerTokenPct: 20,
        maxLossPerTradePct: 2,
        stopLossPct: 5,
        capitalPctPerRound: 10,
        maxPositionsPerSymbol: 2,
        maxPositionsPerChain: 3,
        maxPositionsPerStrategy: 2,
        maxPositionsPerRound: 5,
        enabledStrategies: ['scalp', 'day', 'swing'],
        tradingPairs: [],
      };
      expect(cfg.mode).toBe('paper');
      expect(cfg.maxDrawdownPct).toBe(10);
      expect(cfg.enabledStrategies.length).toBe(3);
    });

    it('accepts live mode config', () => {
      const cfg: EngineConfig = {
        mode: 'live',
        graduatedToLive: true,
        paperCyclesPassed: 3,
        paperCyclesRequired: 3,
        killSwitchActive: false,
        maxDrawdownPct: 10,
        maxDailyLossPct: 5,
        maxExposurePerTokenPct: 20,
        maxLossPerTradePct: 2,
        stopLossPct: 5,
        capitalPctPerRound: 10,
        maxPositionsPerSymbol: 2,
        maxPositionsPerChain: 3,
        maxPositionsPerStrategy: 2,
        maxPositionsPerRound: 5,
        enabledStrategies: ['scalp', 'day', 'swing'],
        tradingPairs: [],
      };
      expect(cfg.mode).toBe('live');
      expect(cfg.graduatedToLive).toBe(true);
    });
  });
});