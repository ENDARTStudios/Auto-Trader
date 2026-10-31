---
name: agent-orca
description: Orca como doutrina de orquestração em worktrees isolados — um worktree por agente, fan-out de prompts, comparar e mergear o vencedor; resolve exatamente a classe de incidente de sessões paralelas deste repo (git add -A engolindo trabalho alheio, .kilo/ resíduo, main avançando entre turnos).
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/stablyai/orca (acessado 2026-10-31; ~112k★; TS/Electron monorepo, MIT)
license: MIT — permissive; doutrina da casa → SPEC-ONLY (workbench do operador, não dependência)
---

# Skill agent-orca — Doutrina de worktree isolado por agente

## 1. Função (evidência do repo)
"Agent IDE"/orquestrador: roda frotas de agentes CLI (Claude Code, Codex, Cursor, etc.) **cada um em seu próprio git worktree isolado**, fan-out do mesmo prompt para N agentes, comparar diffs e **mergear o vencedor**. Terminal splits, Design Mode (injetar screenshot/HTML no prompt), integração GitHub/Linear, Orca CLI, mobile companion. MIT, TS/Electron.

## 2. Papel no projeto/skill v1.6
- **Doutrina de harness para as sessões paralelas do Auto Trader**: o repo já sofreu exatamente o que o Orca resolve — sessões paralelas avançando `main` entre turnos, `git add -A` engolindo mudanças alheias (`state/mode.json`, renames `middleware.ts → src/proxy.ts`), resíduo de worktree (`.kilo/worktrees/*`) lintado por engano, node_modules misturado entre branches.
- **Padrão a adotar por spec**: toda sessão autônoma não-trivial trabalha em **worktree próprio** (`git worktree add ../auto-trader-wt-<task>`); a main nunca avança sob um turno; merges entre worktrees são explícitos e revisados; `git add` sempre com paths explícitos dentro do próprio worktree.
- **Fan-out/compare-merge**: para tarefas com N abordagens viáveis (ex.: migração grande), rodar 2+ worktrees e mergear o vencedor por evidência — precede o padrão challenger da skill (§5.4) na camada de engenharia.

## 3. Guardrails vinculantes
- Worktree é descartável: `git worktree remove` ao fim da tarefa + nunca commitar artefatos de worktree dentro do repo principal (lição `.kilo/`).
- A main é protegida: nenhum turno assume que o `origin/main` que leu no início ainda vale no fim — **bootstrap forense a cada ciclo** (§3 do AGENT_AUTONOMO_DOER).
- Ferramentas de orquestração (Orca/Claude/Cursor) são do Operador; o repo só adota a **disciplina**, não a ferramenta.

## 4. Contrato (status: SPEC-ONLY)
Sem runtime acoplado. Adoção = atualização do `AGENT_AUTONOMO_DOER.md` §1.7 ("trabalhar em branch isolada" → "trabalhar em **worktree isolado**") + higiene (`git worktree prune`, ignores). Estrutura já existe no repo (graft, hooks) — nada a instalar.

## 5. O que NÃO incorporar
O app Electron/CLI (workbench do operador), Computer Use, cloud relay — infra pessoal, fora do escopo do repositório.

## 6. Licença
**MIT** — permissive; **SPEC-ONLY** (doutrina de processo).
