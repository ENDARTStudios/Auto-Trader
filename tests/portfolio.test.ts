// tests/portfolio.test.ts — portfolio.ts com DB/RLS/execução mockados.
//
// Determinístico: sem rede, sem Postgres. O withSystemRls é substituído por um
// fake tx; paper-trader/fee/paper-order e singletons vêm de vi.fn(). Cobre
// openPosition, closePosition, rebalanceRound, ensureInitialized,
// getSystemOwnerId/systemOwnerScope e withdrawReserve.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  positionCreate: vi.fn(),
  positionFindUnique: vi.fn(),
  positionUpdate: vi.fn(),
  positionFindMany: vi.fn(),
  paperBuy: vi.fn(),
  paperSell: vi.fn(),
  liveBuy: vi.fn(),
  liveSell: vi.fn(),
  recordFeeAuditLog: vi.fn(),
  recordPaperOrder: vi.fn(),
  transitionPaperOrder: vi.fn(),
  tradingBalanceFindUnique: vi.fn(),
  tradingBalanceCreate: vi.fn(),
  tradingBalanceUpdate: vi.fn(),
  reserveFindUnique: vi.fn(),
  reserveUpdate: vi.fn(),
  reserveCreate: vi.fn(),
  configFindUnique: vi.fn(),
  configCreate: vi.fn(),
  userFindFirst: vi.fn(),
  roundUpdateMany: vi.fn(),
  dbTransaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    position: {},
    tradingBalance: {
      findUnique: (...a: unknown[]) => h.tradingBalanceFindUnique(...a),
      create: (...a: unknown[]) => h.tradingBalanceCreate(...a),
      update: (...a: unknown[]) => h.tradingBalanceUpdate(...a),
    },
    reserve: {
      findUnique: (...a: unknown[]) => h.reserveFindUnique(...a),
      create: (...a: unknown[]) => h.reserveCreate(...a),
      update: (...a: unknown[]) => h.reserveUpdate(...a),
    },
    config: {
      findUnique: (...a: unknown[]) => h.configFindUnique(...a),
      create: (...a: unknown[]) => h.configCreate(...a),
    },
    user: { findFirst: (...a: unknown[]) => h.userFindFirst(...a) },
    round: { updateMany: (...a: unknown[]) => h.roundUpdateMany(...a) },
    $transaction: (...a: unknown[]) => h.dbTransaction(...a),
  },
}));

