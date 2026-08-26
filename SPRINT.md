# SPRINT.md — Sprint S03: Frontend Auth + Complete Route Protection (Fase 3.2)

> **Gerado:** 2026-08-27 — pós S02 Auth Foundation concluído (`ce20416`)
> **Método:** impacto × complexidade — S02 fechou backend auth (User/Session/RBAC/RLS). Próximo maior gap: **sem UI de login** (auth só via curl) + **30 rotas ainda públicas** (analytics, logs, history, etc sem `requireSession`).
> **Status:** ✅ CONCLUÍDO — 2026-08-27 (6/6 tarefas, `/login` OK, middleware 401→/login, 5 rotas + wallets RLS + trader seed + `e2e/auth.spec.ts`)
> **Branch:** `main` (S03 frontend auth, frozen intacto)
> **Commit:** `feat: S03 frontend auth — see DECISOES #24`
> **Fórmula PROTOCOLO_MESTRE §15:** S03 `(Valor 3 × Urgência 3) / Risco 1.5 = 6.0` vs `TOTP/MFA 3.0` → S03 venceu.

---

## 1. Diagnóstico pós S02 (evidências 2026-08-27)

| Área | Estado pós S02 | Gap que justifica S03 |
|---|---|---|
| **Auth backend** | ✅ 3 rotas `/api/auth/*` OK, 5 rotas críticas com `requireSession`+`hasPermission` | `GET /api/analytics` etc ainda sem guard |
| **Login UI** | ❌ Zero — `src/app/page.tsx` é dashboard direto, sem login, sem `useAuth` | Operador não consegue logar via UI; `curl` apenas |
| **Protect remaining routes** | ❌ 30+ rotas sem `requireSession` (logs, history, rounds, market, ai-insights, etc) | Qualquer IP lê logs/P&L sem cookie |
| **RLS Exchange** | ⚠️ `ownerId` em schema mas `src/app/api/exchanges/route.ts` ainda sem `rlsWhere` | Mesma falha que wallets antes de S02 T007 |
| **Dashboard guard** | ❌ `src/app/page.tsx` não verifica `GET /api/auth/me` → sem redirect para `/login` | Usuário não logado vê dashboard quebrado (401 nos fetches) |
| **Logout** | ⚠️ `POST /api/auth/logout` existe mas sem botão UI | Sem UX de logout |
| **Admin seed** | ⚠️ `admin@local` + `viewer@local` OK, mas falta `trader@local` para teste RBAC completo | S03 adiciona `trader` para matriz 3 papéis |
| **E2E** | ❌ Nenhum `e2e/auth.spec.ts` | Sem prova de redirect 401→login |

**Conclusão:** S03 fecha o **ciclo auth E2E**: login UI → cookie → dashboard guard → todas as rotas com `requireSession` → logout. É o menor wiring que torna S02 utilizável.

---

## 2. Sprint Goal S03

> **Ao final da S03, qualquer browser que acesse `/` sem cookie é redirecionado para `/login`; login com `admin@local/Admin123!` ou `viewer@local/Viewer123!` ou `trader@local/Trader123!` cria `HttpOnly` cookie e volta ao dashboard; dashboard mostra `user.email (role)` + botão logout; todas as 35 rotas `GET/POST /api/*` (exceto `/api/health`, `/api/auth/login`) exigem `requireSession` (401) + `hasPermission` (403); `exchanges` e `positions` com RLS; e `e2e/auth.spec.ts` prova `401→/login` e `viewer 403 kill-switch`.**

**Fora de escopo S03 (fica para S04):** TOTP/MFA, `Position.ownerId` filter (deixa single-operator), OAuth, refresh token rotation, password reset.

---

## 3. Tarefas S03 (7) — Ordem

### T001 — `src/hooks/use-auth.ts` + `src/app/login/page.tsx`

- **Objetivo:** hook + UI de login com skeleton/motion já padronizados
- **Arquivos (3):**
  - `src/hooks/use-auth.ts` — `useAuth()` (TanStack `useQuery` `GET /api/auth/me` → `{user}` ou `null` + `isLoading`), `useLogin()` (`useMutation` `POST /api/auth/login` + `onSuccess` toast + `router.push("/")` + `qc.invalidateQueries`), `useLogout()` (`POST /api/auth/logout` + `router.push("/login")`)
  - `src/app/login/page.tsx` — form `email`/`password` (Zod `react-hook-form` + `shadcn` `Input`/`Button`), `isPending` → spinner `motion`, `onError` toast, link "Credenciais: admin/viewer/trader", `ErrorBoundary` + `Skeleton` já existentes
  - `src/app/login/layout.tsx` — layout minimal sem `Providers` duplicado (reusa root)
