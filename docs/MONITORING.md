# MONITORING — O que Vigiar e Como

> **Versão:** 1.0 — 2026-09-23
> **Implementação:** [OBSERVABILITY.md](./OBSERVABILITY.md) (OTel/metrics/Sentry). **Runbook:** [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md).

---

## 1. Sinais vitais (ordem de checagem)

| # | Sinal | Fonte | Ruim quando |
|---|---|---|---|
| 1 | **Estado global** | `state/mode.json` | ≠ `ok` (`lang_degraded`, `unknown_regime`, `crisis_lock`, `frozen_autonomy`) — checar `history[]` para o trigger |
| 2 | **Kill switches** | `config/risk_config.json` (estado aplicado no engine) | Disparado sem ação correspondente em posições |
| 3 | **Feed health** | `SourceHealth` + `MarketSnapshot` | Fonte stale/degradada (`feed_stale_switch` → close_neutralize) |
| 4 | **Erros** | Sentry + `AppLog` + `logs/crash.log*` | 5xx recorrentes, exceções novas |
| 5 | **Calibração** | Brier 7d/30d de `logs/episodes.jsonl` | Piora > 10%/15% (switches de calibração) |
| 6 | **Drawdown** | portfolio/`PerformanceSnapshot` | Aproximar de -2% dia / -5% semana / -8% mês |
| 7 | **Infra** | OTel metrics (`src/lib/observability/metrics.ts`) | Latência p95, memória, loop parado |

## 2. Instrumentação existente

- **OpenTelemetry:** `otel.ts` + `exporter.ts` + `registry.ts` (traces/metrics).
- **Sentry:** `sentry-init.ts` (client/server) — captura com contexto de requestId.
- **Snapshot:** `snapshot.ts` → `PerformanceSnapshot` (equity/métricas por janela).
- **Logs estruturados:** `AppLog` (DB) + `logs/*.jsonl` (episódios, coerência, rejeitados, forward).
- **SSE:** `/api/stream` alimenta o dashboard em tempo real.
- **Notificações:** `NotificationChannel`/`NotificationLog` — alertas configuráveis por evento (ex.: transição de `mode.json`).

## 3. Rotinas

| Rotina | Frequência | O que olhar |
|---|---|---|
| Glance no dashboard | diário | Estado ≠ ok, erros no painel de logs, posições anômalas |
| Revisão de episódios | semanal | `logs/episodes.jsonl` — decisões com P esquisita? ([MEMORY.md](./MEMORY.md) §4) |
| Quarentena de edges | T_sla 30d | `dag_edges_quarantine.json` — promote/rejeitar ([ITERATION.md](./ITERATION.md)) |
| Health das fontes | semanal | `SourceHealth` — fontes degradando cronicamente |
| Backup restore spot-check | mensal | Amostra de backup restaura ([BACKUP_DR.md](./BACKUP_DR.md)) |
| Review do envelope | T_sla 30d | `risk_config.json`/limites ainda fazem sentido ([RULES.md](./RULES.md) §2) |

## 4. Alarmes mínimos (configurar antes do live)

1. `mode.json` sai de `ok` → notificação imediata.
2. Qualquer kill switch disparado → notificação imediata.
3. `/api/health` falhando 2× seguidas → alerta de infra.
4. Erro 5xx > N em 5min (Sentry alert) → alerta.
5. Drawdown cruzando 50% do limite diário → aviso precoce.

## 5. Quando alerta vira incidente

Ação manual imediata (kill switch) + runbook ([INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md)) + postmortem curto registrado. Regra de ouro: **capital primeiro, diagnóstico depois**.

---

**Relacionados:** [ANALYTICS.md](./ANALYTICS.md) · [BACKUP_DR.md](./BACKUP_DR.md) · [RULES.md](./RULES.md) · [../MANUAL_DO_OPERADOR.md](../MANUAL_DO_OPERADOR.md)
