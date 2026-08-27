# SPRINT.md — Sprint S05: Observability + Strict RLS + Quality Gates (Fase 8-9)

> **Gerado:** 2026-08-27 — pós S04 MFA concluído (`b912998`)
> **Método:** impacto × complexidade — S04 fechou MFA + Position nullable. Próximo maior gap: **Position ainda com `ownerId` nullable** (IDOR residual) + **Sentry/OTEL só docs** (sem `sentry.client.config.ts`) + **quality gates só docs** (sem `dependency-cruiser`, `knip`, `commitlint`).
> **Status:** ✅ CONCLUÍDO — 2026-08-27 (5/5 tarefas, Position STRICT, Sentry wiring, quality configs, password reset, `vitest 16/16`)
> **Branch:** `main` (S05 hardening Fase 8-9, frozen intacto)
> **Commit:** `feat: S05 observability + strict RLS — see DECISOES #26 + SECURITY REG-011`
> **Fórmula:** S05 `(Valor 3 × Urgência 1.5) / Risco 1.5 = 3.0` vs `Live trading 2.0` → S05 venceu (Dev Skill 100% fechado).

---

## 1. Diagnóstico pós S04

| Área | Estado pós S04 | Gap S05 |
|---|---|---|
| **Position RLS** | ⚠️ `ownerId String?` nullable, `openPosition` sem `ownerId` param, `GET /api/positions` sem `rlsWhere` | `traderA` ainda vê `position` de `traderB` se ambos existirem (single-operator hoje, mas gap estrutural) |
| **Sentry** | ⚠️ `src/lib/observability/sentry.ts` `captureError` existe mas `sentry.client.config.ts`/`server.config.ts` não existem, `instrumentation.ts` não chama `initSentry` | `SENTRY_DSN` setado não captura nada |
| **OTEL** | ⚠️ `src/lib/observability/otel.ts` existe mas `instrumentation.ts` não chama `initOTel` | `OTEL_EXPORTER_OTLP_ENDPOINT` não exporta traces |
| **Quality** | ⚠️ `docs/LINT.md` documenta `dependency-cruiser`/`knip`/`commitlint` mas `.dependency-cruiser.cjs`, `commitlint.config.cjs` não existem | CI não quebra se ciclo `chain → trading` for introduzido |
| **Password reset** | ❌ `POST /api/auth/forgot`/`reset` não existe | Operador com senha esquecida precisa `seed-auth.ts` manual |
| **DoD S04** | ✅ TOTP 6/6, MFA 11/11, build OK | S05 deve manter `vitest 14/14` + `next build` |

**Goal S05:** `Position.ownerId` `NOT NULL` (backfill `admin` onde null + `openPosition` exige `ownerId`) + `sentry.client/server.config.ts` + `instrumentation.ts` chama `initSentry`/`initOTel` (no-op se env vazio) + `.dependency-cruiser.cjs` (forbid `chain→trading`, `components→db`, `cycle`) + `commitlint.config.cjs` + `PASSWORD_RESET` `POST /api/auth/forgot` (gera token 32B + `expiresAt 15m` em `Session` ou `PasswordReset` table) + `POST /api/auth/reset` (`token` + `newPassword`).

**Fora de escopo S05 (S06):** Live trading `CCXT`/`ethers` (PLANO_MESTRE Fase 4), `Position` RLS E2E com 2 traders simultâneos, `knip`/`stryker` nightly.

---

## 2. Tarefas S05 (5)

### T001 — `Position.ownerId` STRICT + `portfolio.ts` owner param

- **Arquivos (3):** `prisma/schema.prisma` → `ownerId String` (remove `?`, add `default` via backfill script), `prisma/schema.prisma` User `positions Position[]` já OK, `src/lib/trading/portfolio.ts` → `openPosition(..., ownerId: string)` + `db.position.create({data:{..., ownerId}})` + `listPositions` helper futuro
- **Backfill:** `npx tsx scripts/backfill-position-owner.ts` → `UPDATE Position SET ownerId = (SELECT id FROM User WHERE role='super_admin' LIMIT 1) WHERE ownerId IS NULL`
- **Critério:** `npx prisma validate` OK, `db push` OK, `SELECT count(*) FROM Position WHERE ownerId IS NULL` → 0, `npx next build` OK
- **Risco:** médio — `NOT NULL` sem backfill quebra `db push`
- **Depende de:** nenhuma

