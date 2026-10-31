---
name: agent-paperclip
description: Paperclip como doutrina de orquestração de times de agentes ("a empresa") — goals, org chart, budgets com hard stop, governança/aprovações, atomic task checkout (execution locks), audit logs. Destrava especificamente o problema de sessões paralelas executando a mesma tarefa neste repo.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/paperclipai/paperclip (acessado 2026-10-31; ~109k★; Node 24 + React + Postgres, monorepo pnpm/Turbo, MIT)
license: MIT — permissive; doutrina da casa → SPEC-ONLY (control-plane, não dependência)
---

# Skill agent-paperclip — Doutrina de orquestração de times de agentes

## 1. Função (evidência do repo)
"Se OpenClaw é um funcionário, Paperclip é a empresa": control-plane para times de agentes — **goals** de negócio, "contratação" de agentes (CEO/CTO/engineers), **budgets com alertas e hard stops**, **governança/aprovações**, org chart com papéis/permissões, task threads, **heartbeat execution** (agentes acordam por tarefa/follow-up/schedule), **atomic task checkout** (execution locks), audit logs de atividade, Skill Studio (skills compartilhadas + version history + **evals**), gateway MCP governado, secrets management, export/import de "empresa". Adapters para Claude Code, Codex, Cursor, Gemini CLI, agentes HTTP próprios. Node 24 + React + Postgres embutido, Rust Runner opcional.

## 2. Papel no projeto/skill v1.6
- **`AGENT_AUTONOMO_DOER.md` já é uma mini-empresa** (hierarquia §0, máquina de estados §5, escalar/continuar §18) — o Paperclip valida e detalha 4 peças que faltam:
  1. **Atomic task checkout (execution locks)** — o problema recorrente deste repo: sessões paralelas pegando a mesma tarefa/branch (T085 vs T093, PR #34 contaminada). Um lock por tarefa-id (checkout atômico) elimina a colisão na origem.
  2. **Budget/custo com hard stop** — agentes custam tokens; hard stop por tarefa/dia (tipo `BUDGET_OVERFLOW` da taxonomia §11, hoje sem enforcement real).
  3. **Governança/aprovações** — espelha os estados ESCALATED/BLOCKED e o envelope humano (T_sla): aprovação formal registrada, não implícita.
  4. **Audit logs de atividade** — `logs/episodes.jsonl` já faz; o padrão deles (atividade estruturada por agente/task/decisão) reforça o formato de evidência §14.
- **Heartbeats + schedules** ≈ `TradingSchedule`/`cron-evolution.ts` do nosso engine — mesma ideia, domínio diferente.
- **Skill Studio com evals** = o que o `skills/` deveria evoluir para ser (skills versionadas + eval obrigatório antes de promote — cf. challenger-loop).

## 3. Guardrails vinculantes
- O control-plane NUNCA decide trading nem toca no envelope — orquestra engenharia, não risco de mercado (§0/§8c).
- Execution locks vivem fora do repo (serviço/issue assignment) — nunca em arquivo commitado que sessões disputam.
- Budget é de tokens/custo de agente; o "budget" de **risco de trading** continua sendo só do envelope humano (`risk_config.json`).
- Governança = registrar aprovação formal (quem/quando/o quê) — D051/D053/D055 são o precedente; automatizar o registro, não a autoridade.

## 4. Contrato (status: SPEC-ONLY)
Sem runtime acoplado. Adoção = (a) registro de locks por tarefa no fluxo Issues→PRs (issue assignee = lock; AGENT_GUIDE atualiza), (b) `BUDGET_OVERFLOW` com enforcement real (contador de tentativas/custo por tarefa no STATUS), (c) template de aprovação formal em `PENDENCIAS_OPERADOR.md`. Se um dia control-plane real: self-hosted (Postgres próprio), never cloud.

## 5. O que NÃO incorporar
Código (Node/React/Rust — monorepo deles), org charts de fantasia (CEO/CTO para 1 operador é ruído), runtime Rust opcional, cloud.

## 6. Licença
**MIT** — permissive; **SPEC-ONLY** por doutrina (control-plane de processo).
