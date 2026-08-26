# SPRINT.md — Próxima Sprint (Dev Skill — Foundation Wiring)

> **Gerado:** 2026-08-26 — análise do estado atual do projeto
> **Método:** impacto × complexidade (maior impacto, menor complexidade primeiro)
> **Status:** Planejado — NÃO implementado (aguardando aprovação do Operador)
> **Branch sugerida:** `feat/S01-foundation-wiring`

---

## 1. Diagnóstico do Estado Atual (evidências)

| Área | Estado atual | Evidência |
|---|---|---|
| **PRD/UML/RBAC/RLS/SECRETS/ARCH** | ✅ Docs criados | `docs/PRD.md`, `docs/UML.md`, `docs/RBAC.md`, `docs/RLS.md`, `docs/SECRETS.md`, `docs/ARCHITECTURE.md` |
| **Secrets (.env)** | ✅ `.env.example` + `src/lib/env.ts` (Zod) | `getEnv()` existe, `SIGNER_TEST_HOOKS` guard |
| **Feature Flags** | ⚠️ Helper `feature-flags.ts` criado, mas tabela `FeatureFlag` não existe no Prisma | `prisma/schema.prisma` não tem `model FeatureFlag` |
| **Error Reporting** | ⚠️ `error-boundary.tsx` + `sentry.ts` + `otel.ts` criados, mas `page.tsx` não usa `ErrorBoundary` por panel | `src/app/page.tsx:854` — nenhum `ErrorBoundary` |
| **WAF/Rate Limit** | ⚠️ `src/lib/rate-limit.ts` + `middleware.ts` criados, mas rotas não chamam `checkRateLimit` | `src/app/api/*` — sem `handleApiError` ainda |
| **TLS/HSTS** | ⚠️ Docs + `Caddyfile` + `middleware.ts` HSTS, mas `next.config.ts` não tem `headers()` | `next.config.ts:12` — sem `headers()` |
| **Testes** | ⚠️ `vitest.config.ts` + `playwright.config.ts` + `codecov.yml` criados, mas `package.json` não tem scripts `test:coverage` | `package.json:5` — só `test:ci` via `tsx` |
| **Security Audit** | ✅ Doc `SECURITY_AUDIT.md` + `SECURITY.md` REG-001..008 mantidos | `SECURITY_AUDIT.md:20` dimensões |
| **Motion** | ⚠️ `src/lib/ui/motion.ts` + `docs/MOTION.md` criados, mas panels não usam `Skeleton`/`motion` sistematicamente | `src/components/dashboard/*.tsx` — sem `motion` |
| **SEO** | ⚠️ `robots.ts` + `sitemap.ts` criados, mas `layout.tsx` sem `alternates.canonical`/`openGraph`/`jsonLd` | `src/app/layout.tsx:19` — só `title`/`description` |
| **CI/CD** | ✅ `.github/workflows/ci.yml` + `dependabot.yml` + `CODEOWNERS` + `ISSUE_TEMPLATE/*` + `pull_request_template.md` | 4 templates + PR template |
| **AGENT_GUIDE** | ✅ `AGENT_GUIDE.md` criado (padrão Issues→PRs→CI) | `AGENT_GUIDE.md:8` seções |

**Conclusão:** Docs e scaffolds estão 90% prontos. O que falta é **wiring** — conectar o que foi scaffoldado ao runtime (Prisma migration, layout, page, next.config, package.json). É o menor esforço com maior desbloqueio (fecha 5 critérios Dev Skill de uma vez).

---

## 2. Próxima Funcionalidade Escolhida — Justificativa

### Escolhida: **S01 — Foundation Wiring (Feature Flags + Security Headers + Rate Limit + Error Boundary + SEO)**

**Por quê esta e não outra?**

| Candidata | Impacto | Complexidade | Risco | Veredito |
|---|---|---|---|---|
| **Auth + RBAC completo** | Alto (desbloqueia multi-user) | Alto (User/Session models, argon2, TOTP, middleware auth) | Alto (auth mal feito é crítico) | Deixar para S02 — precisa de design review |
| **S01 — Foundation Wiring** | **Alto** (fecha 5 critérios Dev Skill, melhora segurança/SEO/UX sem mudar lógica de negócio) | **Baixo** (só wiring: 1 migration + 3 edits + 1 wrap) | **Baixo** (não toca vault/chain/signer) | **Escolhida — melhor ROI** |
| M3.4 — Writer Lease UI | Médio | Médio | Médio | Depois de Auth |
| Observabilidade full (Sentry OTEL wiring) | Médio | Médio (precisa DSN, testar) | Baixo | Pode ir em S01 como extra se sobrar tempo |