vi.mock('@/lib/auth/rls-context', () => ({
  withSystemRls: async (fn: (tx: unknown) => unknown) =>
    fn({
      position: {
        create: (...a: unknown[]) => h.positionCreate(...a),
        findUnique: (...a: unknown[]) => h.positionFindUnique(...a),
        update: (...a: unknown[]) => h.positionUpdate(...a),
        findMany: (...a: unknown[]) => h.positionFindMany(...a),
      },
    }),
  withUserRls: async (_s: unknown, fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('@/lib/trading/paper-trader', () => ({
  paperBuy: (...a: unknown[]) => h.paperBuy(...a),
  paperSell: (...a: unknown[]) => h.paperSell(...a),
  liveBuy: (...a: unknown[]) => h.liveBuy(...a),
  liveSell: (...a: unknown[]) => h.liveSell(...a),
  ExecutionResult: undefined,
}));

vi.mock('@/lib/trading/fee-model', () => ({
  recordFeeAuditLog: (...a: unknown[]) => h.recordFeeAuditLog(...a),
}));

vi.mock('@/lib/trading/paper-order-store', () => ({
  recordPaperOrder: (...a: unknown[]) => h.recordPaperOrder(...a),
  transitionPaperOrder: (...a: unknown[]) => h.transitionPaperOrder(...a),
}));

vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

import {
  closePosition,
  ensureInitialized,
  getSystemOwnerId,
  openPosition,
  rebalanceRound,
  systemOwnerScope,
  withdrawReserve,
} from '@/lib/trading/portfolio';
import { DEFAULT_CONFIG, type EngineConfig } from '@/lib/trading/config';
import type { ScamReportData, TokenCandidate } from '@/lib/trading/types';
import type { ExecutionResult } from '@/lib/trading/paper-trader';

// Instância nova do módulo (o cache de getSystemOwnerId é module-level, sem
// reset exportado); usado só nos casos que testam a resolução do owner.
async function freshPortfolio(): Promise<typeof import('@/lib/trading/portfolio')> {
  vi.resetModules();
  return await import('@/lib/trading/portfolio');
}

const NOW = new Date('2026-11-03T12:00:00Z');
const cfg = (patch: Partial<EngineConfig> = {}): EngineConfig => ({ ...DEFAULT_CONFIG, ...patch });

const candidate: TokenCandidate = {
  symbol: 'BTC/USDT',
  source: 'cex',
  priceUsd: 100,
  volume24hUsd: 5_000_000,
  liquidityUsd: 10_000_000,
  platformId: 'binance',
};
const scamReport: ScamReportData = {
  symbol: 'BTC/USDT',
  score: 91,
  passed: true,
  subscores: [],
  findings: { liquidity: ['ok'] },
};

const breakdown = {
  grossAmountUsd: 1000,
  feeBps: 10,
  slippageBps: 30,
  side: 'buy' as const,
  feeUsd: 1,
  slippageUsd: 3,
  totalCostUsd: 4,
  netAmountUsd: 996,
};

function buyResult(patch: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    ok: true,
    executedPriceUsd: 100,
    qty: 10,
    amountUsd: 1000,
    grossAmountUsd: 1000,
    feeUsd: 1,
    slippageUsd: 3,
    breakdown,
    ...patch,
  };
}

function row(patch: Record<string, unknown> = {}) {
  return {
    id: 'pos-1',
    symbol: 'BTC/USDT',
    source: 'cex',
    chain: null,
    tokenId: null,
    status: 'open',
    entryPriceUsd: 100,
    entryAmountUsd: 1000,
    entryQty: 10,
    entryAt: NOW,
    exitPriceUsd: null,
    exitAmountUsd: null,
    exitAt: null,
    exitReason: null,
    pnlUsd: null,
    pnlPct: null,
    takeProfitPrice: 115,
    stopLossPrice: 92,
    maxExitAt: new Date(NOW.getTime() + 180 * 60_000),
    scamScore: 91,
    scamBreakdown: JSON.stringify(scamReport.findings),
    strategy: 'day',
    roundId: 7,
    ...patch,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const fn of Object.values(h)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset: () => void }).mockReset();
  }
  h.recordFeeAuditLog.mockResolvedValue(undefined);
  h.recordPaperOrder.mockResolvedValue(undefined);
  h.transitionPaperOrder.mockResolvedValue(undefined);
  h.tradingBalanceUpdate.mockResolvedValue({});
  h.reserveUpdate.mockResolvedValue({});
  h.configCreate.mockResolvedValue({});
  h.tradingBalanceCreate.mockResolvedValue({});
  h.reserveCreate.mockResolvedValue({});
  h.roundUpdateMany.mockResolvedValue({ count: 1 });
  h.dbTransaction.mockImplementation(async (ops: unknown) => Promise.all(ops as Promise<unknown>[]));
  h.positionCreate.mockResolvedValue(row());
  h.positionFindUnique.mockResolvedValue(row());
  h.positionUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) =>
    row({ ...args.data, exitAt: args.data.exitAt ?? NOW })
  );
  h.positionFindMany.mockResolvedValue([]);
  h.userFindFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// openPosition
