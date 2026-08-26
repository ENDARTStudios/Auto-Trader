# ISSUES BACKLOG — Dev Skill

> **Gerado:** 2026-08-26
> **Como usar:** rode `bash scripts/create-github-issues.sh` (requer `gh` CLI autenticado) ou crie manualmente via GitHub UI usando os templates em `.github/ISSUE_TEMPLATE/`.

---

## Sprint S01 — Foundation Wiring (8 issues — P0)

| # | Título | Template | Labels | Prioridade |
|---|---|---|---|---|
| 1 | `[FEAT] T001 — Prisma FeatureFlag model + migration` | feature_request | enhancement, sprint:S01 | P0 |
| 2 | `[FEAT] T002 — next.config headers() HSTS/CSP` | feature_request | enhancement, sprint:S01 | P0 |
| 3 | `[FEAT] T003 — SEO layout canonical/OG/JSON-LD + robots/sitemap` | feature_request | enhancement, sprint:S01 | P0 |
| 4 | `[FEAT] T004 — ErrorBoundary por panel + QueryCache captureError` | feature_request | enhancement, sprint:S01 | P0 |
| 5 | `[FEAT] T005 — Rate limit + handleApiError nas 5 rotas críticas` | security | security, sprint:S01 | P0 |
| 6 | `[CHORE] T006 — package.json scripts Vitest/Playwright + deps` | chore | chore, sprint:S01 | P1 |
| 7 | `[FEAT] T007 — Motion wiring em MarketPanel (Skeleton + motion.ts)` | feature_request | enhancement, sprint:S01 | P1 |
| 8 | `[FEAT] T008 — Seed flags + /api/feature-flags + DECISOES` | feature_request | enhancement, sprint:S01 | P1 |

### Corpo de cada issue (copiar para GitHub)

#### Issue 1 — T001

```md
**Problema:** Helper `feature-flags.ts` existe mas tabela `FeatureFlag` não existe no Prisma — `isEnabled()` sempre retorna false.

**Proposta:** Adicionar `model FeatureFlag` em `prisma/schema.prisma` (id, key unique, enabled, rolloutPct, description) + `prisma migrate dev --name feature_flags`.

**Critérios de aceite:**
- [ ] `npx prisma migrate dev --name feature_flags` passa
- [ ] `npx prisma generate` passa
- [ ] `npm run test:ci` verde (637 checks)

**Arquivos:** `prisma/schema.prisma`, `prisma/migrations/20260826_feature_flags/migration.sql`
**Risco:** baixo
```

#### Issue 2 — T002

```md
**Problema:** HSTS só via Caddy/middleware — se Caddy cair, prod fica sem HSTS.

**Proposta:** Adicionar `async headers()` em `next.config.ts` com HSTS `max-age=63072000; includeSubDomains; preload` em prod.

**Critérios:**
- [ ] `curl -I` em prod mostra HSTS
- [ ] `npm run build` passa

**Arquivos:** `next.config.ts`
```

#### Issue 3 — T003

```md
**Problema:** SEO incompleto — sem canonical, OG, JSON-LD, sitemap.

**Proposta:** Expandir `metadata` em `layout.tsx` + verificar `robots.ts`/`sitemap.ts` já criados.

**Critérios:**
- [ ] `curl -s / | grep canonical` → match
- [ ] `curl -s /robots.txt` → Allow + Sitemap
- [ ] `curl -s /sitemap.xml` → XML válido
- [ ] Lighthouse SEO >90

**Arquivos:** `src/app/layout.tsx`, `public/og-image.png`
```

#### Issue 4 — T004

```md
**Problema:** Nenhum panel isolado — 1 throw quebra dashboard inteiro.

**Proposta:** Envolver cada panel em `src/app/page.tsx` com `<ErrorBoundary label="...">` + `isLoading ? <Skeleton />` + `QueryCache.onError` em `providers.tsx`.

**Critérios:**
- [ ] Throw em 1 panel → só ele mostra fallback
- [ ] isLoading mostra Skeleton no tamanho exato

**Arquivos:** `src/app/page.tsx`, `src/app/providers.tsx`
```

#### Issue 5 — T005

```md
**Problema:** Rotas sem rate limit app-layer nem erro padronizado.

**Proposta:** Adicionar `checkRateLimit` + `try/catch → handleApiError` em `/api/status`, `/api/positions`, `/api/engine/start`, `/api/kill-switch`, `/api/config`.

**Critérios:**
- [ ] 6× POST /api/auth/login → 429 + Retry-After
- [ ] Stack nunca vaza em prod

**Arquivos:** `src/app/api/status/route.ts` + 4 rotas, `src/lib/rate-limit.ts`, `src/lib/api/error-handler.ts`
**Risco:** medio — toca rotas
```

#### Issue 6 — T006

```md
**Problema:** `vitest.config.ts`/`playwright.config.ts` existem mas `package.json` não tem scripts.

**Proposta:** Adicionar scripts `test`, `test:run`, `test:coverage`, `test:e2e` + devDeps `vitest`, `@playwright/test`.

**Critérios:**
- [ ] `npx vitest run --coverage` roda sem erro de config
- [ ] `npm run test:ci` ainda verde

**Arquivos:** `package.json`, `vitest.config.ts`, `playwright.config.ts`
```

#### Issue 7 — T007

```md
**Problema:** Motion documentado mas nenhum panel usa `motion.ts` + `Skeleton` + `dynamic`.

**Proposta:** Refator `market-panel.tsx` para provar padrão: `isLoading → Skeleton`, `AnimatePresence` + `staggerContainer`, variants de `@/lib/ui/motion`.

**Critérios:**
- [ ] `grep "from '@/lib/ui/motion'" market-panel.tsx` → match
- [ ] Slow 3G mostra skeletons shimmer

**Arquivos:** `src/components/dashboard/market-panel.tsx`, `src/lib/ui/motion.ts`, `e2e/motion.spec.ts`
```

#### Issue 8 — T008

```md
**Problema:** Flags sem seed nem API de toggle.

**Proposta:** Criar `scripts/seed-flags.ts` + `src/app/api/feature-flags/route.ts` (GET lista, POST toggle) + registrar em `DECISOES.md`.

**Critérios:**
- [ ] `curl /api/feature-flags | jq length==9`
- [ ] `git diff --name-only | grep -E 'chain|signer|audit'` → vazio (frozen intacto)

**Arquivos:** `prisma/seed.ts`, `src/app/api/feature-flags/route.ts`, `DECISOES.md`
```

---

## Backlog Futuro (não entrar em S01)

| # | Título | Tipo | Prioridade |
|---|---|---|---|
| 9 | `[FEAT] S02 — Auth + RBAC + RLS (User/Session/AuditLog)` | feature | P0 |
| 10 | `[FEAT] S02 — withRLS em wallets/exchanges/positions` | security | P0 |
| 11 | `[FEAT] S03 — Observabilidade full (Sentry DSN + OTEL wiring)` | feat | P1 |
| 12 | `[CHORE] Knip — remover código morto (3 arquivos órfãos)` | chore | P2 |
| 13 | `[SECURITY] HSTS preload submissão + securityheaders.com A+` | security | P1 |
| 14 | `[FEAT] Three.js hero + GSAP equity draw (motion avançado)` | feat | P3 |
| 15 | `[CHORE] Migrar test:ci de tsx para Vitest (637 checks)` | chore | P1 |

---

## Como criar no GitHub

```bash
# Opção 1 — script automático (requer gh auth login)
bash scripts/create-github-issues.sh

# Opção 2 — manual: GitHub → Issues → New issue → escolha template → cole corpo acima
```
