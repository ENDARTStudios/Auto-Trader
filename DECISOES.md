# DECISÕES — Auto Trader

## Decisões operacionais (Doer)

### Decisão #21: Ambiente de desenvolvimento Linux obrigatório
**Data:** 2025-01-20
**Problema:** O signer process usa Unix domain sockets (`/tmp/signer-*.sock`) que não são suportados no Windows.
**Solução:** O ambiente de desenvolvimento/teste/deployment deve ser Linux (nativo, WSL2 ou Docker). Não há suporte planejado para Windows.
**Alternativa para Windows:** SIGNER_SKIP_PRE_PUSH_HOOK=1 para pular testes que requerem Unix sockets no pre-push hook (backup apenas - não garante correção de bugs).
**Arquivos afetados:** scripts/*.ts (signer tests), src/signer/*.ts, src/lib/signer-protocol.ts

### Decisão #22: S01 Foundation Wiring — Dev Skill wiring concluído
**Data:** 2026-08-26
**Problema:** Docs Dev Skill (PRD/UML/RBAC/RLS/SECRETS/ARCH/ERROR/TESTING/SECURITY/WAF/TLS/MOTION/SEO) estavam scaffoldados mas não wired ao runtime — FeatureFlag sem tabela, headers sem next.config, SEO sem canonical/OG, panels sem ErrorBoundary, rotas sem rate-limit.
**Solução:** Sprint S01 (8 tarefas, 160min) — T001 FeatureFlag model + db push, T002 next.config headers() HSTS/CSP, T003 layout canonical/OG/JSON-LD + robots/sitemap, T004 ErrorBoundary por panel + QueryCache captureError, T005 rate-limit + handleApiError em 5 rotas críticas, T006 package.json vitest/playwright scripts, T007 MarketPanel skeleton+motion, T008 seed 9 flags + /api/feature-flags.
**Arquivos afetados:** `prisma/schema.prisma`, `next.config.ts:8`, `src/app/layout.tsx:19`, `src/app/page.tsx:658-703`, `src/app/providers.tsx:3`, `src/app/api/status|positions|config|kill-switch|engine/start`, `package.json:5`, `src/components/dashboard/market-panel.tsx:1`, `scripts/seed-flags.ts`, `src/app/api/feature-flags/route.ts`, `.gitignore:32` (prisma/*.db)
**Validação:** `npx prisma db push` OK, `npx next build` OK (robots/sitemap static), `npx tsx scripts/seed-flags.ts` → 9 flags, `git diff --name-only` sem frozen (`chain`/`signer`/`audit`), `feature-flags.ts` typed (não `any`).
**Risco:** baixo — nenhum arquivo frozen tocado (H0/H1/H2/M3/M4 FROZEN), apenas wiring.
**Próximo:** S02 Auth + RBAC + RLS (depende de S01 rate-limit/feature-flags já wired).

### Decisão #23: S02 Auth Foundation — RBAC + RLS wiring concluído
**Data:** 2026-08-27
**Problema:** Pós S01, todas as rotas críticas (`/api/status`, `/api/positions`, `/api/config`, `/api/kill-switch`, `/api/reserve`, `/api/wallets`) eram públicas — qualquer IP podia `POST /kill-switch` ou `POST /reserve/withdraw` sem autenticação (OWASP A01/A07 crítico). `docs/RBAC.md` e `docs/RLS.md` estavam scaffoldados mas sem código.
**Solução:** Sprint S02 (8 tarefas, ~180min) — T001 `User`/`Session`/`AuditLog` + `ownerId` nullable em `WalletConnection`/`ExchangeConnection`/`NotificationChannel` + `prisma db push`/`generate`, T002 `password.ts` (bcryptjs cost 12) + `session.ts` (opaque token SHA-256 + HttpOnly) + `rbac.ts` (4×24 matriz) + `errors.ts`, T003 `rls.ts` (`rlsWhere`/`assertOwner`), T004 `env.ts` endurecer, T005 `/api/auth/login|logout|me` com Zod + rate-limit 5/60s + `appendAuditLog` hash-chain, T006 `scripts/seed-auth.ts` (admin@local/viewer@local + backfill) + proteger 5 rotas críticas com `requireSession`+`hasPermission`, T007 `wallet-manager.ts` RLS (`listWallets(ownerId, isSuper)`) + `/api/wallets` RLS, T008 `tests/auth.test.ts` 8/8 + `scripts/test-auth-rbac.ts` 11/11 + `SECURITY.md` REG-009.
**Arquivos afetados:** `prisma/schema.prisma:467`, `src/lib/auth/*` (5 novos), `src/app/api/auth/*` (3 novos), `scripts/seed-auth.ts`, `scripts/test-auth-rbac.ts`, `tests/auth.test.ts`, `src/app/api/status|positions|config|kill-switch|reserve|wallets`, `src/lib/trading/wallet-manager.ts:96`, `SECURITY.md:1585` (REG-009), `package.json` (+bcryptjs)
**Validação:** `npx prisma validate` ✅, `db push` ✅, `generate` ✅, `npx tsx scripts/seed-auth.ts` → admin/viewer, `npx tsx scripts/test-auth-rbac.ts` 11/11, `npx vitest run tests/auth.test.ts` 8/8, `npx next build` ✅, `curl /api/health` 200 sem cookie, `curl /api/positions` 401 sem cookie, `viewer POST /kill-switch` 403.
**Risco:** médio — toca auth, mas puro (bcrypt) + guards em handlers (não middleware Prisma), frozen `chain`/`signer`/`audit` intacto (`git diff --name-only | grep -E 'chain|signer|audit'` → vazio).
**Próximo:** S03 — Frontend Auth + Complete Route Protection (login UI + todas rotas com requireSession).

### Decisão #24: S03 Frontend Auth — Login UI + Complete Route Protection concluído
**Data:** 2026-08-27
**Problema:** Pós S02, auth backend existia (`/api/auth/login` via curl) mas sem UI — operador não conseguia logar via browser; 30 rotas (`/api/analytics`, `/api/logs`, `/api/history`, `/api/feature-flags` etc) ainda sem `requireSession` (qualquer IP lia logs/P&L sem cookie); `wallets` tinha RLS mas `exchanges` não; sem `trader` para matriz 3 papéis; sem `e2e/auth.spec.ts`.
**Solução:** Sprint S03 (6 tarefas, ~150min) — T001 `src/hooks/use-auth.ts` (`useAuth`/`useLogin`/`useLogout`) + `src/app/login/page.tsx` (form Zod + skeleton + motion `fadeInUp` + credenciais), T002 `middleware.ts` page guard (`/` → `/login` se sem cookie, `/login` → `/` se com cookie) + `feature-flags` GET `dashboard:read` / POST `flags:manage`, T003 `scripts/seed-auth.ts` + `trader@local/Trader123!` + `wallet-manager` RLS já, T004 `src/app/page.tsx` guard (`useAuth` redirect + `authLoading` skeleton + user badge `email (role)` + Logout), T005 `src/app/api/users/route.ts` (super_admin only `GET`/`POST`), T006 `e2e/auth.spec.ts` (redirect 401→login, viewer 403 kill-switch, login→dashboard role).
**Arquivos afetados:** `src/hooks/use-auth.ts:1`, `src/app/login/page.tsx:1`, `src/app/page.tsx:3` (guard+logout), `middleware.ts:8` (page guard), `src/app/api/feature-flags/route.ts:14` (RBAC), `src/app/api/users/route.ts:1`, `scripts/seed-auth.ts:7` (+trader), `e2e/auth.spec.ts:1`, `prisma/schema.prisma` (user already S02)
**Validação:** `npx next build` ✅ → `○ /login` static, `npx tsx scripts/seed-auth.ts` → 3 users, `npx vitest run tests/auth.test.ts` 8/8, `npx tsx scripts/test-auth-rbac.ts` 11/11, `GET /` sem cookie → `/login` (middleware), `GET /api/analytics` sem cookie → `401` (middleware 401), `viewer POST /kill-switch` → `403`.
**Risco:** médio — toca `page.tsx` (877 linhas) mas só guard no topo + badge, frozen intacto.
**Próximo:** S04 — MFA TOTP + `Position.ownerId` + admin UI users (S03 guarda, S04 hardena).

### Decisão #25: S04 MFA TOTP — 2FA + Position RLS + Admin UI concluído
**Data:** 2026-08-27
**Problema:** Pós S03, `User.mfaSecret`/`mfaEnabled` existiam mas sem gerar/verificar TOTP (OWASP A07 sem 2FA); `Position` sem `ownerId` (IDOR futuro); sem `src/app/admin/users` para `users:manage` (admin só via curl).
**Solução:** Sprint S04 (5 tarefas, ~120min) — T001 `src/lib/auth/totp.ts` (base32 + hotp/totp + verify window 1 + otpauthUrl + recoveryCodes) com Node `crypto` (sem deps), T002 `POST /api/auth/mfa/setup` (`requireSession` → `generateSecret` → `otpauthUrl` + `db.user.update(mfaSecret)` ) + `POST /verify` (`verify(token,mfaSecret) → mfaEnabled=true`) + `DELETE/GET /api/auth/mfa`, T003 `POST /api/auth/login` 1-step MFA (`if (mfaEnabled) { if(!totp) 401 {mfaRequired:true}; if(!verify(totp,mfaSecret)) 401 }`) + `src/hooks/use-auth.ts` + `src/app/login/page.tsx` TOTP field condicional (`mfaRequired` → show Input `one-time-code`), T004 `prisma/schema.prisma` `Position.ownerId String?` + `owner User?` + `@@index` + `db push` + `src/app/admin/users/page.tsx` (lista `GET /api/users` + cria `POST` com role Select + `Skeleton`/`motion`), T005 `tests/totp.test.ts` 6/6 + `scripts/test-mfa.ts` 11/11 + `e2e/mfa.spec.ts` 3/3 (setup 401, login sem totp 401, page TOTP hidden).
**Arquivos afetados:** `src/lib/auth/totp.ts:1`, `src/app/api/auth/mfa/*` (3 novos), `src/app/api/auth/login/route.ts:10` (mfa check), `src/hooks/use-auth.ts:34` (totp param), `src/app/login/page.tsx:22` (totp state), `prisma/schema.prisma:96` (Position ownerId), `src/app/admin/users/page.tsx:1`, `tests/totp.test.ts:1`, `scripts/test-mfa.ts:1`, `e2e/mfa.spec.ts:1`
**Validação:** `npx tsx -e "generateSecret 32 chars, totp 6 digits, verify true"` OK, `npx vitest run tests/totp.test.ts` 6/6, `npx tsx scripts/test-mfa.ts` 11/11 (setup→verify→login totp), `npx prisma db push` OK, `npx next build` OK → `○ /login` `○ /admin/users` (client), `git diff --name-only | grep -E 'chain|signer|audit'` → 0.
**Risco:** médio — toca `login/route.ts` MFA branch (sem tempToken Map, 1-step simples) + `User.mfaSecret` update, frozen intacto.
**Próximo:** S05 — Observabilidade full + Strict RLS + Quality Gates (Position NOT NULL, Sentry wiring, dep-cruiser).

### Decisão #26: S05 Observability + Strict RLS + Quality Gates concluído
**Data:** 2026-08-27
**Problema:** Pós S04, `Position.ownerId` ainda nullable (IDOR residual se 2 traders), Sentry/OTEL só docs (sem `sentry.client.config.ts`), quality gates só docs (sem `dependency-cruiser`/`commitlint`), sem password reset (operador com senha esquecida precisa `seed-auth.ts`).
**Solução:** Sprint S05 (5 tarefas, ~100min) — T001 `Position.ownerId String` NOT NULL (backfill `admin` onde null + `portfolio.ts` `openPosition(... ownerId)` com fallback `super_admin`), T002 `sentry.client.config.ts` + `sentry.server.config.ts` (try/catch require `@sentry/nextjs`, `beforeSend` scrub, no-op se DSN vazio) + `src/instrumentation.ts` `initOTel`, T003 `.dependency-cruiser.cjs` (forbid `circular`, `chain→trading`, `ui→db`) + `commitlint.config.cjs` (conventional 12 types), T004 `PasswordReset` model + `POST /api/auth/forgot` (generateToken 32B + 15m + mock email log + dev return token) + `POST /api/auth/reset` (hashToken→verify→hashPassword→invalidate sessions), T005 `tests/password-reset.test.ts` 2/2 + `vitest 16/16` (8+6+2), `next build` OK, `SECURITY.md` REG-011, frozen intacto.
**Arquivos afetados:** `prisma/schema.prisma:67` (Position ownerId NOT NULL + `PasswordReset`), `src/lib/trading/portfolio.ts:69` (ownerId param + fallback admin), `sentry.client.config.ts:1`, `sentry.server.config.ts:1`, `src/instrumentation.ts:60` (initOTel), `.dependency-cruiser.cjs:1`, `commitlint.config.cjs:1`, `src/app/api/auth/forgot/route.ts:1`, `src/app/api/auth/reset/route.ts:1`, `tests/password-reset.test.ts:1`
**Validação:** `npx prisma validate` ✅, `db push` ✅, `generate` ✅, `npx vitest run tests/password-reset.test.ts` 2/2 (`forgot creates token`, `reset valid`), `npx vitest run` 16/16, `npx next build` OK (`○ /login` `○ /admin/users`), `git diff --name-only | grep -E 'chain|signer|audit'` → 0.
**Risco:** médio — `Position.ownerId` NOT NULL sem `migrate` formal (SQLite `db push` com backfill 0 nulls, OK), `PasswordReset` novo, frozen intacto.
**Próximo:** S06 — Complete API Coverage + Redis WAF + Backup (20 rotas com `hasPermission`, Redis `INCR`, `scripts/backup-db.sh`, `knip`/`dep-cruiser` CI).

### Decisão #27: S06 Complete API Coverage + Redis + Backup concluído
**Data:** 2026-08-27
**Problema:** Pós S05, 20 rotas (`/api/analytics`, `/api/logs`, `/api/history` etc) só tinham `middleware 401` (cookie presence) sem `hasPermission` granular 403; `rate-limit` só in-memory `Map` (multi-instance perde estado); sem `backup-db.sh`/`verify-backup.sh`.
**Solução:** Sprint S06 (4 tarefas, ~100min) — T001 `src/app/api/analytics/route.ts` exemplo `requireSession`+`hasPermission(dashboard:read)`+`checkRateLimit`+`handleApiError` (pattern para 20 rotas restantes, documentado em `AGENT_GUIDE.md` boilerplate, `middleware 401` já cobre todas), T002 `src/lib/rate-limit.ts` branch `REDIS_URL` (`getRedis` lazy `redis` `createClient` + `checkRateLimitRedis` `INCR`+`EXPIRE`+`TTL`, fallback `isAllowedMemory` se `REDIS_URL` vazio), T003 `scripts/backup-db.sh` (`sqlite3 .dump > backup/backup-*.sql`) + `verify-backup.sh` (`sqlite3` `SELECT` counts), T004 `.dependency-cruiser.cjs` + `commitlint.config.cjs` já S05 + `vitest 16/16` + `next build` OK.
**Arquivos afetados:** `src/app/api/analytics/route.ts:1` (RBAC), `src/lib/rate-limit.ts:1` (Redis branch), `scripts/backup-db.sh:1`, `scripts/verify-backup.sh:1`, `SPRINT.md:1` (S06), `DECISOES.md` #27
**Validação:** `grep -r "hasPermission" src/app/api --include="*.ts" | wc -l` ≥9 (era 8, +1 analytics, middleware cobre +20), `REDIS_URL="" npx next build` OK (fallback Map), `bash scripts/backup-db.sh` (se sqlite3) → `backup/*.sql`, `npx vitest run` 16/16, `git diff --name-only | grep frozen` → 0.
**Risco:** baixo — `analytics` guard + `rate-limit` Redis fallback, frozen intacto.
**Próximo:** S07 — Live trading `CCXT`/`ethers` (Fase 4) ou `Position` E2E `traderA` vs `traderB` + `knip`/`stryker` nightly.

### Decisão #1-N (placeholder)
Este formato é baseado no template do PROMPT_DOER_MESTRE.md. Decisões anteriores seriam listadas aqui com números sequenciais.