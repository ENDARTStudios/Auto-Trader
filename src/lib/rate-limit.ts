// src/lib/rate-limit.ts — Sliding window rate limiter (memory dev, Redis prod)
// See docs/WAF_RATE_LIMIT.md

type Bucket = { timestamps: number[] };

const memoryStore = new Map<string, Bucket>();

function isAllowed(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter?: number } {
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
  return isAllowed(`${route}:${key}`, cfg.limit, cfg.windowMs);
}

export function __resetRateLimitStore(): void {
  memoryStore.clear();
}
