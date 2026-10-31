---
name: agent-codebase-memory-mcp
description: Codebase-memory-mcp como validação externa da doutrina graph-first — knowledge graph tree-sitter, 15 MCP tools, queries sub-ms, 99% menos tokens. Gêmeo do nosso graft/.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/DeusData/codebase-memory-mcp (acessado 2026-09-12; 43k★, MIT)
license: MIT — doutrina (já temos graft/ próprio; nada a instalar)
---

# Skill agent-codebase-memory-mcp — Graph-first validado

## 1. Função (evidência do repo)
MCP server de code intelligence: indexa o repo em knowledge graph (tree-sitter, 158 linguagens, SQLite/LZ4), 15 tools (search/trace/architecture/impact/dead-code/Cypher), queries <1ms, 99.2% menos tokens vs grep (3.4k vs 412k em 5 queries), 100% local, sem LLM embutido (o agente é o tradutor).

## 2. Papel no projeto
- **Valida `AGENTS.md:1` GRAFT-FIRST:** `graft ask/grep/callers/skeleton` = o mesmo padrão (grafo antes de grep/read). Evidência externa de que navegação por ponteiro > leitura de arquivos.
- **Precedentes a adotar:** dead-code detection (nosso `knip.json:1` já cobre — manter), impact analysis (nosso `graft callers --depth N` — manter), ADR persistentes (`manage_adr` → nossos `DECISOES.md:1` + `docs/adr/` se criado).

## 3. Guardrails
- Nada a instalar (graft/ próprio cumpre o papel); skill é **doutrina**, não dependência.
- Graph é cache local regenerável (`/graft/` gitignored) — nunca commitar artefato de índice.

## 4. Contrato (status: DOCTRINE)
Nenhum wiring. Se um dia o graft/ for insuficiente, reavaliar com benchmark (tokens/query) antes de trocar.

## 5. O que NÃO incorporar
Binário externo, telemetria (eles não têm; manter assim), escrita em configs do agente sem review.

## 6. Licença
**MIT — doutrina apenas.**
