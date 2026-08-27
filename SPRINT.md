# SPRINT.md — Sprint S04: MFA TOTP + Position RLS + Users Admin UI (Fase 3.3)

> **Gerado:** 2026-08-27 — pós S03 Frontend Auth concluído (`cb850f0`)
> **Método:** impacto × complexidade — S03 fechou login UI + 5 rotas + middleware. Próximo maior gap: **MFA ausente** (OWASP A07, PLANO_MESTRE Fase 3) + `Position` sem `ownerId` (S02 deixou single-operator) + sem admin UI para `users:manage`.
> **Status:** ✅ CONCLUÍDO — 2026-08-27 (5/5 tarefas, TOTP 32 chars, MFA setup/verify, login com MFA, Position ownerId, admin UI, `tests/totp.test.ts` 6/6, `test-mfa.ts` 11/11)
> **Branch:** `main` (S04 MFA + Position RLS, frozen intacto)
> **Commit:** `feat: S04 MFA TOTP — see DECISOES #25 + SECURITY REG-010`
> **Fórmula:** S04 `(Valor 3 × Urgência 2) / Risco 1.5 = 4.0` vs `Observabilidade full 3.0` → S04 venceu.

---

## 1. Diagnóstico pós S03

| Área | Estado pós S03 | Gap S04 |
|---|---|---|
| **Login UI + middleware** | ✅ `/login` + `useAuth` + `middleware` 401/redirect + 5 rotas + wallets RLS | `mfaEnabled` coluna existe mas sem gerar/verificar TOTP |
| **MFA** | ❌ `User.mfaSecret` nullable mas nunca preenchido, `POST /api/auth/mfa/*` não existe | Sem 2FA, `viewer` com senha fraca = comprometimento = acesso a `engine:kill` |
| **Position RLS** | ❌ `Position` sem `ownerId` | Multi-user futuro: trader A vê posição de trader B (IDOR) |
| **Users admin** | ⚠️ `GET/POST /api/users` existe mas sem UI | Admin precisa `curl` para criar trader |
| **E2E MFA** | ❌ `e2e/auth.spec.ts` 3 testes, sem MFA | Sem prova de TOTP `window` |

**Goal S04:** `POST /api/auth/mfa/setup` (super_admin/trader, requer `requireSession`) gera `secret` base32 + `otpauth://` + `qrcode` (via `qrcode` lib ou ASCII), `POST /api/auth/mfa/verify {token}` ativa `mfaEnabled=true`; `POST /api/auth/login` se `mfaEnabled` → `200 {mfaRequired:true, tempToken}` → segundo `POST /api/auth/login {tempToken, totp}` → `Set-Cookie`; `Position.ownerId` nullable + `listPositions` filtra por `ownerId`; `src/app/admin/users/page.tsx` lista/cria users (super_admin); `e2e/mfa.spec.ts` 2 testes.

**Fora de escopo S04 (S05):** `Position.ownerId` NOT NULL + backfill estrito, TOTP recovery codes, WebAuthn.

---

## 2. Tarefas S04 (5)

### T001 — `src/lib/auth/totp.ts` helper

- **Arquivos (1):** `src/lib/auth/totp.ts` — `BASE32_ALPHABET`, `base32Encode(buf)`, `base32Decode(str)`, `generateSecret(bytes=20)`, `totp(secret, time=now, step=30, digits=6)`, `verify(token, secret, window=1)`, `otpauthUrl(secret, email, issuer="Auto Trader")`, `generateRecoveryCodes(n=8)`
- **Critério:** `generateSecret` 32 chars base32, `totp` 6 dígitos, `verify(totp(secret), secret)===true`, `verify("000000", secret)===false`, `otpauthUrl` contém `otpauth://totp/`
- **Verificação:** `npx tsx -e "import {generateSecret,totp,verify} from '@/lib/auth/totp'; const s=generateSecret(); console.log(verify(totp(s),s))"` → `true`
- **Risco:** baixo — puro crypto, sem DB
- **Depende de:** nenhuma

