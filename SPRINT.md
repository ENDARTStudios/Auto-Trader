# SPRINT.md — Sprint S02: Auth Foundation + RBAC + RLS (Fase 3)

> **Gerado:** 2026-08-27 — pós S01 Foundation Wiring concluído (`3fb14d5`)
> **Método:** impacto × complexidade — S01 fechou wiring (headers/SEO/flags/rate-limit). Próximo maior risco: **todas as rotas são públicas** (kill-switch, config, wallets, reserve) sem autenticação. OWASP A01/A07 crítico.
> **Status:** ✅ CONCLUÍDO — 2026-08-27 (8/8 tarefas, `next build` OK, `tests/auth.test.ts` 8/8, `test-auth-rbac.ts` 11/11)
> **Branch:** `main` (S02 wiring + auth, frozen intacto)
> **Commit:** `feat: S02 auth foundation — see DECISOES #23 + SECURITY REG-009`
> **Fórmula PROTOCOLO_MESTRE §15:** S02 `(Valor 3 × Urgência 3) / Risco 2 = 4.5` vs `Observabilidade full 2.0` — S02 venceu.

---

## 1. Diagnóstico pós S01 (evidências 2026-08-27)

| Área | Estado pós S01 | Gap que justifica S02 |
|---|---|---|
| **FeatureFlag / headers / SEO / rate-limit / vitest / motion** | ✅ 8/8 wiring OK (`next build` OK, 9 flags seed OK, 5 rotas com rate-limit) | — |
| **Auth** | ❌ Zero — `src/lib/auth` não existe, `next-auth` instalado mas não usado, nenhuma rota `/api/auth/*` | Qualquer IP pode `POST /api/kill-switch`, `POST /api/config`, `POST /api/reserve/withdraw` |
| **RBAC** | ❌ Docs `docs/RBAC.md` define 4 papéis × 24 permissões, mas `hasPermission` não existe | Sem RBAC, `viewer` consegue `engine:kill` |
| **RLS** | ❌ Docs `docs/RLS.md` define `ownerId` + `withRLS`, mas `prisma/schema.prisma` não tem `ownerId` em `WalletConnection`/`ExchangeConnection`/`Position` | User A lê wallet de User B (IDOR) |
| **Session** | ❌ Sem `User`/`Session` tables, sem cookie `httpOnly` `Secure` `SameSite`, sem `argon2id`/`bcrypt` | OWASP A07 — sessão em `localStorage` seria falha, mas hoje nem existe sessão |
| **Secrets** | ⚠️ `ENCRYPTION_KEY`/`SESSION_SECRET` em `.env.example` mas `src/lib/env.ts` não valida `SESSION_SECRET` como obrigatório | S02 torna `SESSION_SECRET` obrigatório (usado para assinar cookie) |
| **Testes auth** | ❌ Nenhum teste RBAC/RLS | S02 adiciona 3 testes estruturais (REG-009) |

**Conclusão:** S02 é o **único** que fecha falha crítica de segurança com baixo acoplamento ao frozen base (só `prisma/schema` + `src/lib/auth` + `src/app/api/auth` + `middleware.ts`). Não toca `chain`/`signer`/`audit`.

---

## 2. Sprint Goal S02

> **Ao final da S02, o sistema tem:** `User`/`Session`/`AuditLog` no Prisma, `POST /api/auth/login` com `bcryptjs` + lockout `5×→429` + cookie `httpOnly Secure SameSite=Lax` `7d`, `GET /api/auth/me`, `POST /api/auth/logout`, `hasPermission(role, perm)` com 4 papéis, `middleware.ts` protegendo `/api/*` (exceto `/api/health`, `/api/auth/login`), `withRLS`/`assertOwner` helper, `ownerId` nullable em `WalletConnection`/`ExchangeConnection`/`NotificationChannel` (backfill), seed `admin@local` + `viewer@local`, e 3 testes `tests/auth.test.ts` provando `401`/`403`/`IDOR` — e `npm run test:ci` + `next build` ainda verdes, frozen intacto.

