// src/lib/rate-limit.ts — sliding window rate limiter (memória no dev, Redis em prod)
//
// Dois modos, mesma política:
//   - memória: Map por processo. Serve dev/test e é o FALLBACK quando o Redis cai.
//   - Redis: ZSET por chave (score = timestamp ms) — limite GLOBAL entre instâncias.
//     Só é usado quando REDIS_URL existe; qualquer erro do Redis degrada para
//     memória com UM warn (nunca derruba o request, nunca faz retry infinito).
//
// Identity-aware: key por `user:<id>` (requireSession), `ip:<addr>` (rotas públicas)
// e `acct:<email>` (login/forgot). Ver docs/WAF_RATE_LIMIT.md.

import { NextResponse } from 'next/server';

type Bucket = { timestamps: number[] };
type RateLimitResult = { allowed: boolean; retryAfter?: number };

const memoryStore = new Map<string, Bucket>();

// Subconjunto do node-redis que o limiter usa. Tipado localmente para não
// acoplar o bundle ao cliente quando o pacote não é usado (dev sem REDIS_URL).
type RedisSlidingClient = {
  zRemRangeByScore: (k: string, min: string, max: string) => Promise<unknown>;
  zAdd: (k: string, members: Array<{ score: number; value: string }>) => Promise<unknown>;
  zCard: (k: string) => Promise<number>;
  pExpire: (k: string, ms: number) => Promise<unknown>;
  zRange: (k: string, start: number, stop: number) => Promise<string[]>;
  zRem: (k: string, member: string) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

const REDIS_PREFIX = 'rlz:';
let redisClient: RedisSlidingClient | null = null;
let redisResolved = false;
let redisConnectPromise: Promise<RedisSlidingClient | null> | null = null;
let redisWarned = false;

function warnOnce(message: string): void {
  if (redisWarned) return;
  redisWarned = true;
  console.warn('[rate-limit] ' + message);
}

// Conecta UMA vez por processo; chamadas concorrentes compartilham a mesma promise
// (sem isso, N requests no boot abrem N conexões e o Redis recusa por limite).
async function getRedis(): Promise<RedisSlidingClient | null> {
  if (!process.env.REDIS_URL) return null;
  if (redisResolved) return redisClient;
  if (!redisConnectPromise) {
    redisConnectPromise = (async () => {
      try {
        const { createClient } = await import('redis');
        const client = createClient({ url: process.env.REDIS_URL });
        // Sem listener de 'error' o node-redis derruba o processo em falha de socket.
        client.on('error', (err: unknown) => {
          warnOnce('erro de conexão Redis (rate limit segue em memória): ' + String((err as Error)?.message ?? err));
        });
        await client.connect();
        redisClient = client as unknown as RedisSlidingClient;
        console.log('[rate-limit] Redis conectado — sliding window distribuído');
        return redisClient;
      } catch (err) {
        warnOnce(
          'Redis indisponível, usando fallback em memória: ' + String((err as Error)?.message ?? err),
        );
        return null;
      } finally {
        redisResolved = true;
      }
    })();
  }
  return redisConnectPromise;
}

// Chamado quando o Redis falha em runtime: desliga o modo distribuído até o
// próximo restart (fail-safe para memória, sem martelar um Redis morto).
function degradeToMemory(reason: string): void {
  warnOnce('degradando rate limit para memória: ' + reason);
  redisClient = null;
  redisResolved = true;
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

// ---- Sliding window — memória (sync fast-path e fallback) ----
function isAllowedMemory(key: string, limit: number, windowMs: number): RateLimitResult {
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
// O membro carrega o timestamp no prefixo (`<ms>-<rand>`), então o retryAfter sai
// do membro mais antigo sem depender do shape de zRangeWithScores entre versões.
async function isAllowedRedis(
  r: RedisSlidingClient,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const zkey = REDIS_PREFIX + key;
  const now = Date.now();
  const member = now + '-' + Math.random().toString(36).slice(2, 8);
  await r.zRemRangeByScore(zkey, '-inf', String(now - windowMs));
  await r.zAdd(zkey, [{ score: now, value: member }]);
  const count = await r.zCard(zkey);
  if (count > limit) {
    // Request negado não estende a janela dos outros.
    await r.zRem(zkey, member);
    const oldestMembers = await r.zRange(zkey, 0, 0);
    const oldestTs = Number(String(oldestMembers[0] ?? '').split('-')[0]);
    const base = Number.isFinite(oldestTs) && oldestTs > 0 ? oldestTs : now;
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((base + windowMs - now) / 1000)) };
  }
  await r.pExpire(zkey, windowMs + 1_000); // TTL de segurança > janela; chaves ociosas morrem sozinhas
  return { allowed: true };
}

// Sync: sempre memória (rotas que não podem await). Mantido por compatibilidade.
export function checkRateLimit(key: string, route: string): RateLimitResult {
  const cfg = tierForRoute(route);
  return isAllowedMemory(route + ':' + key, cfg.limit, cfg.windowMs);
}

// Serializa, por chave, as operações no Redis DENTRO deste processo. ZADD+ZCARD
// não são atômicos (MULTI/Lua não usados para não depender de EVAL), então um
// burst concorrente poderia contar errado. Entre instâncias o ZSET segue sendo a
// fonte de verdade; aqui garantimos ordem local.
const keyLocks = new Map<string, Promise<unknown>>();
function withKeyLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  if (keyLocks.size > 10_000) keyLocks.clear(); // guarda contra crescimento sem fim
  const previous = keyLocks.get(lockKey) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  keyLocks.set(
    lockKey,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

// Async distribuído: é o caminho preferido em produção (requireSession usa este).
export async function checkRateLimitDistributed(key: string, route: string): Promise<RateLimitResult> {
  const cfg = tierForRoute(route);
  const composite = route + ':' + key;
  const r = await getRedis();
  if (!r) return isAllowedMemory(composite, cfg.limit, cfg.windowMs);
  try {
    return await withKeyLock(composite, () => isAllowedRedis(r, composite, cfg.limit, cfg.windowMs));
  } catch (err) {
    degradeToMemory(String((err as Error)?.message ?? err));
    return isAllowedMemory(composite, cfg.limit, cfg.windowMs);
  }
}

// Alias histórico (nome anterior) — mantém quem já chamava.
export async function checkRateLimitRedis(key: string, route: string): Promise<RateLimitResult> {
  return checkRateLimitDistributed(key, route);
}

export function isDistributedRateLimitEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
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

// Só para testes: permite simular com/sem Redis no mesmo arquivo.
export function __resetRedisRateLimit(): void {
  redisClient = null;
  redisResolved = false;
  redisConnectPromise = null;
  redisWarned = false;
}
