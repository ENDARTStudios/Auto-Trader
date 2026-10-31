# WAF + Bot Fight Mode + Rate Limiting

> **Versão:** 2.0 — 2026-09-30 (v1.0 — 2026-08-26; v2.0: rate limit identity-aware — por usuário/conta/IP, sliding window em memória E Redis, resposta 429 padronizada via helper único)
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
  │  Next.js proxy.ts            │  ← Rate limit por IP + por user + por rota (app-layer)
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
# Caddyfile — com rate limit + HSTS (ver docs/05-security-compliance/TLS_HSTS.md)

{
    # Global: rate limit storage (in-memory; para prod com múltiplas instâncias use Redis via plugin)
    order rate_limit before basicauth
}

:443 {
    tls {
        # Full (Strict) — ver docs/05-security-compliance/TLS_HSTS.md
        protocols tls1.2 tls1.3
    }

    header {
        # HSTS — Full Strict (preload ready)
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        # Security headers (ver docs/05-security-compliance/SECURITY_REVIEW.md §2.3)
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

## 4. App-Layer Rate Limiting (`src/lib/rate-limit.ts` + `src/lib/auth/session.ts`)

> **v2.0 — implementação real (testada em `tests/rate-limit.test.ts`):** identity-aware.
> Limite por **usuário** (`user:<id>`) em todas as rotas autenticadas (hook no `requireSession`),
> por **conta** (`acct:<email>`) em endpoints de credencial e por **IP** em rotas públicas.
> Algoritmo: **sliding window** em memória (dev) e Redis ZSET (prod).
> Resposta padronizada 429 + `Retry-After` via `rateLimitResponse()` / `RateLimitedError` → `handleApiError`.

### 4.1 Chaves por camada

| Camada | Chave | Onde aplica |
|---|---|---|
| **Usuário autenticado** | `user:<userId>` | `requireSession()` — cobre TODAS as rotas protegidas sem tocar handler por handler; excede → `RateLimitedError` → 429 |
| **Conta (credencial)** | `acct:<email lowercased>` | `POST /api/auth/login` e `/api/auth/forgot` — mitiga brute force distribuído que o limite por IP não pega |
| **IP (rotas públicas)** | `ip:<addr>` (XFF/XRI) | Pre-gate nos handlers públicos (`/api/auth/*`, `/api/health`) |

Nota: `src/proxy.ts` NÃO aplica rate limit (roda no runtime Node do Proxy, sem store compartilhado) — só auth guard, CSRF e security headers. O gate de identidade vive no `requireSession` (após resolver sessão no DB). `getSession()` propaga `RateLimitedError` (quem usa soft-auth recebe 429 no `handleApiError`).

### 4.2 Algoritmo — sliding window (memória + Redis)

```ts
// Memória (sync fast-path): bucket de timestamps filtrado pela janela
isAllowedMemory(key, limit, windowMs) → { allowed, retryAfter }

// Redis (prod, REDIS_URL): ZSET com score = timestamp ms
//   ZREMRANGEBYSCORE rlz:<key> -inf <now-windowMs>   // expira entradas antigas
//   ZADD rlz:<key> <now> <member>                     // tentativa atual
//   ZCARD → count > limit? ZREM do próprio member (negado NUNCA estende a janela)
//          e retryAfter = (score mais antigo + windowMs) - now
//   PEXPIRE rlz:<key> windowMs+1s                     // chaves ociosas morrem sozinhas
```

Fallback: Redis indisponível → memória local (por instância — aceitável; multi-instância sério exige Redis saudável).

### 4.3 Tiers (`rateLimitConfig`)

```ts
default: { limit: 100, windowMs: 10_000 }, // rotas autenticadas genéricas (por user)
auth:    { limit: 5,   windowMs: 60_000 }, // /api/auth/* pré-auth (por IP)
account: { limit: 10,  windowMs: 60_000 }, // acct:<email> em login/forgot (por conta)
health:  { limit: 20,  windowMs: 10_000 },
vault:   { limit: 10,  windowMs: 60_000 }, // REG-002 (por IP)
```

Em teste (`test.db` ou `NODE_ENV=test`) os limites sobem (100/1000) para não flakar e2e paralelo.

### 4.4 Resposta padronizada 429

Único shape em todo o sistema — `rateLimitResponse(retryAfter)` (em `rate-limit.ts`) e
`handleApiError(RateLimitedError)` (em `error-handler.ts`) emitem:

- Status **429**
- Header **`Retry-After: N`** (segundos, inteiro ≥ 1)
- Header `Cache-Control: no-store`
- Body `{ error: 'rate_limited', retryAfter: N }`

**Nova rota NUNCA monta 429 à mão** — importa `rateLimitResponse` (pré-auth) ou joga `RateLimitedError` (autenticada).

---

## 5. Tabela de Limites (Resumo)

| Rota | Chave | Limite (app) | Store |
|---|---|---|---|
| Rotas autenticadas (`/api/*` com sessão) | `user:<id>` + rota | default 100/10s | Memória (dev) / Redis ZSET (prod) |
| `POST /api/auth/*` (pré-auth) | `ip:<addr>` | 5/60s | Memória / Redis |
| `POST /api/auth/login` + `/forgot` (por conta) | `acct:<email>` | 10/60s | Memória / Redis |
| `POST /api/vault/*` | `ip:<addr>` | 10/60s (REG-002) | Memória / Redis |
| `GET /api/health` | `ip:<addr>` | 20/10s | Memória |

Rotas públicas (allowlist do middleware): `/api/health`, `/api/auth/login`, `/api/auth/forgot`, `/api/auth/reset` — recuperação de senha precisa funcionar para usuário deslogado (proteção: rate limit 5/60s por IP + 10/60s por conta + token single-use). Todo o resto exige cookie de sessão e recebe o gate por usuário.

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
