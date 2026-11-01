# AGENT_TEAM — Equipe de Bots e Plano de Aceleração

> **Versão:** 1.0 — 2026-11-01
> **Propósito:** acelerar o desenvolvimento com uma equipe de agentes especializados, cada um com função única, gatilhos claros e gates inegociáveis. Complementa (não substitui) o `AGENT_AUTONOMO_DOER.md` e a hierarquia de autoridade dele (§0).

---

## 1. Princípios (inegociáveis)

1. **Hierarquia de autoridade** (AGENT_AUTONOMO_DOER §0): Operador > PROTOCOLO_MESTRE > skills > este documento.
2. **Gates sempre**: lint 0 · tsc 0 · vitest · build · gitleaks — nenhum bot mergear sem evidência (formato `DECISOES.md`).
3. **Um worktree por bot** (doutrina Orca — `skills/agent-orca.md`): sessões nunca compartilham árvore; merges explícitos; `git add` com paths explícitos.
4. **Lock atômico por tarefa** (doutrina Paperclip — `skills/agent-paperclip.md`): issue assignee = lock; duas sessões nunca pegam a mesma tarefa.
5. **Registro**: todo ciclo gera STATUS em `logs/episodes.jsonl` + atualização de docs.
6. **Envelope intocado**: nenhum bot escreve em `risk_config.json`/`mode.json`/`dag_edges.json` (write-fence).

## 2. A equipe (6 bots)

| Bot | Função | Encontra/mitiga | Ferramentas | Gatilho |
|---|---|---|---|---|
| 🔭 **Sentinela** (Auditor) | Varrer o repo em busca de falhas e regressões | Roda gates + `impeccable detect` + health do deploy + drift de docs; abre issues S1–S4 priorizadas | gh CLI, playwright (`scripts/ui-audit.mjs`, `prod-visual-check.mjs`), graft, vitest | **Diário** (automatizado) + pós-merge |
| 🛡️ **Guardião** (Security/RedTeam) | Segurança ofensiva e defensiva | Strix (red-team técnico) + iFixAi (comportamental) + gitleaks + `npm audit`; valida frozen base e envelope | gh, strix, ifixai (spec), npm audit | PRs sensíveis + semanal |
| 🔨 **Builder** (Doer) | Executar tarefas do backlog ponta a ponta | Pega issue com lock, quebra em T001..T00N ([TASK_BREAKING_DOWN](TASK_BREAKING_DOWN.md)), implementa + testes + PR | worktree próprio, graft, todas as gates | Issues prontas (on-demand) |
| 🔬 **Pesquisador** (Researcher) | Absorver sistemas externos por evidência + completar pesquisa pendente | Protocolo do índice ([RESEARCH](../08-knowledge-management/RESEARCH.md)): licença → análise → skill → registry → roadmap; forward OOS p/ propostas de modelo | WebFetch, gh, skills `ext-*`/`agent-*` | **Semanal** (automatizado) |
| ⚙️ **Ops** (Infra) | Deploy, saúde e infraestrutura | Railway/Vercel CLIs, health pós-deploy, domínios, backups ([BACKUP_DR](../06-devops-deployment/BACKUP_DR.md)) | railway CLI, vercel CLI, curl | Pós-merge + on-call |
| 🧐 **Revisor** (Reviewer) | Fechar o ciclo: revisar PRs e decidir merge | Checklist [CODE_REVIEW](../06-devops-deployment/CODE_REVIEW.md) + política de auto-merge (diff auditado, gates verdes, frozen intacto) | gh, graft | PRs abertas |

## 3. Plano de aceleração (o que cada bot destrava)

| Semana | Foco | Bot líder | Resultado esperado |
|---|---|---|---|
| S1 | Estabilizar produção: smoke T058 **agora possível no Railway** (sem SSO/challenge), onboarding wizard e2e, monitorar init de cold start | Sentinela + Ops | T058 fechada; alertas no deploy |
| S1 | Backlog de UX-UX pendente: setState-during-render, 401 noise no login | Builder | Console limpo em produção |
| S2 | Spec-ports de maior valor (ROADMAP Fase II): Day Trader PASS/BLOCK no `risk-manager`, Backtrader analyzers no `backtest.ts` | Builder + Revisor | Testes dedicados verdes |
| S2 | Banco durável (decisão do Operador em `PENDENCIAS_OPERADOR.md`): Postgres hospedado ou VPS | Ops + Operador | Dados persistentes multi-instância |
| S3 | Cobertura: chain ≥ 40% ratchet, iFixAi rodando no squad | Guardião | Baseline sobe sem regressão |
| S3+ | Evolução: challenger de modelo com forward OOS ≥ 30d | Pesquisador | Promote com evidência |

## 4. Coordenação (como os bots não se atropelam)

1. **Fila = Issues do GitHub** (uma issue = uma tarefa = um lock via assignee).
2. **Branch/worktree por bot**: `wt-<bot>-<task>`; merge só via PR com CI verde.
3. **Main avançou?** Bootstrap forense a cada ciclo (§3 do AGENT_AUTONOMO_DOER) — nunca confiar no estado lido no início do turno.
4. **Bloqueio externo** → registrar em `PENDENCIAS_OPERADOR.md` e seguir para a próxima tarefa independente.
5. **Conflito entre bots** → hierarquia §0 decide; divergência técnica vira ADR.

## 5. Automações ativas

| Automação | Bot | Agendamento | Escopo |
|---|---|---|---|
| Sentinela diária | 🔭 | cron diário (esta máquina) | gates + health do Railway + issues novas |
| Pesquisador semanal | 🔬 | cron semanal | análise de 1–2 repos externos por evidência |

Builder, Guardião, Ops e Revisor rodam **on-demand** (sob instrução do Operador ou gatilho de evento) — cron para eles seria desperdício de quota sem fila pronta.

---

**Relacionados:** [AGENT_AUTONOMO_DOER.md](../../AGENT_AUTONOMO_DOER.md) · [TASKS.md](TASKS.md) · [CODE_REVIEW.md](../06-devops-deployment/CODE_REVIEW.md) · [skills/agent-orca.md](../../skills/agent-orca.md) · [skills/agent-paperclip.md](../../skills/agent-paperclip.md)
