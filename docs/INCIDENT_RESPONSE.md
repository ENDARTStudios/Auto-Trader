# INCIDENT_RESPONSE.md — Plano de Resposta a Incidentes — Auto Trader

> Last updated: 2026-09-03 (Fase 9.8 — S32 Etapa 3)
> Owner: END ART Studios — endart.studios@gmail.com — https://t.me/AutoTrader2027
> Status: Ativo. Revisar a cada sprint ou após cada incidente real.
> Referências: `docs/DEPLOY.md:7`, `docs/ERROR_REPORTING.md:1`, `docs/OBSERVABILITY.md:1`, `src/lib/observability/sentry.ts:1`, `src/lib/crash-logger.ts:1`, `SECURITY.md:1` REG-001..014

---

## 1. Classificação de severidade

| Sev | Label | Exemplo | SLO resposta |
|-----|-------|---------|--------------|
| **SEV1** | Crítico | Vazamento de secrets, RLS bypass, perda de fundos live, DB corrompido, Kill Switch falhou | 15 min |
| **SEV2** | Alto | Rate-limit bypass, auth 5xx >1% em 5min, Stripe webhook sem HMAC, ETL sem dados >6h | 1 h |
| **SEV3** | Médio | k6 p95 >500ms, Ollama RAG sem citações, Sentry 4xx spike | 4 h |
| **SEV4** | Baixo | Docs desatualizados, Lighthouse <90, Trivy warn | Próximo sprint |

---

## 2. Canais e contatos

| Papel | Contato | Canal |
|-------|---------|-------|
| Operador / On-call | endart.studios@gmail.com | Telegram https://t.me/AutoTrader2027 + Fly.io alerts email |
| Dev (this repo) | `AGENT_GUIDE.md:1` | GitHub Issues `security_report.yml:1` |
| Status público | — | `GET /api/health/live` + UptimeRobot free (`docs/DEPLOY.md:9.5.4`) |

Regra: **nunca** discutir secrets, private keys ou `ENCRYPTION_KEY` em canal não criptografado. Usar Fly.io secrets (`fly secrets set`) e 1Password/Infisical.

---

## 3. Detecção (onde o alerta nasce)

| Sinal | Fonte | Threshold | Ação automática |
|-------|-------|-----------|-----------------|
| 5xx >1% em 5min | Sentry `sentry.server.config.ts:1` + Fly metrics `docs/DEPLOY.md:7` | `requests.error_ratio >0.01` | Sentry alert → Telegram |
| Auth falhas >50/min | `src/lib/rate-limit.ts:1` bucket `auth:5/60s` + OTEL `metrics.ts:1` | 50 | Rate-limit 429 + Sentry |
| PositionAlert critical | `src/lib/trading/position-surveillance.ts:1` | `severity=critical` | `PositionAlert` + Sentry → Telegram |
| DB down / latency | `src/app/api/health/ready:1` `dbLatencyMs` + `docker-compose.yml:1` pgvector healthcheck | `>500ms` ou `pg_isready` fail | Fly restart + Pager |
| k6 p95 >500ms | `scripts/load-test-k6.mjs:1` CI | p95 | CI gate fail, não mergear |
| ETL staleness | `src/lib/etl/run.ts:1` `DataSource` timestamp | >6h | Cron alert + `sentry:sentry.ts:1` |

Health checks manuais:

```bash
curl -fsS https://your-domain.com/api/health/live   # {"status":"live"}
curl -fsS https://your-domain.com/api/health/ready  # {"dbLatencyMs":5}
fly logs --app auto-trader-prod --region gru
npx vitest run --reporter=dot
```

---

## 4. Runbook por cenário

### 4.1 Vazamento de secrets / `ENCRYPTION_KEY` / `SESSION_SECRET`

1. **Conter**: `fly secrets set ENCRYPTION_KEY=$(openssl rand -hex 32)` + `SESSION_SECRET=$(openssl rand -hex 32)` (invalida sessões). Revogar `SENTRY_DSN`, `STRIPE_WEBHOOK_SECRET`, `REDIS_URL`.
2. **Rotacionar**: `src/lib/trading/kdf.ts:1` KDF versioning — incrementar `KDF_VERSION` e re-criptografar `privateKeyEncrypted`/`mfaSecret` (`src/lib/trading/key-rotation.ts:1`).
3. **Auditar**: `SELECT * FROM AuditLog WHERE action LIKE '%auth%' ORDER BY seq DESC LIMIT 100;` (`src/lib/auth/audit.ts:1` hash-chain).
4. **Comunicar**: SEV1 — Telegram + email em 15min, sem detalhar secrets.
5. **Prevenir**: mover para Vault/Infisical (`PLANO_MESTRE.md:7.9`).

