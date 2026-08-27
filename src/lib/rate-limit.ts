// src/lib/rate-limit.ts — Sliding window rate limiter (memory dev, Redis prod)
// See docs/WAF_RATE_LIMIT.md

type Bucket = { timestamps: number[] };

const memoryStore = new Map<string, Bucket>();

// Redis client singleton (lazy)
let redis: { incr: (k: string) => Promise<number>; expire: (k: string, s: number) => Promise<unknown>; ttl: (k: string) => Promise<number> } | null = null;
let redisReady = false;
async function getRedis(): Promise<typeof redis> {
  if (redisReady) return redis;
  if (!process.env.REDIS_URL) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('redis') as typeof import('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    redis = client as never;
    redisReady = true;
    console.log('[rate-limit] Redis connected');
    return redis;
  } catch {
    redisReady = true; // don't retry every call
    return null;
  }
}

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

export const rateLimitConfig: Record<string, { limit: number; windowMs: number }> = {
  default: { limit: 100, windowMs: 10_000 },
  auth: { limit: 5, windowMs: 60_000 },
  health: { limit: 20, windowMs: 10_000 },
  vault: { limit: 10, windowMs: 60_000 },
};

export function checkRateLimit(key: string, route: string): { allowed: boolean; retryAfter?: number } {
  const cfg = route.startsWith('/api/auth/') || route.startsWith('/api/vault')
    ? rateLimitConfig.auth
    : route.startsWith('/api/health')
      ? rateLimitConfig.health
      : rateLimitConfig.default;
  // Sync fast-path: memory (Redis async would need await, but checkRateLimit is sync in handlers)
  // For Redis, caller should use checkRateLimitRedis (async). S06 keeps sync memory fallback for sync handlers.
  return isAllowedMemory(`${route}:${key}`, cfg.limit, cfg.windowMs);
}

// Async Redis variant — use when REDIS_URL is set and handler is async (all handlers are async, so this is preferred for prod)
export async function checkRateLimitRedis(key: string, route: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const r = await getRedis();
  if (!r) return checkRateLimit(key, route);
  const cfg = route.startsWith('/api/auth/') || route.startsWith('/api/vault') ? rateLimitConfig.auth : route.startsWith('/api/health') ? rateLimitConfig.health : rateLimitConfig.default;
  const redisKey = `rl:${route}:${key}`;
  const count = await r.incr(redisKey);
  if (count === 1) await r.expire(redisKey, Math.ceil(cfg.windowMs / 1000));
  if (count > cfg.limit) {
    const ttl = await r.ttl(redisKey);
    return { allowed: false, retryAfter: ttl > 0 ? ttl : Math.ceil(cfg.windowMs / 1000) };
  }
  return { allowed: true };
}

export function __resetRateLimitStore(): void {
  memoryStore.clear();
}
