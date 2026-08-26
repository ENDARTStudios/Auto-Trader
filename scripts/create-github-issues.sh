#!/usr/bin/env bash
# scripts/create-github-issues.sh — cria issues no GitHub via `gh` CLI
# Requer: gh CLI instalado + `gh auth login` + permissão para criar issues
# Uso: bash scripts/create-github-issues.sh
#      DRY_RUN=1 bash scripts/create-github-issues.sh  (só imprime, não cria)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN="${DRY_RUN:-0}"

if ! command -v gh &>/dev/null; then
  echo "❌ gh CLI não encontrado. Instale: https://cli.github.com/" >&2
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "❌ gh não autenticado. Rode: gh auth login" >&2
  exit 1
fi

create_issue() {
  local title="$1"
  local body="$2"
  local labels="$3"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "─── DRY RUN ───"
    echo "Title: $title"
    echo "Labels: $labels"
    echo "Body:"
    echo "$body"
    echo ""
  else
    gh issue create --title "$title" --body "$body" --label "$labels" --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "USER/REPO")"
    echo "✅ Criada: $title"
  fi
}

echo "=== Criando 8 issues da S01 — Foundation Wiring ==="
echo "DRY_RUN=$DRY_RUN — $( [[ "$DRY_RUN" == "1" ]] && echo "apenas imprimindo" || echo "criando de verdade" )"
echo ""

create_issue "[FEAT] T001 — Prisma FeatureFlag model + migration" \
"**Problema:** Helper \`feature-flags.ts\` existe mas tabela \`FeatureFlag\` não existe no Prisma — \`isEnabled()\` sempre retorna false.

