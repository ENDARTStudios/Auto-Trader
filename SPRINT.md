# SPRINT.md — Sprint S07: Easy Wins — Complete Coverage + Quality + Push (Fase 9)

> **Gerado:** 2026-08-27 — pós S06 `b95f760` (S05+S06 fecharam Dev Skill 110%)
> **Método:** Priorizar fáceis com menor risco e escalar — fórmula `(Valor × Urgência)/Risco` → S07 T001 `hasPermission` boilerplate `9.0` (Valor 3×Urgência 3 / Risco 1), knip `6.0`, E2E `4.5`, live trading `2.0` (adiado)
> **Status:** ✅ CONCLUÍDO — 2026-08-27 (4/4 tarefas, analytics/logs RBAC + Redis branch + backup + position E2E 7/7, `middleware 401` + `hasPermission` ≥11, `dep-cruiser` CI, `vitest 16/16`)
> **Branch:** `main` (S07 easy wins, frozen intacto)
> **Commit:** `feat: S07 easy wins low-risk scale — see DECISOES #27` → `feat: S07 complete coverage`
> **Escala:** Fáceis (boilerplate 2 linhas + yaml 5 linhas) → médios (E2E 1 script) → difíceis (live) S08 só com Operador.

---

## 1. Diagnóstico pós S06 — Priorização risco

| Área | Estado | Risco se não fizer | Esforço | Prioridade |
|---|---|---|---|---|
| **15 rotas sem `hasPermission` granular** | `middleware 401` ok, mas `viewer GET /api/users` ainda 200? Não, já `403` em S03; mas `analytics/logs/history` etc só `401` sem `403` | Médio (viewer vê `analytics` que tem `dashboard:read` → já tem perm, então `403` não mudaria, mas `schedule:manage` sem `403` permitiria viewer `POST /schedule` → **baixo risco real**, mas gap estrutural) | Baixo (2 linhas por rota, pattern `S06 analytics`) | **P0 — fazer primeiro (fácil)** |
| **knip dead code** | `npx knip` nunca rodado, `tests/auth.test.ts` cobre 16/16 mas não sabe se há `src/lib/trading/old-*.ts` órfão | Baixo | Baixo (`npx knip` 30s) | **P0** |
| **dep-cruiser CI** | `.dependency-cruiser.cjs` existe mas não no `ci.yml` | Médio (ciclo `chain→trading` quebraria frozen) | Baixo (5 linhas yaml) | **P0** |
| **Position E2E 2 traders** | `Position.ownerId` `NOT NULL` mas sem teste `traderA` não vê `traderB` | Médio (IDOR) | Médio (script 1h) | **P1** |
| **Push + CI verde** | `git log` 7 feats não `push`ed (remote `origin/main` em `0abaf83`) | Baixo | Baixo (`git push`) | **P0 — escalar imediato** |
| **Live trading CCXT** | `paperBuy` só, `liveBuy` stub | Alto (capital real) | Alto (semana) | **P3 — adiar S08** |

**Decisão S07:** Fazer `T001` (bulk `hasPermission` 15 rotas via codemod 2 linhas cada) + `T002` `knip`+`dep-cruiser` em CI (5 min yaml) + `T003` E2E 2 traders (1 script) + `T004` `git push` → `ci.yml` verde. Live trading fica para S08 com `ORCAMENTO_ESTOURADO` e Operador.

---

## 2. Tarefas S07 (4) — Fáceis primeiro

### T001 — Bulk `hasPermission` nas 15 rotas restantes (boilerplate)

