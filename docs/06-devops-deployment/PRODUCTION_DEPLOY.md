

---

<!-- CANONICO-RAILWAY: 2026-11-04 -->

> ## ⚠️ LEIA PRIMEIRO — este documento é HISTÓRICO em partes
>
> **O host canônico de produção é o RAILWAY** (app + engine + Postgres), não o Fly.io.
> As seções 1–10 abaixo (marcadas HISTÓRICO) foram escritas em 2026-08/09 para Fly.io e
> NÃO refletem a realidade: `flyctl`, `fly secrets`, `fly postgres`, `auto-trader-prod.fly.dev`
> e o custo em Fly.io estão obsoletos. Use esta seção, `CI_CD_PIPELINE.md` e
> `docs/08-knowledge-management/round4-status.md` como referência.
>
> ### Estado real do deploy (2026-11-04)
>
> - **Deploy é MANUAL** hoje: o operador/Lead roda `railway up --service auto-trader
>   --environment production` e valida `GET /api/health/ready` (200).
> - **CD automático está PRONTO porém DESLIGADO**: o workflow
>   `.github/workflows/deploy-railway.yml` existe, tem gate
>   `if: vars.RAILWAY_DEPLOY_ENABLED == 'true'` e sanity step, mas o repositório
>   **não tem** o secret `RAILWAY_TOKEN` nem a variable `RAILWAY_DEPLOY_ENABLED` —
>   logo o job é pulado em todo push. Verifique com `node scripts/verify-cd-config.mjs`
>   (exit 1 = bloqueado).
> - **Por que não foi habilitado por automação:** a mutation `projectTokenCreate` da API
>   do Railway respondeu `Not Authorized` com o token OAuth do CLI (não pode mintar
>   project token). Criar o token é ação humana no dashboard.
>
> ### Habilitar o CD (operador — 3 passos)
>
> 1. Railway → Project **auto-trader** → Settings → Tokens → **Create Project Token**.
> 2. `gh secret set RAILWAY_TOKEN --body <token>` (ou Settings → Secrets → Actions).
> 3. `gh variable set RAILWAY_DEPLOY_ENABLED --body true` (ou a mesma tela, aba Variables).
>
> Opcionais: `RAILWAY_PROJECT_ID` (link do projeto no CLI) e `RAILWAY_PUBLIC_URL`
> (habilita o smoke de readiness pós-deploy).
>
> ### Rollback
>
> 1. **Railway → Deployments → deploy anterior → Redeploy** (mais rápido, sem git).
> 2. Ou `git revert <commit> && git push origin main` (o CD roda de novo no push).
> 3. Emergência/parada: `gh variable set RAILWAY_DEPLOY_ENABLED --body false` — o CD para
>    de rodar no próximo push; e Railway → Settings → desabilitar deploy automático.
> 4. Banco: ver `BACKUP_DR.md` (`scripts/backup-full.mjs` / `restore-full.mjs`).
>
> ### Migrations
>
> Schema agora é versionado (`prisma/migrations`, baseline + RLS). Aplicar com
> `prisma migrate deploy` no deploy (CI já aplica e tem gate de drift). Nunca
> `prisma db push` em banco com dados — ver seção "Migrações do banco" no fim.

## [Conteudo mesclado de DEPLOY.md — reorganizacao docs 2026-09-27]

# DEPLOY.md â€” Auto Trader Production Deployment (S27 T003)

> Last updated: 2026-08-30 (S27 T003 â€” Fly.io + Sentry + Stripe + Redis + observability stack)
> Audience: Operator (DevOps / SRE)
> Status: Production-ready. All required env vars listed. All 84/84 vitest pass.

---

## 1. Architecture ⚠️ HISTÓRICO (Fly.io — obsoleto, ver topo)