### T002 — Sentry wiring `sentry.client.config.ts` + `server.config.ts` + `instrumentation.ts`

- **Arquivos (3):** `sentry.client.config.ts` (`import * as Sentry from "@sentry/nextjs"; Sentry.init({dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate:0.1, beforeSend: scrub})`), `sentry.server.config.ts` (same com `process.env.SENTRY_DSN`), `src/instrumentation.ts` → `await import("@/lib/observability/sentry").then(m=>m.initSentry())` (no-op se DSN vazio, já existe `captureError` que require Sentry dinâmico)
- **Simplificação S05:** não instalar `@sentry/nextjs` ainda (evita `npm install` pesado em Windows), apenas criar configs com `try/catch require` (igual `sentry.ts` já faz). Se DSN vazio, no-op. Se DSN setado e `npm install @sentry/nextjs` futuro, passa a capturar.
- **Critério:** `SENTRY_DSN="" npx next build` OK (no-op), `SENTRY_DSN=https://x@x.ingest.sentry.io/x npx tsx -e "import('./src/lib/observability/sentry').then(m=>m.captureError(new Error('test')))"` → console `[captureError]` + `Sentry.captureException` se instalado
- **Risco:** baixo
- **Depende de:** T001

### T003 — Quality configs `dependency-cruiser` + `commitlint` + `knip`

- **Arquivos (3):** `.dependency-cruiser.cjs` (forbid `circular`, `chain→trading`, `components→db`), `commitlint.config.cjs` (`extends: ["@commitlint/config-conventional"]`, `type-enum` 12 types), `package.json` scripts `lint:arch` + `knip` já via `npx knip`
- **Critério:** `npx dependency-cruiser --validate .dependency-cruiser.cjs src` → 0 violations (ou lista ciclos se houver), `npx commitlint --from=HEAD~1` passa para `feat: ...`
- **Risco:** baixo
- **Depende de:** T002

### T004 — Password reset `POST /api/auth/forgot` + `POST /api/auth/reset`

- **Arquivos (3):** `prisma/schema.prisma` → `model PasswordReset { id String @id @default(cuid()), userId String, tokenHash String @unique, expiresAt DateTime, used Boolean @default(false), createdAt DateTime @default(now()), user User @relation(...), @@index([userId]), @@index([tokenHash]) }` + `User.passwordResets PasswordReset[]`, `src/app/api/auth/forgot/route.ts` (`POST {email}` → `findUnique` → `generateToken` 32B → `hashToken` → `db.passwordReset.create({expiresAt: now+15m})` → `console.log` mock email `http://localhost:3000/reset?token=<token>`), `src/app/api/auth/reset/route.ts` (`POST {token, newPassword}` → `hashToken` → `findUnique` → `expiresAt>now && !used` → `hashPassword(newPassword)` → `db.user.update` → `db.passwordReset.update({used:true})`)
- **Critério:** `POST /api/auth/forgot {email:"admin@local"}` → `200 {ok:true}` + `SELECT * FROM PasswordReset` 1 row `expiresAt` 15m, `POST /api/auth/reset {token, newPassword:"NewAdmin123!"}` → `200`, login com nova senha → `200`, token reuse → `400`
- **Risco:** médio — toca auth, mas sem email real (mock console.log)
- **Depende de:** T003

### T005 — Testes + DoD

- **Arquivos (4):** `tests/totp.test.ts` já 6/6 mantido, `tests/auth.test.ts` 8/8, novo `tests/password-reset.test.ts` (2: `forgot creates token`, `reset with valid token succeeds`), `DECISOES.md` #26, `SECURITY.md` REG-011
- **Critério:** `npx vitest run` 16/16 (8+6+2), `npx next build` OK, `git diff --name-only | grep -E 'chain|signer|audit'` → 0, `npx dependency-cruiser --validate` 0 violations
- **Risco:** baixo
- **Depende de:** T004

---

## 3. Estimativa S05

| T | Tempo |
|---|---|
| T001 | 20 min |
| T002 | 15 min |
| T003 | 15 min |
| T004 | 30 min |
| T005 | 20 min |
| **Total** | **~100 min (1h40)** |
