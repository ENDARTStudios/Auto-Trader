---
name: agent-harness-engineering
description: Awesome-harness-engineering como catálogo de doutrina — loops, contexto, tools, permissões, memória, evals, HITL (OpenAI/Anthropic/Google/Microsoft). Valida nosso desenho adapter/bootstrap/envelope.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/ai-boost/awesome-harness-engineering (acessado 2026-09-12; 4.1k★; licença API: NOASSERTION/Other)
license: NOASSERTION (Other, via API GitHub 2026-09-12) — DOUTRINA, nada copiado; tratar como restritiva
---

# Skill agent-harness-engineering — Catálogo de doutrina

## 1. Função (evidência: API + índice)
Awesome-list de harness engineering: foundations (OpenAI/Anthropic/Google/Microsoft), primitivas (agent loop ReAct/LangGraph, planning plan-and-execute, context delivery/compaction, tool design, skills/MCP, permissions, memory, orchestration, verification/CI, observability, HITL), implementações de referência, evals.

## 2. Papel no projeto (validação cruzada do nosso desenho)
- **Loop + planejamento:** plan-and-execute / Plan.md→Implement.md = nosso `SPRINT.md`/`PLANO_MESTRE.md` + todowrite como artefatos de harness.
- **Contexto:** compaction e "harnessabilidade como critério" = nosso GRAFT-FIRST + `graft skeleton` (navegação por ponteiro, não leitura).
- **Permissões:** authorization estruturada (não texto) = nosso RBAC 4×24 + RLS + `mode.json:1` como permissão de estado.
- **Verificação:** evals que bloqueiam deploy = nosso `test:ci` pre-push + k6 p95 + Trivy + ZAP.
- **Falhas:** taxonomia context/constraint/verification/planning = nosso postmortem `owner ∈ {M_param, M_lang, both}` (§5.3b).

## 3. Guardrails
- Harness muda por evidência (benchmark), não por moda de framework — harness-only tuning antes de trocar modelo.
- Controles computacionais (linters/tests) > controles inferenciais (LLM-as-judge) para gates.

## 4. Contrato (status: DOCTRINE)
Leitura de referência para decisões de harness. Nada a instalar.

## 5. O que NÃO incorporar
Framework específico da lista sem avaliação; a lista é catálogo, não recomendação cega.

## 6. Licença
**NOASSERTION (API GitHub) — doutrina; nada copiado. Revalidar licença se qualquer trecho for citado longamente.**