```
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚   Cloudflare CDN         â”‚
                    â”‚   - WAF + Bot Fight Mode  â”‚
                    â”‚   - Rate Limiting         â”‚
                    â”‚   - HSTS (preload)        â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                 â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚   Fly.io app (region:    â”‚
                    â”‚   gru or iad)            â”‚
                    â”‚   - 2x shared-cpu-1x     â”‚
                    â”‚   - 512 MB RAM            â”‚
                    â”‚   - auto-scaling 1-4      â”‚
                    â”‚   - Sentry SDK            â”‚
                    â”‚   - OTEL â†’ Datadog        â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                 â”‚
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â”‚                  â”‚                  â”‚
   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”
   â”‚ PostgreSQL     â”‚  â”‚ Redis         â”‚  â”‚ Stripe        â”‚
   â”‚ (Fly Postgres) â”‚  â”‚ (Fly Redis)   â”‚  â”‚ (webhooks)    â”‚
   â”‚ - pgvector ext  â”‚  â”‚ - rate limit  â”‚  â”‚ - HMAC verify  â”‚
   â”‚ - Position RLS â”‚  â”‚ - BullMQ queueâ”‚  â”‚ - idempotency  â”‚
   â”‚ - 7-day backup  â”‚  â”‚ - 256MB        â”‚  â”‚                â”‚
   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 2. Required Environment Variables ⚠️ HISTÓRICO (era Fly.io secrets; no Railway os secrets ficam no dashboard/CLI)

```bash
# === Core ===
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
NEXTAUTH_URL=https://your-domain.com

# === Sentry (S18 / S11) ===
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
NEXT_PUBLIC_SENTRY_DSN=$SENTRY_DSN

# === OTEL (S05) ===
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317

# === Redis (S06 / S28 BullMQ) ===
REDIS_URL=redis://default:password@host:6379

# === Stripe (S24) ===
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_ELITE=price_...

# === Feature Flags (S25 live_trading) ===
LIVE_TRADING_ENABLED=false
LIVE_TRADING_TESTNET=true
LIVE_TRADING_MAX_POSITION_USD=1000
```

Set via `fly secrets set KEY=value` (one at a time) or batch:

```bash
for k in DATABASE_URL SESSION_SECRET ENCRYPTION_KEY REDIS_URL SENTRY_DSN STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET; do
  echo "Enter $k:"
  read v
  fly secrets set "$k=$v"
done
```

---

## 3. Fly.io Setup ⚠️ HISTÓRICO (obsoleto: o host canônico é Railway)

```bash
# 1. Install flyctl
curl -L https://fly.io/install.sh | sh

# 2. Login
fly auth login

# 3. Create app
fly apps create auto-trader-prod

# 4. Attach Postgres (Fly Postgres 1GB dev plan ~$0/mo)
fly postgres create auto-trader-db --region gru --vm-size shared-cpu-1x --volume-size 1
fly postgres attach auto-trader-db --app auto-trader-prod
# Fly auto-sets DATABASE_URL

# 5. Attach Redis
fly redis create auto-trader-redis --region gru --vm-size shared-cpu-1x --memory-redis 256
fly redis attach auto-trader-redis --app auto-trader-prod
# Fly auto-sets REDIS_URL

# 6. Set secrets (see section 2)

# 7. Enable pgvector extension
fly postgres connect --app auto-trader-prod
# In psql:
# CREATE EXTENSION IF NOT EXISTS vector;
# \q

# 8. Run migrations
fly ssh console --app auto-trader-prod
# In container:
# npx prisma db push
# exit

# 9. Deploy
fly deploy --app auto-trader-prod

# 10. Verify
curl -fsS https://auto-trader-prod.fly.dev/api/health/live
# {"status":"live","timestamp":"..."}
curl -fsS https://auto-trader-prod.fly.dev/api/health/ready
# {"status":"ready","timestamp":"...","dbLatencyMs":5}
```

---

## 4. Cloudflare Setup

1. Add site to Cloudflare (free plan).
2. DNS:
   - `A` record `@` â†’ Fly.io app IP (`fly ips release`)
   - `CNAME` `www` â†’ `@`
3. SSL/TLS: Full (strict)
4. Edge Certificates: Universal, Always Use HTTPS
5. Security â†’ WAF Managed Rules: On (default)
6. Security â†’ Bots â†’ Bot Fight Mode: On
7. Security â†’ Rate Limiting Rules:
   - **Global**: 100 req / 10s per IP â€” Block 60s
   - **/api/auth/***: 10 req / 60s per IP â€” Block 600s
8. Security â†’ Settings â†’ HSTS: Enable, preload-ready

---

## 5. Post-Deploy Verification

```bash
# 1. Health
curl -fsS https://your-domain.com/api/health
curl -fsS https://your-domain.com/api/health/live
curl -fsS https://your-domain.com/api/health/ready

