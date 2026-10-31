# ANALYTICS — Métricas de Produto e do Engine

> **Versão:** 1.0 — 2026-09-23
> **Princípio:** métrica sem decisão ligada é enfeite. Toda métrica abaixo alimenta um kill switch, um painel ou uma decisão de evolução.

---

## 1. Métricas de performance de trading (núcleo)

| Métrica | Fonte | Uso |
|---|---|---|
| **Equity curve** | `PerformanceSnapshot` | Painel do dashboard; graduação paper→live. |
| **EV real (ponto-fixo)** | checklist item 8 da skill | Comparação previsão×realização por episódio. |
| **Brier score 7d/30d** | `logs/episodes.jsonl` (`P_Mparam`) | Kill switches `calibration_drift_switch` / `model_miscalibration_switch` (piora 10%/15% → dispara). |
| **Drawdown dia/semana/mês** | portfolio | Limites -2%/-5%/-8% (`risk_config.json`). |
| **Win rate / fee-adjusted P&L** | `FeeAuditLog`, `fee-model.ts` | Sanity de execução paper. |
| **Ciclos paper** | `PaperCycleAttempt` | Contador de graduação. |

## 2. Métricas do scam detector

- Volume de candidatos × aprovados × rejeitados por camada (`ScamReport`, `ScoutSkipStat`).
- Taxa de honeypot detectado (GoPlus `cannotSell`), contratos não-verificados (`hasMint`/`isProxy`).
- Falsos negativos conhecidos viram episódios de aprendizado ([MEMORY.md](./MEMORY.md) §4).

## 3. Métricas de saúde operacional

| Métrica | Fonte | Alerta |
|---|---|---|
| `SourceHealth` por fonte externa | ETL | Fonte degradada → retry/backoff, visível no UI. |
| Estado global | `state/mode.json` | Transição para `unknown_regime`/`crisis_lock` → notificação (`NotificationChannel`). |
| Erros 5xx / exceções | Sentry + `AppLog` | Ver [ERROR_REPORTING.md](./ERROR_REPORTING.md). |
| Cobertura das fontes | `MarketSnapshot` contagem | Snapshot vazio = feed stale. |

## 4. Produto & uso

- Dashboard: painéis de saldo, posições, P&L, histórico, scam audit, logs (SSE `/api/stream`).
- `/api/analytics` e `/api/history` agregam para o UI; exportação via `csv-export.ts`.
- Backtests comparativos em `BacktestResult` (baseline para EV futuro).

## 5. Evolução (analytics → ação)

O ciclo métrica→decisão é fechado pelo `self_evolution_feedback_core`: episódio → aprendizado taxonomizado → quarentena de edges → review humano T_sla 30d → promote/rejeição. Detalhe em [ITERATION.md](./ITERATION.md). Challenger só promote com forward OOS e Brier melhor que champion (`state/model_registry.json`).

---

**Relacionados:** [MONITORING.md](./MONITORING.md) · [ITERATION.md](./ITERATION.md) · [RULES.md](./RULES.md)
