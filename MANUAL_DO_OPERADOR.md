# MANUAL_DO_OPERADOR.md — Auto Trader — Guia do Operador

> Last updated: 2026-09-03 (Fase 9.9 — S32 Etapa 3)
> Público: Operador (você, dono da instância). Não requer conhecimento de código, mas exige terminal.
> Pré-requisitos: `git`, `node 20`, `bun` (opcional), `docker` + `docker compose`, `flyctl` (se deploy externo), `.env` a partir de `.env.example:1`
> Referências: `PLANO_MESTRE.md:1` Fases 0-9, `docs/DEPLOY.md:1`, `docs/ARCHITECTURE.md:1`, `docs/SECRETS.md:1`, `src/lib/env.ts:1` Zod

---

## 1. Visão em 30s

Auto Trader é um sistema autônomo de **paper trading** de criptomoedas com detecção multicamada de scams, circuit breakers e divisão 50/50 de lucro. Modo padrão é **paper** (simulação, sem capital real). Modo **live** só libera após 50 ciclos paper lucrativos (graduação) + feature flag `live_trading` OFF por padrão (`src/lib/feature-flags/live-trading.ts:1`). Stack: Next.js 16 + Prisma + SQLite (dev) / PostgreSQL+pgvector (prod) + Ollama `nomic-embed-text` + Redis (opcional, `REDIS_URL`).

---

## 2. Instalação local (5 min)

```bash
git clone <repo> && cd "Auto Trader"
cp .env.example .env
# Edite .env: gere segredos (nunca commitar)
node -e "console.log('base64:'+require('crypto').randomBytes(32).toString('base64'))" # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"          # SESSION_SECRET
# Opcional: SENTRY_DSN, REDIS_URL, ETHERSCAN_API_KEY, GOOGLE_SAFE_BROWSING_KEY

npm ci
npx prisma migrate deploy  # SQLite dev.db (ou postgres se DATABASE_URL=postgresql://)
npx prisma db seed         # cria admin@local/Admin123! + viewer/trader (prisma/seed.ts:1)
npm run dev                # next dev :3000 (Turbopack)
# ou docker: docker compose up -d  (db: pgvector/pg16 :5432 + ollama :11434)  docker-compose.yml:1
#            npx prisma migrate deploy  (contra postgres)
#            docker compose exec ollama ollama pull nomic-embed-text
```

Abra http://localhost:3000 → Login `admin@local` / `Admin123!` (`src/app/login/page.tsx:1`).

Verifique gates:

```bash
npx eslint .                    # deve ser 0 errors (c76b702)
npm audit --audit-level=high    # 0 high (deepmerge-ts/effect via override prisma; mdxeditor/rsh removidos — mortos); 3 moderate vitest (S34)
npx vitest run --coverage      # thresholds baseline 15/55/70 (ratchet com T050c; 80% aspiracional)
npx next build                  # 44 rotas, proxy middleware
bunx graft check                # wiring 2533 nodes OK (graft/ é cache local, não commitar)
```

---

## 3. Operação diária

| Ação | Comando / Caminho |
|------|-------------------|
| Iniciar/parar engine | Dashboard → WorkspaceHeader Start/Stop ou `POST /api/engine/start` + `/stop` |
| Kill switch (emergência) | `POST /api/kill-switch {"active":true,"reason":"manual"}` ou botão Kill no header (`src/app/api/kill-switch/route.ts:1`) — **imutável, exige confirmação** |
| Reserva (único saque) | Dashboard → Controls → Reserve Withdraw (`POST /api/reserve {"action":"withdraw","amountUsd":10}`) |
| Config da engine | Dashboard → ConfigEditor (`GET/POST /api/config`) — `takeProfitPct`, `stopLossPct`, `maxDrawdownPct`, `cexSymbols`/`dexChains`, `paperCyclesRequired` |
| Agenda de trading | Dashboard → SystemPanel Schedule (`GET/POST /api/schedule`) — `enabled`, `daysOfWeek`, `startTime`/`endTime`, `timezone`, `forceCloseAtEnd`; status `within`/`reason` |
| Posições abertas | `GET /api/positions` (RLS `ownerId`, cursor pagination) |
| Scam reports | `GET /api/scam-reports` (GoPlus `src/lib/etl/goplus.ts:1`) |
| Logs | `GET /api/logs?limit=80` + `src/lib/crash-logger.ts:1` `logs/crash-*.log` (síncrono, sobrevive a crash) |
| Saúde | `GET /api/health` / `live` / `ready` (`src/app/api/health/*`) — `health:live` sem DB, `ready` checa `pg_isready`/`dbLatencyMs` |

