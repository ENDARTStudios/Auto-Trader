// tests/performance-snapshot.test.ts — recordSnapshotIfDue com DB/RLS/preços mockados.
//
// Determinístico: fake timers (throttle 1/min), sem rede. O estado de throttle
// é módulo-level, então cada caso importa uma instância nova (vi.resetModules).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  snapshotFindFirst: vi.fn(),
  snapshotCreate: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  tradingBalanceFindUnique: vi.fn(),
  reserveFindUnique: vi.fn(),
  positionFindMany: vi.fn(),
  fetchPricesBatch: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    performanceSnapshot: {
      findFirst: (...a: unknown[]) => h.snapshotFindFirst(...a),
      create: (...a: unknown[]) => h.snapshotCreate(...a),
      deleteMany: (...a: unknown[]) => h.snapshotDeleteMany(...a),
    },
    tradingBalance: { findUnique: (...a: unknown[]) => h.tradingBalanceFindUnique(...a) },
    reserve: { findUnique: (...a: unknown[]) => h.reserveFindUnique(...a) },
  },
}));

vi.mock('@/lib/auth/rls-context', () => ({
  withSystemRls: async (fn: (tx: unknown) => unknown) =>
    fn({ position: { findMany: (...a: unknown[]) => h.positionFindMany(...a) } }),
  withUserRls: async (_s: unknown, fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('@/lib/trading/price-feed', () => ({
  fetchPricesBatch: (...a: unknown[]) => h.fetchPricesBatch(...a),
}));

vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: (...a: unknown[]) => h.warn(...a), error: noop, debug: noop } };
});

const NOW = new Date('2026-11-03T12:00:00Z');
const MIN = 60_000;

type SnapshotModule = typeof import('@/lib/trading/performance-snapshot');

async function freshModule(): Promise<SnapshotModule> {
  vi.resetModules();
  return (await import('@/lib/trading/performance-snapshot')) as SnapshotModule;
}

