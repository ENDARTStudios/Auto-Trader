// tests/routes-rounds-graduation.test.ts — GET /api/rounds e GET /api/graduation.
//
// 200 (mapeamento/payload), 401, 403, 429 e 500 em ambos.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  requireSession: vi.fn(),
  hasPermission: vi.fn(),
  roundFindMany: vi.fn(),
  evaluateGraduation: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a) }));
vi.mock('@/lib/auth/session', () => ({ requireSession: (...a: unknown[]) => h.requireSession(...a) }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...a: unknown[]) => h.hasPermission(...a) }));
vi.mock('@/lib/db', () => ({
  db: { round: { findMany: (...a: unknown[]) => h.roundFindMany(...a) } },
}));
vi.mock('@/lib/trading/graduation', () => ({
  evaluateGraduation: (...a: unknown[]) => h.evaluateGraduation(...a),
}));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

import { GET as getRounds } from '@/app/api/rounds/route';
import { GET as getGraduation } from '@/app/api/graduation/route';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/errors';

const SESSION = { userId: 'u-1', email: 'u@local', role: 'trader', isActive: true };
const NOW = new Date('2026-11-04T12:00:00Z');
const req = (url = 'http://localhost/api/rounds') => new Request(url);

function roundRow(patch: Record<string, unknown> = {}) {
  return {
    id: 7,
    startedAt: NOW,
    endedAt: null,
    tradingBalanceUsd: 1000,
    reserveBalanceUsd: 100,
    tokensScanned: 12,
    tokensPassedFilter: 3,
    tokensRejectedScam: 9,
    positionsOpened: 2,
    positionsClosed: 0,
    roundPnlUsd: null,
    status: 'running',
    notes: null,
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
  h.roundFindMany.mockResolvedValue([]);
  h.evaluateGraduation.mockResolvedValue({ eligible: false, windowFull: false, attemptsUsed: 0 });
});

describe('GET /api/rounds', () => {
  it('200: mapeia rounds paginados (mais recentes, take 30)', async () => {
    h.roundFindMany.mockResolvedValue([
      roundRow(),
      roundRow({
        id: 6,
        endedAt: NOW,
        status: 'completed',
        roundPnlUsd: 42.5,
        positionsClosed: 2,
        notes: 'ok',
      }),
    ]);
    const res = await getRounds(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: 7, startedAt: NOW.toISOString(), endedAt: null, status: 'running' });
    expect(body[1]).toMatchObject({
      id: 6,
      endedAt: NOW.toISOString(),
      status: 'completed',
      roundPnlUsd: 42.5,
      positionsClosed: 2,
      notes: 'ok',
    });
    expect(h.roundFindMany).toHaveBeenCalledWith({ orderBy: { id: 'desc' }, take: 30 });
  });

  it('401 sem sessão e 403 sem dashboard:read', async () => {
    h.requireSession.mockRejectedValueOnce(new UnauthorizedError());
    expect((await getRounds(req())).status).toBe(401);
    h.hasPermission.mockReturnValueOnce(false);
    expect((await getRounds(req())).status).toBe(403);
    expect(h.hasPermission).toHaveBeenCalledWith(SESSION.role, 'dashboard:read');
  });

  it('429 rate limited e 500 em erro de DB', async () => {
    h.checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 3 });
    const limited = await getRounds(req());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('3');

    h.roundFindMany.mockRejectedValue(new Error('db down'));
    const failed = await getRounds(req());
    expect(failed.status).toBe(500);
    expect((await failed.json()).error).toBe('internal_error');
  });
});

describe('GET /api/graduation', () => {
  const gradReq = () => req('http://localhost/api/graduation');

  it('200: devolve a avaliação da janela de graduação', async () => {
    h.evaluateGraduation.mockResolvedValue({
      eligible: false,
      windowFull: true,
      attemptsUsed: 20,
      criteria: [{ label: 'win rate', satisfied: true }],
    });
    const res = await getGraduation(gradReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ windowFull: true, attemptsUsed: 20 });
  });

  it('401 sem sessão e 403 sem dashboard:read', async () => {
    h.requireSession.mockRejectedValueOnce(new UnauthorizedError());
    expect((await getGraduation(gradReq())).status).toBe(401);
    h.hasPermission.mockReturnValueOnce(false);
    expect((await getGraduation(gradReq())).status).toBe(403);
  });

  it('429 rate limited e 500 quando a avaliação falha', async () => {
    h.checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 9 });
    expect((await getGraduation(gradReq())).status).toBe(429);
    h.evaluateGraduation.mockRejectedValue(new Error('config não encontrada'));
    expect((await getGraduation(gradReq())).status).toBe(500);
  });
});