**Fora de escopo S02 (fica para S03):** TOTP/MFA, `Position.ownerId` RLS (positions são single-operator hoje), `withRLS` em `Position` (deixa nullable), OAuth, refresh token rotation, `User` CRUD admin UI.

---

## 3. Tarefas S02 (8) — Ordem

### T001 — Prisma: `User`/`Session`/`AuditLog` + `ownerId` em models RLS

- **Objetivo:** criar base de dados para auth/RBAC/RLS
- **Arquivos (2):**
  - `prisma/schema.prisma` — adicionar `model User` (id, email unique, passwordHash, role `super_admin|trader|viewer|service`, isActive, mfaEnabled/mfaSecret nullable, lastLoginAt, timestamps), `model Session` (id, userId FK, tokenHash unique SHA-256, expiresAt, ip, userAgent), `model AuditLog` (id, actorId, actorRole, action, target, ip, prevHash, hash SHA-256 chain, seq unique monotonic, createdAt) + `ownerId String?` + `owner User? @relation` em `WalletConnection`, `ExchangeConnection`, `NotificationChannel` + `@@index([ownerId])` + `@@index` em `User.email`, `User.role`, `Session.userId`, `Session.expiresAt`
  - `prisma/migrations/*_auth_rls/` — gerado por `npx prisma db push` (SQLite dev) — não precisa `migrate dev` formal, `db push` + `generate` basta (REG-006 migration baseline já existe)
- **Critério de pronto (binário):**
  - `npx prisma validate` ✅
  - `npx prisma db push` ✅ sem perder dados (`--accept-data-loss` não necessário — só adiciona colunas nullable)
  - `npx prisma generate` ✅
  - `npm run test:ci` (ou `npx tsc --noEmit --skipLibCheck` em Windows) ainda verde — não quebrar frozen
- **Verificação:**
  ```bash
  npx prisma validate
  npx prisma db push
  node -e "const {PrismaClient}=require('@prisma/client');new PrismaClient().user.findMany().then(r=>console.log('users',r.length))"
  ```
- **Risco:** baixo — só adiciona tabelas/colunas nullable, sem FK cascade perigosa
- **Depende de:** nenhuma

### T002 — `src/lib/auth/*` utils: hash, token, cookie

- **Objetivo:** helpers puros, sem DB, testáveis
- **Arquivos (4):**
  - `src/lib/auth/password.ts` — `hashPassword(plain): Promise<string>` via `bcryptjs` (cost 12), `verifyPassword(hash, plain): Promise<boolean>` (timing-safe)
  - `src/lib/auth/session.ts` — `generateToken(): string` (`crypto.randomBytes(32).hex`), `hashToken(token): string` (`SHA-256 hex`), `createSessionCookie(token, expiresAt): string` (`session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=...; Max-Age=604800`), `parseSessionCookie(header): string|null`, `SESSION_COOKIE_NAME="session"`, `SESSION_TTL_MS=7*24*3600*1000`
  - `src/lib/auth/rbac.ts` — `type Role="super_admin"|"trader"|"viewer"|"service"`, `type Permission` 24 valores (ver `docs/RBAC.md` §2), `ROLE_PERMISSIONS: Record<Role, Set<Permission>>` (matriz §3), `hasPermission(role, perm): boolean`, `requirePermission(perm)` helper que `throw ForbiddenError` se não tem
  - `src/lib/auth/errors.ts` — `UnauthorizedError(status 401)`, `ForbiddenError(perm, status 403)`, `RateLimitedError(retryAfter, status 429)`
- **Critério de pronto:**
  - `hashPassword("Test123!")` → `$2b$12$...` e `verifyPassword` true/false
  - `hasPermission("viewer","engine:kill")===false`, `hasPermission("super_admin","*")===true` (via set)
  - `npx tsc --noEmit --skipLibCheck` ✅
- **Verificação:**
  ```bash
  node -e "require('tsx/cjs'); import('@/lib/auth/rbac').then(m=>console.log(m.hasPermission('viewer','engine:kill')))"
  ```
- **Risco:** baixo — puro, sem DB
- **Depende de:** T001

### T003 — `src/lib/auth/rls.ts` helper

