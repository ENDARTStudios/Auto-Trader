# PRODUCTION_DEPLOY — Deploy de Produção

> **Versão:** 1.0 — 2026-09-23
> **Detalhe legado Fly.io:** [DEPLOY.md](./DEPLOY.md). TLS/borda: [TLS_HSTS.md](./TLS_HSTS.md). Runbook de incidente: [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md).

---

## 1. Forma do deploy

**Docker standalone** (engine in-process precisa de processo long-running — sem serverless):

```
npm run build            # next build + copy .next/static e public para .next/standalone
npm start                # NODE_ENV=production bun .next/standalone/server.js (tee server.log)
```

Dockerfile multi-stage (deps instala python3/make/g++ para node-gyp; copia `install-git-hooks.mjs` p/ postinstall — correções T050d/T050e). docker-compose sobe as dependências: pgvector + ollama.

## 2. Pré-requisitos de produção

- [ ] **Linux** (Decisão #21 — Unix sockets do signer).
- [ ] DB de produção: Postgres pgvector (`docker-compose.yml`) + `npx prisma migrate deploy`.
- [ ] Env completa (`.env` fora do git): `SESSION_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, DSN Sentry, Stripe (se billing) — validadas em `src/lib/env.ts` ([SECRETS.md](./SECRETS.md)).
- [ ] Seeds executados 1ª vez (`seed-auth`, `seed-flags`) e credenciais dev trocadas.
- [ ] Caddy na frente com TLS automático + headers ([TLS_HSTS.md](./TLS_HSTS.md), `Caddyfile`).
- [ ] Backups configurados e **restore testado** ([BACKUP_DR.md](./BACKUP_DR.md) §5) — obrigatório antes de qualquer live.
- [ ] CI verde em `main` (release parte de commit testado — [QA_TESTING.md](./QA_TESTING.md)).

## 3. Passo a passo

```bash
# 1. Obter código no commit de release (tag)
git fetch && git switch --detach <tag/commit>

# 2. Build da imagem / app
npm ci && npm run build

# 3. Infra
docker compose up -d                      # db (pgvector) + ollama
npx prisma migrate deploy                 # migrations em prod

# 4. Subir app (systemd/supervisor/Docker Run — processo persistente)
NODE_ENV=production bun .next/standalone/server.js

# 5. Health gate
curl -fsS localhost:3000/api/health/ready
```

**Staging automático (quando ativado):** job `deploy-staging` no CI (`vars.STAGING_ENABLED=true` + `FLY_API_TOKEN` + `STAGING_URL`) → `fly deploy --app auto-trader-staging` → health gate `api/health/ready`.

## 4. Pós-deploy (checklist operacional)

- [ ] `/api/health/ready` 200; login funciona; dashboard carrega painéis.
- [ ] `state/mode.json` em `ok`; kill switches visíveis no config.
- [ ] Sentry/OTel reportando ([MONITORING.md](./MONITORING.md)).
- [ ] 1 ciclo do engine observado sem erro em `logs/episodes.jsonl`.
- [ ] **Paper mode confirmado** — live só via graduação ([RULES.md](./RULES.md) §4).

## 5. Rollback

```bash
# 1. Voltar ao commit/tag anterior do app (processo persistente → reinicia no anterior)
git switch --detach <tag-anterior> && npm ci && npm run build && restart app
# 2. Migrations: prisma migrate resolve / restore de DB se a migration quebrou (BACKUP_DR §4)
# 3. Validar: /api/health/ready + 1 ciclo do engine
# 4. Registrar: DECISOES.md + postmortem se houve impacto
```

Se dúvida de capital em risco: **kill switch manual primeiro**, rollback depois ([MANUAL_DO_OPERADOR.md](../MANUAL_DO_OPERADOR.md)).

---

**Relacionados:** [SETUP.md](./SETUP.md) · [BACKUP_DR.md](./BACKUP_DR.md) · [MONITORING.md](./MONITORING.md) · [PREVIEW_DEPLOYMENT.md](./PREVIEW_DEPLOYMENT.md)
