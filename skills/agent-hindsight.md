---
name: agent-hindsight
description: Hindsight como modelo de memória que aprende — banks isolados, facts/experiences/observations (evidenciadas, refinadas nunca sobrescritas)/mental models (respostas de pé auto-escritas), recall 4-vias com RRF + rerank, Retain/Recall/Reflect. Espelho direto do self_evolution_feedback_core sobre o nosso pgvector.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/vectorize-io/hindsight (acessado 2026-10-31; ~57k★; Python + PostgreSQL/pgvector, MIT; SOTA LongMemEval replicado por Virginia Tech/Washington Post)
license: MIT — permissive; doutrina da casa → SPEC-ONLY (modelo de memória, não dependência)
---

# Skill agent-hindsight — Modelo de memória de agente que aprende

## 1. Função (evidência do repo)
Sistema de memória para agentes ("Agent Memory That Learns"): **memory banks** isoladas (um "cérebro" por agente/projeto, sem leak cruzado, com traços de disposição que moldam o raciocínio). Tipos de memória: **world facts** (semânticos), **experiences** (episódicos, do próprio agente), **observations** (crenças consolidadas, deduplicadas, **com quotes e proof counts, refinadas — nunca sobrescritas** — conforme nova evidência chega), **mental models** (respostas de pé para perguntas definidas, reescritas em background — leitura vira lookup). Entidades + relações + time-series com vetores sparse/dense. APIs: **Retain** (LLM extrai fatos/entidades/tempo/relações), **Recall** (4 estratégias paralelas: semântica, BM25, grafo, temporal → **RRF + cross-encoder rerank**), **Reflect** (síntese LLM). Stack: Postgres + **pgvector**, clients TS/Python/Go, MCP server, Memory Defense (PII/segredos, 45 padrões).

## 2. Papel no projeto/skill v1.6
- **Espelho direto do `self_evolution_feedback_core`** (§5/§12): `logs/episodes.jsonl` = experiences; o padrão **observations** é o que falta na nossa memória — aprendizado taxonomizado com **proof counts e refinamento incremental** (episódios novos CONFIRMAM/REFINAM uma observação em vez de empilhar linhas soltas); **mental models** = respostas de pé ("qual o regime?", "qual setup tem melhor forward hit?") materializadas e reescritas em background — leitura barata, exatamente o que o debate (§5) consome.
- **Recall 4-vias + RRF** valida o desenho do skill `agent-agentmemory` (#12, memória 4-tier + RRF) — convergência independente de dois sistemas = evidência forte do padrão.
- **Postgres + pgvector = o nosso stack de prod** (docker-compose pgvector, `Embedding`/`KnowledgeGraph`) — a evolução da memória de episódios para observations/mental models cabe no schema atual sem novo serviço.
- **Memory Defense** = o mesmo poste de `sanitize.ts`/SECRETS: PII/segredos bloqueados antes de sair do perímetro.

## 3. Guardrails vinculantes
- Memória **nunca** gera `P` nem decide (§0.5) — observations alimentam o debate e o learner; calibração continua sendo do `M_param`.
- Observações só são promovidas com **evidência citada** (episode id / timestamp) — sem citação, é opinião e não entra.
- `mode.json`/`risk_config.json` não são memória aprendida — write-fence intacto (§5.5/§7).
- Banks por domínio: episódios de paper ≠ aprendizado de engenharia — sem mistura.

## 4. Contrato (status: SPEC-ONLY)
Sem runtime acoplado. Adoção = evolução do schema (`Observation`, `MentalModel` sobre Postgres/pgvector existentes) + worker de consolidação (dedup/merge com proof counts) + recall 4-vias no RAG atual. Se um dia serviço externo: rodar local (pg0/embedded), nunca Zep/nuvem com dados de trading.

## 5. O que NÃO incorporar
Código Python/clientes (modelo é spec), substituição do `episodes.jsonl` append-only (as observations **derivam** dele), Zep/Oracle, o wrapper de LLM (nosso `M_lang` já tem pipeline próprio).

## 6. Licença
**MIT** — permissive; **SPEC-ONLY** por doutrina (modelo de memória do learner).