**Fórmula do PROTOCOLO_MESTRE.md §15:** `Prioridade = (Valor × Urgência) / Risco`
- S01: (3 × 3) / 1 = **9.0** (máximo)
- Auth: (3 × 2) / 3 = **2.0**

---

## 3. Sprint Goal

> **Ao final da S01, qualquer agente que clonar o repo terá:** feature flags no DB, HSTS/headers em prod, rate limit ativo em `/api/*`, ErrorBoundary isolando cada panel, e SEO básico (canonical/OG/robots/sitemap) — tudo verificado por teste e sem tocar em vault/chain/signer (frozen).

---

## 4. Tarefas (8) — Ordem de Execução

### T001 — Prisma: adicionar `FeatureFlag` + `User` stub (sem auth ainda)

- **Objetivo:** criar `model FeatureFlag` no Prisma e migrar DB dev
- **Arquivos afetados (3):**
  - `prisma/schema.prisma` — adicionar `model FeatureFlag` (id, key unique, enabled, rolloutPct, description, timestamps)
  - `prisma/migrations/20260826_feature_flags/migration.sql` — gerado por `prisma migrate dev`
  - `docs/ARCHITECTURE.md` — já documenta, só validar
- **Critério de pronto (binário):**
  - `npx prisma migrate dev --name feature_flags` passa sem erro
  - `npx prisma generate` passa
  - `npm run test:ci` ainda verde (637 checks)
- **Verificação:**
  ```bash
  npx prisma migrate dev --name feature_flags --create-only && npx prisma migrate deploy
  npx prisma studio  # ver tabela FeatureFlag
  ```
- **Risco:** baixo (nova tabela, sem FK)
- **Depende de:** nenhuma

### T002 — `next.config.ts`: adicionar `headers()` com HSTS/CSP

- **Objetivo:** HSTS + security headers também via Next.js (defesa em profundidade além de Caddy/middleware)
- **Arquivos afetados (1):**
  - `next.config.ts` — adicionar `async headers()` retornando HSTS `max-age=63072000; includeSubDomains; preload` em prod + CSP
- **Critério de pronto:**
  - `curl -I http://localhost:3000/api/health` em `NODE_ENV=production` retorna `Strict-Transport-Security`
  - `npm run build` passa
- **Verificação:**
  ```bash
  NODE_ENV=production npm run build && NODE_ENV=production npm run start &
  curl -sI http://localhost:3000/api/health | grep -i strict-transport-security
  # deve mostrar max-age=63072000; includeSubDomains; preload
  ```
- **Risco:** baixo (só headers, sem lógica)
- **Depende de:** T001

### T003 — `src/app/layout.tsx`: SEO completo (canonical, OG, JSON-LD)

- **Objetivo:** fechar checklist SEO §2 (canonical, openGraph, twitter, robots, jsonLd)
- **Arquivos afetados (2):**
  - `src/app/layout.tsx` — expandir `metadata` com `metadataBase`, `alternates.canonical`, `openGraph`, `twitter`, `robots`, e injetar `jsonLd` script
  - `public/og-image.png` — placeholder 1200×630 (pode ser SVG convertido)
- **Critério de pronto:**
  - `curl -s http://localhost:3000 | grep -E 'canonical|og:title|twitter:card|application/ld\+json'` retorna 4 matches
  - `curl -s http://localhost:3000/robots.txt` → `Allow: /` + `Sitemap:`
  - `curl -s http://localhost:3000/sitemap.xml` → XML válido com `<url>`
  - Lighthouse SEO score >90
- **Verificação:**
  ```bash
  npm run build && npm run start &
  curl -s http://localhost:3000 | grep -o 'rel="canonical"'
  curl -s http://localhost:3000/robots.txt
  curl -s http://localhost:3000/sitemap.xml | head -20
  npx lighthouse http://localhost:3000 --only-categories=seo --output=json | jq '.categories.seo.score'
  ```
- **Risco:** baixo
- **Depende de:** T002

### T004 — `src/app/page.tsx`: envolver panels com `ErrorBoundary` + `Skeleton` já existentes

