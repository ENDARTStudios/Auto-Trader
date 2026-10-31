

---

## [Conteudo mesclado de OBSERVABILITY.md — reorganizacao docs 2026-09-27]

# Observabilidade â€” Sentry, Datadog, New Relic, OpenTelemetry

> **VersÃ£o:** 1.0 â€” 2026-08-26
> **Stack:** Pino (logs) + Sentry (errors) + OpenTelemetry OTLP (traces/metrics) â†’ qualquer backend OTLP
> **PrincÃ­pio:** Logs, mÃ©tricas e traces correlacionados por `requestId` + `actorId` + `traceId`.

---

## 1. Arquitetura

```
  App (Next.js + Engine + Signer)
     â”‚
     â”œâ”€â”€ Pino (JSON) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º Loki / Datadog Logs / CloudWatch
     â”‚      redact: [password, token, ENCRYPTION_KEY]
     â”‚
     â”œâ”€â”€ Sentry SDK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º Sentry (errors + performance)
     â”‚      beforeSend scrub + tracesSampleRate 0.1 prod
     â”‚
     â””â”€â”€ OTEL SDK (NodeSDK) â”€â”€â”€â”€â”€â”€â”€â–º OTLP endpoint
            auto-instrumentations      â”‚
            (http, prisma, fetch)      â”œâ”€â”€â–º Datadog APM (se endpoint Datadog)
                                       â”œâ”€â”€â–º New Relic (se endpoint New Relic)
                                       â”œâ”€â”€â–º Grafana Tempo + Loki + Prometheus
                                       â””â”€â”€â–º Sentry OTEL (se endpoint Sentry)
```

Um Ãºnico `OTEL_EXPORTER_OTLP_ENDPOINT` decide para onde vÃ£o traces. Sentry Ã© separado (DSN). Pino Ã© sempre local (JSON â†’ aggregator via sidecar ou stdout).

---

## 2. Logs â€” Pino (`src/lib/observability/logger.ts`)

```ts
// src/lib/observability/logger.ts â€” ver docs/ERROR_REPORTING.md Â§5
import pino from 'pino';

export const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['password','passwordHash','token','apiKey','apiSecret','ENCRYPTION_KEY','SESSION_SECRET','req.headers.authorization'],
    censor: '[REDACTED]',
  },
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

export const logger = {
  info: (source: string, msg: string, ctx?: unknown) => {
    pinoLogger.info({ source, ctx }, msg);
    // + fire-and-forget AppLog (Prisma) para dashboard
  },
  error: (source: string, msg: string, ctx?: unknown) => {
    pinoLogger.error({ source, ctx }, msg);
    // + AppLog + Sentry.captureException se error
  },
};
```

**CorrelaÃ§Ã£o:** todo log inclui `requestId` (gerado no middleware, propagado via `AsyncLocalStorage`) + `actorId` (session.userId) se autenticado.

```ts
// src/middleware.ts
import { randomUUID } from 'crypto';
const requestId = randomUUID();
res.headers.set('X-Request-Id', requestId);
// + ALS set
```

---

## 3. Errors â€” Sentry (`src/lib/observability/sentry.ts`)

Ver `docs/ERROR_REPORTING.md` Â§3.

**Setup:**

```bash
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
# cria sentry.client.config.ts + sentry.server.config.ts
```

**Env:**

```bash
SENTRY_DSN="https://xxx@xxx.ingest.sentry.io/xxx"
# ou NEXT_PUBLIC_SENTRY_DSN (client)
```

**VerificaÃ§Ã£o:** `curl -X POST http://localhost:3000/api/debug/throw` (rota dev-only) â†’ Sentry Issues deve mostrar `test-sentry-*` em <30s.

---

## 4. Traces â€” OpenTelemetry (`src/lib/observability/otel.ts`)

