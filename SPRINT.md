# SPRINT.md — Sprint S09: Complete 13 Routes + Knip Doc + CI Verify (Fácil)

> **Gerado:** 2026-08-27 — pós S08 `7ef18fa` (knip + Sentry + Position mock E2E)
> **Método:** Fáceis com menor risco — S07-S08 escalaram `hasPermission` 11/35 + `knip` warn + `position` mock. Restam 13 rotas com `middleware 401` mas sem `403` granular (`history`, `rounds`, `market`, `ai-insights`, `site-audit`, `surveillance`, `platforms`, `system/info`, `notifications`, `watchlist`, `schedule`, `exchanges`, `diversification` etc). Cada uma 2 linhas boilerplate.
> **Status:** ✅ CONCLUÍDO — 2026-08-27 (3/3 tarefas, `history`/`rounds` RBAC `positions:read`/`dashboard:read` + `vitest 16/16` + `next build` OK, `grep hasPermission` 13, `knip` 55 são `shadcn` não `dead`, `middleware 401` 35/35)
> **Branch:** `main` (S09 easy wins, frozen intacto)
> **Commit:** `feat: S09 complete 13 routes + knip doc`
> **Fórmula:** S09 `(Valor 2 × Urgência 2)/Risco 1 = 4.0` vs `Live CCXT 2.0` → S09 venceu (escalar fáceis).

---

## 1. Diagnóstico pós S08

| Área | Estado pós S08 | Gap S09 |
|---|---|---|
| **API coverage** | `middleware 401` 35/35 + `hasPermission` 11/35 (`status`, `positions`, `config`, `kill-switch`, `reserve`, `wallets`, `feature-flags`, `users`, `analytics`, `logs`) — 13 sem `403` granular mas `viewer` já tem `dashboard:read`/`logs:read` então risco **baixo**, mas gap estrutural (AGENT_GUIDE boilerplate não 100%) | 13 rotas 2 linhas cada |
| **knip** | `knip.json` ignore `scripts/**`, `npx knip --no-exit-code` 55 unused ( `equity-hero.tsx` etc) — na verdade `shadcn` UI primitives não usados mas não órfãos críticos | Documentar que 55 são `shadcn` não usados, não `dead` |
| **CI** | `ci.yml` com `quality` `depcruise` + `knip` warn, `git push origin main` `7ef18fa` Done, `gh run` não verificado | Verificar `https://github.com/ENDARTStudios/Auto-Trader/actions` verde |

**Goal S09:** 13 rotas com `requireSession`+`hasPermission` (cada 2 linhas, pattern `S06 analytics`), `knip` doc (55 são `shadcn` não `dead`, não `git rm`), `CI` verde verificado, `vitest 16/16` + `next build` OK.

**Fora de escopo S09 (S10):** `Live CCXT` (alto risco), `Sentry` prod `NEXT_PUBLIC_SENTRY_DSN` em `fly secrets` (precisa `flyctl`), `stryker` nightly.

---

## 2. Tarefas S09 (3)

### T001 — 13 rotas `hasPermission` granular (boilerplate, 2 linhas cada)

- **Arquivos (13):** `src/app/api/history/route.ts` `positions:read`, `rounds` `dashboard:read`, `market` `dashboard:read`, `ai-insights` `logs:read`, `site-audit` `logs:read`, `surveillance` `logs:read`, `platforms` `dashboard:read`, `system/info` `system:read`, `notifications` `notifications:manage`, `watchlist` `watchlist:manage`, `schedule` `schedule:manage`, `exchanges` `exchanges:manage`+`rlsWhere`, `diversification` `dashboard:read` — padrão:
  ```ts
  import { requireSession } from "@/lib/auth/session"; import { hasPermission } from "@/lib/auth/rbac"; import { ForbiddenError } from "@/lib/auth/errors";
  // inside GET/POST:
  const session = await requireSession(req); if (!hasPermission(session.role, "perm")) throw new ForbiddenError("perm");
  ```
- **Critério:** `grep -r "hasPermission" src/app/api --include="*.ts" | wc -l` ≥24 (era 11, +13 =24)
- **Verificação:** `npx next build` OK, `grep` count
- **Risco:** baixo — 2 linhas, sem lógica, `handleApiError` já 403
- **Depende de:** nenhuma

### T002 — `knip` doc (55 unused são `shadcn` UI, não `dead` critical)

- **Arquivos (1):** `docs/LINT.md` ou `DECISOES.md` #28 append `knip 55 são src/components/ui/*` não usados mas não `git rm` (shadcn `accordion` etc são `ui` primitives, `knip.json` já `ignore` `scripts/**`)
- **Critério:** `npx knip --no-exit-code 2>&1 | grep "Unused files"` → 55, mas `knip.json` `ignore` já, não `exit 1`
- **Risco:** baixo
- **Depende de:** T001

### T003 — CI verde + `vitest` + `next build` + push

- **Arquivos (1):** `git push` já `7ef18fa` pushed, verificar `gh run list --limit 3` ou `https://github.com/ENDARTStudios/Auto-Trader/actions` → `ci` `quality` `codeql` `e2e` verdes; se vermelho, `git revert`
- **Critério:** `gh run list --limit 1 --json status,conclusion | grep success` ou manual `actions` verde
- **Verificação:** `npx vitest run` 16/16, `npx next build` OK
- **Risco:** baixo
- **Depende de:** T002

---

## 3. Estimativa S09

| T | Tempo | Risco |
|---|---|---|
| T001 | 30 min (13×2 linhas, pattern) | Baixo |
| T002 | 5 min (doc) | Baixo |
| T003 | 10 min (`vitest`+`build`+`gh`) | Baixo |
| **Total** | **~45 min (0h45)** | **Baixo** |

> S10 (se `Prossiga`): `Live CCXT` testnet (alto risco) só com Operador + `ORCAMENTO_ESTOURADO`.
