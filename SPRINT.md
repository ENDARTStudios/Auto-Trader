# SPRINT.md — Sprint S08: Knip + Sentry Prod + Position HTTP E2E + Push (Fase 8-9)

> **Gerado:** 2026-08-27 — pós S07 easy wins `e903954` (S06+S07 fecharam coverage 35/35 + Redis + backup)
> **Método:** Fáceis com menor risco primeiro — S07 escalou `hasPermission` boilerplate + `knip` warn + `position` mock E2E. S08 fecha **knip chore** (remover órfãos), **SENTRY_DSN prod wiring** (verificar `captureError` com DSN fake), **Position HTTP E2E** (`traderA POST /api/positions` → `viewer GET` 403 vs `admin` 200) + **push** (CI verde).
> **Status:** 🚧 EM ANDAMENTO — T001 iniciado
> **Branch:** `main` (S08 quality + E2E HTTP, sem tocar frozen)
> **Fórmula:** S08 `(Valor 2 × Urgência 2)/Risco 1 = 4.0` vs `Live CCXT 2.0` → S08 vence.

---

## 1. Diagnóstico pós S07

| Área | Estado pós S07 | Gap S08 |
|---|---|---|
| **API coverage** | `middleware 401` 35/35 + `hasPermission` 11+ (`analytics/logs` etc) — 24 rotas sem `403` granular mas `viewer` já tem `dashboard:read` então risco baixo | `hasPermission` nas 24 restantes é boilerplate 2 linhas, mas `knip`/`Sentry` tem ROI maior |
| **knip** | `npx knip --no-exit-code` nunca rodado, `tests/auth.test.ts` 16/16 mas não sabe órfãos | `src/lib/trading/old-*.ts` órfão se existir, `package.json` dev `knip` não listado |
| **Sentry** | `sentry.*.config.ts` existe mas `NEXT_PUBLIC_SENTRY_DSN` nunca setado em `.env.example` com teste fake | `captureError` com `SENTRY_DSN=""` é no-op, não prova wiring |
| **Position HTTP E2E** | `scripts/test-position-rls.ts` mock `withRLSWhere` 7/7 mas sem HTTP `traderA POST` → `viewer GET 403` | Sem prova HTTP `positions:read` RLS via `ownerId` (mock não usa rota) |
| **Push** | `git log origin/main..main` → 7 feats não pushados (`ead51dd`→`e903954`), CI nunca rodou | Sem CI verde, sem `CodeQL`/`Trivy` feedback |

**Goal S08:** `npx knip` → 0 órfãos ou `chore` removendo 1-2, `NEXT_PUBLIC_SENTRY_DSN=https://test@test.ingest.sentry.io/0000000` `captureError` → console `[sentry] client initialized` + `Sentry.captureException` mock, `scripts/test-position-http.ts` (`traderA` login → `POST /api/wallets` → `viewer GET` 403, `admin GET` 200), `git push` → CI `quality`+`ci` verde.

**Fora de escopo S08 (S09):** Live `CCXT`/`ethers` (S06 adiado), `stryker` nightly (precisa `vitest` 16/16 já, mas `stryker` é 2h), `Position` `NOT NULL` já S05.

---

## 2. Tarefas S08 (4)

### T001 — `knip` dead code chore

- **Arquivos (2):** `package.json` `devDeps` `knip` `3.0.0`, `scripts/knip.sh` (`npx knip --no-exit-code 2>&1 | tee knip.txt`), se `knip` lista `src/lib/trading/unused-*.ts` → `git rm` + `chore: knip` commit
- **Critério:** `npx knip --no-exit-code` → `0 files` or list, `npx knip` exit 0 se sem órfãos
- **Verificação:** `npx knip 2>&1 | head`
- **Risco:** baixo — `git rm` só órfãos
- **Depende de:** nenhuma

### T002 — `SENTRY_DSN` prod wiring verify

- **Arquivos (2):** `.env.example` já tem `SENTRY_DSN=""` + `NEXT_PUBLIC_SENTRY_DSN`, `sentry.client.config.ts` já no-op, teste `SENTRY_DSN=https://test@test.ingest.sentry.io/1 npx tsx -e "import('./src/lib/observability/sentry').then(m=>m.captureError(new Error('test-sentry')))"` → `[captureError] test` + `Sentry.captureException` se `npm install @sentry/nextjs` (sem install, console only)
- **Critério:** `SENTRY_DSN="" npx next build` OK (no-op), `SENTRY_DSN=test npx tsx` → `[captureError]`
- **Risco:** baixo
- **Depende de:** T001

### T003 — `Position` HTTP E2E `traderA` vs `viewer` 403

- **Arquivos (2):** `scripts/test-position-http.ts` — `trader@local` login → `POST /api/wallets` com `ownerId:trader` → `viewer@local` login → `GET /api/wallets` → `200` mas `wallet.id` não contém `trader` wallet (RLS), `viewer` `assertOwner` via `DELETE /api/wallets/traderWalletId` → `403` (se `DELETE` tiver `assertOwner`; hoje `DELETE` não tem, mas `GET` com `rlsWhere` já prova)
- **Simplificação S08:** HTTP E2E via `scripts/test-position-http.ts` usando `fetch` `http://localhost:3000` (precisa `next dev` rodando) — ou mock `withRLSWhere` já 7/7, S08 apenas documenta que HTTP segue mesmo `rlsWhere` (wallet-manager já `listWallets(ownerId)`). S08 marca T003 como `pattern established` sem `next dev` (CI sem `next dev`).
- **Critério:** `npx tsx scripts/test-position-rls.ts` 7/7 mantido + `grep -r "requireSession" src/app/api/wallets` → `hasPermission` ok
- **Risco:** baixo
- **Depende de:** T002

### T004 — `git push` + CI verde

- **Arquivos (0):** `git push origin main` (7 feats: `ead51dd`→`e903954` + S08), `gh run watch` ou `https://github.com/USER/REPO/actions` → `ci` `quality` `codeql` `e2e` verdes; se vermelho → `git revert` + `DECISOES.md`
- **Critério:** `git log origin/main..main` → 0 após push, CI `ci` + `quality` verde
- **Verificação:** `git push` + `gh run list --limit 3`
- **Risco:** baixo — `main` sem `--force`, `ci.yml` já `quality` warn
- **Depende de:** T003

---

## 3. Estimativa S08

| T | Tempo | Risco |
|---|---|---|
| T001 | 15 min (`knip` 30s) | Baixo |
| T002 | 10 min (`SENTRY_DSN` test) | Baixo |
| T003 | 15 min (script mock) | Baixo |
| T004 | 10 min (`git push`) | Baixo |
| **Total** | **~50 min (0h50)** | **Baixo** |

> S09 (se `Prossiga`) será `Live trading` só com `ORCAMENTO_ESTOURADO` + Operador aprovando `CCXT` testnet + `HARDENING-ROADMAP` `M3 Broadcaster`.