Ver `docs/ERROR_REPORTING.md` Â§4.

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http
```

**Env (um dos):**

```bash
# Datadog
OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp.datadoghq.com"
# New Relic
OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp.nr-data.net"
# Grafana (local)
OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
# Sentry OTEL
OTEL_EXPORTER_OTLP_ENDPOINT="https://xxx.ingest.sentry.io/api/xxx/envelope"
```

**InstrumentaÃ§Ãµes automÃ¡ticas:** `http`, `express`, `prisma`, `fetch` â€” sem cÃ³digo extra. Cada `fetch` para Binance/DexScreener vira span.

---

## 5. MÃ©tricas â€” Prometheus + Grafana (ou Datadog/New Relic)

### 5.1 Endpoint `/api/metrics` (protegido)

```ts
// src/app/api/metrics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/middleware';

export async function GET(req: NextRequest) {
  // SÃ³ service ou super_admin
  const session = await requirePermission('system:read')(req);
  // Prometheus text format
  const metrics = `
# HELP autotrader_engine_ticks_total Total engine ticks
# TYPE autotrader_engine_ticks_total counter
autotrader_engine_ticks_total ${tickCount}

# HELP autotrader_positions_open Current open positions
# TYPE autotrader_positions_open gauge
autotrader_positions_open ${openCount}

# HELP autotrader_pnl_realized_usd Realized PnL USD
# TYPE autotrader_pnl_realized_usd gauge
autotrader_pnl_realized_usd ${realizedPnl}

# HELP autotrader_scarb_blocks_total Scam blocks by reason
# TYPE autotrader_scarb_blocks_total counter
autotrader_scarb_blocks_total{reason="honeypot"} ${honeypotBlocks}
  `.trim();
  return new NextResponse(metrics, { headers: { 'Content-Type': 'text/plain' } });
}
```

### 5.2 Prometheus scrape

```yaml
# prometheus.yml
scrape_configs:
  - job_name: autotrader
    metrics_path: /api/metrics
    bearer_token: ${METRICS_TOKEN}
    static_configs:
      - targets: ['autotrader:3000']
```

### 5.3 Alertas (Grafana ou Datadog)

| Alerta | CondiÃ§Ã£o | AÃ§Ã£o |
|---|---|---|
| `engine_down` | `up == 0` por 2min | PagerDuty / Telegram |
| `error_rate` | `rate(http_requests_total{status=~"5.."}[5m]) > 0.01` | Slack |
| `drawdown_breach` | `autotrader_pnl_realized_usd` drawdown >20% | Telegram (crÃ­tico) |
| `auth_failures` | `rate(auth_failures_total[1m]) > 50` | Slack + auto-block IP |

---

## 6. Dashboard â€” O que Observar

| Painel | Fonte | Query |
|---|---|---|
| Request rate + latency p95 | OTEL traces | `histogram_quantile(0.95, rate(http_duration_seconds_bucket[5m]))` |
| Error rate | Sentry + Pino | `count_over_time({level="error"}[5m])` |
| Engine ticks + loop state | `/api/status` + Prometheus | `autotrader_engine_ticks_total` |
| Positions + PnL | Prometheus + `PerformanceSnapshot` | `autotrader_pnl_realized_usd` |
| DB size + slow queries | Prisma + Pino | `db.query.duration > 500ms` |
| Uptime | UptimeRobot / Prometheus `up` | `up{job="autotrader"}` |

---

## 7. VerificaÃ§Ã£o

```bash
# Logs estruturados (dev)
npm run dev 2>&1 | grep '"level":50' | jq .

# Logs em prod (JSON)
docker logs autotrader 2>&1 | jq 'select(.level==50)'

# Sentry â€” forÃ§ar erro
curl -X POST http://localhost:3000/api/debug/throw 2>&1 | jq .

# OTEL â€” verificar traces chegando
curl http://localhost:4318/v1/traces -X POST -H "Content-Type: application/json" -d '{}' -i | head