// findFirst é chamado 2x: (1) orderBy timestamp (throttle), (2) orderBy id (trim).
function primeSnapshotFindFirst(latestRow: { id: number } | null = { id: 1 }): void {
  h.snapshotFindFirst.mockImplementation(async (args: { orderBy?: { timestamp?: string; id?: string } }) => {
    if (args?.orderBy?.id) return latestRow;
    return null;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const fn of Object.values(h)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset: () => void }).mockReset();
  }
  h.tradingBalanceFindUnique.mockResolvedValue({
    balanceUsd: 1000,
    peakBalanceUsd: 1300,
    realizedPnlUsd: 25,
  });
  h.reserveFindUnique.mockResolvedValue({ balanceUsd: 200 });
  h.positionFindMany.mockResolvedValue([]);
  h.fetchPricesBatch.mockResolvedValue(new Map());
  h.snapshotCreate.mockResolvedValue({ id: 1 });
  h.snapshotDeleteMany.mockResolvedValue({ count: 0 });
  primeSnapshotFindFirst();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('recordSnapshotIfDue', () => {
  it('grava equity = trading + reserve + unrealized e drawdown vs peak', async () => {
    h.positionFindMany.mockResolvedValue([
      {
        id: 'p1',
        symbol: 'BTC/USDT',
        source: 'cex',
        chain: null,
        tokenId: null,
        entryPriceUsd: 100,
        entryQty: 2,
        entryAmountUsd: 200,
      },
    ]);
    h.fetchPricesBatch.mockResolvedValue(new Map([['p1', 110]]));
    const mod = await freshModule();
    await mod.recordSnapshotIfDue();

    expect(h.snapshotCreate).toHaveBeenCalledTimes(1);
    const data = h.snapshotCreate.mock.calls[0][0].data;
    expect(data.tradingBalanceUsd).toBe(1000);
    expect(data.reserveBalanceUsd).toBe(200);
    expect(data.peakBalanceUsd).toBe(1300);
    expect(data.realizedPnlUsd).toBe(25);
    expect(data.unrealizedPnlUsd).toBeCloseTo(20, 10); // (110-100)*2
    expect(data.totalEquityUsd).toBeCloseTo(1220, 10);
    expect(data.openPositionsCount).toBe(1);
    expect(data.drawdownPct).toBeCloseTo(((1300 - 1220) / 1300) * 100, 10);

    // fetchPricesBatch recebeu a posição aberta
    expect(h.fetchPricesBatch.mock.calls[0][0]).toEqual([
      {
        id: 'p1',
        symbol: 'BTC/USDT',
        source: 'cex',
        chain: null,
        tokenId: null,
      },
    ]);
  });

  it('sem preço no feed usa entryPrice → unrealized 0 (não inventa P&L)', async () => {
    h.positionFindMany.mockResolvedValue([
      {
        id: 'p1',
        symbol: 'BTC/USDT',
        source: 'cex',
        chain: null,
        tokenId: null,
        entryPriceUsd: 100,
        entryQty: 2,
        entryAmountUsd: 200,
      },
    ]);
    h.fetchPricesBatch.mockResolvedValue(new Map());
    const mod = await freshModule();
    await mod.recordSnapshotIfDue();
    expect(h.snapshotCreate.mock.calls[0][0].data.unrealizedPnlUsd).toBe(0);
    expect(h.snapshotCreate.mock.calls[0][0].data.totalEquityUsd).toBe(1200);
  });

  it('equity acima do peak → drawdown clampado em 0', async () => {
    h.tradingBalanceFindUnique.mockResolvedValue({
      balanceUsd: 2000,
      peakBalanceUsd: 1300,
      realizedPnlUsd: 0,
    });
    const mod = await freshModule();
    await mod.recordSnapshotIfDue();
    expect(h.snapshotCreate.mock.calls[0][0].data.drawdownPct).toBe(0);
  });

  it('throttle: segunda chamada imediata não grava (1/min)', async () => {
    const mod = await freshModule();
    await mod.recordSnapshotIfDue();
    await mod.recordSnapshotIfDue();
    expect(h.snapshotCreate).toHaveBeenCalledTimes(1);
    // segunda chamada nem consulta o banco (barato)
    expect(h.tradingBalanceFindUnique).toHaveBeenCalledTimes(1);
  });

  it('throttle: após 60s grava novamente', async () => {
    const mod = await freshModule();
    await mod.recordSnapshotIfDue();
    vi.setSystemTime(new Date(NOW.getTime() + MIN));
    await mod.recordSnapshotIfDue();
    expect(h.snapshotCreate).toHaveBeenCalledTimes(2);
  });

  it('throttle: 59.999s ainda não grava', async () => {
    const mod = await freshModule();
    await mod.recordSnapshotIfDue();
    vi.setSystemTime(new Date(NOW.getTime() + MIN - 1));
    await mod.recordSnapshotIfDue();
    expect(h.snapshotCreate).toHaveBeenCalledTimes(1);
  });

  it('throttle por DB (restart): snapshot recente no banco evita novo registro', async () => {
    h.snapshotFindFirst.mockImplementation(async (args: { orderBy?: { timestamp?: string } }) => {
      if (args?.orderBy?.timestamp) return { timestamp: new Date(NOW.getTime() - 30_000) };
      return { id: 1 };
    });
    const mod = await freshModule();
    await mod.recordSnapshotIfDue();
    expect(h.snapshotCreate).not.toHaveBeenCalled();
    expect(h.tradingBalanceFindUnique).not.toHaveBeenCalled();
  });

  it('sem tradingBalance/reserve → não grava (e não lança)', async () => {
    h.tradingBalanceFindUnique.mockResolvedValue(null);
    const mod = await freshModule();
    await mod.recordSnapshotIfDue();
    expect(h.snapshotCreate).not.toHaveBeenCalled();
  });

  it('erro no create é capturado (log warn) e não derruba o engine', async () => {
    h.snapshotCreate.mockRejectedValue(new Error('db down'));
    const mod = await freshModule();
    await expect(mod.recordSnapshotIfDue()).resolves.toBeUndefined();
    expect(h.warn).toHaveBeenCalledTimes(1);
  });

  it('trim: remove snapshots antigos quando id > MAX_ROWS (50k)', async () => {
    h.snapshotFindFirst.mockImplementation(async (args: { orderBy?: { timestamp?: string; id?: string } }) => {
      if (args?.orderBy?.id) return { id: 50_005 };
      return null;
    });
    const mod = await freshModule();
    await mod.recordSnapshotIfDue();
    expect(h.snapshotDeleteMany).toHaveBeenCalledWith({ where: { id: { lt: 5 } } });
  });

  it('sem linha para trim (banco novo) não deleta nada', async () => {
    h.snapshotFindFirst.mockImplementation(async (args: { orderBy?: { timestamp?: string; id?: string } }) => {
      if (args?.orderBy?.id) return null;
      return null;
    });
    const mod = await freshModule();
    await mod.recordSnapshotIfDue();
    expect(h.snapshotDeleteMany).not.toHaveBeenCalled();
  });
});