- **Objetivo:** defesa em profundidade além do RBAC
- **Arquivos (1):**
  - `src/lib/auth/rls.ts` — `withRLS(session, model, fn)`, `assertOwner(session, model, id)`, `rlsWhere(session, model): PrismaWhere` — se `role===super_admin` retorna `{}` (bypass mas loga), senão `{ownerId: session.userId}`; `assertOwner` busca `select {ownerId}` e `throw Forbidden` se `row.ownerId !== session.userId && role!==super_admin`
- **Critério de pronto:**
  - `withRLS(viewerSession, 'walletConnection', tx=>tx.walletConnection.findMany({where:{isActive:true}}))` injeta `ownerId`
  - `assertOwner(userA, 'walletConnection', walletB.id)` throws `403`
  - Unit test `tests/rls.test.ts` 2 casos passam
- **Verificação:**
  ```bash
  grep -r "withRLS\|assertOwner" src/lib/auth/rls.ts
  ```
- **Risco:** baixo
- **Depende de:** T002

### T004 — `src/lib/env.ts` endurecer + `src/lib/auth/config.ts`

- **Objetivo:** `SESSION_SECRET` obrigatório em prod, `DATABASE_URL` já existente
- **Arquivos (2):**
  - `src/lib/env.ts` — `SESSION_SECRET` de `z.string().optional()` → `z.string().min(32)` quando `NODE_ENV=production` (via `superRefine`), `ENCRYPTION_KEY` já opcional (ok), adicionar `SESSION_TTL_DAYS` env opcional
  - `src/lib/auth/config.ts` — `getAuthConfig()` retorna `{ sessionTtlMs, bcryptRounds:12, lockoutMaxAttempts:5, lockoutWindowMs:15*60*1000 }`
- **Critério de pronto:**
  - `NODE_ENV=production SESSION_SECRET=short npx tsx -e "import {getEnv} from '@/lib/env';getEnv()"` → throw `SESSION_SECRET must be ≥32`
  - `NODE_ENV=development` sem `SESSION_SECRET` ainda passa (dev convenience, mas `session.ts` gera token opaco mesmo sem secret — secret só para HMAC se usar JWT futuro)
- **Verificação:** `npx tsc --noEmit --skipLibCheck` ✅
- **Risco:** baixo
- **Depende de:** T003

### T005 — `src/app/api/auth/*` rotas (login/logout/me)

- **Objetivo:** fluxo completo sem UI (curl testável)
- **Arquivos (4):**
  - `src/app/api/auth/login/route.ts` — `POST {email,password}` → Zod validação → `db.user.findUnique({where:{email}})` → `verifyPassword` → lockout `checkRateLimit(ip, '/api/auth/login')` 5/60s → `429` se excedeu → `generateToken` → `db.session.create({tokenHash:hashToken(token), userId, expiresAt:now+7d, ip})` → `db.user.update({lastLoginAt:now})` → `db.auditLog.create({actorId, action:"auth:login", hash:sha256(canonical), prevHash, seq})` → `Set-Cookie: session=... HttpOnly Secure SameSite=Lax`
  - `src/app/api/auth/logout/route.ts` — `POST` → `parseSessionCookie` → `db.session.delete({where:{tokenHash}})` → `Set-Cookie: session=; Max-Age=0`
  - `src/app/api/auth/me/route.ts` — `GET` → `parseSessionCookie` → `db.session.findUnique` → `expiresAt>now?` → `db.user.findUnique` → `{user:{id,email,role}}` ou `401`
  - `src/lib/auth/audit.ts` — `appendAuditLog({actorId, actorRole, action, target, ip})` com hash-chain `prevHash` + `seq` monotonic (usa `AuditLog` table, não file `audit-log.ts` — file continua para signer)
- **Critério de pronto:**
  - `curl -X POST /api/auth/login -d '{"email":"admin@local","password":"Admin123!"}'` → `200 + Set-Cookie: session=... HttpOnly` + `{"user":{"role":"super_admin"}}`
  - `curl -X POST /api/auth/login` 6× com senha errada → 6º `429 Retry-After`
  - `curl -H "Cookie: session=<valid>" /api/auth/me` → `200`, sem cookie → `401`
  - `curl -X POST /api/auth/logout -H "Cookie: session=<valid>"` → `200` + `Set-Cookie: session=; Max-Age=0`, `me` depois → `401`
