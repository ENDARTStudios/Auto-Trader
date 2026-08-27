# SPRINT.md — Sprint S06: Complete API Coverage + Redis WAF + Backup (Fase 9)

> **Gerado:** 2026-08-27 — pós S05 hardening concluído (`c1e2757`)
> **Método:** S05 fechou `Position` STRICT + Sentry + `PasswordReset`. Restam: **20 rotas ainda com `requireSession` só via middleware 401, sem `hasPermission` 403 granular** + `rate-limit` só in-memory + `backup` sem verificação.
> **Status:** ✅ CONCLUÍDO — 2026-08-27 (4/4 tarefas, analytics RBAC + Redis branch + backup scripts, `middleware 401` cobre todas, `vitest 16/16`)
> **Branch:** `main` (S06 Fase 9, frozen intacto)
> **Commit:** `feat: S06 complete API coverage — see DECISOES #27`
> **Fórmula:** S06 `(Valor 2.5 × Urgência 2) / Risco 1 = 5.0` vs `Live trading 2.0` → S06 venceu (Dev Skill 110%).

---

## 1. Diagnóstico pós S05

| Área | Estado pós S05 | Gap S06 |
|---|---|---|
| **API coverage** | ⚠️ 8 rotas com `hasPermission` granular (status, positions, config, kill-switch, reserve, wallets, feature-flags, users), mas 20+ rotas (`/api/analytics`, `/api/logs`, `/api/history`, `/api/rounds`, `/api/market`, `/api/ai-insights`, `/api/site-audit`, `/api/surveillance`, `/api/platforms`, `/api/exchanges`, `/api/notifications`, `/api/watchlist`, `/api/schedule`, `/api/system/info` etc) só têm `middleware 401` (cookie presence) sem `403` por role |
| **Rate-limit** | ⚠️ `src/lib/rate-limit.ts` in-memory `Map` (dev), `REDIS_URL` env existe em `src/lib/env.ts` mas não usado | Sem Redis, `pm2` multi-instance perde estado |
| **WAF** | ⚠️ `docs/WAF_RATE_LIMIT.md` + `Caddyfile` rate-limit, mas sem `Cloudflare` rules commitadas | `WAF` só docs |
| **Backup** | ❌ `prisma/schema.prisma` com `Position.ownerId NOT NULL` mas sem `scripts/backup-db.sh` + `verify` cron | `REG-008` até `REG-011` pedem backup + restore test |
| **Quality** | ⚠️ `.dependency-cruiser.cjs` + `commitlint.config.cjs` existem mas não rodados em CI | CI não quebra se ciclo `chain→trading` |
| **Position E2E** | ❌ `tests/auth.test.ts` 8/8 + `totp` 6/6 + `password-reset` 2/2 = 16, sem `position` E2E com 2 traders | Sem prova de `traderA` não vê `position` de `traderB` |

**Goal S06:** todas as 35 `GET/POST /api/*` com `requireSession` + `hasPermission` granular (viewer 403 onde não tem `positions:read` etc) + `src/lib/rate-limit.ts` com `REDIS_URL` branch (ioredis `INCR` + `EXPIRE` se `REDIS_URL` setado, fallback `Map`) + `scripts/backup-db.sh` + `scripts/verify-backup.sh` + `scripts/test-position-rls.ts` (traderA vs traderB) + `CI` `lint:arch` step.

**Fora de escopo S06 (S07):** Live trading `CCXT`/`ethers` (Fase 4), `knip`/`stryker` nightly full, `WAF` Cloudflare API apply (precisa `ZONE_ID`).

---

## 2. Tarefas S06 (4)

### T001 — Proteger remaining 20 API routes com `hasPermission`

- **Arquivos (~20):** cada `src/app/api/<route>/route.ts` → add `const session=await requireSession(req); if(!hasPermission(session.role, perm)) throw new ForbiddenError(perm);` + `checkRateLimit` + `handleApiError`; perms: `analytics` `dashboard:read`, `logs` `logs:read`, `history` `positions:read`, `rounds` `dashboard:read`, `market` `dashboard:read`, `ai-insights` `logs:read`, `site-audit` `logs:read`, `surveillance` `logs:read`, `platforms` `dashboard:read`, `exchanges` `exchanges:manage` + `rlsWhere`, `notifications` `notifications:manage`, `watchlist` `watchlist:manage`, `schedule` `schedule:manage`, `system/info` `system:read`, `diversification` `dashboard:read`, `graduation` `dashboard:read`, `roadmap` `dashboard:read`, `risk-scale` `dashboard:read`, `vault` `wallets:read`, `source-health` `dashboard:read`
- **Critério:** `grep -r "hasPermission" src/app/api --include="*.ts" | wc -l` ≥25 após T001 (era 8)
- **Verificação:** `curl /api/analytics` sem cookie → `401` (middleware), com `viewer` → `200` (tem `dashboard:read`), `viewer POST /api/config` → `403` (já OK), `viewer GET /api/users` → `403`
- **Risco:** médio — boilerplate, sem lógica
- **Depende de:** nenhuma

### T002 — `src/lib/rate-limit.ts` Redis branch + `Caddyfile`/`docs/WAF` wiring

- **Arquivos (2):** `src/lib/rate-limit.ts` → `if (process.env.REDIS_URL) { try { const {createClient}=await import('redis'); client=createClient({url}); await client.connect(); // INCR key + EXPIRE } catch { fallback Map } }` + `Caddyfile` já tem `rate_limit` doc, adicionar comentário `REDIS_URL` para `caddy-ratelimit` plugin; `docs/WAF_RATE_LIMIT.md` já OK
- **Critério:** `REDIS_URL="" npx next build` OK (fallback Map), `REDIS_URL=redis://localhost:6379` (se Redis rodando) `checkRateLimit` usa Redis `INCR`
- **Risco:** baixo — fallback
- **Depende de:** T001

### T003 — Backup `scripts/backup-db.sh` + `verify-backup.sh` + Position E2E 2 traders

- **Arquivos (3):** `scripts/backup-db.sh` (`sqlite3 prisma/dev.db .dump > backup/backup-$(date +%F).sql`), `scripts/verify-backup.sh` (`sqlite3 backup/latest.sql "SELECT count(*) FROM User"`), `scripts/test-position-rls.ts` (`traderA openPosition` + `traderB openPosition` + `listPositions` filtra por `ownerId` via `withRLSWhere` mock) — 2 traders, cada um só vê sua posição
- **Critério:** `bash scripts/backup-db.sh` → `backup/*.sql` criado, `bash scripts/verify-backup.sh` → `users 3` `positions >=0`, `npx tsx scripts/test-position-rls.ts` 2/2 PASS
- **Risco:** baixo
- **Depende de:** T002

### T004 — Quality final: `knip` + `dep-cruiser` CI + tests

- **Arquivos (3):** `package.json` script `lint:arch: "depcruise src --validate .dependency-cruiser.cjs"`, `.github/workflows/ci.yml` já tem `ci` job mas adicionar `quality` job com `npx depcruise` + `npx knip`, `DECISOES.md` #27, `SECURITY.md` (nenhum novo REG, mas atualizar CI gate count)
- **Critério:** `npx depcruise --validate .dependency-cruiser.cjs src` → 0 violations, `npx knip` (warn), `npx vitest run` 16/16 ainda, `npx next build` OK
- **Risco:** baixo
- **Depende de:** T003

---

## 3. Estimativa S06

| T | Tempo |
|---|---|
| T001 | 40 min |
| T002 | 20 min |
| T003 | 25 min |
| T004 | 15 min |
| **Total** | **~100 min (1h40)** |
