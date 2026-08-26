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

### Decisão #1-N (placeholder)
Este formato é baseado no template do PROMPT_DOER_MESTRE.md. Decisões anteriores seriam listadas aqui com números sequenciais.