### 4.2 Bypass RLS / acesso a `Position` de outro `ownerId`

1. **Conter**: `POST /api/kill-switch` `{"active":true}` — congela engine (`src/app/api/kill-switch/route.ts:1`).
2. **Verificar**: `tests/position-rls.test.ts:1` + `npx vitest run tests/position-rls.test.ts` deve falhar se bypass.
3. **Auditar**: `AuditLog` `action=position:read/write` + `RLS.md:1` `ownerId` check.
4. **Corrigir**: revisar `src/lib/auth/rls.ts:1` `enforceRlsPosition`.
5. **Postmortem**: REG em `SECURITY.md:1`.

### 4.3 Live trading perda / `Kill Switch` não para

1. `POST /api/kill-switch` manual + `fly ssh console -C "pkill -f node"` se travado.
2. Verificar `src/lib/chain/broadcaster.ts:1` + `writer-lease.ts:1` fencing token.
3. Logs síncronos: `logs/crash-*.log` (`src/lib/crash-logger.ts:1` + `src/instrumentation.ts:1`).
4. SEV1 — reembolsável apenas se Stripe/chain evidência.

### 4.4 DB corrompido / `pgvector` down

1. `fly postgres restart --app auto-trader-db`
2. `fly postgres connect -C "SELECT 1"` + `docker compose exec db pg_isready -U autotrader`
3. Restore: `gunzip < db-YYYY-MM-DD.sql.gz | psql $DATABASE_URL` (`scripts/backup-db.sh:1`, `docs/DEPLOY.md:6` retenção 30d).
4. `npx prisma migrate deploy` + `npx prisma db push`.
5. Verificar `prisma/seed.ts:1` admin.

### 4.5 Stripe webhook sem assinatura

1. Rejeitar: `src/app/api/webhooks/stripe/route.ts:1` HMAC `stripe-signature` já retorna 400 `invalid_signature` (`tests/billing-webhook.test.ts:1`).
2. Rotacionar `STRIPE_WEBHOOK_SECRET` via Stripe dashboard + `fly secrets set`.
3. Auditar `PaymentEvent` idempotência.

---

## 5. Fluxo padrão (6 fases)

```
Detect → Triage (Sev) → Contain (kill-switch/rate-limit/secrets) → Eradicate (fix + tests) → Recover (deploy + health/ready + k6) → Lessons (postmortem + REG + PLANO_MESTRE update)
```

Checklist de contain (sempre):

- [ ] Kill switch se envolve fundos/RLS: `curl -X POST https://your-domain.com/api/kill-switch -H "Content-Type: application/json" -d '{"active":true,"reason":"INC-YYYY-MM-DD"}' -H "Cookie: $ADMIN_COOKIE"`
- [ ] Rate-limit se envolve brute-force: verificar `middleware.ts:1` + `proxy-trust.ts:1`
- [ ] Secrets se envolve vazamento: `fly secrets list` + rotação
- [ ] Snapshot forense: `fly logs --app auto-trader-prod > logs/inc-YYYY-MM-DD.log` + `logs/crash-*.log`

---

## 6. Postmortem (24h após SEV1/2)

Template em `docs/ERROR_REPORTING.md:1`:

- Timeline (UTC), impacto (users/funds), causa raiz, detecção, contenção, correção, testes de regressão (`SECURITY.md` REG-NNN), ações preventivas, owner + data.

Commit: `docs: postmortem INC-YYYY-MM-DD (SEV2 auth rate-limit)` + atualizar `PLANO_MESTRE.md:8.8` REG.

---

## 7. Prevenção (gates que impedem reincidência)

| Gate | Onde | Quebra CI se |
|------|------|--------------|
| `npx eslint .` | `eslint.config.mjs:1` + `hooks/set-state-in-effect` | 0 errors (Etapa 1 `c76b702`) |
| `npm audit --audit-level=high` | `package.json:1` sharp `0.35.4` (`27877b7`) | high/critical |
| `npx vitest run` | `vitest.config.ts:1` 91/91 | <91 |
| `npx next build` | 44 rotas | fail |
| CodeQL | `.github/workflows/ci.yml:45` | high |
| k6 p95 | `scripts/load-test-k6.mjs:1` | >500ms |
| Trivy | `docs/DEPLOY.md:9.1.5` Fase 9.1.5 | high/critical imagem |

---

## 8. Contatos externos

- Fly.io status: https://status.fly.io
- Cloudflare: Security → Events, Rate Limiting → Events
- Stripe: Dashboard → Developers → Webhooks → Attempts + Logs
- Sentry: `sentry.server.config.ts:1` Issues → Alert rules
