# WAF + Bot Fight Mode + Rate Limiting

> **Versão:** 1.0 — 2026-08-26
> **Stack:** Next.js middleware (app-layer) + Cloudflare WAF/Bot (edge) + Caddy rate limit
> **Princípio:** Toda rota tem rate limit. Bot malicioso é bloqueado na borda, não no app.

---

## 1. Arquitetura em Camadas

```
  Internet
     │
     ▼
  ┌──────────────────────────────┐
  │  Cloudflare (edge)           │  ← WAF managed rules + Bot Fight Mode + Rate Limiting rules
  │  - WAF: OWASP + leaks        │     (bloqueia antes de chegar no origin)
  │  - Bot Fight Mode: ON        │
  │  - Rate Limiting: 100 req/10s por IP (edge)
  │  - DDoS: auto                │
  └──────────────┬───────────────┘
                 │ (só passa se Cloudflare aprovou)
                 ▼
  ┌──────────────────────────────┐
  │  Caddy (origin reverse proxy)│  ← TLS termination + HSTS + rate limit fallback
  │  :443 { rate_limit ... }     │
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │  Next.js middleware.ts       │  ← Rate limit por IP + por user + por rota (app-layer)
  │  + proxy-trust.ts (REG-002)  │     (última barreira, com lógica de negócio)
  │  + RBAC + RLS               │
  └──────────────┬───────────────┘
                 │
                 ▼
              Route Handler
```

---

## 2. Cloudflare — WAF + Bot Fight Mode

### 2.1 WAF Managed Rules

Ativar no dashboard Cloudflare (ou via API):

| Rule Set | Ação | Por quê |
|---|---|---|
| **Cloudflare Managed Ruleset** | Block | OWASP Top 10, CVEs, etc. |
| **OWASP Core Ruleset** | Block (paranoia 1) | SQLi, XSS, RFI, etc. |
| **Exposed Credentials Check** | Block | Detecta credencial vazada em request |

**Via API:**

```bash
# Listar rulesets
curl -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets" \
  -H "Authorization: Bearer $CF_API_TOKEN"

# Ativar managed ruleset (exemplo)
curl -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/$RULESET_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rules":[{"action":"execute","action_parameters":{"id":"efb7b8d093b940c3b919568d5279d02e"},"expression":"true"}]}'
```

### 2.2 Bot Fight Mode

Dashboard → Security → Bots → **Bot Fight Mode: ON**

- Desafia bots conhecidos (headless, scrapers) com JS challenge / managed challenge.
- Protege `/api/*` sem afetar `GET /` (humano).

**Verificação:**

```bash
curl -A "python-requests/2.0" https://your-domain.com/api/status -i
# Esperado: 403 ou challenge page (não 200)
```

### 2.3 Cloudflare Rate Limiting Rules (edge)

Dashboard → Security → Rate limiting rules:

| Rule | Expression | Characteristics | Period | Requests | Action |
|---|---|---|---|---|---|
| Global | `http.request.uri.path contains "/api/"` | IP | 10s | 100 | Block 60s |
| Auth strict | `http.request.uri.path contains "/api/auth/"` | IP | 60s | 5 | Block 900s (15min) |
| Health | `http.request.uri.path eq "/api/health"` | IP | 10s | 20 | Block 10s |

---

## 3. Caddy — Rate Limit Fallback (origin)

`Caddyfile` já existe — SPRINT adiciona `rate_limit`:

```caddyfile
# Caddyfile — com rate limit + HSTS (ver docs/TLS_HSTS.md)

{
    # Global: rate limit storage (in-memory; para prod com múltiplas instâncias use Redis via plugin)
    order rate_limit before basicauth
}

:443 {
    tls {
        # Full (Strict) — ver docs/TLS_HSTS.md
        protocols tls1.2 tls1.3
    }

    header {
        # HSTS — Full Strict (preload ready)
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        # Security headers (ver docs/SECURITY_AUDIT.md §2.3)
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.binance.com https://api.dexscreener.com"
        Cross-Origin-Opener-Policy "same-origin"
        Cross-Origin-Embedder-Policy "require-corp"
    }

    # Rate limit por IP (Caddy plugin caddy-ratelimit)
    @api path /api/*
    rate_limit @api {
        zone api {
            key {remote_host}
            window 10s
            events 100
        }
        # Auth é mais restrito — sobrescreve
        zone auth {
            key {remote_host}
            window 60s
            events 5
        }
    }

    reverse_proxy localhost:3000 {
        header_up Host {host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }
}

# Redirect HTTP → HTTPS (HSTS)
:80 {
    redir https://{host}{uri} permanent
}
```

> **Nota:** `caddy-ratelimit` é plugin externo (`github.com/mholt/caddy-ratelimit`). Para MVP sem plugin, o rate limit app-layer (middleware) é suficiente; Caddy rate limit entra quando o deploy usa Caddy custom build.

