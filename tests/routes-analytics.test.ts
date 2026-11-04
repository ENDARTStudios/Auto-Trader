// tests/routes-analytics.test.ts — GET /api/analytics (range, summary, breakdowns).
//
// Determinístico: snapshots/posições/sessão mockados. Cobre 200 com summary e
// breakdowns, range inválido → fallback 24h, 200 vazio, 401, 403, 429 e 500.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  requireSession: vi.fn(),
  hasPermission: vi.fn(),
  performanceSnapshotFindMany: vi.fn(),
  positionFindMany: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a) }));
vi.mock('@/lib/auth/session', () => ({ requireSession: (...a: unknown[]) => h.requireSession(...a) }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...a: unknown[]) => h.hasPermission(...a) }));
vi.mock('@/lib/auth/rls-context', () => ({
  withUserRls: async (_s: unknown, fn: (tx: unknown) => unknown) =>
    fn({ position: { findMany: (...a: unknown[]) => h.positionFindMany(...a) } }),
  withSystemRls: async (fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock('@/lib/db', () => ({
  db: { performanceSnapshot: { findMany: (...a: unknown[]) => h.performanceSnapshotFindMany(...a) } },
}));

import { GET as getAnalytics } from '@/app/api/analytics/route';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/errors';

const SESSION = { userId: 'u-1', email: 'u@local', role: 'trader', isActive: true };
const req = (qs = '') => new Request('http://localhost/api/analytics' + qs);

function snapshot(patch: Record<string, unknown> = {}) {
  return {
    timestamp: new Date('2026-11-04T10:00:00Z'),
    tradingBalanceUsd: 800,
    reserveBalanceUsd: 200,
    peakBalanceUsd: 1200,
    realizedPnlUsd: 50,
    unrealizedPnlUsd: -10,
    totalEquityUsd: 1000,
    openPositionsCount: 1,
    drawdownPct: 0,
    ...patch,
  };
}

function closedPosition(patch: Record<string, unknown> = {}) {
  return {
    id: 'pos-1',
    symbol: 'BTC/USDT',
    entryAt: new Date('2026-11-04T08:00:00Z'),
    exitAt: new Date('2026-11-04T09:00:00Z'),
    pnlUsd: 150,
    pnlPct: 15,
    scamScore: 90,
    ...patch,
  };
}

beforeEach(() => {
  for (const fn of Object.values(h)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset: () => void }).mockReset();
  }
  h.checkRateLimit.mockReturnValue({ allowed: true });
  h.requireSession.mockResolvedValue(SESSION);
  h.hasPermission.mockReturnValue(true);
  h.performanceSnapshotFindMany.mockResolvedValue([]);
  // 1ª chamada: closedPositions (sem select). 2ª: allClosed/streaks (select pnlUsd).
  h.positionFindMany.mockImplementation(async (args: { select?: { pnlUsd?: boolean } }) => {
    if (args?.select?.pnlUsd) return [{ pnlUsd: 150 }, { pnlUsd: -50 }];
    return [];
  });
});

describe('GET /api/analytics', () => {
  it('200: summary + breakdowns + streaks + best/worst', async () => {
    h.performanceSnapshotFindMany.mockResolvedValue([
      snapshot({ timestamp: new Date('2026-11-04T09:00:00Z'), totalEquityUsd: 1000, drawdownPct: 0 }),
      snapshot({ timestamp: new Date('2026-11-04T10:00:00Z'), totalEquityUsd: 1100, drawdownPct: 5 }),
    ]);
    h.positionFindMany.mockImplementation(async (args: { select?: { pnlUsd?: boolean } }) => {
      if (args?.select?.pnlUsd) return [{ pnlUsd: -50 }, { pnlUsd: 150 }];
      return [
        closedPosition({ id: 'w', symbol: 'BTC/USDT', pnlUsd: 150, pnlPct: 15 }),
        closedPosition({ id: 'l', symbol: 'ETH/USDT', pnlUsd: -50, pnlPct: -5 }),
      ];
    });

    const res = await getAnalytics(req('?range=7d'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.range).toBe('7d');
    expect(body.summary).toMatchObject({
      startEquityUsd: 1000,
      endEquityUsd: 1100,
      absChangeUsd: 100,
      pctChange: 10,
      maxEquityUsd: 1100,
      minEquityUsd: 1000,
      maxDrawdownPct: 5,
      snapshotCount: 2,
    });
    expect(body.equityCurve).toHaveLength(2);
    expect(body.bySymbol).toEqual([
      expect.objectContaining({ symbol: 'BTC/USDT', trades: 1, wins: 1, losses: 0, totalPnlUsd: 150 }),
      expect.objectContaining({
        symbol: 'ETH/USDT',
        trades: 1,
        wins: 0,
        losses: 1,
        totalPnlUsd: -50,
        winRate: 0,
        avgPnlUsd: -50,
      }),
    ]);
    expect(body.byDayOfWeek).toHaveLength(7);
    expect(body.byHour).toHaveLength(24);
    expect(body.streaks).toMatchObject({ currentWinStreak: 1, longestWinStreak: 1, longestLossStreak: 1 });
    expect(body.bestTrade).toMatchObject({ symbol: 'BTC/USDT', pnlUsd: 150 });
    expect(body.worstTrade).toMatchObject({ symbol: 'ETH/USDT', pnlUsd: -50 });
    expect(body.closedPositionsCount).toBe(2);
  });

  it('200: sem snapshots/posições — summary zerado e best/worst null', async () => {
    const body = await (await getAnalytics(req('?range=24h'))).json();
    expect(body.summary).toMatchObject({
      startEquityUsd: 0,
      endEquityUsd: 0,
      snapshotCount: 0,
      rangeStart: null,
      rangeEnd: null,
    });
    expect(body.bySymbol).toEqual([]);
    expect(body.bestTrade).toBeNull();
    expect(body.worstTrade).toBeNull();
    expect(body.closedPositionsCount).toBe(0);
  });

  it('range inválido -> 400 invalid_range; range=all usa epoch', async () => {
    const res = await getAnalytics(req('?range=42y'));
    expect(res.status).toBe(400);
    const invalid = await res.json();
    // Corrigido na round 13: não cai mais silenciosamente em 24h ecoando o range
    // inválido; é erro de validação com a lista de ranges aceitos.
    expect(invalid.error).toBe('invalid_range');
    expect(invalid.accepted).toEqual(expect.arrayContaining(['24h', '7d', '30d', 'all']));
    expect(h.performanceSnapshotFindMany).not.toHaveBeenCalled();

    const all = await (await getAnalytics(req('?range=all'))).json();
    expect(all.range).toBe('all');
    const calls = h.performanceSnapshotFindMany.mock.calls;
    const lastWhere = calls[calls.length - 1][0].where as { timestamp: { gte: Date } };
    expect(lastWhere.timestamp.gte.getTime()).toBe(0); // 1970
  });

  it('401 sem sessão e 403 sem dashboard:read', async () => {
    h.requireSession.mockRejectedValueOnce(new UnauthorizedError());
    expect((await getAnalytics(req())).status).toBe(401);
    h.hasPermission.mockReturnValueOnce(false);
    expect((await getAnalytics(req())).status).toBe(403);
  });

  it('429 rate limited e 500 em erro de DB', async () => {
    h.checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 4 });
    const limited = await getAnalytics(req());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('4');

    h.performanceSnapshotFindMany.mockRejectedValue(new Error('db down'));
    expect((await getAnalytics(req())).status).toBe(500);
  });
});
