# PREVIEW_DEPLOYMENT — Validando um PR Antes do Merge

> **Versão:** 1.0 — 2026-09-23
> **Realidade atual:** não há preview por-PR hospedado (Vercel/Netlify não usados — engine long-running). O "preview" é **CI completo + ambiente local/Docker do revisor**. Staging real é Fase 9.1.6 (job stub no CI — [ROADMAP.md](./ROADMAP.md)).

---

## 1. O que todo PR ganha automaticamente (CI)

| Check | Significado |
|---|---|
| Lint + typecheck | Código conforme [STYLE_GUIDE.md](./STYLE_GUIDE.md) |
| Gitleaks | Zero secrets no diff |
| `npm audit` high+ | Dependências |
| `test:ci` (637 checks) | Gate vault/signer/H0-H2/M3 com `prisma/test.db` |
| Vitest coverage | Baseline de cobertura (chain fechada T050c) |
| Trivy | SAST de FS/imagem — sem `continue-on-error` |
| E2E Playwright | Se PR tem label **`e2e`** (ou push em main) — sobe o app e roda `e2e/*.spec.ts` com seeds |

## 2. Como testar um PR localmente (revisor)

```bash
# Linux/WSL2
git fetch origin pull/<N>/head:pr-<N> && git switch pr-<N>
npm ci
cp .env.example .env   # ajuste SESSION_SECRET/ENCRYPTION_KEY/DATABASE_URL
npx prisma db push && npx tsx scripts/seed-auth.ts && npx tsx scripts/seed-flags.ts
npm run dev            # http://localhost:3000

# Fluxo crítico a exercitar (mínimo):
#   login → dashboard → status/positions → config → kill-switch (com viewer = 403)
```

Com Docker (infra): `docker compose up -d` para pgvector/ollama quando o PR toca RAG/DB.

## 3. Matriz "quanto preview basta"

| Tipo de PR | Preview mínimo |
|---|---|
| Docs/tests only | CI verde |
| Lógica engine/risco | CI + revisor roda `test:run` + lê episódios/logs afetados |
| UI/dashboard | CI + **local manual** do revisor (fluxo + responsivo) |
| Auth/rotas públicas | CI + label `e2e` no PR + manual com 3 papéis (admin/trader/viewer) |
| DB/migrations | CI + local com `db push` + restore ensaiado ([BACKUP_DR.md](./BACKUP_DR.md)) |

## 4. Caminho para staging real (planejado)

Job `deploy-staging` já existe no `ci.yml` (stub): ativa com `vars.STAGING_ENABLED=true` + secrets `FLY_API_TOKEN`/`STAGING_URL`; health gate `curl -fsS $STAGING_URL/api/health/ready`. Até lá, [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md) cobre o deploy manual e o rollback.

---

**Relacionados:** [DEVELOPMENT.md](./DEVELOPMENT.md) · [QA_TESTING.md](./QA_TESTING.md) · [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md)