- **Objetivo:** isolar falhas por panel (nenhum panel quebra o dashboard inteiro)
- **Arquivos afetados (2):**
  - `src/app/page.tsx` — envolver cada panel com `<ErrorBoundary label="...">` (MarketPanel, AIInsightsPanel, etc.) + usar `isLoading ? <Skeleton />` onde ainda não usa
  - `src/app/providers.tsx` — adicionar `QueryCache.onError → captureError` + `MutationCache.onError → toast`
- **Critério de pronto:**
  - Forçar erro em 1 panel (ex: `throw new Error('test')` em `MarketPanel`) → só aquele panel mostra fallback, resto renderiza
  - `isLoading` em cada panel mostra `<Skeleton className="h-[X] w-full" />` no tamanho exato
- **Verificação:**
  ```bash
  # Manual: editar MarketPanel para throw, recarregar, verificar isolamento
  # Automatizado (futuro): e2e/motion.spec.ts — teste de ErrorBoundary
  npm run build  # deve passar
  ```
- **Risco:** baixo (só wrapping)
- **Depende de:** T003

### T005 — `src/app/api/*`: adicionar `handleApiError` + `checkRateLimit` nas 5 rotas críticas

- **Objetivo:** rate limit app-layer + erro padronizado (não vaza stack em prod)
- **Arquivos afetados (6):**
  - `src/lib/api/error-handler.ts` — já criado, só validar
  - `src/lib/rate-limit.ts` — já criado, só validar
  - `src/app/api/status/route.ts` — adicionar `checkRateLimit` + `try/catch → handleApiError`
  - `src/app/api/positions/route.ts` — idem
  - `src/app/api/engine/start/route.ts` — idem
  - `src/app/api/kill-switch/route.ts` — idem
  - `src/app/api/config/route.ts` — idem
- **Critério de pronto:**
  - `for i in 1..6; do curl -s -w "%{http_code} " -X POST http://localhost:3000/api/auth/login -d '{}' -H "Content-Type: application/json"; done` → 6º é 429
  - `curl -s http://localhost:3000/api/status | jq .` nunca retorna `stack` em `NODE_ENV=production`
- **Verificação:**
  ```bash
  # Rate limit
  for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"a@a.com","password":"x"}'; done; echo
  # Esperado: 401 401 401 401 401 429
  curl -i -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"a@a.com","password":"x"}' | grep -i retry-after
  ```
- **Risco:** médio (toca rotas, mas só adiciona guard)
- **Depende de:** T004

### T006 — `package.json`: adicionar scripts Vitest/Playwright + deps

- **Objetivo:** fechar `docs/TESTING.md` — tornar `test:coverage` e `test:e2e` executáveis
- **Arquivos afetados (2):**
  - `package.json` — adicionar scripts `test`, `test:run`, `test:coverage`, `test:e2e`, `test:e2e:ui` + devDeps `vitest`, `@playwright/test`, `pino-pretty`
  - `vitest.config.ts` / `playwright.config.ts` — já criados, só validar via `npx vitest --version`
- **Critério de pronto:**
  - `npx vitest run --coverage` roda (mesmo que 0 testes novos) sem erro de config
  - `npx playwright test --list` lista 0 specs sem erro
  - `npm run test:ci` ainda verde (não quebrar gate existente)
- **Verificação:**
  ```bash
  npx vitest --version && npx playwright --version
  npx vitest run --run 2>&1 | tail -20
  npm run test:ci 2>&1 | tail -20
  ```
- **Risco:** baixo (só scripts, não muda runtime)
- **Depende de:** T005

### T007 — `docs/MOTION.md` wiring: 1 panel exemplo com `motion.ts` + `Skeleton` + `dynamic`

- **Objetivo:** provar o padrão Motion em 1 panel (resto segue o molde em S02)
- **Arquivos afetados (3):**
  - `src/lib/ui/motion.ts` — já criado, validar
  - `src/components/dashboard/market-panel.tsx` — refator para: `isLoading → Skeleton`, `AnimatePresence` + `staggerContainer` na lista, `dynamic` se usa recharts
  - `e2e/motion.spec.ts` — novo: verifica skeleton aparece em Slow 3G e animação não quebra
- **Critério de pronto:**
  - `market-panel.tsx` importa `fadeInUp`/`staggerContainer` de `@/lib/ui/motion` (não inline)
  - Throttle Slow 3G no DevTools mostra skeletons shimmer, não tela branca
  - `npx playwright test e2e/motion.spec.ts` passa