Tradução: header `LanguageSelector` (`src/components/language-selector.tsx:1`, `src/lib/i18n/*:1`) — `pt-BR` (default), `en-US`, `es-ES`; cookie `locale` 1 ano (`src/components/actions.ts:1`).

---

## 4. Backup e restore

Scripts `S06`:

```bash
bash scripts/backup-db.sh              # SQLite: cria db/backup-YYYY-MM-DD.sql.gz
bash scripts/verify-backup.sh db/backup-YYYY-MM-DD.sql.gz
# Postgres prod: pg_dump $DATABASE_URL | gzip > /tmp/db-$(date +%F).sql.gz  (docs/DEPLOY.md:6 retenção 30d)
# Restore SQLite: bash scripts/restore-db.sh db/backup-YYYY-MM-DD.sql.gz
# Restore Postgres: gunzip < /tmp/db-YYYY-MM-DD.sql.gz | psql $DATABASE_URL
npx prisma migrate deploy
```

Agende cron diário (exemplo `0 3 * * * bash /path/scripts/backup-db.sh`).

---

## 5. Observabilidade

- **Sentry**: `sentry.client.config.ts:1` + `sentry.server.config.ts:1` (`SENTRY_DSN`). `src/lib/observability/sentry.ts:1` `captureError`/`captureMessage`.
- **OTEL**: `OTEL_EXPORTER_OTLP_ENDPOINT` → `src/lib/observability/otel.ts:1` + `exporter.ts:1` + `metrics.ts:1` (`/api/metrics` exige `system:read`, `docs/OBSERVABILITY.md:1`).
- **Crash logger**: `src/instrumentation.ts:1` registra `uncaughtException`/`unhandledRejection` em `logs/crash-*.log` + `logs/boot.log`. Em caso de "server morreu silenciosamente", rodar `bash scripts/diag-oom-check.sh` (dmesg/journalctl) + `bash scripts/smoke-test-production.sh` (`next build && next start`, não `next dev`).
- **Alertas**: `docs/DEPLOY.md:7` — 5xx >1% 5min, auth >50/min, PositionAlert critical, latency p95 >500ms (k6 `scripts/load-test-k6.mjs:1`).

---

## 6. Segurança — o que nunca fazer

- Nunca commitar `.env` (`.gitignore:48` `.env*` exceto `.env.example`). `.env.example:1` só placeholders `SUA_CHAVE_AQUI`.
- Nunca expor `mfaSecret`, `privateKeyEncrypted`, `tokenHash` (`docs/RLS.md:1`, `src/lib/auth/rls.ts:1` sanitiza).
- Sempre `ENCRYPTION_KEY` base64 32 bytes + `SESSION_SECRET` ≥32 chars (`src/lib/env.ts:1` Zod).
- Sempre `bcrypt` cost 12 (`src/lib/auth/password.ts:1`), AES-256-GCM KDF versioning (`src/lib/trading/wallet-crypto.ts:1`, `kdf.ts:1`).
- Sempre HMAC Stripe webhook (`src/app/api/webhooks/stripe/route.ts:1`, `tests/billing-webhook.test.ts:1`).
- Auditoria: `AuditLog` hash-chain (`src/lib/auth/audit.ts:1`, `SECURITY.md:1` REG-014).

---

## 7. Deploy externo (Fly.io) — resumo

Ver `docs/DEPLOY.md:3` completo. Resumo:

```bash
fly auth login
fly apps create auto-trader-prod
fly postgres create auto-trader-db --region gru --vm-size shared-cpu-1x --volume-size 1
fly postgres attach auto-trader-db --app auto-trader-prod
fly redis create auto-trader-redis --region gru
fly redis attach auto-trader-redis --app auto-trader-prod
fly secrets set DATABASE_URL=... SESSION_SECRET=... ENCRYPTION_KEY=... REDIS_URL=... SENTRY_DSN=...
fly postgres connect --app auto-trader-prod -C "CREATE EXTENSION IF NOT EXISTS vector;"
fly deploy
curl -fsS https://your-domain.com/api/health/live
```