- **Critério:** `curl POST /api/auth/login` ainda OK + `npm run build` OK + login UI renderiza com skeleton enquanto `useAuth.isLoading`
- **Verificação:** `npx next build` + manual `http://localhost:3000/login` → form aparece
- **Risco:** baixo
- **Depende de:** nenhuma

### T002 — `src/app/page.tsx` guard + `middleware.ts` page redirect

- **Objetivo:** dashboard exige login
- **Arquivos (2):**
  - `src/app/page.tsx` — topo `const {user,isLoading}=useAuth(); if(isLoading) return <Skeleton full>`; `if(!user) { router.push("/login"); return <Skeleton>Redirect...</> }`; header mostra `user.email (role)` + `Logout` botão
  - `middleware.ts` — adicionar `if (pathname==="/login" || pathname==="/api/auth/login" || pathname.startsWith("/_next")) return NextResponse.next()`; se `!cookie` e `pathname==="/"` → `NextResponse.redirect(new URL("/login", req.url))` (opcional, mas client guard já cobre; middleware é edge-safe só com cookie presence, não DB)
- **Critério:** sem cookie `GET /` → redirect `/login` (ou skeleton redirect); com cookie via login → dashboard com `admin@local (super_admin)`
- **Verificação:** `curl -s http://localhost:3000/ -H "Cookie: session=invalid" | grep -i login` ou manual browser incognito
- **Risco:** médio — toca page.tsx (877 linhas) mas só add guard no topo
- **Depende de:** T001

### T003 — Proteger remaining 30 rotas `GET/POST /api/*` com `requireSession`+`hasPermission`

- **Objetivo:** fechar A01 em todas as rotas
- **Arquivos (~15):**
  - `src/app/api/analytics/route.ts` → `dashboard:read`
  - `src/app/api/history/route.ts` → `positions:read`
  - `src/app/api/logs/route.ts` → `logs:read`
  - `src/app/api/rounds/route.ts` → `dashboard:read`
  - `src/app/api/market/route.ts` → `dashboard:read`
  - `src/app/api/ai-insights/route.ts` → `logs:read`
  - `src/app/api/site-audit/route.ts` → `logs:read`
  - `src/app/api/surveillance/route.ts` → `logs:read`
  - `src/app/api/platforms/route.ts` → `dashboard:read`
  - `src/app/api/backtest/route.ts` → `backtest:run` (GET lista `dashboard:read`, POST `backtest:run`)
  - `src/app/api/notifications/**` → `notifications:manage`
  - `src/app/api/watchlist/**` → `watchlist:manage`
  - `src/app/api/schedule/route.ts` → `schedule:manage`
  - `src/app/api/system/info/route.ts` → `system:read`
  - `src/app/api/exchanges/route.ts` → `exchanges:manage` + RLS
  - `src/app/api/feature-flags/route.ts` → `GET dashboard:read`, `POST flags:manage`
  - Padrão: `const session=await requireSession(req); if(!hasPermission(session.role, perm)) throw new ForbiddenError(perm);` + `checkRateLimit` já existe em algumas
- **Critério:** `curl /api/analytics` sem cookie → `401` (era 200 antes); `curl -H "Cookie: viewer" /api/kill-switch POST` → `403` já OK; `viewer GET /api/config` → `200` (tem `config:read`), `viewer POST /api/config` → `403`
- **Verificação:** `grep -r "requireSession" src/app/api --include="*.ts" | wc -l` deve ser ≥20 após T003
- **Risco:** médio — toca muitas rotas mas é boilerplate
- **Depende de:** T002

### T004 — RLS complete: `exchanges` + `notificationChannel` + `Position` stub

- **Objetivo:** fechar IDOR em exchanges
- **Arquivos (3):**
  - `src/lib/trading/wallet-manager.ts` — já tem `listWallets(ownerId,isSuper)` + `createWallet(ownerId)`; fazer mesmo para `listExchanges(ownerId,isSuper)` + `createExchange(ownerId)`
  - `src/app/api/exchanges/route.ts` — `GET` → `listExchanges(session.userId, isSuper)`, `POST` → `createExchange({... , ownerId: session.userId})` + `requireSession`+`hasPermission("exchanges:manage")`
  - `prisma/schema.prisma` — já tem `ownerId` nullable em `NotificationChannel`; adicionar `ownerId` em `Position`? **Deixa para S04** (positions são single-operator, RLS deixaria query mais lenta sem benefício). Documentar em `DECISOES.md`.