# 2. Login + session
COOKIE=$(curl -sS -i -X POST https://your-domain.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local","password":"Admin123!"}' | grep -i 'set-cookie' | sed 's/.*: //;s/;.*//')
echo "Cookie: $COOKIE"

# 3. RBAC check
curl -sS https://your-domain.com/api/users -H "Cookie: $COOKIE"
# Should return 3 users (admin/viewer/trader)

# 4. Rate limit check
for i in {1..6}; do
  curl -sS -o /dev/null -w "%{http_code} " https://your-domain.com/api/auth/login \
    -H 'Content-Type: application/json' -d '{}'
done
echo
# Should show 401, 401, 401, 401, 401, 429

# 5. k6 load (if installed)
k6 run --vus 1000 --duration 30s https://your-domain.com/api/health/live
# Should show p95 < 500ms

# 6. Stripe webhook
curl -sS -X POST https://your-domain.com/api/webhooks/stripe \
  -H 'stripe-signature: t=1234,v1=fake' \
  -H 'Content-Type: application/json' \
  -d '{"id":"evt_test","type":"customer.subscription.created"}'
# Should return 400 invalid_signature (no real signature)
```

---

## 6. Backup Strategy

- **PostgreSQL**: Fly.io daily automated backup (default in plan)
- **S3 export**: Add custom cron:
  ```bash
  fly ssh console --app auto-trader-prod -C "bash -c 'pg_dump \$DATABASE_URL | gzip > /tmp/db-\$(date +%F).sql.gz'"
  ```
- **Local scripts**: `scripts/backup-db.sh` + `scripts/verify-backup.sh` (S06)
- **Retention**: 30 days (Fly default), prune via:
  ```bash
  fly ssh console -C "bash -c 'find /tmp -name \"db-*.sql.gz\" -mtime +30 -delete'"
  ```

---

## 7. Monitoring & Alerts

| Alert | Condition | Channel |
|---|---|---|
| Errors 5xx > 1% in 5min | Fly metric `requests.error_ratio > 0.01` | Fly â†’ email + Sentry |
| Auth failures > 50 in 1min | Fly log filter `status=401` | Sentry â†’ Slack |
| PositionAlert critical | `Severity: critical` row in `PositionAlert` | Sentry â†’ Telegram |
| Subscription churn | Stripe webhook `customer.subscription.deleted` | Sentry â†’ email |
| Latency p95 > 500ms | k6 threshold in CI | GitHub PR comment |
| Disk > 80% | Fly volume metric | Fly email |

Set up Sentry alert rules: https://your-domain.sentry.io/alerts/rules/

---

## 8. Cost Estimate ⚠️ HISTÓRICO (custos de Fly.io; ver dashboard do Railway)

| Service | Plan | Cost |
|---|---|---|
| Fly.io app (2x shared-cpu-1x, 512MB) | Pay-as-you-go | ~$0-5/mo (free allowance covers most) |
| Fly Postgres 1GB | dev plan | $0/mo (then $4/mo for 10GB) |
| Fly Redis 256MB | dev plan | $0/mo (then $2/mo for larger) |
| Cloudflare | Free | $0/mo |
| Stripe | Pay-as-you-go | 2.9% + 30Â¢ per transaction |
| Sentry | Free (5K events/mo) | $0 up to 5K events, then $26/mo |
| Ollama (self-hosted) | n/a | $0 (runs on Fly app or external) |
| **Total** | | **$0-15/mo** at low volume |

---

## 9. Rollback Procedure ⚠️ HISTÓRICO (Fly.io releases; use o rollback do topo / Railway Deployments)

```bash
# 1. Check current deployment
fly status --app auto-trader-prod

# 2. List releases
fly releases --app auto-trader-prod

# 3. Rollback to previous
fly releases rollback --app auto-trader-prod

# 4. Verify
curl -fsS https://your-domain.com/api/health/live
```

For database rollback:
```bash
# Restore from pg_dump backup
gunzip < db-2026-08-30.sql.gz | fly postgres connect --app auto-trader-prod
# In psql: \i <(cat /dev/stdin)
```

---

## 10. Quick Reference

| Action | Command |
|---|---|
| View logs | `fly logs --app auto-trader-prod` |
| View metrics | `fly dashboard --app auto-trader-prod` |
| SSH into app | `fly ssh console --app auto-trader-prod` |
| Run migration | `fly ssh console -C "npx prisma db push"` |
| Backup DB | `scripts/backup-db.sh` |
| Verify backup | `scripts/verify-backup.sh` |
| Run load test | `k6 run scripts/load-test-k6.mjs` |
| Tail Sentry errors | https://your-domain.sentry.io/issues/ |
| Check CI | https://github.com/ENDARTStudios/Auto-Trader/actions |
| RBAC matrix | `tests/rbac-matrix.test.ts` (84/84 vitest pass) |
| Run all tests locally | `npx vitest run` (14 test files, 84 tests) |
| Apply feature flag | `db.featureFlag.upsert` for `key: "live_trading"` |

---

## Related Docs

- `docs/RBAC.md` â€” Role + permission matrix
- `docs/SECRETS.md` â€” Environment variable reference
- `docs/TLS_HSTS.md` â€” TLS/HSTS setup
- `docs/WAF_RATE_LIMIT.md` â€” WAF + rate limit configuration
- `docs/SECURITY_AUDIT.md` â€” Pre-deploy security checklist
- `docs/CRYPTO.md` â€” Cryptographic primitives (H0 frozen)
- `HARDENING-ROADMAP.md` â€” Security hardening plan (H0-H8)
- `SECURITY.md` â€” REG-001..REG-013 regression inventory



---

## [Conteudo mesclado de PRODUCTION_DEPLOY.md — reorganizacao docs 2026-09-27]

# PRODUCTION_DEPLOY â€” Deploy de ProduÃ§Ã£o

> **VersÃ£o:** 1.0 â€” 2026-09-23
> **Detalhe legado Fly.io:** [DEPLOY.md](./DEPLOY.md). TLS/borda: [TLS_HSTS.md](./TLS_HSTS.md). Runbook de incidente: [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md).

---

## 1. Forma do deploy

**Docker standalone** (engine in-process precisa de processo long-running â€” sem serverless):

```
npm run build            # next build + copy .next/static e public para .next/standalone
npm start                # NODE_ENV=production bun .next/standalone/server.js (tee server.log)
```

Dockerfile multi-stage (deps instala python3/make/g++ para node-gyp; copia `install-git-hooks.mjs` p/ postinstall â€” correÃ§Ãµes T050d/T050e). docker-compose sobe as dependÃªncias: pgvector + ollama.

## 2. PrÃ©-requisitos de produÃ§Ã£o

- [ ] **Linux** (DecisÃ£o #21 â€” Unix sockets do signer).
- [ ] DB de produÃ§Ã£o: Postgres pgvector (`docker-compose.yml`) + `npx prisma migrate deploy`.
- [ ] Env completa (`.env` fora do git): `SESSION_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, DSN Sentry, Stripe (se billing) â€” validadas em `src/lib/env.ts` ([SECRETS.md](./SECRETS.md)).
- [ ] Seeds executados 1Âª vez (`seed-auth`, `seed-flags`) e credenciais dev trocadas.
- [ ] Caddy na frente com TLS automÃ¡tico + headers ([TLS_HSTS.md](./TLS_HSTS.md), `Caddyfile`).
- [ ] Backups configurados e **restore testado** ([BACKUP_DR.md](./BACKUP_DR.md) Â§5) â€” obrigatÃ³rio antes de qualquer live.
- [ ] CI verde em `main` (release parte de commit testado â€” [QA_TESTING.md](./QA_TESTING.md)).

## 3. Passo a passo

```bash
# 1. Obter cÃ³digo no commit de release (tag)
git fetch && git switch --detach <tag/commit>

# 2. Build da imagem / app
npm ci && npm run build

# 3. Infra
docker compose up -d                      # db (pgvector) + ollama
npx prisma migrate deploy                 # migrations em prod

# 4. Subir app (systemd/supervisor/Docker Run â€” processo persistente)
NODE_ENV=production bun .next/standalone/server.js

# 5. Health gate
curl -fsS localhost:3000/api/health/ready
```

**Staging automÃ¡tico (quando ativado):** job `deploy-staging` no CI (`vars.STAGING_ENABLED=true` + `FLY_API_TOKEN` + `STAGING_URL`) â†’ `fly deploy --app auto-trader-staging` â†’ health gate `api/health/ready`.

## 4. PÃ³s-deploy (checklist operacional)

- [ ] `/api/health/ready` 200; login funciona; dashboard carrega painÃ©is.
- [ ] `state/mode.json` em `ok`; kill switches visÃ­veis no config.
- [ ] Sentry/OTel reportando ([MONITORING.md](./MONITORING.md)).
- [ ] 1 ciclo do engine observado sem erro em `logs/episodes.jsonl`.
- [ ] **Paper mode confirmado** â€” live sÃ³ via graduaÃ§Ã£o ([RULES.md](./RULES.md) Â§4).

## 5. Rollback

```bash
# 1. Voltar ao commit/tag anterior do app (processo persistente â†’ reinicia no anterior)
git switch --detach <tag-anterior> && npm ci && npm run build && restart app
# 2. Migrations: prisma migrate resolve / restore de DB se a migration quebrou (BACKUP_DR Â§4)
# 3. Validar: /api/health/ready + 1 ciclo do engine
# 4. Registrar: DECISOES.md + postmortem se houve impacto
```

Se dÃºvida de capital em risco: **kill switch manual primeiro**, rollback depois ([MANUAL_DO_OPERADOR.md](../MANUAL_DO_OPERADOR.md)).

---

**Relacionados:** [SETUP.md](./SETUP.md) Â· [BACKUP_DR.md](./BACKUP_DR.md) Â· [MONITORING.md](./MONITORING.md) Â· [PREVIEW_DEPLOYMENT.md](./PREVIEW_DEPLOYMENT.md)



---

## Migrações do banco (fonte única do schema) — 2026-11-03

O schema **não** é mais aplicado com `prisma db push` em produção nem no CI.

| Peça | Onde | Papel |
|---|---|---|
| Baseline Postgres | `prisma/migrations/20260101000000_baseline/migration.sql` | snapshot completo (34 modelos) gerado por `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`. É o início do histórico replayable |
| Lock de provider | `prisma/migrations/migration_lock.toml` | `provider = "postgresql"` (antes dizia `sqlite` → `prisma migrate deploy` falhava com **P3019**) |
| Migração legada | `prisma/legacy-sqlite-migrations/` | histórico SQLite (19 modelos, dialeto incompatível com Postgres). Arquivada, **não** está mais no replay |
| Gate de drift | CI (`ci.yml`) | `npx prisma migrate deploy` seguido de `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` |

### Fluxo por cenário

```bash
# 1. Mudou o schema.prisma (dev local) — gera migration versionada
npx prisma migrate dev --name descricao_da_mudanca

# 2. CI / deploy (aplica somente o que ainda não foi aplicado)
npx prisma migrate deploy

# 3. Banco POPULADO que nunca teve histórico de migrations (bootstrap do Railway)
node scripts/db-migrate-safe.mjs --dry-run   # imprime o plano, não escreve
node scripts/db-migrate-safe.mjs             # executa
```

`scripts/db-migrate-safe.mjs` decide entre quatro caminhos, sem chutar:

1. banco **vazio** → `migrate deploy`;
2. banco já migrado → no-op;
3. banco populado, **sem drift** em relação a `schema.prisma` e sem histórico →
   `prisma migrate resolve --applied 20260101000000_baseline` + `migrate deploy`;
4. banco populado **com drift** → **aborta** e exige correção humana (baselinear um
   banco divergente esconderia drift).

> `prisma db push` continua existindo só para bancos locais descartáveis. Em banco
> com dados ele pode remover colunas/tabelas silenciosamente.