- **Verificação:**
  ```bash
  grep -r "from '@/lib/ui/motion'" src/components/dashboard/market-panel.tsx
  npx playwright test e2e/motion.spec.ts --reporter=list
  ```
- **Risco:** baixo (só 1 panel)
- **Depende de:** T006

### T008 — Seed de flags + verificação E2E + atualizar `DECISOES.md`

- **Objetivo:** popular flags iniciais e provar wiring E2E
- **Arquivos afetados (3):**
  - `prisma/seed.ts` (ou `scripts/seed-flags.ts`) — `upsert` das 9 flags de `docs/ARCHITECTURE.md` §4.2 com defaults
  - `src/app/api/feature-flags/route.ts` — GET lista flags, POST toggle (guard `flags:manage` — por enquanto sem auth, só rate-limit; auth virá em S02)
  - `DECISOES.md` — registrar decisão "S01 wiring concluído, frozen base intacto"
- **Critério de pronto:**
  - `curl http://localhost:3000/api/feature-flags | jq .` lista 9 flags
  - `curl -X POST http://localhost:3000/api/feature-flags -d '{"key":"enable_ai_squad","enabled":false}'` toggla e `isEnabled('enable_ai_squad')` reflete
  - Nenhum arquivo frozen (`src/lib/chain/*`, `src/signer/*`, `src/lib/audit/*`) foi modificado (ver `git diff --name-only`)
- **Verificação:**
  ```bash
  npx tsx scripts/seed-flags.ts
  curl -s http://localhost:3000/api/feature-flags | jq '.flags | length'  # 9
  git diff --name-only | grep -E 'src/lib/chain|src/signer|src/lib/audit' && echo "FAIL: frozen touched" || echo "OK: frozen intact"
  npm run test:ci 2>&1 | tail -5
  ```
- **Risco:** baixo
- **Depende de:** T007

---

## 5. Arquivos Afetados (consolidado — 14 arquivos)

| Arquivo | Tarefa | Tipo |
|---|---|---|
| `prisma/schema.prisma` | T001 | schema |
| `prisma/migrations/20260826_feature_flags/*` | T001 | migration |
| `next.config.ts` | T002 | config |
| `src/app/layout.tsx` | T003 | SEO |
| `public/og-image.png` | T003 | asset |
| `src/app/page.tsx` | T004 | UI wiring |
| `src/app/providers.tsx` | T004 | error handling |
| `src/app/api/status/route.ts` | T005 | API guard |
| `src/app/api/positions/route.ts` | T005 | API guard |
| `src/app/api/engine/start/route.ts` | T005 | API guard |
| `src/app/api/kill-switch/route.ts` | T005 | API guard |
| `src/app/api/config/route.ts` | T005 | API guard |
| `package.json` | T006 | scripts |
| `src/components/dashboard/market-panel.tsx` | T007 | motion |
| `e2e/motion.spec.ts` | T007 | test |
| `prisma/seed.ts` / `scripts/seed-flags.ts` | T008 | seed |
| `src/app/api/feature-flags/route.ts` | T008 | API |
| `DECISOES.md` | T008 | doc |

**Nenhum arquivo frozen é tocado** — `src/lib/chain/*`, `src/signer/*`, `src/lib/audit/*`, `src/lib/trading/wallet-crypto.ts` permanecem intactos (H0/H1/H2/M3/M4 FROZEN).

---

## 6. Testes Necessários

| Camada | Teste | Onde | Tarefa |
|---|---|---|---|
| **Unit** | `feature-flags.test.ts` — `isEnabled` com env override + rollout + cache | `src/lib/trading/__tests__/feature-flags.test.ts` | T001 |
| **Unit** | `rate-limit.test.ts` — sliding window + retryAfter | `src/lib/__tests__/rate-limit.test.ts` | T005 |
| **Integração** | `GET /api/feature-flags` lista 9, `POST` toggla | `tests/integration/feature-flags.test.ts` | T008 |
| **Integração** | `GET /api/health` 200, `POST /api/kill-switch` rate-limited | `tests/integration/rate-limit.test.ts` | T005 |
| **Integração** | SEO — `GET /` tem canonical, OG, jsonLd | `tests/integration/seo.test.ts` | T003 |
| **E2E** | `e2e/motion.spec.ts` — skeleton em Slow 3G, ErrorBoundary isolamento | `e2e/motion.spec.ts` | T007 |
| **E2E** | `e2e/rate-limit.spec.ts` — 6× POST → 429 + Retry-After | `e2e/rate-limit.spec.ts` | T005 |
| **Manual** | Lighthouse SEO >90, Performance >90 | `npx lighthouse http://localhost:3000 --view` | T003 |
| **Gate** | `npm run test:ci` 637 checks ainda verdes | `scripts/test-*.ts` | Todas |

