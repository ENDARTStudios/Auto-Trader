import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { createPrismaClient } from '@/lib/db';
import {
  checkRateLimit,
  rateLimitConfig,
  rateLimitResponse,
  __resetRateLimitStore,
} from '@/lib/rate-limit';
import { requireSession, generateToken, hashToken, signSessionToken } from '@/lib/auth/session';
import { RateLimitedError } from '@/lib/auth/errors';
import { hashPassword } from '@/lib/auth/password';
import * as redisMockModule from 'redis';
import {
  checkRateLimitDistributed,
  isDistributedRateLimitEnabled,
  __resetRedisRateLimit,
} from '@/lib/rate-limit';

// Mock do node-redis: ZSET em memória + controles para simular falha de conexão
// e falha em runtime. Nenhum teste toca um Redis real.
vi.mock('redis', () => {
  const zsets = new Map<string, Array<{ value: string; score: number }>>();
  const control = { failConnect: false, failOps: false, connectCalls: 0 };
  const client = {
    on() {
      return client;
    },
    async connect() {
      control.connectCalls += 1;
      if (control.failConnect) throw new Error('ECONNREFUSED');
    },
    async zRemRangeByScore(k: string, min: string, max: string) {
      // Semântica do ZREMRANGEBYSCORE: REMOVE os membros DENTRO de [min, max]
      // e mantém os de fora (os mais novos que a janela continuam contando).
      const lo = min === '-inf' ? -Infinity : Number(min);
      const hi = max === '+inf' ? Infinity : Number(max);
      const before = zsets.get(k) ?? [];
      const kept = before.filter((m) => !(m.score >= lo && m.score <= hi));
      zsets.set(k, kept);
      return before.length - kept.length;
    },
    async zAdd(k: string, members: Array<{ score: number; value: string }>) {
      const list = zsets.get(k) ?? [];
      for (const m of members) list.push({ value: m.value, score: m.score });
      zsets.set(k, list);
      return members.length;
    },
    async zCard(k: string) {
      if (control.failOps) throw new Error('redis connection lost');
      return (zsets.get(k) ?? []).length;
    },
    async pExpire() {
      return 1;
    },
    async zRange(k: string, start: number, stop: number) {
      const list = (zsets.get(k) ?? []).slice().sort((a, b) => a.score - b.score);
      return list.slice(start, stop + 1).map((m) => m.value);
    },
    async zRem(k: string, member: string) {
      zsets.set(
        k,
        (zsets.get(k) ?? []).filter((m) => m.value !== member),
      );
      return 1;
    },
  };
  return { createClient: () => client, __control: control, __zsets: zsets };
});

const redisControl = (redisMockModule as unknown as {
  __control: { failConnect: boolean; failOps: boolean; connectCalls: number };
}).__control;

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
  // The cookie now carries the SIGNED value (<token>.<hmac>) — requireSession
  // rejects unsigned cookies before the DB lookup.
  const signedCookie = signSessionToken(token);
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
      new Request('http://localhost/api/status', { headers: { cookie: `session=${signedCookie}` } });
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
      headers: { cookie: `session=${signedCookie}` },
    });
    const reqStatus = new Request('http://localhost/api/status', {
      headers: { cookie: `session=${signedCookie}` },
    });
    await expect(requireSession(reqPositions)).resolves.toBeTruthy();
    await expect(requireSession(reqStatus)).resolves.toBeTruthy();
  });
});
describe('rate limit distribuído (Redis real via mock do node-redis)', () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalLimit = rateLimitConfig.default.limit;

  beforeEach(() => {
    __resetRedisRateLimit();
    __resetRateLimitStore();
    redisControl.failConnect = false;
    redisControl.failOps = false;
    redisControl.connectCalls = 0;
    rateLimitConfig.default.limit = 2;
  });

  afterEach(() => {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    rateLimitConfig.default.limit = originalLimit;
    __resetRedisRateLimit();
    __resetRateLimitStore();
  });

  it('sem REDIS_URL não conecta e usa memória', async () => {
    delete process.env.REDIS_URL;
    __resetRedisRateLimit();
    expect(isDistributedRateLimitEnabled()).toBe(false);
    const key = 'user:sem-redis';
    expect((await checkRateLimitDistributed(key, '/api/positions')).allowed).toBe(true);
    expect((await checkRateLimitDistributed(key, '/api/positions')).allowed).toBe(true);
    const denied = await checkRateLimitDistributed(key, '/api/positions');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
    expect(redisControl.connectCalls).toBe(0);
  });

  it('com REDIS_URL usa Redis, respeita o limite e conecta UMA vez', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    __resetRedisRateLimit();
    expect(isDistributedRateLimitEnabled()).toBe(true);
    const key = 'user:com-redis';
    // 5 chamadas concorrentes: o lock de promise deve abrir 1 conexão só
    const first = await Promise.all([
      checkRateLimitDistributed(key, '/api/positions'),
      checkRateLimitDistributed(key, '/api/positions'),
      checkRateLimitDistributed(key, '/api/positions'),
    ]);
    expect(first.filter((r) => r.allowed)).toHaveLength(2);
    expect(first.filter((r) => !r.allowed)).toHaveLength(1);
    expect(redisControl.connectCalls).toBe(1);
    const denied = await checkRateLimitDistributed(key, '/api/positions');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
    // chave de rota diferente tem contagem própria
    expect((await checkRateLimitDistributed(key, '/api/status')).allowed).toBe(true);
  });

  it('falha de conexão do Redis degrada para memória (e não lança)', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    __resetRedisRateLimit();
    redisControl.failConnect = true;
    const key = 'user:conn-fail';
    expect((await checkRateLimitDistributed(key, '/api/positions')).allowed).toBe(true);
    expect((await checkRateLimitDistributed(key, '/api/positions')).allowed).toBe(true);
    const denied = await checkRateLimitDistributed(key, '/api/positions');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('erro do Redis em runtime degrada para memória na mesma chamada', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    __resetRedisRateLimit();
    redisControl.failOps = true;
    const res = await checkRateLimitDistributed('user:runtime-fail', '/api/positions');
    expect(res.allowed).toBe(true);
    expect(redisControl.connectCalls).toBe(1);
  });

  it('requireSession usa o caminho distribuído quando REDIS_URL existe', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    __resetRedisRateLimit();
    __resetRateLimitStore();
    rateLimitConfig.default.limit = 1;
    redisControl.failConnect = false;
    redisControl.connectCalls = 0;

    const email = `rl-redis-${Date.now()}@local`;
    const token = generateToken();
    const signed = signSessionToken(token);
    const passwordHash = await hashPassword('TestPass123!');
    const user = await db.user.create({ data: { email, passwordHash, role: 'viewer' } });
    await db.session.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) },
    });
    try {
      const req = () =>
        new Request('http://localhost/api/positions', { headers: { cookie: `session=${signed}` } });
      await expect(requireSession(req())).resolves.toBeTruthy();
      await expect(requireSession(req())).rejects.toBeInstanceOf(RateLimitedError);
      // prova que foi o Redis (e não a memória) que contou: 1 conexão aberta
      expect(redisControl.connectCalls).toBe(1);
    } finally {
      await db.session.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});