// ---------------------------------------------------------------------------
describe('openPosition', () => {
  it('paper: executa buy, grava posição com TP/SL e retorna PositionRow', async () => {
    h.paperBuy.mockResolvedValue(buyResult());
    const result = await openPosition(cfg(), candidate, 1000, scamReport, 7, 'admin-1', 'scalp');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('pos-1');
    expect(result?.status).toBe('open');
    expect(result?.entryPriceUsd).toBe(100);
    expect(result?.takeProfitPrice).toBeCloseTo(115, 10);
    expect(result?.stopLossPrice).toBeCloseTo(92, 10);
    expect(result?.maxExitAt).toBe(new Date(NOW.getTime() + 180 * 60_000).toISOString());

    expect(h.paperBuy).toHaveBeenCalledTimes(1);
    expect(h.paperBuy.mock.calls[0][1]).toBe(1000);
    expect(h.paperBuy.mock.calls[0][2]).toEqual({ feeBps: 10, slippageBps: 30 });

    const createArgs = h.positionCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArgs.data).toMatchObject({
      ownerId: 'admin-1',
      symbol: 'BTC/USDT',
      source: 'cex',
      status: 'open',
      entryPriceUsd: 100,
      entryAmountUsd: 1000,
      entryQty: 10,
      takeProfitPrice: expect.closeTo(115, 10),
      stopLossPrice: expect.closeTo(92, 10),
      scamScore: 91,
      strategy: 'scalp',
      roundId: 7,
    });
    expect(createArgs.data.maxExitAt).toEqual(new Date(NOW.getTime() + 180 * 60_000));
    expect(createArgs.data.scamBreakdown).toBe(JSON.stringify(scamReport.findings));

    expect(h.tradingBalanceUpdate).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { tradesOpened: { increment: 1 } },
    });
    expect(h.recordPaperOrder).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: 'pos-1', symbol: 'BTC/USDT', amountUsd: 1000 })
    );
  });

  it('paper: Falha de execução retorna null e NÃO cria posição', async () => {
    h.paperBuy.mockResolvedValue({ ...buyResult(), ok: false, error: 'Saldo insuficiente' });
    const result = await openPosition(cfg(), candidate, 1000, scamReport, 7, 'admin-1');
    expect(result).toBeNull();
    expect(h.positionCreate).not.toHaveBeenCalled();
    expect(h.tradingBalanceUpdate).not.toHaveBeenCalled();
  });

  it('ownerId explícito é atribuído sem consultar o super_admin', async () => {
    h.paperBuy.mockResolvedValue(buyResult());
    await openPosition(cfg(), candidate, 1000, scamReport, 7, 'owner-x');
    expect(h.userFindFirst).not.toHaveBeenCalled();
    expect((h.positionCreate.mock.calls[0][0] as { data: { ownerId: string } }).data.ownerId).toBe(
      'owner-x'
    );
  });

  it('sem ownerId e sem super_admin: aborta (sem posição, sem compra)', async () => {
    h.paperBuy.mockResolvedValue(buyResult());
    h.userFindFirst.mockResolvedValue(null);
    const mod = await freshPortfolio(); // cache limpo de getSystemOwnerId
    const result = await mod.openPosition(cfg(), candidate, 1000, scamReport, 7);
    expect(result).toBeNull();
    expect(h.paperBuy).toHaveBeenCalled();
    expect(h.positionCreate).not.toHaveBeenCalled();
  });

  it('sem ownerId: resolve o super_admin (system owner) e usa o id', async () => {
    h.paperBuy.mockResolvedValue(buyResult());
    h.userFindFirst.mockResolvedValue({ id: 'admin-resolved' });
    const mod = await freshPortfolio(); // cache limpo de getSystemOwnerId
    const result = await mod.openPosition(cfg(), candidate, 1000, scamReport, 7);
    expect(result).not.toBeNull();
    expect(h.userFindFirst).toHaveBeenCalledWith({
      where: { role: 'super_admin' },
      select: { id: true },
    });
    expect((h.positionCreate.mock.calls[0][0] as { data: { ownerId: string } }).data.ownerId).toBe(
      'admin-resolved'
    );
  });

  it('registra FeeAuditLog do buy quando há breakdown', async () => {
    h.paperBuy.mockResolvedValue(buyResult());
    await openPosition(cfg(), candidate, 1000, scamReport, 7, 'owner-x', 'swing');
    expect(h.recordFeeAuditLog).toHaveBeenCalledWith(
      'pos-1',
      'BTC/USDT',
      'buy',
      breakdown,
      {
        strategy: 'swing',
        exchange: 'binance',
        executedPriceUsd: 100,
        qty: 10,
      }
    );
  });

  it('sem breakdown (ex.: falha parcial do adaptador) não grava FeeAuditLog', async () => {
    h.paperBuy.mockResolvedValue(buyResult({ breakdown: undefined }));
    await openPosition(cfg(), candidate, 1000, scamReport, 7, 'owner-x');
    expect(h.recordFeeAuditLog).not.toHaveBeenCalled();
  });

  it('modo live (graduado) usa liveBuy; falha → null', async () => {
    h.liveBuy.mockResolvedValue({ ...buyResult(), ok: false, error: 'LIVE_DISABLED: gate' });
    const result = await openPosition(
      cfg({ mode: 'live', graduatedToLive: true }),
      candidate,
      1000,
      scamReport,
      7,
      'owner-x'
    );
    expect(result).toBeNull();
    expect(h.liveBuy).toHaveBeenCalledTimes(1);
    expect(h.paperBuy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// closePosition
// ---------------------------------------------------------------------------
describe('closePosition', () => {
  const sellResult = (patch: Partial<ExecutionResult> = {}): ExecutionResult => ({
    ok: true,
    executedPriceUsd: 110,
    qty: 10,
    amountUsd: 1100,
    grossAmountUsd: 1100,
    feeUsd: 1.1,
    slippageUsd: 3.3,
    breakdown: { ...breakdown, side: 'sell' },
    ...patch,
  });

  it('take_profit: grava pnl/status/exitReason e atualiza contadores', async () => {
    h.paperSell.mockResolvedValue(sellResult());
    const result = await closePosition(cfg(), 'pos-1', 110, 'take_profit');
    expect(result).not.toBeNull();
    expect(result?.status).toBe('closed');
    expect(result?.exitReason).toBe('take_profit');
    expect(result?.pnlUsd).toBeCloseTo(100, 10); // 1100 - 1000
    expect(result?.pnlPct).toBeCloseTo(10, 10);

    const updateArgs = h.positionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data).toMatchObject({ status: 'closed', exitReason: 'take_profit' });
    expect(h.tradingBalanceUpdate).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: {
        realizedPnlUsd: { increment: 100 },
        tradesClosed: { increment: 1 },
        wins: { increment: 1 },
        losses: { increment: 0 },
      },
    });
    expect(h.transitionPaperOrder).toHaveBeenCalledWith('pos-1', 'settle', 'saída: take_profit');
  });

  it('stop_loss com prejuízo → status liquidated e losses++', async () => {
    h.paperSell.mockResolvedValue(sellResult({ amountUsd: 900, executedPriceUsd: 90 }));
    const result = await closePosition(cfg(), 'pos-1', 90, 'stop_loss');
    expect(result?.status).toBe('liquidated');
    expect(result?.pnlUsd).toBeCloseTo(-100, 10);
    expect(h.tradingBalanceUpdate.mock.calls[0][0].data).toMatchObject({
      wins: { increment: 0 },
      losses: { increment: 1 },
    });
  });

  it('registra FeeAuditLog do sell quando há breakdown', async () => {
    h.paperSell.mockResolvedValue(sellResult());
    await closePosition(cfg(), 'pos-1', 110, 'manual');
    expect(h.recordFeeAuditLog).toHaveBeenCalledWith(
      'pos-1',
      'BTC/USDT',
      'sell',
      expect.objectContaining({ side: 'sell' }),
      { strategy: 'day', exchange: 'cex', executedPriceUsd: 110, qty: 10 }
    );
  });

  it('falha no sell retorna null e não atualiza posição', async () => {
    h.paperSell.mockResolvedValue({ ...sellResult(), ok: false, error: 'sem liquidez' });
    const result = await closePosition(cfg(), 'pos-1', 110, 'manual');
    expect(result).toBeNull();
    expect(h.positionUpdate).not.toHaveBeenCalled();
    expect(h.tradingBalanceUpdate).not.toHaveBeenCalled();
  });

  it('posição inexistente ou já fechada → null (sem sell)', async () => {
    h.positionFindUnique.mockResolvedValue(null);
    expect(await closePosition(cfg(), 'nope', 110, 'manual')).toBeNull();

    h.positionFindUnique.mockResolvedValue(row({ status: 'closed' }));
    expect(await closePosition(cfg(), 'pos-1', 110, 'manual')).toBeNull();
    expect(h.paperSell).not.toHaveBeenCalled();
  });

  it('kill_switch usa transição cancel no paper order', async () => {
    h.paperSell.mockResolvedValue(sellResult());
    await closePosition(cfg(), 'pos-1', 110, 'kill_switch');
    expect(h.transitionPaperOrder).toHaveBeenCalledWith(
      'pos-1',
      'cancel',
      'kill switch: encerrada sem liquidação'
    );
  });
});

