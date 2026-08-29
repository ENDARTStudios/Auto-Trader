# SPRINT.md — Sprint S11: Option A — Knip Doc + Sentry Verify + CI Green (Fácil, 20min)

> **Gerado:** 2026-08-27 — pós S10 `9cf21b0` (knip 55→52 + Sentry no-op + Position 7/7)
> **Método:** Opção A (fácil com menor risco) — `knip` 52 são `src/components/ui/*` `shadcn` primitives (`accordion`, `alert-dialog` etc) não usados mas não `dead` (são `ui` kit, `knip.json` já `ignore` `scripts/**`); `SENTRY_DSN` wiring já `sentry.*.config.ts` no-op se `DSN=""`; `git push` já `7ef18fa..9cf21b0` `origin/main` com `ci.yml` `quality` warn.
> **Status:** 🚧 EM ANDAMENTO — T001 iniciado
> **Branch:** `main` (S11 docs, sem tocar frozen, sem `git rm`)
> **Fórmula:** S11 `(Valor 1 × Urgência 2)/Risco 1 = 2.0` vs `Live CCXT 2.0` → S11 vence (fácil, 20min).

---

## 1. Diagnóstico pós S10

| Área | Estado pós S10 | Gap S11 |
|---|---|---|
| **knip** | `npx knip --no-exit-code` 52 `src/components/ui/*` + `dashboard` 3 removidos → 52 são `shadcn` `ui` primitives (`accordion` 1/2 não usado mas é `ui` kit) | Documentar que 52 não são `dead` para `chore`, `knip.json` já `ignore` `scripts/**` |
| **Sentry** | `sentry.client.config.ts` + `server.config.ts` `try/catch require("@sentry/nextjs")` no-op se `DSN=""`, `SENTRY_DSN=test npx tsx captureError` → `[captureError]` OK | `.env.example` já `SENTRY_DSN=""`, `fly secrets set SENTRY_DSN` é manual Operador (PENDENCIAS_OPERADOR.md) |
| **CI** | `git push origin main` `9cf21b0` Done, `ci.yml` `quality` `depcruise` + `knip` warn, `vitest 16/16` | Verificar `https://github.com/ENDARTStudios/Auto-Trader/actions` verde |

**Goal S11:** `docs/LINT.md` append `knip 52 são shadcn ui/*` (não `git rm`), `.env.example` já `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (Operador `fly secrets set`), `gh run list --limit 1` ou `actions` verde, `vitest 16/16` + `next build` OK.

**Fora de escopo S11 (S12):** `Live CCXT` (alto risco), `stryker` nightly (2h), `Position` HTTP `traderA POST` → `viewer 403` full via `fetch` (precisa `next dev`).

---

## 2. Tarefas S11 (3)

### T001 — `knip` doc (52 `ui/*` são `shadcn` não `dead`)

- **Arquivos (1):** `docs/LINT.md` → append `### knip 52 are shadcn ui/*` (list `accordion`, `alert-dialog` etc são `shadcn` primitives, `knip.json` `ignore` `scripts/**` + `ignoreDependencies` `@sentry/nextjs` etc)
- **Critério:** `npx knip --no-exit-code 2>&1 | grep "Unused files"` → 52, mas `knip.json` `ignore` já, não `exit 1`
- **Verificação:** `npx knip --no-exit-code 2>&1 | head -20` + `grep -r "accordion" src --include="*.tsx" | wc -l` → 0 (não usado, mas não `dead` para `chore`)
- **Risco:** baixo — doc only
- **Depende de:** nenhuma

### T002 — `SENTRY_DSN` wiring verify (no-op + prod ready)

- **Arquivos (1):** `DECISOES.md` #31 append `SENTRY_DSN` prod `fly secrets set NEXT_PUBLIC_SENTRY_DSN` é manual Operador (PENDENCIAS_OPERADOR.md), `SENTRY_DSN="" npx next build` OK (no-op), `SENTRY_DSN=test npx tsx` → `[captureError]` (wiring provado S08)
- **Critério:** `SENTRY_DSN="" npx next build` OK, `SENTRY_DSN=test npx tsx -e "import('./src/lib/observability/sentry').then(m=>m.captureError(new Error('S11')))"` → `[captureError] S11`
- **Risco:** baixo
- **Depende de:** T001

### T003 — `git push` CI verde verify

- **Arquivos (1):** `git log origin/main..main` → 0 (S11 docs only, sem `git rm`), `gh run list --limit 3` ou `https://github.com/ENDARTStudios/Auto-Trader/actions` → `ci` `quality` `codeql` verdes; se vermelho, `git revert`
- **Critério:** `gh run list --limit 1 --json status,conclusion` `success` ou `actions` verde
- **Verificação:** `git status --short` clean, `npx vitest run` 16/16, `npx next build` OK
- **Risco:** baixo
- **Depende de:** T002

---

## 3. Estimativa S11

| T | Tempo | Risco |
|---|---|---|
| T001 | 5 min (doc) | Baixo |
| T002 | 5 min (`SENTRY_DSN` test) | Baixo |
| T003 | 10 min (`vitest`+`build`+`gh`) | Baixo |
| **Total** | **~20 min (0h20)** | **Baixo** |
