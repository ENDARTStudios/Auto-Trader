// tests/routes-insights-logs.test.ts — GET /api/ai-insights e GET /api/notifications/logs.
//
// 200 (limit/filtros/parse), 401, 403, 429, 500. DB e sessão mockados.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  requireSession: vi.fn(),
  requirePermission: vi.fn(),
  hasPermission: vi.fn(),
  aiInsightFindMany: vi.fn(),
  notificationLogFindMany: vi.fn(),
  notificationLogCount: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a) }));
vi.mock('@/lib/auth/session', () => ({
  requireSession: (...a: unknown[]) => h.requireSession(...a),
  requirePermission: (perm: unknown) => async (req: unknown) => h.requirePermission(perm, req),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...a: unknown[]) => h.hasPermission(...a) }));
vi.mock('@/lib/db', () => ({
  db: {
    aIInsight: { findMany: (...a: unknown[]) => h.aiInsightFindMany(...a) },
    notificationLog: {
      findMany: (...a: unknown[]) => h.notificationLogFindMany(...a),
      count: (...a: unknown[]) => h.notificationLogCount(...a),
    },
  },
}));

import { GET as getAiInsights } from '@/app/api/ai-insights/route';
import { GET as getNotificationLogs } from '@/app/api/notifications/logs/route';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/errors';

const SESSION = { userId: 'u-1', email: 'u@local', role: 'trader', isActive: true };
const NOW = new Date('2026-11-04T12:00:00Z');
const req = (url: string) => new Request(url);

function insightRow(patch: Record<string, unknown> = {}) {
  return {
    id: 'ai-1',
    agentRole: 'thesis',
    symbol: 'BTC/USDT',
    recommendation: 'buy',
    confidence: 70,
    keySignals: '["bullish","momentum"]',
    promptSummary: 'p',
    modelOutput: 'm',
    tokensUsed: 10,
    durationMs: 5,
    error: null,
    createdAt: NOW,
    ...patch,
  };
}

beforeEach(() => {
  for (const fn of Object.values(h)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset: () => void }).mockReset();
  }
  h.checkRateLimit.mockReturnValue({ allowed: true });
  h.requireSession.mockResolvedValue(SESSION);
  h.requirePermission.mockResolvedValue(SESSION);
  h.hasPermission.mockReturnValue(true);
  h.aiInsightFindMany.mockResolvedValue([]);
  h.notificationLogFindMany.mockResolvedValue([]);
  h.notificationLogCount.mockResolvedValue(0);
});

describe('GET /api/ai-insights', () => {
  const url = (qs = '') => 'http://localhost/api/ai-insights' + qs;

  it('200: devolve insights com keySignals parseado e limit aplicado', async () => {
    h.aiInsightFindMany.mockResolvedValue([insightRow()]);
    const res = await getAiInsights(req(url('?limit=10&role=thesis')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].keySignals).toEqual(['bullish', 'momentum']);
    expect(h.aiInsightFindMany).toHaveBeenCalledWith({
      where: { agentRole: 'thesis' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  });

  it('200: sem role não filtra; limit é clampado em 200', async () => {
    h.aiInsightFindMany.mockResolvedValue([insightRow()]);
    await getAiInsights(req(url('?limit=9999')));
    expect(h.aiInsightFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });

  it('200: keySignals inválido vira [] (não derruba a rota)', async () => {
    h.aiInsightFindMany.mockResolvedValue([insightRow({ keySignals: 'not-json' })]);
    const body = await (await getAiInsights(req(url()))).json();
    expect(body[0].keySignals).toEqual([]);
  });

  it('401 sem sessão e 403 sem logs:read', async () => {
    h.requireSession.mockRejectedValueOnce(new UnauthorizedError());
    expect((await getAiInsights(req(url()))).status).toBe(401);
    h.hasPermission.mockReturnValueOnce(false);
    expect((await getAiInsights(req(url()))).status).toBe(403);
  });

  it('429 rate limited e 500 em erro de DB', async () => {
    h.checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 2 });
    expect((await getAiInsights(req(url()))).status).toBe(429);
    h.aiInsightFindMany.mockRejectedValue(new Error('db down'));
    expect((await getAiInsights(req(url()))).status).toBe(500);
  });
});

describe('GET /api/notifications/logs', () => {
  const url = (qs = '') => 'http://localhost/api/notifications/logs' + qs;

  it('200: devolve logs + total com limite default 100', async () => {
    h.notificationLogFindMany.mockResolvedValue([{ id: 1, eventType: 'engine_started' }]);
    h.notificationLogCount.mockResolvedValue(1);
    const res = await getNotificationLogs(req(url()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      logs: [{ id: 1, eventType: 'engine_started' }],
      total: 1,
      limit: 100,
    });
    expect(h.notificationLogFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { id: 'desc' },
      take: 100,
    });
  });

  it('200: filtros channelId/eventType e limit clampado em 500', async () => {
    await getNotificationLogs(req(url('?channelId=ch-1&eventType=position_closed&limit=9999')));
    expect(h.notificationLogFindMany).toHaveBeenCalledWith({
      where: { channelId: 'ch-1', eventType: 'position_closed' },
      orderBy: { id: 'desc' },
      take: 500,
    });
    expect(h.notificationLogCount).toHaveBeenCalledWith({
      where: { channelId: 'ch-1', eventType: 'position_closed' },
    });
  });

  it('401 sem sessão (UnauthorizedError) e 403 sem audit:read', async () => {
    h.requirePermission.mockRejectedValueOnce(new UnauthorizedError());
    const unauth = await getNotificationLogs(req(url()));
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({ error: 'unauthorized' });

    h.requirePermission.mockRejectedValueOnce(new ForbiddenError('audit:read'));
    const forbidden = await getNotificationLogs(req(url()));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: 'forbidden' });
  });

  it('500 em erro de DB devolve mensagem sanitizada com status 500', async () => {
    h.notificationLogFindMany.mockRejectedValue(new Error('db down'));
    const res = await getNotificationLogs(req(url()));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed to list logs');
  });
});