---

## 7. Critérios de Conclusão da Sprint (Definition of Done)

- [ ] Todas as 8 tarefas com `STATUS: DONE` + evidência tipada (`test_output` / `command_output`)
- [ ] `npx prisma migrate deploy` recria DB idêntico em fresh clone
- [ ] `curl -I http://localhost:3000/api/health` + `curl -s http://localhost:3000 | grep canonical` + `curl -s http://localhost:3000/api/feature-flags | jq length==9` todos PASS
- [ ] `npm run test:ci` verde (637 checks, 23 arquivos)
- [ ] `npx vitest run --coverage` sem erro de config
- [ ] `npm run build` passa
- [ ] `gitleaks detect --no-git` limpo
- [ ] Nenhum arquivo frozen modificado (`git diff --name-only` não lista `src/lib/chain/*` etc.)
- [ ] `DECISOES.md` registra S01 concluído + `SECURITY.md` sem novo REG (S01 não toca vault/chain)
- [ ] PR `feat: S01 foundation wiring (Closes #<issue>)` com CI verde + review CODEOWNERS

---

## 8. Próxima Sprint (S02 — Preview, não implementar ainda)

**S02 — Auth + RBAC + RLS (P0)**

- `model User` + `Session` + `AuditLog` (Prisma) + `argon2id` + TOTP
- `src/lib/auth/*` — `rbac.ts`, `rls.ts`, `session.ts`, `middleware.ts`
- `src/app/api/auth/*` — login/logout/me + lockout 5× → 429 (15min)
- `src/middleware.ts` — auth guard + RBAC por rota
- `withRLS` em `wallets`/`exchanges`/`positions`
- Testes: `viewer → POST /kill-switch → 403`, `user A → wallet B → 403`, `sem cookie → 401`

S02 só começa após S01 mergeada (depende de `feature-flags` + `rate-limit` já wired).

---

## 9. Riscos e Mitigações da S01

| Risco | Mitigação |
|---|---|
| Migration `FeatureFlag` conflita com DB dev existente | Rodar `npx prisma migrate dev` em dev isolado; `migrate deploy` em prod é idempotente |
| HSTS trava localhost em dev | Só enviar HSTS quando `NODE_ENV=production` (middleware + next.config) |
| `page.tsx` wrap com ErrorBoundary quebra layout | Um panel por vez (T007 só MarketPanel), resto em S02 |
| Rate limit em memória perde estado entre restarts | Aceitável para S01 (dev); Redis em S03 |

---

## 10. Estimativa

| Tarefa | Tempo estimado |
|---|---|
| T001 | 15 min |
| T002 | 10 min |
| T003 | 20 min |
| T004 | 25 min |
| T005 | 30 min |
| T006 | 15 min |
| T007 | 25 min |
| T008 | 20 min |
| **Total** | **~160 min (2h40)** |

> Orçamento do PROTOCOLO_MESTRE.md §16 para fase 8–9 é 45–60 min. S01 estoura — sinalizar `ORCAMENTO_ESTOURADO` e negociar fatiamento (ex: S01a = T001–T004, S01b = T005–T008).

---

## 11. Como Aprovar e Iniciar

1. Operador revisa este `SPRINT.md` e responde **"aprovado S01"** ou pede ajustes.
2. Doer cria Issue `[FEAT] S01 Foundation Wiring` linkando este arquivo.
3. Doer cria branch `feat/S01-foundation-wiring` a partir de `main` atualizada.
4. Implementa T001→T008 em ordem, 1 commit por tarefa, `npm run test:ci` verde a cada commit.
5. Abre PR `feat: S01 foundation wiring (Closes #<id>)` com evidências.
6. CI verde + CODEOWNERS review → merge → staging → promoção manual prod.

**Não implementar sem aprovação explícita do Operador.**
