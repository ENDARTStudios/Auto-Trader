# TASKS — Backlog Corrente

> **Versão:** 1.0 — 2026-09-23
> **Fonte viva:** `SPRINT.md` (sprint corrente) + Issues do GitHub. Este doc dá a visão consolidada.
> **Regra:** toda tarefa nasce de Issue → branch → PR → CI (ver [DEVELOPMENT.md](./DEVELOPMENT.md)).

---

## Estado atual (setembro/2026)

- Sprints **S01–S32 concluídas** (0 pendências reais — audit S32).
- CI hardening **T050–T054 concluído**: chain de coverage fechada, skip condicional Unix-socket no Windows, docker fixes, causa raiz Trivy documentada (CVEs node-tar, não regressão).
- Gate atual: `test:ci` 637 checks, lint 0, typecheck limpo, next build 45 rotas.

## Backlog priorizado

| # | Tarefa | Origem | Critério de pronto |
|---|---|---|---|
| 1 | Triagem final das CVEs restantes do npm audit (9 → 0 ou justificadas) | S32/T054 | `npm audit --audit-level=high` verde sem exceções no CI. |
| 2 | Ativar staging real no Fly.io (remover stub do job `deploy-staging`) | ROADMAP | `vars.STAGING_ENABLED=true` + `/api/health/ready` verde. |
| 3 | E2E de graduação paper→live (caminho feliz + bloqueio) | ROADMAP F | `e2e/graduation.spec.ts` cobrindo liberação e recusa. |
| 4 | Runner de e2e `mfa.spec.ts` verde em CI (hoje roda local) | CI | Job e2e passa com TOTP seed de teste. |
| 5 | Ampliar cobertura vitest nos módulos não-frozen com baseline baixa | T050 | Thresholds sobem sem quebrar chain de coverage. |
| 6 | Dashboard: painel de estado do envelope (`mode.json` + kill switches visíveis) | MANUAL_DO_OPERADOR | Operador vê estado e última transição no UI. |
| 7 | Migração default de produção para Postgres+pgvector | ROADMAP | Migrations + backup/DR validados em staging. |
| 8 | Consolidar robots.txt duplicado (`public/robots.txt` estático com placeholder × `src/app/robots.ts` dinâmico) | [SEO.md](./SEO.md) §2 | Um só source de verdade; sitemap aponta domínio real; `disallow /api/` preservado. |
| 9 | Criar `public/llms.txt` (padrão llmstxt.org) | [GEO.md](./GEO.md) §3.1 | `curl /llms.txt` 200 com 5–10 links curados dos docs. |
| 10 | Ampliar `sitemap.ts` com páginas públicas (pricing, privacy, terms) | [SEO.md](./SEO.md) §2 | Sitemap com todas as rotas públicas indexáveis. |

## Como pegar uma tarefa

1. Leia [ONBOARDING.md](./ONBOARDING.md) (uma vez) e `AGENT_GUIDE.md`.
2. Confirme que a tarefa não toca **arquivos frozen** ([RULES.md](./RULES.md) §3).
3. Quebre em sprint com T001…T00N ([TASK_BREAKING_DOWN.md](./TASK_BREAKING_DOWN.md)).
4. PR com validação anexada ([CODE_REVIEW.md](./CODE_REVIEW.md)).

## Definição de Pronto (global)

- [ ] `npm run lint` → 0 erros; `npx tsc --noEmit` → limpo.
- [ ] `npm run test:ci` → 637 checks verdes (pre-push hook REG-004).
- [ ] Cobertura vitest não regride; e2e atualizado se mudou fluxo de UI.
- [ ] Zero arquivos frozen tocados (ou exceção com ADR).
- [ ] Docs de `docs/` atualizados quando o comportamento documentado muda.
- [ ] Decisão registrada em `DECISOES.md` se houve escolha arquitetural.

---

**Relacionados:** [ROADMAP.md](./ROADMAP.md) · [TASK_BREAKING_DOWN.md](./TASK_BREAKING_DOWN.md) · [../SPRINT.md](../SPRINT.md)