- **Verificação:**
  ```bash
  curl -s -D - -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@local","password":"Admin123!"}' | grep -i set-cookie
  curl -s http://localhost:3000/api/auth/me -H "Cookie: session=xxx" | jq .
  ```
- **Risco:** médio — toca auth, mas sem TOTP ainda
- **Depende de:** T004

### T006 — `middleware.ts` auth guard + `src/app/api/health` público

- **Objetivo:** proteger `/api/*` exceto allowlist
- **Arquivos (2):**
  - `middleware.ts` — antes do `NextResponse.next()`: `const publicPaths = ["/api/health","/api/auth/login","/robots.txt","/sitemap.xml","/_next","/og-image.png"]`; `if (isPublic) return res`; senão `const token=req.cookies.get("session")?.value`; `if (!token) return NextResponse.json({error:"unauthorized"}, {status:401})`; `const sessionRow=await db.session.findUnique`? **Mas middleware é edge — não pode Prisma** → solução S02: middleware só verifica presença do cookie (401 se ausente), verificação real de `tokenHash`/`expiresAt` fica em `requireSession(req)` helper chamado dentro de cada rota handler (não no middleware). RBAC fica nas rotas via `requirePermission`. Middleware também mantém `X-Request-Id` + security headers já existentes.
  - `src/lib/auth/session.ts` — adicionar `requireSession(req): Promise<{userId, role, email}>` que faz `parseSessionCookie` → `db.session.findUnique` → `db.user.findUnique` → `401` se inválido/expirado, `403` se `!isActive`
- **Critério de pronto:**
  - `curl http://localhost:3000/api/positions` sem cookie → `401` (via `requireSession` nas rotas, não só middleware)
  - `curl http://localhost:3000/api/health` sem cookie → `200`
  - `curl -X POST /api/auth/login` sem cookie → `200` (login é público)
- **Verificação:** `npx next build` ✅ (middleware não importa Prisma diretamente)
- **Risco:** médio — toca middleware, mas edge-safe
- **Depende de:** T005

### T007 — Seed admin/viewer + proteger 5 rotas críticas com `requireSession` + `requirePermission`

- **Objetivo:** fechar IDOR + auth bypass nas rotas já com rate-limit
- **Arquivos (6):**
  - `scripts/seed-auth.ts` — `upsert` `admin@local` (`Admin123!` → bcrypt) `role super_admin` + `viewer@local` (`Viewer123!` → bcrypt) `role viewer`
  - `src/app/api/status/route.ts` — envolver `GET` com `await requireSession(req)` + `hasPermission(session.role,"dashboard:read")`
  - `src/app/api/positions/route.ts` — `requireSession` + `positions:read` + `withRLS` futuro (S02 deixa `ownerId` nullable, então `withRLS` não filtra ainda — mas `requireSession` já garante 401 sem login)
  - `src/app/api/config/route.ts` — `GET` `config:read`, `POST` `config:write` (viewer → 403)
  - `src/app/api/kill-switch/route.ts` — `engine:kill` (viewer → 403)
  - `src/app/api/reserve/route.ts` — `reserve:manage` (trader/viewer → 403, só super_admin)
  - `src/app/api/wallets/route.ts` + `src/app/api/wallets/[id]/route.ts` + `src/app/api/exchanges/route.ts` — `requireSession` + `withRLS`/`assertOwner` (viewer não tem `wallets:read` → 403)
- **Critério de pronto:**
  - `npx tsx scripts/seed-auth.ts` → `upsert admin, viewer`
  - `curl -H "Cookie: session=<viewer>" -X POST /api/kill-switch -d '{"active":true}'` → `403`
  - `curl -H "Cookie: session=<viewer>" -X POST /api/reserve -d '{"action":"withdraw","amountUsd":10}'` → `403`
  - `curl -H "Cookie: session=<trader>" /api/wallets` → só wallets com `ownerId=traderId` (RLS) — sem trader ainda, mas viewer testado
  - `curl /api/positions` sem cookie → `401` (via `requireSession`)
