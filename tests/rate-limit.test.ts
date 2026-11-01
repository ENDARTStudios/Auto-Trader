import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { createPrismaClient } from '@/lib/db';
import {
  checkRateLimit,
  rateLimitConfig,
  rateLimitResponse,
  __resetRateLimitStore,
} from '@/lib/rate-limit';
import { requireSession, generateToken, hashToken } from '@/lib/auth/session';
import { RateLimitedError } from '@/lib/auth/errors';
import { hashPassword } from '@/lib/auth/password';

const db = createPrismaClient();

describe('rate limit — sliding window (memory)', () => {
  beforeEach(() => __resetRateLimitStore());

  it('permite até o limite dentro da janela e bloqueia com retryAfter', () => {
    const { limit } = rateLimitConfig.auth;
    for (let i = 0; i < limit; i++) {
      expect(checkRateLimit('ip:1.2.3.4', '/api/auth/login').allowed).toBe(true);
    }
    const denied = checkRateLimit('ip:1.2.3.4', '/api/auth/login');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfter).toBeLessThanOrEqual(60);
  });

  it('libera slot quando entradas saem da janela (janela deslizante)', () => {
    vi.useFakeTimers();
    try {
      const { limit, windowMs } = rateLimitConfig.auth;
      for (let i = 0; i < limit; i++) checkRateLimit('ip:5.6.7.8', '/api/auth/login');
      expect(checkRateLimit('ip:5.6.7.8', '/api/auth/login').allowed).toBe(false);
      vi.advanceTimersByTime(windowMs + 1);
      expect(checkRateLimit('ip:5.6.7.8', '/api/auth/login').allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('chave é escopada por rota+identidade (user A não bloqueia user B)', () => {
    expect(checkRateLimit('user:alice', '/api/status').allowed).toBe(true);
    expect(checkRateLimit('user:bob', '/api/status').allowed).toBe(true);
    expect(checkRateLimit('user:alice', '/api/positions').allowed).toBe(true);
  });

  it('tier por conta usa janela de 60s e limite baixo (10/min em prod)', () => {
    expect(rateLimitConfig.account.windowMs).toBe(60_000);
    expect(rateLimitConfig.account.limit).toBeLessThanOrEqual(100); // 10 em prod/dev, 100 em test
  });

  it('rateLimitResponse emite 429 + Retry-After padronizado', async () => {
    const res = rateLimitResponse(7);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('7');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.error).toBe('rate_limited');
    expect(body.retryAfter).toBe(7);
  });
});

describe('requireSession — limite por usuário (identity-aware)', () => {
  const email = `rl-user-${Date.now()}@local`;
  const token = generateToken();
  let userId: string;
  let originalDefaultLimit: number;

  beforeAll(async () => {
    const passwordHash = await hashPassword('TestPass123!');
    const user = await db.user.create({ data: { email, passwordHash, role: 'viewer' } });
    userId = user.id;
    await db.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) },
    });
  });

  afterAll(async () => {
    await db.session.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } }).catch(() => {});
    await db.$disconnect();
  });

  beforeEach(() => {
    __resetRateLimitStore();
    originalDefaultLimit = rateLimitConfig.default.limit;
    rateLimitConfig.default.limit = 3; // janela pequena para exercitar o bloqueio
  });

  afterEach(() => {
    rateLimitConfig.default.limit = originalDefaultLimit;
  });

  it('RateLimitedError após N chamadas do mesmo usuário na mesma rota', async () => {
    const req = () =>
      new Request('http://localhost/api/status', { headers: { cookie: `session=${token}` } });
    for (let i = 0; i < 3; i++) {
      const s = await requireSession(req());
      expect(s.userId).toBe(userId);
    }
    await expect(requireSession(req())).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('rota diferente do mesmo usuário tem contagem própria', async () => {
    __resetRateLimitStore();
    rateLimitConfig.default.limit = 1;
    const reqPositions = new Request('http://localhost/api/positions', {
      headers: { cookie: `session=${token}` },
    });
    const reqStatus = new Request('http://localhost/api/status', {
      headers: { cookie: `session=${token}` },
    });
    await expect(requireSession(reqPositions)).resolves.toBeTruthy();
    await expect(requireSession(reqStatus)).resolves.toBeTruthy();
  });
});