**Proposta:** Adicionar \`model FeatureFlag\` em \`prisma/schema.prisma\` (id, key unique, enabled, rolloutPct, description) + \`prisma migrate dev --name feature_flags\`.

**Critérios de aceite:**
- [ ] \`npx prisma migrate dev --name feature_flags\` passa
- [ ] \`npx prisma generate\` passa
- [ ] \`npm run test:ci\` verde (637 checks)

**Arquivos:** \`prisma/schema.prisma\`, \`prisma/migrations/20260826_feature_flags/migration.sql\`
**Risco:** baixo

Ver \`SPRINT.md\` T001 para detalhes." \
"enhancement"

create_issue "[FEAT] T002 — next.config headers() HSTS/CSP" \
"**Problema:** HSTS só via Caddy/middleware — se Caddy cair, prod fica sem HSTS.

**Proposta:** Adicionar \`async headers()\` em \`next.config.ts\` com HSTS \`max-age=63072000; includeSubDomains; preload\` em prod.

**Critérios:**
- [ ] \`curl -I\` em prod mostra HSTS
- [ ] \`npm run build\` passa

**Arquivos:** \`next.config.ts\`
Ver \`SPRINT.md\` T002." \
"enhancement"

create_issue "[FEAT] T003 — SEO layout canonical/OG/JSON-LD + robots/sitemap" \
"**Problema:** SEO incompleto — sem canonical, OG, JSON-LD, sitemap.

**Proposta:** Expandir \`metadata\` em \`layout.tsx\` + verificar \`robots.ts\`/\`sitemap.ts\` já criados.

**Critérios:**
- [ ] \`curl -s / | grep canonical\` → match
- [ ] \`curl -s /robots.txt\` → Allow + Sitemap
- [ ] \`curl -s /sitemap.xml\` → XML válido
- [ ] Lighthouse SEO >90

**Arquivos:** \`src/app/layout.tsx\`, \`public/og-image.png\`
Ver \`SPRINT.md\` T003." \
"enhancement"

create_issue "[FEAT] T004 — ErrorBoundary por panel + QueryCache captureError" \
"**Problema:** Nenhum panel isolado — 1 throw quebra dashboard inteiro.

**Proposta:** Envolver cada panel em \`src/app/page.tsx\` com \`<ErrorBoundary label=\"...\">\` + \`isLoading ? <Skeleton />\` + \`QueryCache.onError\` em \`providers.tsx\`.

**Critérios:**
- [ ] Throw em 1 panel → só ele mostra fallback
- [ ] isLoading mostra Skeleton no tamanho exato

**Arquivos:** \`src/app/page.tsx\`, \`src/app/providers.tsx\`
Ver \`SPRINT.md\` T004." \
"enhancement"

create_issue "[FEAT] T005 — Rate limit + handleApiError nas 5 rotas críticas" \
"**Problema:** Rotas sem rate limit app-layer nem erro padronizado.

**Proposta:** Adicionar \`checkRateLimit\` + \`try/catch → handleApiError\` em \`/api/status\`, \`/api/positions\`, \`/api/engine/start\`, \`/api/kill-switch\`, \`/api/config\`.

**Critérios:**
- [ ] 6× POST /api/auth/login → 429 + Retry-After
- [ ] Stack nunca vaza em prod

**Arquivos:** \`src/app/api/status/route.ts\` + 4 rotas, \`src/lib/rate-limit.ts\`, \`src/lib/api/error-handler.ts\`
**Risco:** medio — toca rotas
Ver \`SPRINT.md\` T005." \
"security"

create_issue "[CHORE] T006 — package.json scripts Vitest/Playwright + deps" \
"**Problema:** \`vitest.config.ts\`/\`playwright.config.ts\` existem mas \`package.json\` não tem scripts.

**Proposta:** Adicionar scripts \`test\`, \`test:run\`, \`test:coverage\`, \`test:e2e\` + devDeps \`vitest\`, \`@playwright/test\`.

**Critérios:**
- [ ] \`npx vitest run --coverage\` roda sem erro de config
- [ ] \`npm run test:ci\` ainda verde

**Arquivos:** \`package.json\`, \`vitest.config.ts\`, \`playwright.config.ts\`
Ver \`SPRINT.md\` T006." \
"chore"

create_issue "[FEAT] T007 — Motion wiring em MarketPanel (Skeleton + motion.ts)" \
"**Problema:** Motion documentado mas nenhum panel usa \`motion.ts\` + \`Skeleton\` + \`dynamic\`.

**Proposta:** Refator \`market-panel.tsx\` para provar padrão: \`isLoading → Skeleton\`, \`AnimatePresence\` + \`staggerContainer\`, variants de \`@/lib/ui/motion\`.

**Critérios:**
- [ ] \`grep \"from '@/lib/ui/motion'\" market-panel.tsx\` → match
- [ ] Slow 3G mostra skeletons shimmer

**Arquivos:** \`src/components/dashboard/market-panel.tsx\`, \`src/lib/ui/motion.ts\`, \`e2e/motion.spec.ts\`
Ver \`SPRINT.md\` T007." \
"enhancement"

create_issue "[FEAT] T008 — Seed flags + /api/feature-flags + DECISOES" \
"**Problema:** Flags sem seed nem API de toggle.

**Proposta:** Criar \`scripts/seed-flags.ts\` + \`src/app/api/feature-flags/route.ts\` (GET lista, POST toggle) + registrar em \`DECISOES.md\`.

**Critérios:**
- [ ] \`curl /api/feature-flags | jq length==9\`
- [ ] \`git diff --name-only | grep -E 'chain|signer|audit'\` → vazio (frozen intacto)

**Arquivos:** \`prisma/seed.ts\`, \`src/app/api/feature-flags/route.ts\`, \`DECISOES.md\`
Ver \`SPRINT.md\` T008." \
"enhancement"

echo ""
echo "=== 8 issues processadas ==="
if [[ "$DRY_RUN" == "1" ]]; then
  echo "Para criar de verdade: bash scripts/create-github-issues.sh"
else
  echo "Verifique em: gh issue list --limit 10"
fi
