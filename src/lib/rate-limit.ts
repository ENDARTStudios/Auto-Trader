// src/lib/rate-limit.ts — Sliding window rate limiter (memory dev, Redis prod)
// Identity-aware: key by `user:<id>` for authenticated routes (via requireSession),
// `ip:<addr>` for public routes, `acct:<email>` for credential endpoints (login/forgot).
// Responses: rateLimitResponse() → 429 + Retry-After (single source of truth).
// See docs/WAF_RATE_LIMIT.md

import { NextResponse } from 'next/server';

type Bucket = { timestamps: number[] };

const memoryStore = new Map<string, Bucket>();

// Redis client singleton (lazy) — subset used by the sliding window (ZSET)
type RedisSlidingClient = {
  zRemRangeByScore: (k: string, min: string, max: string) => Promise<unknown>;
  zAdd: (k: string, members: Array<{ score: number; value: string }>) => Promise<unknown>;
  zCard: (k: string) => Promise<number>;
  pExpire: (k: string, ms: number) => Promise<unknown>;
  zRangeWithScores: (k: string, min: number, max: number) => Promise<Array<{ value: string; score: number }>>;
  zRem: (k: string, member: string) => Promise<unknown>;
};

let redis: RedisSlidingClient | null = null;
let redisReady = false;
async function getRedis(): Promise<RedisSlidingClient | null> {
  if (redisReady) return redis;
  if (!process.env.REDIS_URL) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('redis') as typeof import('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    redis = client as unknown as RedisSlidingClient;
    redisReady = true;
    console.log('[rate-limit] Redis connected (sliding window)');
    return redis;
  } catch {
    redisReady = true; // don't retry every call
    return null;
  }
}

// E2E roda contra Postgres (DATABASE_URL sem 'test.db'), então precisa de um
// sinal explícito para subir os limites — setado apenas no job de e2e da CI.
const isTest =
  process.env.DATABASE_URL?.includes('test.db') ||
  process.env.NODE_ENV === 'test' ||
  process.env.E2E_RATE_LIMIT_BYPASS === '1';

export const rateLimitConfig: Record<string, { limit: number; windowMs: number }> = {
  default: { limit: isTest ? 1000 : 100, windowMs: 10_000 },
  // Em teste os limites sobem para não flakar e2e paralelo (26 testes × 2 workers → 5/60s estoura).
  auth: { limit: isTest ? 100 : 5, windowMs: 60_000 },
  // Limite por CONTA (acct:<email>) em endpoints de credencial — mitiga brute force distribuído
  // em uma única conta sem depender do IP. Topo da faixa recomendada (5-10/min).
  account: { limit: isTest ? 100 : 10, windowMs: 60_000 },
  health: { limit: isTest ? 1000 : 20, windowMs: 10_000 },
  vault: { limit: isTest ? 100 : 10, windowMs: 60_000 },
};

export function tierForRoute(route: string): { limit: number; windowMs: number } {
  if (route.startsWith('/api/auth/')) return rateLimitConfig.auth;
  if (route.startsWith('/api/vault')) return rateLimitConfig.vault;
  if (route.startsWith('/api/health')) return rateLimitConfig.health;
  return rateLimitConfig.default;
}

// ---- Sliding window — memory (sync fast-path) ----
function isAllowedMemory(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  let bucket = memoryStore.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    memoryStore.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }
  bucket.timestamps.push(now);
  return { allowed: true };
}

// ---- Sliding window — Redis (ZSET: score = timestamp ms) ----
// Denied requests remove their own member so they never extend the window.
async function isAllowedRedis(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfter?: number }> {
  const r = await getRedis();
  if (!r) return isAllowedMemory(key, limit, windowMs);
  const zkey = `rlz:${key}`;
  const now = Date.now();
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  await r.zRemRangeByScore(zkey, '-inf', String(now - windowMs));
  await r.zAdd(zkey, [{ score: now, value: member }]);
  const count = await r.zCard(zkey);
  if (count > limit) {
    await r.zRem(zkey, member);
    const oldest = await r.zRangeWithScores(zkey, 0, 0);
    const oldestScore = oldest[0]?.score ?? now;
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((oldestScore + windowMs - now) / 1000)) };
  }
  await r.pExpire(zkey, windowMs + 1_000); // TTL de segurança > janela; chaves ociosas morrem sozinhas
  return { allowed: true };
}

export function checkRateLimit(key: string, route: string): { allowed: boolean; retryAfter?: number } {
  const cfg = tierForRoute(route);
  // Sync fast-path: memory (Redis async would need await, but checkRateLimit is sync in handlers)
  return isAllowedMemory(`${route}:${key}`, cfg.limit, cfg.windowMs);
}

// Async Redis variant — preferred in prod when REDIS_URL is set (handlers are async).
export async function checkRateLimitRedis(key: string, route: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const cfg = tierForRoute(route);
  return isAllowedRedis(`${route}:${key}`, cfg.limit, cfg.windowMs);
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = req.headers.get?.('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

// Resposta 429 padronizada — SEMPRE com Retry-After. Use em todas as rotas;
// handleApiError também emite este shape quando recebe RateLimitedError.
export function rateLimitResponse(retryAfter?: number): NextResponse {
  const retry = Math.max(1, Math.ceil(retryAfter ?? 60));
  return NextResponse.json(
    { error: 'rate_limited', retryAfter: retry },
    { status: 429, headers: { 'Retry-After': String(retry), 'Cache-Control': 'no-store' } },
  );
}

export function __resetRateLimitStore(): void {
  memoryStore.clear();
}
