---
name: ext-tradingagents-tauric
description: TradingAgents (fork vongchu/TauricResearch) como M_lang challenger + perception enrichment da skill v1.6. Debate multi-agente LangGraph confinado a tese/convicção — nunca decide, dimensiona ou executa.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/vongchu/TradingAgents_TauricResearch (acessado 2026-09-12; 84★, fork de TauricResearch/TradingAgents v0.3.1, Apache-2.0)
license: Apache-2.0 — spec-level + adaptador próprio (nenhum código copiado)
---

# Skill ext-tradingagents-tauric — M_lang orquestrado

## 1. Função (evidência do repo)
Framework multi-agente LLM sobre LangGraph que simula uma mesa: **Analysts** (fundamentals/sentiment/news/technical) → **Researchers** (bull/bear debate N rodadas) → **Trader** (proposta) → **Risk team + Portfolio Manager** (aprova/rejeita → exchange simulada). Multi-provider (OpenAI/Anthropic/Gemini/DeepSeek/Qwen/GLM/Ollama), tickers cripto (`BTC-USD`), `decision log` com reflexão (`trading_memory.md`), checkpoint resume, CLI + Docker, `TradingAgentsGraph().propagate(ticker, date)`.

## 2. Papel na arquitetura v1.6
- **Camada 1 (perception):** analysts alimentam `MarketSnapshot` + pilares N/R (`§2.2`) — já wired em `src/lib/trading/perception-enrichment.ts:1` (Fase 1).
- **Camada 4.5 (debate):** bull/bear viram `Agent_Bull/Bear` — já wired em `src/lib/trading/tradingagents-adapter.ts:1` (Fase 2) + `llm-extractor.ts:1` (Fase 2.1, prosa→estruturado) + `schema-descriptor.ts:1` (Fase 4.1).
- **Camada 5 (evolução):** TA como `challenger_lang` promovido por `forward_hit_rate` OOS — `challenger-loop.ts:1` (Fase 3), cron em `cron-evolution.ts:1` (Fase 4).
- **Lição operacional do fork:** decision log com reflexão realizada (retorno real + alfa vs SPY injetados no próximo prompt) = precedente direto do nosso `logs/episodes.jsonl:1` + postmortem `§5.3`.

## 3. Guardrails vinculantes (§0/0.5)
- `confidence` do trader TA **rebaçada** a `bull/bear_conviction` auxiliar; `P` final **só** de `M_param`.
- Trader TA **ignorado como decisor** (só extrai `forward_prediction`); risk manager TA **substituído** pela Camada 4.
- Tese passa por DAG `config/dag_edges.json:1` antes de aceita; timeout/erro → fallback interno (§4.4d).

## 4. Contrato de integração (status: WIRED)
`buildStack` em `src/lib/trading/bootstrap.ts:1`. Schema do fork via `scripts/inspect_ta_schema.py:1` (B-fim: default ALTA sustenta; manifest trava MÉDIAS).

## 5. O que NÃO incorporar
Motor de decisão, sizing, execução live, `trader_plan` como ordem. O TA é pesquisa/argumento, não risco.

## 6. Licença
Apache-2.0 (permissiva). Mesmo assim: só spec + código próprio; nada copiado.
