// tests/routes-engine.test.ts — POST /api/engine/start e /stop (gating).
//
// Engine mockada (sem loop/timers): cobre 200 running, 200 no-op (start bloqueado
// por VERCEL/kill switch), 401, 403, 429 e 500.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  requireSession: vi.fn(),
  hasPermission: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  running: false,
  eventPush: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: (...a: unknown[]) => h.checkRateLimit(...a) }));
vi.mock('@/lib/auth/session', () => ({ requireSession: (...a: unknown[]) => h.requireSession(...a) }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: (...a: unknown[]) => h.hasPermission(...a) }));
vi.mock('@/lib/trading/engine', () => ({
  engine: {
    start: (...a: unknown[]) => h.start(...a),
    stop: (...a: unknown[]) => h.stop(...a),
    isRunning: () => h.running,
  },
}));
vi.mock('@/lib/trading/event-bus', () => ({
  eventBus: { push: (...a: unknown[]) => h.eventPush(...a) },
}));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: (...a: unknown[]) => h.loggerError(...a), debug: noop } };
});

import { POST as startEngine } from '@/app/api/engine/start/route';
import { POST as stopEngine } from '@/app/api/engine/stop/route';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/errors';

const SESSION = { userId: 'u-1', email: 'u@local', role: 'trader', isActive: true };
const post = (url: string) => new Request(url, { method: 'POST' });

beforeEach(() => {
  for (const fn of Object.values(h)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset: () => void }).mockReset();
  }
  h.checkRateLimit.mockReturnValue({ allowed: true });
  h.requireSession.mockResolvedValue(SESSION);
  h.hasPermission.mockReturnValue(true);
  h.start.mockResolvedValue(undefined);
  h.stop.mockResolvedValue(undefined);
  h.running = false;
});

describe('POST /api/engine/start', () => {
  const url = 'http://localhost/api/engine/start';

  it('200: inicia e reporta running=true + evento SSE', async () => {
    h.start.mockImplementation(async () => {
      h.running = true;
    });
    const res = await startEngine(post(url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, running: true });
    expect(h.eventPush).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'engine', title: 'Engine iniciada' })
    );
  });

  it('200: start no-op (VERCEL/kill switch) → running=false e sem evento', async () => {
    const res = await startEngine(post(url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, running: false });
    expect(h.eventPush).not.toHaveBeenCalled();
  });

  it('401 sem sessão', async () => {
    h.requireSession.mockRejectedValue(new UnauthorizedError());
    expect((await startEngine(post(url))).status).toBe(401);
    expect(h.start).not.toHaveBeenCalled();
  });

  it('403 sem engine:control', async () => {
    h.hasPermission.mockReturnValue(false);
    const res = await startEngine(post(url));
    expect(res.status).toBe(403);
    expect(h.hasPermission).toHaveBeenCalledWith(SESSION.role, 'engine:control');
    expect(h.start).not.toHaveBeenCalled();
  });

  it('429 rate limited', async () => {
    h.checkRateLimit.mockReturnValue({ allowed: false, retryAfter: 12 });
    const res = await startEngine(post(url));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('12');
  });

  it('500 quando engine.start lança (erro interno logado)', async () => {
    h.start.mockRejectedValue(new Error('boom'));
    const res = await startEngine(post(url));
    expect(res.status).toBe(500);
    expect(h.loggerError).toHaveBeenCalled();
  });
});

describe('POST /api/engine/stop', () => {
  const url = 'http://localhost/api/engine/stop';

  it('200: para a engine e reporta running=false + evento SSE', async () => {
    h.running = true;
    h.stop.mockImplementation(async () => {
      h.running = false;
    });
    const res = await stopEngine(post(url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, running: false });
    expect(h.eventPush).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'engine', title: 'Engine parada' })
    );
  });

  it('401/403 no gating de permissão', async () => {
    h.requireSession.mockRejectedValueOnce(new UnauthorizedError());
    expect((await stopEngine(post(url))).status).toBe(401);
    h.requireSession.mockResolvedValue(SESSION);
    h.hasPermission.mockReturnValueOnce(false);
    expect((await stopEngine(post(url))).status).toBe(403);
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('429 rate limited e 500 quando stop lança', async () => {
    h.checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 5 });
    expect((await stopEngine(post(url))).status).toBe(429);
    h.stop.mockRejectedValue(new Error('stop boom'));
    expect((await stopEngine(post(url))).status).toBe(500);
  });
});
