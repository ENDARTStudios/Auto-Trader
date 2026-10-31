# RESEARCH — Pesquisa e Evidências

> **Versão:** 1.0 — 2026-09-23
> **Regra de ouro:** toda integração/técnica entra por **evidência**, nunca por hype. Externo é advisory-only (`src/lib/trading/external-systems.ts:1`).

---

## 1. Sistemas externos analisados (20 repos)

Índice completo com evidências: `skills/EXTERNAL_SYSTEMS_INDEX.md`.

- **9 de trading:** Technical Analysis, Backtrader, NautilusTrader, Freqtrade, CCXT, VectorBT, Lumibot, Hummingbot, FinRL.
- **11 de agent-infra:** memória, harness, coleta, diagramas, red-team, enxame.
- **Política:** copyleft/fair-code/unverified = **SPEC-ONLY** (lemos a ideia, não copiamos código). Execução real só em S14, com envelope humano.

## 2. Fontes de dados (100% gratuitas)

| Fonte | Uso | Módulo |
|---|---|---|
| Binance public REST | Preços CEX | `src/lib/trading/*` |
| DexScreener | Candidatos + preços DEX, liquidez, volume 24h | `src/lib/etl/dexscreener.ts` |
| GoPlus | Auditoria de segurança de token (honeypot, mint, blacklist) | `src/lib/etl/goplus.ts` + `goplus-scanner.ts` |
| Etherscan family (Arbiscan/Basescan/Optimistic) | Verificação de source de contrato | `src/lib/etl/etherscan.ts` |
| CoinGecko | Market cap, preços agregados | `src/lib/etl/coingecko.ts` |
| ollama `nomic-embed-text` | Embeddings locais para RAG (custo zero) | `docker-compose.yml` + `src/lib/rag/` |

## 3. Linhas de pesquisa internas

- **Scam detection multicamada:** turnover, liquidez, contrato, holders, idade + GoPlus + site-integrity + AI squad (`ScamReport`). Falsos negativos conhecidos: honeypot com delayed re-lock, mint em modifier, blacklist seletiva (ver aviso de risco no README).
- **P calibrada:** `P` sempre de `M_param` (§0.5) — nunca de debate/lang. Shrinkage aplicado. Kill switch de calibração por Brier 7d/30d (`risk_config.json → calibration_drift_switch`).
- **Forward OOS:** validação só conta amostra forward, nunca in-sample (`logs/forward_collection.jsonl`). MC posterior (`mc-posterior.ts`) para incerteza.
- **Backtest:** `backtest.ts` + `BacktestResult` — ponto-fixo de EV real (checklist item 8).
- **Debate multi-agente:** só veta condicional (§0.5b/0.5c) e modula sizing via `conviction` — não gera P.

## 4. Pendências de pesquisa (alimentam [TASKS.md](./TASKS.md))

- Benchmark de detecção: taxa FP/FN do scam detector em amostra rotulada forward.
- Expansão multi-chain com fontes gratuitas (Base, Solana) mantendo FP igual ou menor.
- Comparação champion×challenger com forward OOS ≥ 30 dias antes de promote.

---

**Relacionados:** [INTEGRATIONS.md](./INTEGRATIONS.md) · [ANALYTICS.md](./ANALYTICS.md) · [ITERATION.md](./ITERATION.md)
