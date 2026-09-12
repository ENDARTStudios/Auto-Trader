---
name: agent-agency-agents
description: Agency-agents como biblioteca de personas especialistas — divisões Finance (Investment Researcher), Security e Testing alimentam papéis de debate/red-team/teste. Personas, não autoridade.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/msitarzewski/agency-agents (acessado 2026-09-12; 152k★, MIT; URL listada 2x = 1 repo)
license: MIT — personas como referência (nada copiado em bloco)
---

# Skill agent-agency-agents — Biblioteca de personas

## 1. Função (evidência do repo)
Coleção de agentes especialistas com personalidade/processo/deliverables por divisão: Engineering (code reviewer, SRE, incident commander), **Finance (Investment Researcher, Financial Analyst, FP&A)**, **Security (architect, pentester, incident responder, secrets hygiene)**, **Testing (reality checker, test automation, performance)**, + app instalador multi-tool.

## 2. Papel no projeto/skill v1.6
- **Debate (§4.5):** Investment Researcher/Financial Analyst = molde de `Agent_Bull/Bear` (tese com números, bear destrói a tese) — inspiração de prompt, sob nosso DAG + veto condicional.
- **Red-team (§5.8):** personas Security (pentester, secrets hygiene, AI-generated-code auditor) = molde do red-team heurístico (`causal_coherence_check`).
- **Testes (Fase 8):** Reality Checker (evidence-based certification) + Test Automation = espírito dos gates (`vitest 147`, `eslint 0`, `test:ci` pre-push).

## 3. Guardrails vinculantes (§0.5)
- Personas geram **tese/convicção**, nunca probabilidade de EV; `P` só de `M_param`.
- Persona de trading/investimento **não opera** — mesmo confinamento do TA (adaptador + fallback).

## 4. Contrato (status: SPEC-ONLY / doutrina)
Sem instalação do roster (centenas de personas = bloat de contexto). Adoção = 3 moldes (researcher/bear/security-auditor) quando um prompt de debate for escrito.

## 5. O que NÃO incorporar
Roster inteiro, app instalador, personas de execução (ordens, pagamentos, credenciais).

## 6. Licença
**MIT — moldes de prompt apenas.**
