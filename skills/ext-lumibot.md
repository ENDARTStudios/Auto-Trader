---
name: ext-lumibot
description: Lumibot como precedente híbrido — researchers read-only (allow_trading=False), gates Python determinísticos + agentes que raciocinam, memória auditável, mesmo código backtest→paper→live. Spec-level (badge GPL-3.0).
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/Lumiwealth/lumibot (acessado 2026-09-12; 2.1k★, badge GPL-3.0 — tabela interna diz MIT; vale o badge: tratar como GPL)
license: GPL-3.0 (badge) — SPEC-ONLY, nenhum código copiado
---

# Skill ext-lumibot — Precedente híbrido

## 1. Função (evidência do repo)
Framework Python: strategies determinísticas + runtime de AI agents (researcher/bull/bear/trader — **mesmo padrão do TradingAgents**), `allow_trading=False` para researchers (só o trader final opera), ferramentas (SEC filings, FRED macro, indicadores, DuckDB, memória local, Telegram), memória/rastreabilidade (SQLite/Parquet: propostas, risk notes, decisões, ordens, theses), **mesmo código** backtest→paper→live (Alpaca/IBKR/Tradier/Schwab/Polymarket/CCXT), comparação honesta vs TradingAgents/ai-hedge-fund/Backtrader/Freqtrade/vectorbt/NautilusTrader/Hummingbot.

## 2. Papel na arquitetura v1.6
- **Precedente §0.5:** `allow_trading=False` nos researchers = nossa convicção-auxiliar codificada por terceiros; "Python handles the hard gates, agents reason through evidence" = nossa Camada 4 sobre M_lang.
- **Memória (§5.2):** eventos com proveniência agente/model-call em SQLite/Parquet = nosso `logs/episodes.jsonl:1` (`P_Mparam` sempre + `decision_source` + owner).
- **Dados:** SEC + FRED como ferramentas de agente = nossos pilares N/R + `macro_context` (Camadas 1–2); DuckDB para séries em vez de despejar barras no prompt = nossa economia de contexto.
- **Mesmo-código:** backtest→paper→live sem reescrever = nosso `paper-trader.ts` → `live-trader.ts` (S14) sob mesma `EngineConfig`.

## 3. Guardrails vinculantes
- Researchers sempre read-only; só o gate determinístico + humano liberam ordem.
- Backtest de decisão de agente deve ser replayável sem novo call de modelo (nossa `forward_prediction` + outcome resolve o mesmo).
- `PAPER=true` default; live exige troca intencional de config (nossa flag `live_trading` OFF).

## 4. Contrato de integração (status: SPEC-ONLY)
Sem runtime Python acoplado. Adoção = padrões (read-only, gates, memória com proveniência, mesmo-código). A tabela comparativa deles serve como checklist de cobertura do nosso projeto.

## 5. O que NÃO incorporar
Código (GPL pelo badge), execução via brokers deles, universo alavancado do exemplo (TQQQ/SQQQ "use nearly all cash" — anti-padrão pelo nosso §4.3: max 0.5%/trade).

## 6. Licença
**Badge GPL-3.0 (tabela interna alega MIT — discrepância anotada; vale a mais restritiva). Spec apenas.**