---

## 4. App-Layer Rate Limiting (`src/middleware.ts` + `src/lib/rate-limit.ts`)

### 4.1 Store (memória dev, Redis prod)

```ts
// src/lib/rate-limit.ts — SPRINT implementa
import { getEnv } from '@/lib/env';

type Bucket = { timestamps: number[] }; // sliding window

const memoryStore = new Map<string, Bucket>();

function getStore() {
  const redisUrl = getEnv().REDIS_URL;
  if (redisUrl) {
    // Em prod: usar @upstash/redis ou ioredis com sliding window Lua script
    // Por ora, fallback para memória mesmo em prod se Redis não configurado
  }
  return memoryStore;
}

// Sliding window: mantém só timestamps dentro da janela
function isAllowed(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const store = getStore();
  let bucket = store.get(key);
  if (!bucket) { bucket = { timestamps: [] }; store.set(key, bucket); }

  // Remove fora da janela
  bucket.timestamps = bucket.timestamps.filter(t => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    const oldestInWindow = bucket.timestamps[0];
    const retryAfter = Math.ceil((oldestInWindow + windowMs - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  bucket.timestamps.push(now);
  return { allowed: true };
}

export const rateLimitConfig: Record<string, { limit: number; windowMs: number }> = {
  default: { limit: 100, windowMs: 10_000 },        // 100 req / 10s por IP
  auth: { limit: 5, windowMs: 60_000 },             // 5 req / 60s por IP (login, register, reset)
  health: { limit: 20, windowMs: 10_000 },          // 20 req / 10s (health)
  vault: { limit: 10, windowMs: 60_000 },           // 10 unlock tries / 60s por IP (REG-002)
};

export function checkRateLimit(key: string, route: string): { allowed: boolean; retryAfter?: number } {
  const cfg = route.startsWith('/api/auth/') ? rateLimitConfig.auth
            : route.startsWith('/api/vault') ? rateLimitConfig.vault
            : route.startsWith('/api/health') ? rateLimitConfig.health
            : rateLimitConfig.default;
  return isAllowed(`${route}:${key}`, cfg.limit, cfg.windowMs);
}
```

### 4.2 Middleware (`src/middleware.ts`)

```ts
// src/middleware.ts — SPRINT implementa
import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveTrustedClientIp } from '@/lib/trading/proxy-trust';

export function middleware(req: NextRequest) {
  // 1. Resolve IP confiável (REG-002 — usa remoteAddress se sem proxy secret)
  const ip = resolveTrustedClientIp(req as any) ?? 'unknown';

  // 2. Rate limit por rota
  const pathname = req.nextUrl.pathname;
  if (pathname.startsWith('/api/')) {
    const rl = checkRateLimit(ip, pathname);
    if (!rl.allowed) {
      return new NextResponse(JSON.stringify({ error: 'rate_limited', retryAfter: rl.retryAfter }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rl.retryAfter ?? 60),
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '0',
        },
      });
    }
  }

  // 3. Security headers (defesa em profundidade — também no Caddy)
  const res = NextResponse.next();
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // HSTS só em produção (evita travar localhost)
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  return res;
}

export const config = {
  matcher: ['/api/:path*', '/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

---

## 5. Tabela de Limites (Resumo)

| Rota | Limite (edge Cloudflare) | Limite (app middleware) | Store |
|---|---|---|---|
| `GET /api/*` (default) | 100 / 10s por IP | 100 / 10s por IP | Memória (dev) / Redis (prod) |
| `POST /api/auth/*` | 5 / 60s por IP | 5 / 60s por IP | Memória / Redis |
| `POST /api/vault/*` | 10 / 60s por IP | 10 / 60s por IP (REG-002 per-IP bucket) | Memória / Redis |
| `GET /api/health` | 20 / 10s por IP | 20 / 10s por IP | Memória |

Resposta de estouro: **HTTP 429** + header `Retry-After` + body `{ error: 'rate_limited', retryAfter: N }`.

---

## 6. Verificação

```bash
# 6.1 Rate limit — deve bloquear no 6º request de auth em 60s
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" -d '{"email":"a@a.com","password":"x"}'
done
echo
# Esperado: 401 401 401 401 401 429

# 6.2 Retry-After header presente no 429
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"a@a.com","password":"x"}' 2>&1 | grep -i retry-after

# 6.3 Bot — curl com user-agent de bot deve ser desafiado em prod (Cloudflare)
curl -A "python-requests/2.0" https://your-domain.com/api/status -i | head -20
# Esperado em prod: 403 ou challenge; em dev (sem CF): 200 (normal)

# 6.4 WAF — payload de XSS deve ser bloqueado em prod
curl "https://your-domain.com/api/history?symbol=%3Cscript%3Ealert(1)%3C/script%3E" -i | head -20
# Esperado em prod: 403 (WAF); em dev: 400 (Zod) ou 200 com sanitização
```