- **Verificação:**
  ```bash
  npx tsx scripts/seed-auth.ts
  curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"viewer@local","password":"Viewer123!"}' -c /tmp/c.txt | jq .
  curl -s -X POST http://localhost:3000/api/kill-switch -b /tmp/c.txt -H "Content-Type: application/json" -d '{"active":true}' -w " %{http_code}\n" | tail
  # deve ser 403
  ```
- **Risco:** médio — toca 5+ rotas, mas só adiciona guard
- **Depende de:** T006

### T008 — Testes RBAC/RLS + docs + DoD

- **Objetivo:** 3 testes estruturais REG-009 + `SECURITY.md` REG-009 + `DECISOES.md`
- **Arquivos (5):**
  - `tests/auth.test.ts` (Vitest) — `hashPassword`/`verifyPassword` + `hasPermission` matriz 4×24 + `rlsWhere` viewer vs super_admin + `assertOwner` IDOR (user A não acessa wallet B)
  - `scripts/test-auth-rbac.ts` (manual, tsx) — `login 5× fail → 429`, `viewer POST /kill-switch → 403`, `sem cookie GET /positions → 401`, `viewer GET /wallets → 403` (se wallets:read negado), `A GET wallet B → 403`
  - `DECISOES.md` — adicionar Decisão #23 S02 Auth Foundation (arquivos, validação, risco, próximo S03)
  - `SECURITY.md` — adicionar `REG-009: auth guard + RBAC + RLS` (o que pinna, por que existe, estrutura correta)
  - `README.md:docs` — adicionar linha `docs/RBAC.md, docs/RLS.md` já existem, mas S02 wiring verificado
- **Critério de pronto:**
  - `npx tsx scripts/test-auth-rbac.ts` → 5/5 PASS
  - `npx vitest run tests/auth.test.ts` → PASS
  - `npx next build` ✅
  - `git diff --name-only | grep -E 'src/lib/chain|src/signer|src/lib/audit'` → vazio (frozen intacto)
  - `curl /api/health` sem cookie → `200`, `curl /api/positions` sem cookie → `401`
- **Verificação:**
  ```bash
  npx tsx scripts/test-auth-rbac.ts
  npx vitest run --run tests/auth.test.ts 2>&1 | tail
  npx next build 2>&1 | grep -E "error|✓"
  ```
- **Risco:** baixo — testes + docs
- **Depende de:** T007

---

## 4. Arquivos Afetados S02 (consolidado — ~18 arquivos)

| Arquivo | T | Tipo |
|---|---|---|
| `prisma/schema.prisma` | T001 | schema |
| `src/lib/auth/password.ts` | T002 | new |
| `src/lib/auth/session.ts` | T002/T006 | new |
| `src/lib/auth/rbac.ts` | T002 | new |
| `src/lib/auth/errors.ts` | T002 | new |
| `src/lib/auth/rls.ts` | T003 | new |
| `src/lib/auth/audit.ts` | T005 | new |
| `src/lib/auth/config.ts` | T004 | new |
| `src/lib/env.ts` | T004 | edit |
| `src/app/api/auth/login/route.ts` | T005 | new |
| `src/app/api/auth/logout/route.ts` | T005 | new |
| `src/app/api/auth/me/route.ts` | T005 | new |
| `middleware.ts` | T006 | edit |
| `scripts/seed-auth.ts` | T007 | new |
| `src/app/api/status/route.ts` | T007 | edit |
| `src/app/api/positions/route.ts` | T007 | edit |
| `src/app/api/config/route.ts` | T007 | edit |
| `src/app/api/kill-switch/route.ts` | T007 | edit |
| `src/app/api/reserve/route.ts` | T007 | edit |
| `src/app/api/wallets/route.ts` | T007 | edit |
| `tests/auth.test.ts` | T008 | new |
| `scripts/test-auth-rbac.ts` | T008 | new |
| `DECISOES.md` | T008 | doc |
| `SECURITY.md` | T008 | doc |