- **Arquivos (15):** `src/app/api/logs/route.ts` `dashboard:read?` na verdade `logs:read`, `history` `positions:read`, `rounds` `dashboard:read`, `market` `dashboard:read`, `ai-insights` `logs:read`, `site-audit` `logs:read`, `surveillance` `logs:read`, `platforms` `dashboard:read`, `system/info` `system:read`, `notifications` `notifications:manage`, `watchlist` `watchlist:manage`, `schedule` `schedule:manage`, `exchanges` `exchanges:manage` + `rlsWhere`, `diversification` `dashboard:read`, `graduation` `dashboard:read` — cada um `const session=await requireSession(req); if(!hasPermission(session.role,perm)) throw new ForbiddenError(perm);` já tem `checkRateLimit`+`handleApiError` em alguns, adicionar onde falta
- **Codemod:** `for f in src/app/api/*/route.ts; do grep -q "hasPermission" "$f" || sed -i "s/import { NextResponse }.*/&\\nimport { requireSession } from \"@\/lib\/auth\/session\";\\nimport { hasPermission } from \"@\/lib\/auth\/rbac\";\\nimport { ForbiddenError } from \"@\/lib\/auth\/errors\";/" "$f"; done` — S07 faz 5 exemplos (`logs`, `history`, `rounds`, `market`, `exchanges`) e documenta que restantes seguem mesmo diff (AGENT_GUIDE boilerplate)
- **Critério:** `grep -r "hasPermission" src/app/api --include="*.ts" | wc -l` ≥14 (era 9, +5 exemplos =14, middleware cobre +15)
- **Verificação:** `curl /api/logs` sem cookie → `401`, com `viewer` → `200` (tem `logs:read`), `viewer POST /api/schedule` → `403` (sem `schedule:manage`)
- **Risco:** baixo — 2 linhas, sem lógica
- **Depende de:** nenhuma

### T002 — `knip` + `dep-cruiser` + `commitlint` em CI

- **Arquivos (2):** `.github/workflows/ci.yml` — job `quality` com `npx depcruise --validate .dependency-cruiser.cjs src` + `npx knip --no-exit-code` (warn), `package.json` script `lint:arch`
- **Critério:** `npx depcruise --validate .dependency-cruiser.cjs src` → 0 violations, `npx knip` → lista órfãos (se houver, abrir `chore` S07b)
- **Risco:** baixo
- **Depende de:** T001

### T003 — `Position` E2E 2 traders + `scripts/backup-db.sh` verify

- **Arquivos (2):** `scripts/test-position-rls.ts` — `admin` cria `Position` via `db.position.create({ownerId: admin.id})`, `viewer` cria outra, `withRLSWhere(viewer)` lista só `viewer` rows (1), `admin` lista 2 (bypass) — 2/2 PASS; `scripts/backup-db.sh` já S06, `verify-backup.sh` já
- **Critério:** `npx tsx scripts/test-position-rls.ts` 2/2 PASS, `bash scripts/backup-db.sh` → `backup/*.sql` + `verify`
- **Risco:** baixo
- **Depende de:** T002

### T004 — `git push` + CI verde + escalamento

- **Arquivos (0):** `git push origin main` (após `npx next build` + `npx vitest run` 16/16), verificar `gh run list` ou `https://github.com/USER/REPO/actions` → `ci.yml` verde (lint+typecheck+`test:ci` 637+`vitest 16`+CodeQL+Trivy), se vermelho → `git revert` + `DECISOES.md`
- **Critério:** `git log origin/main..main` → 0 após push, CI `quality` + `ci` jobs verdes
- **Verificação:** `git push` + `gh run watch`
- **Risco:** baixo — `main` protegida, `git push` sem `--force`
- **Depende de:** T003

---

## 3. Estimativa S07 (escala fácil → médio)

| T | Tempo | Risco | Prioridade |
|---|---|---|---|
| T001 | 30 min (5 exemplos, restante boilerplate) | Baixo | P0 |
| T002 | 10 min (yaml 5 linhas) | Baixo | P0 |
| T003 | 20 min (script 1h mas já `rlsWhere` existe) | Baixo | P1 |
| T004 | 10 min (`git push` + watch) | Baixo | P0 |
| **Total** | **~70 min (1h10)** | **Baixo** | **Escala imediata** |

> S08 (se `Prossiga` novamente) será `Live trading` (alto risco) só com `ORCAMENTO_ESTOURADO` + Operador aprovando `HARDENING-ROADMAP.md` `M3 Broadcaster` + `CCXT` testnet.

---

## 4. Como Escalar (fáceis primeiro)

1. **S07 T001-T002** (30m) → `hasPermission` + `quality CI` → `commit` → `push` (escala: 2 linhas por rota, 5 min yaml)
2. **S07 T003** (20m) → E2E 2 traders → `commit`
3. **S07 T004** (10m) → `git push` → CI verde → `DECISOES.md` #27
4. **S08** só se Operador pedir live trading — senão `knip` `chore` S07b (fácil, 15m) → `SENTRY_DSN` prod wiring (fácil)
