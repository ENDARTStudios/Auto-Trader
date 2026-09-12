---
name: agent-openviking-plugins
description: OpenViking-plugins como precedente mínimo de hooks recall/capture — plugin pequeno (17★, só Claude Code), padrão útil, adoção restrita ao padrão.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/Castor6/openviking-plugins (acessado 2026-09-12; 17★, Apache-2.0, early)
license: Apache-2.0 — padrão de hooks apenas (repo pequeno, não dependência)
---

# Skill agent-openviking-plugins — Precedente de hooks (menor)

## 1. Função (evidência do repo)
Plugin de memória p/ Claude Code: **auto-recall** (hook pré-prompt injeta memórias) + **auto-capture** (hook pós-resposta extrai e armazena) + MCP tools explícitas (`memory_recall/store/forget/health`). Servidor OpenViking externo, embeddings via Volcengine. Escopo honesto: 17★, 15 commits, só Claude Code.

## 2. Papel no projeto
- **Padrão recall/capture:** valida o ciclo `SessionStart injeta → PostToolUse captura` que nossa tooling de memória deve seguir (quando `logs/*.jsonl` ganhar consolidação).
- **Nada além disso:** agentmemory (28.4k★) é a referência principal; este é precedente secundário pela simplicidade do contrato de hooks.

## 3. Guardrails
- Recall injeta contexto, nunca decisão; capture nunca persiste secrets.
- Sem servidor externo de memória no projeto (custo + dependência sem benefício vs solução própria).

## 4. Contrato (status: DOCTRINE, menor)
Padrão de hooks apenas. Sem instalação, sem wiring.

## 5. O que NÃO incorporar
Servidor OpenViking, embeddings Volcengine, chaves em `ov.conf` (anti-padrão vs nosso `.env.example` placeholders).

## 6. Licença
**Apache-2.0 — padrão apenas. Peso pequeno por evidência (17★, early).**