### T002 — `POST /api/auth/mfa/setup` + `POST /api/auth/mfa/verify` + `DELETE /api/auth/mfa`

- **Arquivos (3):** `src/app/api/auth/mfa/setup/route.ts` (POST → `requireSession` → `generateSecret` → `db.user.update({mfaSecret, mfaEnabled:false})` → `{secret, otpauthUrl}`), `verify/route.ts` (POST `{token}` → `verify(token, user.mfaSecret)` → `db.user.update({mfaEnabled:true})`), `route.ts` DELETE (disable)
- **Critério:** `POST /setup` com admin cookie → `200 {secret, otpauthUrl}`, `POST /verify` com `totp(secret)` → `200 {enabled:true}`, `GET /api/auth/me` → `mfaEnabled:true`
- **Risco:** médio — toca `User.mfaSecret`
- **Depende de:** T001

### T003 — `POST /api/auth/login` segundo fator + `POST /api/auth/login/mfa`

- **Arquivos (1):** `src/app/api/auth/login/route.ts` — se `user.mfaEnabled` então `return 200 {mfaRequired:true, tempToken: hash(user.id+now)}` (store tempToken in `Session` com `expiresAt 5m` e `isMfaPending:true` ou em memória Map); novo `src/app/api/auth/login/mfa/route.ts` → `POST {tempToken, totp}` → `verify` → `Session` real + `Set-Cookie`
- **Simplificação S04:** manter login 1-step mas se `mfaEnabled` exigir `totp` no mesmo `POST /api/auth/login {email,password,totp}` — sem tempToken Map. Escolher 1-step: `if (user.mfaEnabled) { if (!body.totp || !verify(body.totp, user.mfaSecret)) return 401 {mfaRequired:true} }` — sem estado extra. (Documentar em DECISOES)
- **Critério:** `admin` sem MFA → login `200 + cookie`; `admin` com MFA + senha correta sem totp → `401 {mfaRequired:true}`; com totp certo → `200 + cookie`
- **Risco:** médio
- **Depende de:** T002

### T004 — `Position.ownerId` nullable + `src/app/admin/users/page.tsx`

- **Arquivos (4):** `prisma/schema.prisma` → `Position.ownerId String?` + `owner User? @relation` + `@@index([ownerId])`; `src/lib/trading/portfolio.ts` → `openPosition(..., ownerId)`; `src/app/api/positions/route.ts` GET filtra `where: rlsWhere(session,'position')` (future) — S04 deixa GET sem RLS mas POST já com `ownerId: session.userId`; `src/app/admin/users/page.tsx` — lista `GET /api/users` + form cria `POST /api/users` (super_admin) + `Skeleton`+`motion`
- **Critério:** `npx prisma db push` OK, `admin` cria posição → `ownerId=admin.id` (via `create wallet` já), `npx next build` OK
- **Risco:** baixo — `ownerId` nullable, sem backfill estrito
- **Depende de:** T003

### T005 — Testes MFA + DoD

- **Arquivos (3):** `tests/totp.test.ts` (generate, totp, verify, window), `scripts/test-mfa.ts` (setup+verify+login com totp), `e2e/mfa.spec.ts` (login sem totp → 401, com totp → dashboard), `DECISOES.md` #25, `SECURITY.md` REG-010
- **Critério:** `npx vitest run tests/totp.test.ts` 4/4, `npx tsx scripts/test-mfa.ts` OK, `npx next build` OK, `git diff --name-only | grep frozen` → 0
- **Risco:** baixo
- **Depende de:** T004

---

## 3. Estimativa S04

| T | Tempo |
|---|---|
| T001 | 25 min |
| T002 | 30 min |
| T003 | 20 min |
| T004 | 25 min |
| T005 | 20 min |
| **Total** | **~120 min (2h)** |
