# Secrets Management — Variáveis de Ambiente (.env)

> **Versão:** 1.0 — 2026-08-26
> **Princípio:** Nenhum segredo em código, log, commit ou chat. Tudo em env ou secret manager.
> **Validação:** Zod em `src/lib/env.ts` — falha no boot se faltar/inválido.

---

## 1. Arquivos

| Arquivo | Commitado? | Conteúdo | Uso |
|---|---|---|---|
| `.env.example` | ✅ | Placeholders `SUA_CHAVE_AQUI` | Template para clone |
| `.env` | ❌ (gitignored) | Valores reais locais | `next dev` / `prisma` lê |
| `.env.production` | ❌ | Valores prod | Deploy (Fly.io/Railway secrets) |
| `.env.test` | ❌ | Valores de teste (DB memória) | `npm run test:ci` |

`.gitignore` já contém `.env*` (exceto `.env.example` via `!.env.example`).

---

## 2. Catálogo de Variáveis

### 2.1 Obrigatórias (boot falha sem)

| Variável | Exemplo | Descrição | Onde usada |
|---|---|---|---|
| `DATABASE_URL` | `file:./prisma/dev.db` (dev) / `postgresql://...` (prod) | Prisma datasource | `prisma/schema.prisma`, `src/lib/db.ts` |
| `ENCRYPTION_KEY` | `base64:64chars...` | Master key para AES-256-GCM de Wallet/Exchange blobs (32 bytes base64) | `src/lib/trading/wallet-crypto.ts`, `src/lib/trading/kdf.ts` |
| `SESSION_SECRET` | `hex:64chars...` | HMAC para assinar cookies de sessão opaca | `src/lib/auth/session.ts` |
| `SIGNER_SOCKET_PATH` | `/tmp/signer.sock` | Unix socket do signer process (Linux only) | `src/lib/signer-protocol.ts`, `src/signer/main.ts` |

### 2.2 Opcionais — camadas extras (app funciona sem)

| Variável | Default | Descrição |
|---|---|---|
| `GOOGLE_SAFE_BROWSING_KEY` | (vazio) | Ativa 4ª camada site-integrity (Google Safe Browsing v4). Free 10k/dia. |
| `ETHERSCAN_API_KEY` | (vazio) | Rate limit Etherscan contract verification |
| `ARBISCAN_API_KEY` | (vazio) | Idem Arbitrum |
| `BASESCAN_API_KEY` | (vazio) | Idem Base |
| `OPTIMISM_ETHERSCAN_API_KEY` | (vazio) | Idem Optimism |
| `SENTRY_DSN` | (vazio) | DSN do Sentry (observabilidade). Se vazio, Sentry desabilitado. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (vazio) | Endpoint OpenTelemetry (Datadog/New Relic) |
| `REDIS_URL` | (vazio) | Redis para rate limit prod + cache. Sem → memória in-process. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | URL canônica para OG/canonical/sitemap |

### 2.3 Operacionais

| Variável | Default | Descrição |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `CRASH_LOG_DIR` | `./logs` | Onde `crash-logger.ts` escreve `crash-*.log` |
| `SIGNER_TEST_HOOKS` | `0` | `1` só em `test:ci` — expõe `__test_throw` etc. NUNCA em prod. |
| `SIGNER_PROXY_SHARED_SECRET` | (vazio) | Se setado, XFF é confiável; sem, usa `remoteAddress` direto (REG-002) |

---

## 3. Validação com Zod (`src/lib/env.ts`)

```ts
// src/lib/env.ts — SPRINT implementa (ou já existe, adaptar)
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ENCRYPTION_KEY: z.string()
    .regex(/^base64:[A-Za-z0-9+/=]{44}$/, 'ENCRYPTION_KEY must be base64: + 32 bytes (44 chars)')
    .or(z.string().length(64, 'hex 64 chars')),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be ≥32 chars'),
  SIGNER_SOCKET_PATH: z.string().default('/tmp/signer.sock'),

  // opcionais
  GOOGLE_SAFE_BROWSING_KEY: z.string().optional(),
  ETHERSCAN_API_KEY: z.string().optional(),
  ARBISCAN_API_KEY: z.string().optional(),
  BASESCAN_API_KEY: z.string().optional(),
  OPTIMISM_ETHERSCAN_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().url().optional().or(z.literal('')),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().or(z.literal('')),
  REDIS_URL: z.string().url().optional().or(z.literal('')),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CRASH_LOG_DIR: z.string().default('./logs'),
  SIGNER_TEST_HOOKS: z.enum(['0','1']).default('0'),
  SIGNER_PROXY_SHARED_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables — check .env.example');
  }
  _env = parsed.data;
  // Guard: nunca permitir TEST_HOOKS em produção
  if (_env.NODE_ENV === 'production' && _env.SIGNER_TEST_HOOKS === '1') {
    throw new Error('SIGNER_TEST_HOOKS=1 is forbidden in production');
  }
  return _env;
}

// Para scripts que precisam falhar cedo:
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const v = getEnv()[key];
  if (v == null || v === '') throw new Error(`Missing required env: ${String(key)}`);
  return v as NonNullable<Env[K]>;
}
```

