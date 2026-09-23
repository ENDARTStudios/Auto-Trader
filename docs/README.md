# Documentação — Auto Trader

> **Versão:** 1.0 — 2026-09-23
> **Produto:** Sistema autônomo de paper trading de criptomoedas com scam detection multicamada, circuit breakers e graduação controlada paper → live.
> **Como usar:** este é o índice mestre. Comece por [ONBOARDING.md](./ONBOARDING.md) se é sua primeira vez no repo.

---

## 1. Fundação (o que & por quê)

| Doc | O que define |
|---|---|
| [PRD.md](./PRD.md) | Produto: visão, personas, escopo, critérios de sucesso. |
| [DEFINE_THE_USER.md](./DEFINE_THE_USER.md) | Quem é o usuário operador — jobs, dores, sucessos. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Monolito modular: catálogo de apps + feature flags. |
| [UML.md](./UML.md) | Diagramas UML do domínio e do engine. |
| [CHOOSE_TECH_STACK.md](./CHOOSE_TECH_STACK.md) | Decisões de stack e respectivas justificativas. |
| [ADR.md](./ADR.md) | Índice de decisões arquiteturais (fonte viva: `DECISOES.md`). |
| [RULES.md](./RULES.md) | Regras vinculantes: skill de evolução, envelope humano, arquivos frozen. |
| [RESEARCH.md](./RESEARCH.md) | Pesquisa: 20 repos analisados, fontes de dados, forward OOS. |

## 2. Planejamento (quando & o quê)

| Doc | O que define |
|---|---|
| [ROADMAP.md](./ROADMAP.md) | Fases passadas, presente e futuras (fonte viva: `PLANO_MESTRE.md`). |
| [TASKS.md](./TASKS.md) | Backlog corrente e critérios de pronto (fonte viva: `SPRINT.md`). |
| [TASK_BREAKING_DOWN.md](./TASK_BREAKING_DOWN.md) | Como quebrar tarefas em sprints T001…T00N validáveis. |
| [ITERATION.md](./ITERATION.md) | Ciclo de iteração: episódios → aprendizado → evolução. |
| [MEMORY.md](./MEMORY.md) | Onde vive o estado/aprendizado do sistema e do time. |
| [CHANGELOG.md](./CHANGELOG.md) | Histórico de versões do produto. |

## 3. Desenvolvimento (como)

| Doc | O que define |
|---|---|
| [ONBOARDING.md](./ONBOARDING.md) | Trilha de entrada para novos agentes/devs. |
| [SETUP.md](./SETUP.md) | Setup passo a passo do ambiente. |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Fluxo diário: Issues → PRs → CI, pre-push gate. |
| [STYLE_GUIDE.md](./STYLE_GUIDE.md) | Convenções de código e estrutura de módulos. |
| [LINT.md](./LINT.md) | Regras ESLint (0 erros é gate). |
| [CODE_REVIEW.md](./CODE_REVIEW.md) | Checklist e tom de review. |
| [TESTING.md](./TESTING.md) | Estratégia de testes (Vitest + Playwright). |
| [DESIGN.md](./DESIGN.md) | Design system (Tailwind + shadcn/ui + motion). |
| [CONTENT.md](./CONTENT.md) | Conteúdo, i18n e tom de voz. |
| [MOTION.md](./MOTION.md) | Diretrizes de animação. |

## 4. Qualidade & Segurança

| Doc | O que define |
|---|---|
| [QA_TESTING.md](./QA_TESTING.md) | Plano de QA por release; gate `test:ci` (637 checks). |
| [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) | Processo de security review de PRs/releases. |
| [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) | Auditoria de segurança vigente. |
| [SECURITY.md](../SECURITY.md) | Registro de hardening (REGs) — raiz do repo. |
| [RBAC.md](./RBAC.md) | Matriz de papéis × permissões. |
| [RLS.md](./RLS.md) | Row-Level Security (multi-tenant por `ownerId`). |
| [SECRETS.md](./SECRETS.md) | Gestão de segredos e vault. |
| [CRYPTO.md](./CRYPTO.md) | Criptografia aplicada (KDF, rotação, hash-chain). |
| [signer-isolation-design.md](./signer-isolation-design.md) | Isolamento do processo signer. |
| [WAF_RATE_LIMIT.md](./WAF_RATE_LIMIT.md) | Rate limiting e proteção de borda. |
| [TLS_HSTS.md](./TLS_HSTS.md) | TLS/HSTS/CSP. |
| [ERROR_HANDLING.md](./ERROR_HANDLING.md) | Convenções de erro e taxonomia. |
| [ERROR_REPORTING.md](./ERROR_REPORTING.md) | Pipeline de report (Sentry/crash-logger). |
| [PERFORMANCE.md](./PERFORMANCE.md) | Orçamentos de performance e otimizações. |
| [ACCESSIBILITY.md](./ACCESSIBILITY.md) | Acessibilidade (a11y) e i18n. |
| [COMPLIANCE.md](./COMPLIANCE.md) | Compliance: aviso de risco, LGPD/GDPR, limites operacionais. |
| [SEO.md](./SEO.md) | Descoberta orgânica — inventário técnico dos 4 pilares. |
| [AEO.md](./AEO.md) | Featured snippets / posição 0 — resposta extraível por answer engines. |
| [AIO.md](./AIO.md) | Citação em Google AI Overviews — E-E-A-T e frases citáveis. |
| [GEO.md](./GEO.md) | Citação em LLMs (ChatGPT/Perplexity/Claude) — llms.txt e markdown. |
| [API.md](./API.md) | API interna `/api/*` — autenticação, RBAC, erros. |

## 5. Operação (deploy & rodar)

| Doc | O que define |
|---|---|
| [SETUP.md](./SETUP.md) | Ambiente local (também é o "preview"). |
| [PREVIEW_DEPLOYMENT.md](./PREVIEW_DEPLOYMENT.md) | Como validar um PR antes do merge. |
| [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md) | Deploy de produção (Docker standalone + Fly.io). |
| [DEPLOY.md](./DEPLOY.md) | Detalhes de deploy legados (Fly.io). |
| [BACKUP_DR.md](./BACKUP_DR.md) | Backup e disaster recovery (RPO/RTO). |
| [MONITORING.md](./MONITORING.md) | Observabilidade, alertas e o que vigiar. |
| [OBSERVABILITY.md](./OBSERVABILITY.md) | OTel/metrics/Sentry — implementação. |
| [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md) | Runbook de incidentes. |
| [INTEGRATIONS.md](./INTEGRATIONS.md) | Integrações externas (Binance, DexScreener, GoPlus…). |
| [ANALYTICS.md](./ANALYTICS.md) | Métricas de produto e do engine. |
| [MANUAL_DO_OPERADOR.md](../MANUAL_DO_OPERADOR.md) | Manual do operador humano. |

## 6. Referências cruzadas (raiz do repo)

- `AGENT_GUIDE.md` — padrão de trabalho Issues→PRs→CI (leitura obrigatória).
- `SPRINT.md` — sprint corrente e histórico S01–S32.
- `PLANO_MESTRE.md` — plano mestre de fases.
- `DECISOES.md` — log de decisões operacionais (fonte do [ADR.md](./ADR.md)).
- `HARDENING-ROADMAP.md` — roadmap de hardening de segurança.
- `SKILL.md` / `auto-trade-bubble-macro-evolution.md` — skill de inteligência de trade (v1.6.0).
- `skills/EXTERNAL_SYSTEMS_INDEX.md` — 20 repos externos analisados (advisory-only).
