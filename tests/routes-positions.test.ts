// tests/routes-positions.test.ts — handlers /api/positions, /api/positions/[id] e close.
//
// Determinístico: sessão/RBAC/db/RLS/preço mockados; Request reais do Node.
// Cobre 200 (mapeamento), 400 (posição já fechada), 401, 403, 404 (inexistente e
// IDOR via RLS), 429 (rate limit), 500 (erro interno) e o gating do close.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  requireSession: vi.fn(),
  requirePermission: vi.fn(),
  hasPermission: vi.fn(),
  positionFindMany: vi.fn(),
  positionFindUnique: vi.fn(),
  scamReportFindFirst: vi.fn(),
  aiInsightFindMany: vi.fn(),
  positionAlertFindMany: vi.fn(),
  marketSnapshotFindMany: vi.fn(),
  roundFindUnique: vi.fn(),
  fetchPricesBatch: vi.fn(),
  getPaperOrderByPosition: vi.fn(),
  getConfig: vi.fn(),
  closePosition: vi.fn(),
  notifyEvent: vi.fn(),
  eventPush: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a),
}));
vi.mock('@/lib/auth/session', () => ({
  requireSession: (...a: unknown[]) => h.requireSession(...a),
  // requirePermission(perm) devolve um handler(req) — como no módulo real.
  requirePermission: (perm: unknown) => async (req: unknown) => {
    const session = await h.requirePermission(perm, req);
    return session;
  },
}));
vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: (...a: unknown[]) => h.hasPermission(...a),
}));
vi.mock('@/lib/auth/rls-context', () => ({
  withUserRls: async (_s: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      position: {
        findMany: (...a: unknown[]) => h.positionFindMany(...a),
        findUnique: (...a: unknown[]) => h.positionFindUnique(...a),
      },
    }),
  withSystemRls: async (fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock('@/lib/db', () => ({
  db: {
    position: {},
    scamReport: { findFirst: (...a: unknown[]) => h.scamReportFindFirst(...a) },
    aIInsight: { findMany: (...a: unknown[]) => h.aiInsightFindMany(...a) },
    positionAlert: { findMany: (...a: unknown[]) => h.positionAlertFindMany(...a) },
    marketSnapshot: { findMany: (...a: unknown[]) => h.marketSnapshotFindMany(...a) },
    round: { findUnique: (...a: unknown[]) => h.roundFindUnique(...a) },
  },
}));
vi.mock('@/lib/trading/price-feed', () => ({
  fetchPricesBatch: (...a: unknown[]) => h.fetchPricesBatch(...a),
}));
vi.mock('@/lib/trading/paper-order-store', () => ({
  getPaperOrderByPosition: (...a: unknown[]) => h.getPaperOrderByPosition(...a),
}));
vi.mock('@/lib/trading/config', () => ({ getConfig: (...a: unknown[]) => h.getConfig(...a) }));
vi.mock('@/lib/trading/portfolio', () => ({
  closePosition: (...a: unknown[]) => h.closePosition(...a),
}));
vi.mock('@/lib/trading/notifier', () => ({ notifyEvent: (...a: unknown[]) => h.notifyEvent(...a) }));
vi.mock('@/lib/trading/event-bus', () => ({ eventBus: { push: (...a: unknown[]) => h.eventPush(...a) } }));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

import { GET as listPositions } from '@/app/api/positions/route';
import { GET as getPosition } from '@/app/api/positions/[id]/route';
import { POST as closePositionRoute } from '@/app/api/positions/[id]/close/route';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/errors';

const SESSION = { userId: 'u-1', email: 'u@local', role: 'trader', isActive: true };
const NOW = new Date('2026-11-04T12:00:00Z');

function req(url = 'http://localhost/api/positions', init: RequestInit = {}): Request {
  return new Request(url, init);
}

function openRow(patch: Record<string, unknown> = {}) {
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
    maxExitAt: new Date(NOW.getTime() + 3_600_000),
    scamScore: 90,
    scamBreakdown: '{"x":1}',
    roundId: 1,
    strategy: 'day',
    ...patch,
  };
}

function detailRow(patch: Record<string, unknown> = {}) {
  return openRow(patch);
}

beforeEach(() => {
  for (const fn of Object.values(h)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset: () => void }).mockReset();
  }
  h.checkRateLimit.mockReturnValue({ allowed: true });
  h.requireSession.mockResolvedValue(SESSION);
  h.requirePermission.mockImplementation(async () => SESSION);
  h.hasPermission.mockReturnValue(true);
  h.positionFindMany.mockResolvedValue([]);
  h.positionFindUnique.mockResolvedValue(null);
  h.fetchPricesBatch.mockResolvedValue(new Map());
  h.scamReportFindFirst.mockResolvedValue(null);
  h.aiInsightFindMany.mockResolvedValue([]);
  h.positionAlertFindMany.mockResolvedValue([]);
  h.marketSnapshotFindMany.mockResolvedValue([]);
  h.roundFindUnique.mockResolvedValue(null);
  h.getPaperOrderByPosition.mockResolvedValue(null);
  h.getConfig.mockResolvedValue({ mode: 'paper', killSwitchActive: false });
  h.closePosition.mockResolvedValue(null);
  h.notifyEvent.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// GET /api/positions
// ---------------------------------------------------------------------------
describe('GET /api/positions', () => {
  it('200: mapeia posições abertas e calcula P&L não realizado', async () => {
    h.positionFindMany.mockResolvedValue([openRow(), openRow({ id: 'pos-2', entryPriceUsd: 50, entryQty: 2 })]);
    h.fetchPricesBatch.mockResolvedValue(new Map([['pos-1', 110], ['pos-2', 40]]));
    const res = await listPositions(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      id: 'pos-1',
      status: 'open',
      currentPriceUsd: 110,
      unrealizedPnlUsd: 100,
      unrealizedPnlPct: 10,
      entryAt: NOW.toISOString(),
    });
    expect(body[1]).toMatchObject({ id: 'pos-2', currentPriceUsd: 40, unrealizedPnlUsd: -20, unrealizedPnlPct: -20 });
    // RLS: consulta no contexto do usuário
    expect(h.positionFindMany).toHaveBeenCalledWith({
      where: { status: 'open' },
      orderBy: { entryAt: 'desc' },
      take: 50,
    });
  });

  it('200: sem preço do feed usa 0 no preço e no P&L (USD e %)', async () => {
    h.positionFindMany.mockResolvedValue([openRow()]);
    h.fetchPricesBatch.mockResolvedValue(new Map());
    const body = await (await listPositions(req())).json();
    expect(body[0].currentPriceUsd).toBe(0);
    expect(body[0].unrealizedPnlUsd).toBe(0);
    // Corrigido na round 13: antes calculava -100% a partir de preço 0.
    expect(body[0].unrealizedPnlPct).toBe(0);
  });

  it('401 sem sessão', async () => {
    h.requireSession.mockRejectedValue(new UnauthorizedError());
    const res = await listPositions(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('403 sem permissão positions:read', async () => {
    h.hasPermission.mockReturnValue(false);
    const res = await listPositions(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('429 rate limited', async () => {
    h.checkRateLimit.mockReturnValue({ allowed: false, retryAfter: 7 });
    const res = await listPositions(req());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('7');
  });

  it('500 quando o banco falha', async () => {
    h.positionFindMany.mockRejectedValue(new Error('db down'));
    const res = await listPositions(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('internal_error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/positions/[id]
// ---------------------------------------------------------------------------
describe('GET /api/positions/[id]', () => {
  const params = (id = 'pos-1') => ({ params: Promise.resolve({ id }) });

  it('200: agrega posição + scam + AI + alertas + snapshots + round', async () => {
    h.positionFindUnique.mockResolvedValue(detailRow());
    h.scamReportFindFirst.mockResolvedValue({
      score: 88,
      passed: true,
      honeypotScore: 1,
      liquidityScore: 2,
      contractScore: 3,
      taxScore: 4,
      holderScore: 5,
      ageScore: 6,
      findings: '{"a":["b"]}',
      analyzedAt: NOW,
    });
    h.aiInsightFindMany.mockResolvedValue([
      {
        id: 'ai-1',
        agentRole: 'thesis',
        recommendation: 'buy',
        confidence: 70,
        promptSummary: 'p',
        modelOutput: 'm',
        keySignals: '["a"]',
        durationMs: 10,
        error: null,
        createdAt: NOW,
      },
    ]);
    h.positionAlertFindMany.mockResolvedValue([
      { id: 'al-1', type: 'price_anomaly', severity: 'high', message: 'x', context: null, detectedAt: NOW, resolvedAt: null, resolution: null },
    ]);
    h.marketSnapshotFindMany.mockResolvedValue([
      { analyzedAt: NOW, priceUsd: 100, rsi14: 50, signalLabel: 'neutral' },
    ]);
    h.roundFindUnique.mockResolvedValue({
      id: 1,
      startedAt: NOW,
      endedAt: null,
      tokensScanned: 5,
      tokensPassedFilter: 2,
      positionsOpened: 1,
      positionsClosed: 0,
      roundPnlUsd: null,
      status: 'running',
    });
    h.getPaperOrderByPosition.mockResolvedValue({
      key: 'k',
      state: 'filled',
      transitions: '[]',
      createdAt: NOW,
    });
    h.fetchPricesBatch.mockResolvedValue(new Map([['pos-1', 110]]));

    const res = await getPosition(req('http://localhost/api/positions/pos-1'), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.position).toMatchObject({
      id: 'pos-1',
      currentPriceUsd: 110,
      unrealizedPnlUsd: 100,
      paperOrder: { key: 'k', state: 'filled' },
      scamBreakdown: { x: 1 },
    });
    expect(body.scamReport).toMatchObject({ score: 88, findings: { a: ['b'] } });
    expect(body.aiInsights).toHaveLength(1);
    expect(body.surveillanceAlerts).toHaveLength(1);
    expect(body.round).toMatchObject({ id: 1, status: 'running' });
    expect(body.marketChart).toHaveLength(1);
  });

  it('404 quando a posição não existe (ou RLS nega/IDOR)', async () => {
    h.positionFindUnique.mockResolvedValue(null);
    const res = await getPosition(req('http://localhost/api/positions/foreign'), params('foreign'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Posição não encontrada' });
  });

  it('401 sem sessão e 403 sem permissão', async () => {
    h.requirePermission.mockRejectedValueOnce(new UnauthorizedError());
    expect((await getPosition(req(), params())).status).toBe(401);
    h.requirePermission.mockRejectedValueOnce(new ForbiddenError('positions:read'));
    expect((await getPosition(req(), params())).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/positions/[id]/close
// ---------------------------------------------------------------------------
describe('POST /api/positions/[id]/close', () => {
  const params = (id = 'pos-1') => ({ params: Promise.resolve({ id }) });
  const post = (body: unknown = { note: 'manual' }) =>
    req('http://localhost/api/positions/pos-1/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('200: fecha no preço de mercado e devolve a posição fechada', async () => {
    h.positionFindUnique.mockResolvedValue(openRow());
    h.fetchPricesBatch.mockResolvedValue(new Map([['pos-1', 110]]));
    const closed = { ...openRow(), status: 'closed', exitPriceUsd: 110, pnlUsd: 100, pnlPct: 10 };
    h.closePosition.mockResolvedValue(closed);
    const res = await closePositionRoute(post(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, exitPrice: 110, note: 'manual' });
    expect(h.closePosition).toHaveBeenCalledWith(expect.anything(), 'pos-1', 110, 'manual');
    expect(h.eventPush).toHaveBeenCalled();
  });

  it('404 posição inexistente', async () => {
    h.positionFindUnique.mockResolvedValue(null);
    expect((await closePositionRoute(post(), params('nope'))).status).toBe(404);
  });

  it('400 posição já fechada', async () => {
    h.positionFindUnique.mockResolvedValue(openRow({ status: 'closed' }));
    const res = await closePositionRoute(post(), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('já está fechada');
  });

  it('503 sem preço de mercado', async () => {
    h.positionFindUnique.mockResolvedValue(openRow());
    h.fetchPricesBatch.mockResolvedValue(new Map());
    const res = await closePositionRoute(post(), params());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('preço');
  });

  it('500 quando closePosition retorna null (falha de execução)', async () => {
    h.positionFindUnique.mockResolvedValue(openRow());
    h.fetchPricesBatch.mockResolvedValue(new Map([['pos-1', 110]]));
    h.closePosition.mockResolvedValue(null);
    expect((await closePositionRoute(post(), params())).status).toBe(500);
  });

  it('401/403 no gating de permissão', async () => {
    h.requirePermission.mockRejectedValueOnce(new UnauthorizedError());
    expect((await closePositionRoute(post(), params())).status).toBe(401);
    h.requirePermission.mockRejectedValueOnce(new ForbiddenError('positions:write'));
    expect((await closePositionRoute(post(), params())).status).toBe(403);
  });
});