// ---------------------------------------------------------------------------
// rebalanceRound
// ---------------------------------------------------------------------------
describe('rebalanceRound', () => {
  it('round com lucro: split reserva/reinvest e finaliza completed', async () => {
    h.positionFindMany.mockResolvedValue([{ pnlUsd: 100 }, { pnlUsd: 50 }]);
    const result = await rebalanceRound(cfg(), 7);
    expect(result).toEqual({ profitUsd: 150, reserveCutUsd: 75, reinvestCutUsd: 75 });
    expect(h.dbTransaction).toHaveBeenCalledTimes(1);
    expect((h.dbTransaction.mock.calls[0][0] as unknown[]).length).toBe(2);
    expect(h.roundUpdateMany).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({
        roundPnlUsd: 150,
        positionsClosed: 2,
        status: 'completed',
      }),
    });
  });

  it('round com PnL <= 0: NÃO faz split, mas SEMPRE finaliza o round', async () => {
    h.positionFindMany.mockResolvedValue([{ pnlUsd: -40 }, { pnlUsd: -10 }]);
    const result = await rebalanceRound(cfg(), 8);
    expect(result).toEqual({ profitUsd: -50, reserveCutUsd: 0, reinvestCutUsd: 0 });
    expect(h.dbTransaction).not.toHaveBeenCalled();
    expect(h.roundUpdateMany).toHaveBeenCalledWith({
      where: { id: 8 },
      data: expect.objectContaining({
        roundPnlUsd: -50,
        positionsClosed: 2,
        status: 'completed',
        endedAt: expect.any(Date),
      }),
    });
  });

  it('round sem posições finalizadas: completed com PnL 0', async () => {
    h.positionFindMany.mockResolvedValue([]);
    const result = await rebalanceRound(cfg(), 9);
    expect(result).toEqual({ profitUsd: 0, reserveCutUsd: 0, reinvestCutUsd: 0 });
    expect(h.roundUpdateMany).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({ roundPnlUsd: 0, positionsClosed: 0, status: 'completed' }),
    });
  });

  it('reservePct/reinvestPct respeitam o config (30/70)', async () => {
    h.positionFindMany.mockResolvedValue([{ pnlUsd: 200 }]);
    const result = await rebalanceRound(cfg({ reservePct: 30, reinvestPct: 70 }), 10);
    expect(result.reserveCutUsd).toBe(60);
    expect(result.reinvestCutUsd).toBe(140);
  });
});