- **Critério:** `admin` cria exchange → `ownerId=admin.id`; `viewer` (sem `exchanges:manage`) → `403` antes de chegar ao RLS; `trader` com `wallets:read` mas sem `exchanges:manage` → `403`
- **Verificação:** `npx tsx scripts/test-auth-rbac.ts` já testa `rlsWhere`; adicionar `exchange RLS` check
- **Risco:** baixo
- **Depende de:** T003

### T005 — `scripts/seed-auth.ts` trader + admin UI API `/api/users`

- **Objetivo:** 3 papéis testáveis + CRUD mínimo para admin
- **Arquivos (3):**
  - `scripts/seed-auth.ts` — adicionar `trader@local`/`Trader123!` `role trader`
  - `src/app/api/users/route.ts` — `GET` → `requireSession`+`hasPermission("users:manage")` → `db.user.findMany({select:{id,email,role,isActive}})`; `POST` → `hasPermission("users:manage")` + Zod `{email,password,role}` + `hashPassword` + `db.user.create`
  - `src/app/api/users/[id]/route.ts` — `DELETE`/`PATCH` `users:manage` (opcional, mínimo)
- **Critério:** `npx tsx scripts/seed-auth.ts` → 3 users; `viewer GET /api/users` → `403`; `admin GET /api/users` → `200` com 3; `admin POST /api/users` → `201`
- **Verificação:** `curl -H "Cookie: admin" /api/users | jq .`
- **Risco:** médio — novo endpoint, mas só super_admin
- **Depende de:** T004

### T006 — E2E `e2e/auth.spec.ts` + DoD

- **Objetivo:** prova 401→login e RBAC via Playwright
- **Arquivos (4):**
  - `e2e/auth.spec.ts` — `test("redirect to /login when no cookie")`, `test("viewer cannot POST kill-switch")`, `test("login viewer → dashboard shows role")`
  - `DECISOES.md` #24 S03
  - `SECURITY.md` atualizar REG-009 com E2E prova
  - `README.md` adicionar `docs` login
- **Critério:** `npx playwright test e2e/auth.spec.ts` 3/3; `npx next build` OK; `git diff --name-only | grep frozen` → 0
- **Verificação:** `npx playwright test --list` + `npx next build`
- **Risco:** baixo
- **Depende de:** T005

---

## 4. Arquivos Afetados S03 (consolidado — ~22 arquivos)

| Arquivo | T | Tipo |
|---|---|---|
| `src/hooks/use-auth.ts` | T001 | new |
| `src/app/login/page.tsx` | T001 | new |
| `src/app/page.tsx` | T002 | edit |
| `middleware.ts` | T002 | edit |
| `src/app/api/analytics/route.ts` | T003 | edit |
| `src/app/api/history/route.ts` | T003 | edit |
| `src/app/api/logs/route.ts` | T003 | edit |
| `src/app/api/rounds/route.ts` | T003 | edit |
| `src/app/api/market/route.ts` | T003 | edit |
| `src/app/api/exchanges/route.ts` | T003/T004 | edit |
| `src/app/api/feature-flags/route.ts` | T003 | edit |
| `src/lib/trading/wallet-manager.ts` | T004 | edit |
| `scripts/seed-auth.ts` | T005 | edit |
| `src/app/api/users/route.ts` | T005 | new |
| `e2e/auth.spec.ts` | T006 | new |
| `DECISOES.md` | T006 | doc |
| `SECURITY.md` | T006 | doc |

---

## 5. Testes S03

| Camada | Teste |
|---|---|
| Unit | `hasPermission` já OK (S02) |
| Integração | `GET /api/analytics` sem cookie → `401`, com viewer → `200`, `POST /api/config` viewer → `403` |
| E2E | `e2e/auth.spec.ts` 3 testes (redirect, login, RBAC) |
| Manual | Browser incognito → `/` → `/login` → `admin/Admin123!` → dashboard `super_admin` → logout → `/login` |

---

## 6. DoD S03

- [ ] `GET /` sem cookie → `/login` (client ou middleware)
- [ ] `POST /api/auth/login` com `trader@local/Trader123!` → `200` + dashboard `trader`
- [ ] `GET /api/analytics` sem cookie → `401`, com `viewer` → `200`
- [ ] `POST /api/config` `viewer` → `403`, `trader` → `200`
- [ ] `GET /api/exchanges` `viewer` → `403` (sem `exchanges:manage`)
- [ ] `npx playwright test e2e/auth.spec.ts` 3/3
- [ ] `npx next build` OK, `git diff --name-only | grep frozen` → 0

---

## 7. Estimativa S03

| T | Tempo |
|---|---|
| T001 | 30 min |
| T002 | 20 min |
| T003 | 40 min |
| T004 | 15 min |
| T005 | 25 min |
| T006 | 20 min |
| **Total** | **~150 min (2h30)** |