# Metrics
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3000/api/metrics
```



---

## [Conteudo mesclado de MONITORING.md — reorganizacao docs 2026-09-27]

# MONITORING â€” O que Vigiar e Como

> **VersÃ£o:** 1.0 â€” 2026-09-23
> **ImplementaÃ§Ã£o:** [OBSERVABILITY.md](./OBSERVABILITY.md) (OTel/metrics/Sentry). **Runbook:** [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md).

---

## 1. Sinais vitais (ordem de checagem)

| # | Sinal | Fonte | Ruim quando |
|---|---|---|---|
| 1 | **Estado global** | `state/mode.json` | â‰  `ok` (`lang_degraded`, `unknown_regime`, `crisis_lock`, `frozen_autonomy`) â€” checar `history[]` para o trigger |
| 2 | **Kill switches** | `config/risk_config.json` (estado aplicado no engine) | Disparado sem aÃ§Ã£o correspondente em posiÃ§Ãµes |
| 3 | **Feed health** | `SourceHealth` + `MarketSnapshot` | Fonte stale/degradada (`feed_stale_switch` â†’ close_neutralize) |
| 4 | **Erros** | Sentry + `AppLog` + `logs/crash.log*` | 5xx recorrentes, exceÃ§Ãµes novas |
| 5 | **CalibraÃ§Ã£o** | Brier 7d/30d de `logs/episodes.jsonl` | Piora > 10%/15% (switches de calibraÃ§Ã£o) |
| 6 | **Drawdown** | portfolio/`PerformanceSnapshot` | Aproximar de -2% dia / -5% semana / -8% mÃªs |
| 7 | **Infra** | OTel metrics (`src/lib/observability/metrics.ts`) | LatÃªncia p95, memÃ³ria, loop parado |

## 2. InstrumentaÃ§Ã£o existente

- **OpenTelemetry:** `otel.ts` + `exporter.ts` + `registry.ts` (traces/metrics).
- **Sentry:** `sentry-init.ts` (client/server) â€” captura com contexto de requestId.
- **Snapshot:** `snapshot.ts` â†’ `PerformanceSnapshot` (equity/mÃ©tricas por janela).
- **Logs estruturados:** `AppLog` (DB) + `logs/*.jsonl` (episÃ³dios, coerÃªncia, rejeitados, forward).
- **SSE:** `/api/stream` alimenta o dashboard em tempo real.
- **NotificaÃ§Ãµes:** `NotificationChannel`/`NotificationLog` â€” alertas configurÃ¡veis por evento (ex.: transiÃ§Ã£o de `mode.json`).

## 3. Rotinas

| Rotina | FrequÃªncia | O que olhar |
|---|---|---|
| Glance no dashboard | diÃ¡rio | Estado â‰  ok, erros no painel de logs, posiÃ§Ãµes anÃ´malas |
| RevisÃ£o de episÃ³dios | semanal | `logs/episodes.jsonl` â€” decisÃµes com P esquisita? ([MEMORY.md](./MEMORY.md) Â§4) |
| Quarentena de edges | T_sla 30d | `dag_edges_quarantine.json` â€” promote/rejeitar ([ITERATION.md](./ITERATION.md)) |
| Health das fontes | semanal | `SourceHealth` â€” fontes degradando cronicamente |
| Backup restore spot-check | mensal | Amostra de backup restaura ([BACKUP_DR.md](./BACKUP_DR.md)) |
| Review do envelope | T_sla 30d | `risk_config.json`/limites ainda fazem sentido ([RULES.md](./RULES.md) Â§2) |

## 4. Alarmes mÃ­nimos (configurar antes do live)

1. `mode.json` sai de `ok` â†’ notificaÃ§Ã£o imediata.
2. Qualquer kill switch disparado â†’ notificaÃ§Ã£o imediata.
3. `/api/health` falhando 2Ã— seguidas â†’ alerta de infra.
4. Erro 5xx > N em 5min (Sentry alert) â†’ alerta.
5. Drawdown cruzando 50% do limite diÃ¡rio â†’ aviso precoce.

## 5. Quando alerta vira incidente

AÃ§Ã£o manual imediata (kill switch) + runbook ([INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md)) + postmortem curto registrado. Regra de ouro: **capital primeiro, diagnÃ³stico depois**.

---

**Relacionados:** [ANALYTICS.md](./ANALYTICS.md) Â· [BACKUP_DR.md](./BACKUP_DR.md) Â· [RULES.md](./RULES.md) Â· [../MANUAL_DO_OPERADOR.md](../MANUAL_DO_OPERADOR.md)