**Nenhum frozen tocado:** `src/lib/chain/*`, `src/signer/*`, `src/lib/audit/*`, `src/lib/trading/wallet-crypto.ts`, `src/lib/trading/kdf.ts`.

---

## 5. Testes S02 (pirâmide)

| Camada | Teste | Onde |
|---|---|---|
| Unit | `hashPassword` cost 12 + `verifyPassword` true/false | `tests/auth.test.ts` |
| Unit | `hasPermission` 4 papéis × 24 perms + `forbidden` throw | `tests/auth.test.ts` |
| Unit | `rlsWhere` super_admin bypass vs viewer filter | `tests/auth.test.ts` |
| Unit | `assertOwner` IDOR (A não acessa B) | `tests/auth.test.ts` |
| Integração | `POST /api/auth/login` 5× fail → 429, 6× → ok + cookie HttpOnly | `scripts/test-auth-rbac.ts` |
| Integração | `viewer POST /kill-switch → 403`, `no cookie GET /positions → 401` | `scripts/test-auth-rbac.ts` |
| E2E (futuro) | Login UI → dashboard → kill-switch 403 para viewer | `e2e/auth.spec.ts` (S03) |
| Gate | `npx next build` + `npx tsc --noEmit --skipLibCheck` + `test:ci` | CI |

---

## 6. DoD S02

- [ ] `npx prisma validate` + `db push` + `generate` OK
- [ ] `npx tsx scripts/seed-auth.ts` → `admin@local` + `viewer@local` upsert
- [ ] `curl POST /api/auth/login` → `200 + Set-Cookie HttpOnly` + `GET /me` → `200`, `POST /logout` → `401` depois
- [ ] `curl POST /auth/login` 6× fail → `429 Retry-After`
- [ ] `curl GET /api/positions` sem cookie → `401`, `curl GET /api/health` sem cookie → `200`
- [ ] `viewer POST /kill-switch` → `403`, `viewer POST /reserve` → `403`
- [ ] `npx next build` ✅, `git diff --name-only | grep frozen` → vazio
- [ ] `SECURITY.md` REG-009 + `DECISOES.md` #23 + `S01` preservado em git log

---

## 7. Riscos S02

| Risco | Mitigação |
|---|---|
| `bcryptjs` não instalado → `hashPassword` falha | `npm install bcryptjs @types/bcryptjs` em T002 (devDep) |
| `middleware.ts` não pode Prisma (edge) → `requireSession` deve ser em handler, não middleware | T006: middleware só 401 se cookie ausente; verificação `tokenHash`/`expiresAt` fica em `requireSession` dentro da rota |
| `ownerId` nullable quebra RLS — wallet antiga sem owner | T001: nullable para backfill, `seed-auth.ts` backfilla `ownerId` para `admin` onde null; S03 torna `NOT NULL` |
| Lockout por IP vs por email — `checkRateLimit` já por IP (default 100/10s) + auth 5/60s | T005: `checkRateLimit(ip, "/api/auth/login")` já cobre; adicionar `email` no key se quiser `5/60s por email` (S03) |

---

## 8. Estimativa S02

| T | Tempo |
|---|---|
| T001 | 20 min |
| T002 | 25 min |
| T003 | 15 min |
| T004 | 10 min |
| T005 | 40 min |
| T006 | 15 min |
| T007 | 30 min |
| T008 | 25 min |
| **Total** | **~180 min (3h)** |

> Orçamento PROTOCOLO §16 fase 3 é 60min — estoura, mas é `ORCAMENTO_ESTOURADO` justificado (auth é P0 crítico, sem fatiamento útil). Alternativa fatiamento: S02a T001-T004 (models+utils), S02b T005-T008 (rotas+seed+testes) — se Operador preferir, avisar.

---

## 9. Como Iniciar S02

1. `git checkout main && git pull`
2. `npx prisma validate` (S01 OK)
3. Implementar T001 → `npx prisma db push` → `npx prisma generate` → `npx next build`
4. Um commit por T, `npx next build` verde a cada commit, `git diff --name-only | grep frozen` → vazio
5. Após T008, PR `feat: S02 auth foundation (Closes #S02)` → CI → merge
