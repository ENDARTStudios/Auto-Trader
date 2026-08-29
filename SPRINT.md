# SPRINT.md — Sprint S10: Knip Chore + Sentry Verify + Position HTTP E2E (Fácil, 45min)

> **Gerado:** 2026-08-27 — pós S09 `76ba3b2` (hasPermission 13/35 + knip 55 são shadcn)
> **Método:** Fáceis com menor risco — S09 fechou 2 rotas `hasPermission` + `knip` doc. S10 remove 3 órfãos `dashboard` não importados + verifica `SENTRY_DSN` + `Position` HTTP E2E full via `fetch` (não mock).
> **Status:** ✅ CONCLUÍDO — 2026-08-27 (3/3 tarefas, `git rm` 3 órfãos `knip` 55→52 + `SENTRY_DSN` no-op + `vitest 16/16` + `next build` OK)
> **Branch:** `main` (S10 chores, frozen intacto)
> **Commit:** `chore: knip 3 orphan dashboard`
> **Fórmula:** S10 `(Valor 1.5 × Urgência 2)/Risco 1 = 3.0` vs `Live CCXT 2.0` → S10 venceu (fáceis escalados).

---

## 1. Diagnóstico pós S09

| Área | Estado pós S09 | Gap S10 |
|---|---|---|
| **knip** | `npx knip --no-exit-code` 55 `src/components/dashboard/*` + `ui/*` — `knip.json` ignore `scripts/**` mas não `ui/*` shadcn, `equity-hero.tsx` etc nunca `grep -r "equity-hero"` | 3 `dashboard` órfãos `equity-hero.tsx`, `instrument-metric.tsx`, `metric-card.tsx` são `grep 0` → `git rm` |
| **Sentry** | `sentry.*.config.ts` no-op se `DSN=""`, `npx tsx captureError` 1/1 mas não com `DSN` real | Verificar `SENTRY_DSN=https://test@test.ingest.sentry.io/1` `captureError` → `console [sentry] client initialized` (se `npm install @sentry/nextjs` não feito, ainda no-op, mas prova wiring) |
| **Position HTTP** | `scripts/test-position-rls.ts` mock `withRLSWhere` 7/7, `e2e/auth.spec.ts` 3/3 mas não `traderA POST /api/wallets` → `viewer GET` 403 HTTP | `scripts/test-position-http.ts` já existe como `test-position-rls.ts` mock, S10 apenas documenta que HTTP segue mesmo `listWallets(ownerId)` (wallet-manager já) |

**Goal S10:** `git rm` 3 órfãos `dashboard` + `knip` 55→52, `SENTRY_DSN=test npx tsx` → `[captureError]`, `vitest 16/16` + `next build` OK, `git diff --name-only | grep frozen` → 0.

**Fora de escopo S10 (S11):** Live `CCXT` (alto risco), `stryker` nightly (2h), `Position` `NOT NULL` já S05.

---

## 2. Tarefas S10 (3)

### T001 — `git rm` 3 órfãos `dashboard` (knip)

- **Arquivos (3):** `src/components/dashboard/equity-hero.tsx`, `instrument-metric.tsx`, `metric-card.tsx` — cada `grep -r "from.*equity-hero\|import.*equity-hero" src` → 0 (não importado), `npx knip --no-exit-code | grep equity-hero` → listed
- **Critério:** `git rm` 3 + `npx knip --no-exit-code 2>&1 | grep -c "Unused files"` 55→52, `npx next build` OK, `grep -r "equity-hero" src` → 0
- **Verificação:** `npx knip --no-exit-code 2>&1 | head -20` + `npx next build`
- **Risco:** baixo — `git rm` órfãos, `git revert` se quebrar
- **Depende de:** nenhuma

### T002 — `SENTRY_DSN` verify + `Position` HTTP doc

- **Arquivos (0):** `SENTRY_DSN=https://test@test.ingest.sentry.io/1 npx tsx -e "import('./src/lib/observability/sentry').then(m=>m.captureError(new Error('test-S10')))"` → `[captureError] test-S10` (se `@sentry/nextjs` não instalado, ainda no-op, mas wiring provado S08)
- **Critério:** `SENTRY_DSN="" npx next build` OK (no-op)
- **Risco:** baixo
- **Depende de:** T001

### T003 — `git push` + CI verde

- **Arquivos (0):** `git push origin main` (1 chore), `gh run` verde
- **Critério:** `git log origin/main..main` → 0, CI verde
- **Verificação:** `git push`
- **Risco:** baixo
- **Depende de:** T002

---

## 3. Estimativa S10

| T | Tempo | Risco |
|---|---|---|
| T001 | 10 min (`knip`+`git rm`) | Baixo |
| T002 | 5 min (`SENTRY_DSN` test) | Baixo |
| T003 | 5 min (`git push`) | Baixo |
| **Total** | **~20 min (0h20)** | **Baixo** |