**Uso no boot:**

```ts
// src/instrumentation.ts — primeira linha
import { getEnv } from '@/lib/env';
getEnv(); // valida e falha rápido se env inválido

// src/lib/db.ts
import { getEnv } from '@/lib/env';
export const db = new PrismaClient({ datasources: { db: { url: getEnv().DATABASE_URL } } });
```

---

## 4. `.env.example` (template)

```bash
# .env.example — copie para .env e preencha
# NUNCA commitar valores reais aqui — só placeholders.

# === Obrigatórias ===
DATABASE_URL="file:./prisma/dev.db"
# Para prod: postgresql://user:password@host:5432/autotrader?schema=public

ENCRYPTION_KEY="base64:SUA_CHAVE_AQUI_32_BYTES_BASE64_44_CHARS_=="
# Gere com: node -e "console.log('base64:'+require('crypto').randomBytes(32).toString('base64'))"

SESSION_SECRET="SUA_CHAVE_AQUI_MIN_32_CHARS_HEX_OU_RANDOM_64"
# Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

SIGNER_SOCKET_PATH="/tmp/signer.sock"

# === Opcionais (desbloqueiam camadas extras) ===
GOOGLE_SAFE_BROWSING_KEY=""
ETHERSCAN_API_KEY=""
ARBISCAN_API_KEY=""
BASESCAN_API_KEY=""
OPTIMISM_ETHERSCAN_API_KEY=""

SENTRY_DSN=""
OTEL_EXPORTER_OTLP_ENDPOINT=""
REDIS_URL=""
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# === Operacionais ===
NODE_ENV="development"
CRASH_LOG_DIR="./logs"
SIGNER_TEST_HOOKS="0"
SIGNER_PROXY_SHARED_SECRET=""
```

---

## 5. Secret Manager em Produção

| Plataforma | Onde setar segredo | Como o app lê |
|---|---|---|
| **Fly.io** | `fly secrets set ENCRYPTION_KEY=...` | `process.env` (injetado no container) |
| **Railway** | Variables → Raw Editor | `process.env` |
| **Vercel** | Settings → Environment Variables | `process.env` |
| **Docker local** | `docker-compose.yml` → `env_file: .env` | `process.env` |

**Rotação de segredos (ver `docs/CRYPTO.md` + `src/lib/trading/key-rotation.ts`):**

1. Gerar nova `ENCRYPTION_KEY`.
2. Rodar `rotatePassphrase(blobs, oldPass, newPass)` — pure function, caller persiste atomicamente.
3. Atualizar secret no provider (`fly secrets set ...`).
4. Redeploy (rolling, sem downtime).
5. `isBlobCurrent()` detecta blobs stale até rotação completar.

---

## 6. Auditoria — Onde NÃO pode aparecer segredo

| Local | Regra | Verificação |
|---|---|---|
| Código | Nunca hardcode; sempre `getEnv().X` | `gitleaks detect --source .` no pre-commit + CI |
| Log | `logger` com `redact: ['password','token','apiKey','secret']` | `rg -i "apiKey.*[A-Za-z0-9]{20,}" src/` deve dar 0 |
| Erro retornado ao client | Nunca incluir `DATABASE_URL` / stack com env | Handler global: `if (NODE_ENV==='production') hide stack` |
| Commit | `.env` gitignored; `gitleaks` bloqueia | `git check-ignore -v .env` → `.gitignore` |
| Analytics / Sentry | `beforeSend` scrub de `ENCRYPTION_KEY`, `SESSION_SECRET` | `sentry.client.config.ts` com `beforeSend` |

```ts
// logger.ts — redact
import pino from 'pino';
export const logger = pino({
  redact: {
    paths: ['password', 'passwordHash', 'token', 'apiKey', 'apiSecret', 'ENCRYPTION_KEY', 'SESSION_SECRET'],
    censor: '[REDACTED]',
  },
});
```
