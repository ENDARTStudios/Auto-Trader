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
**Próximo:** S04 — TOTP/MFA + `Position.ownerId` filter + password reset + admin UI completo + `e2e` full.

### Decisão #1-N (placeholder)
Este formato é baseado no template do PROMPT_DOER_MESTRE.md. Decisões anteriores seriam listadas aqui com números sequenciais.