Cloudflare WAF/HSTS: `docs/TLS_HSTS.md:1` + `docs/WAF_RATE_LIMIT.md:1` + `docs/DEPLOY.md:4`.

Rollback: `fly releases rollback --app auto-trader-prod` + restore pg_dump (`docs/DEPLOY.md:9`).

---

## 8. Kill switch, graduação e live trading

- **Graduação**: `src/lib/trading/graduation.ts:1` — `paperCyclesRequired` 50, `paperCyclesPassed` contador, `graduatedToLive` flag. Live só após 50 ciclos paper lucrativos + `graduatedToLive=true`.
- **Feature flag**: `FeatureFlag` `key:live_trading` (`prisma/schema.prisma:60`, `src/lib/feature-flags/live-trading.ts:1`) — default `false` (`scripts/seed-flags.ts:1`). Habilitar live exige operador: `npx tsx scripts/seed-flags.ts --enable-live` ou `db.featureFlag.update({where:{key:"live_trading"}, data:{enabled:true}})`.
- **S14 live**: `src/lib/chain/*` (broadcaster, leased-broadcaster, pipeline, rpc-resilience, simulation-gate, mev-baseline, approval-hardening) está **FROZEN** (`AGENT_GUIDE.md:1`). S14 testnet (`ccxt` + `ethers` Uniswap V3 `ETH/SEPOLIA`) é `ORCAMENTO_ESTOURADO` — requer `BINANCE_TESTNET_API_KEY`, `ALCHEMY_RPC_URL`, `ETH_SEPOLIA_PRIVATE_KEY` + aprovação. Até lá, use `dry-run` (`scripts/test-m5-dry-run.ts:1`, `tests/live-trader.test.ts:1` 9 tests).

---

## 9. Troubleshooting

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| `401` em `/api/users` | Cookie `session` expirou (7d) ou `SESSION_SECRET` mudou | Login novamente; verificar `src/lib/auth/session.ts:15` `hashToken` |
| `429` em `/api/auth/login` | Bucket `auth:5/60s` excedido | Aguardar `Retry-After` ou `REDIS_URL` down (fallback Map) |
| `X-CSRF-Token` missing | Cookie `csrf` não enviado | Verificar `middleware.ts:1` `csrf` `SameSite=Lax` + header `x-csrf-token` |
| ETL sem dados | APIs CoinGecko/DexScreener/GoPlus/Etherscan sem `*_API_KEY` | `src/lib/etl/run.ts:1` roda com dados mock se chaves ausentes; `npm run job:etl:run` |
| RAG sem citações | `pgvector` ou `ollama` down | `docker compose up db ollama` + `ollama pull nomic-embed-text` (`docker-compose.yml:1`) |
| `graft check: STALE` | Código mudou sem `graft build` | `bunx graft build` (2533 nodes) |
| `npx eslint .` com erros | Hooks ou require | Ver `eslint.config.mjs:46` ignores + Etapa 1 `c76b702` |

---

## 10. Checklist de entrega (Definition of Done por marco)

| Marco | Requisito | Evidência |
|-------|-----------|-----------|
| Beta fechada (100 users) | Paper lucrativo + login + RBAC + RLS + i18n | Fases 0-5 `[x]`, `vitest 91/91`, `next build 44 rotas`, `PLANO_MESTRE.md:5` |
| Open Beta (1k) | + graduação live + billing Stripe + observabilidade | Fases 0-8 `[x]` parcial, `ci.yml:1`, `Sentry/OTEL` |
| v1.0 | + RAG citações + ETL auto + DAST + hardening | Todas fases, `INCIDENT_RESPONSE.md:1`, este manual |

---

## 11. Contatos

- Código: `AGENT_GUIDE.md:1` (PROTOCOLO_MESTRE.md Seção 9)
- Secrets: `docs/SECRETS.md:1`
- Arquitetura: `docs/ARCHITECTURE.md:1` (DAG 35 rotas)
- Incidentes: `docs/INCIDENT_RESPONSE.md:1`