// ---------------------------------------------------------------------------
// ensureInitialized / system owner / withdrawReserve
// ---------------------------------------------------------------------------
describe('ensureInitialized', () => {
  it('cria config, trading balance (capital inicial) e reserve quando ausentes', async () => {
    h.configFindUnique.mockResolvedValue(null);
    h.tradingBalanceFindUnique.mockResolvedValue(null);
    h.reserveFindUnique.mockResolvedValue(null);
    h.configCreate.mockResolvedValue({ id: 'singleton' });
    h.tradingBalanceCreate.mockResolvedValue({ id: 'singleton' });
    h.reserveCreate.mockResolvedValue({ id: 'singleton' });

    await ensureInitialized();

    expect(h.configCreate).toHaveBeenCalledWith({ data: { id: 'singleton' } });
    expect(h.tradingBalanceCreate).toHaveBeenCalledWith({
      data: { id: 'singleton', balanceUsd: 1000, peakBalanceUsd: 1000 },
    });
    expect(h.reserveCreate).toHaveBeenCalledWith({ data: { id: 'singleton' } });
  });

  it('idempotente: com singletons existentes não cria nada', async () => {
    h.configFindUnique.mockResolvedValue({ id: 'singleton', initialCapitalUsd: 500 });
    h.tradingBalanceFindUnique.mockResolvedValue({ id: 'singleton' });
    h.reserveFindUnique.mockResolvedValue({ id: 'singleton' });
    await ensureInitialized();
    expect(h.configCreate).not.toHaveBeenCalled();
    expect(h.tradingBalanceCreate).not.toHaveBeenCalled();
    expect(h.reserveCreate).not.toHaveBeenCalled();
  });
});

describe('getSystemOwnerId / systemOwnerScope', () => {
  it('retorna null sem super_admin', async () => {
    h.userFindFirst.mockResolvedValue(null);
    const mod = await freshPortfolio();
    expect(await mod.getSystemOwnerId()).toBeNull();
  });

  it('cacheia o super_admin resolvido', async () => {
    h.userFindFirst.mockResolvedValue({ id: 'admin-cache' });
    const mod = await freshPortfolio();
    expect(await mod.getSystemOwnerId()).toBe('admin-cache');
    expect(await mod.getSystemOwnerId()).toBe('admin-cache');
    expect(h.userFindFirst).toHaveBeenCalledTimes(1);
  });

  it('systemOwnerScope: owner presente filtra; null não filtra', () => {
    expect(systemOwnerScope('admin-1')).toEqual({ ownerId: 'admin-1' });
    expect(systemOwnerScope(null)).toEqual({});
  });
});

describe('withdrawReserve', () => {
  it('rejeita valor inválido e saldo insuficiente', async () => {
    expect(await withdrawReserve(0)).toBe(false);
    expect(await withdrawReserve(-10)).toBe(false);
    h.reserveFindUnique.mockResolvedValue({ id: 'singleton', balanceUsd: 10 });
    expect(await withdrawReserve(50)).toBe(false);
    expect(h.reserveUpdate).not.toHaveBeenCalled();
  });

  it('debita e contabiliza saque quando há saldo', async () => {
    h.reserveFindUnique.mockResolvedValue({ id: 'singleton', balanceUsd: 100 });
    expect(await withdrawReserve(40)).toBe(true);
    expect(h.reserveUpdate).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { balanceUsd: { decrement: 40 }, totalWithdrawnUsd: { increment: 40 } },
    });
  });
});
