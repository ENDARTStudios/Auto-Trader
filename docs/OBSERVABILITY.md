# Observabilidade — Sentry, Datadog, New Relic, OpenTelemetry

> **Versão:** 1.0 — 2026-08-26
> **Stack:** Pino (logs) + Sentry (errors) + OpenTelemetry OTLP (traces/metrics) → qualquer backend OTLP
> **Princípio:** Logs, métricas e traces correlacionados por `requestId` + `actorId` + `traceId`.

---

## 1. Arquitetura

```
  App (Next.js + Engine + Signer)
     │
     ├── Pino (JSON) ──────────────► Loki / Datadog Logs / CloudWatch
     │      redact: [password, token, ENCRYPTION_KEY]
     │
     ├── Sentry SDK ───────────────► Sentry (errors + performance)
     │      beforeSend scrub + tracesSampleRate 0.1 prod
     │
     └── OTEL SDK (NodeSDK) ───────► OTLP endpoint
            auto-instrumentations      │
            (http, prisma, fetch)      ├──► Datadog APM (se endpoint Datadog)
                                       ├──► New Relic (se endpoint New Relic)
                                       ├──► Grafana Tempo + Loki + Prometheus
                                       └──► Sentry OTEL (se endpoint Sentry)
```

Um único `OTEL_EXPORTER_OTLP_ENDPOINT` decide para onde vão traces. Sentry é separado (DSN). Pino é sempre local (JSON → aggregator via sidecar ou stdout).

---

## 2. Logs — Pino (`src/lib/observability/logger.ts`)

```ts
// src/lib/observability/logger.ts — ver docs/ERROR_REPORTING.md §5
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

**Correlação:** todo log inclui `requestId` (gerado no middleware, propagado via `AsyncLocalStorage`) + `actorId` (session.userId) se autenticado.

```ts
// src/middleware.ts
import { randomUUID } from 'crypto';
const requestId = randomUUID();
res.headers.set('X-Request-Id', requestId);
// + ALS set
```

---

## 3. Errors — Sentry (`src/lib/observability/sentry.ts`)

Ver `docs/ERROR_REPORTING.md` §3.

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

**Verificação:** `curl -X POST http://localhost:3000/api/debug/throw` (rota dev-only) → Sentry Issues deve mostrar `test-sentry-*` em <30s.

---

## 4. Traces — OpenTelemetry (`src/lib/observability/otel.ts`)

Ver `docs/ERROR_REPORTING.md` §4.

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

**Instrumentações automáticas:** `http`, `express`, `prisma`, `fetch` — sem código extra. Cada `fetch` para Binance/DexScreener vira span.

---

## 5. Métricas — Prometheus + Grafana (ou Datadog/New Relic)

### 5.1 Endpoint `/api/metrics` (protegido)

```ts
// src/app/api/metrics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/middleware';

export async function GET(req: NextRequest) {
  // Só service ou super_admin
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

| Alerta | Condição | Ação |
|---|---|---|
| `engine_down` | `up == 0` por 2min | PagerDuty / Telegram |
| `error_rate` | `rate(http_requests_total{status=~"5.."}[5m]) > 0.01` | Slack |
| `drawdown_breach` | `autotrader_pnl_realized_usd` drawdown >20% | Telegram (crítico) |
| `auth_failures` | `rate(auth_failures_total[1m]) > 50` | Slack + auto-block IP |

---

## 6. Dashboard — O que Observar

| Painel | Fonte | Query |
|---|---|---|
| Request rate + latency p95 | OTEL traces | `histogram_quantile(0.95, rate(http_duration_seconds_bucket[5m]))` |
| Error rate | Sentry + Pino | `count_over_time({level="error"}[5m])` |
| Engine ticks + loop state | `/api/status` + Prometheus | `autotrader_engine_ticks_total` |
| Positions + PnL | Prometheus + `PerformanceSnapshot` | `autotrader_pnl_realized_usd` |
| DB size + slow queries | Prisma + Pino | `db.query.duration > 500ms` |
| Uptime | UptimeRobot / Prometheus `up` | `up{job="autotrader"}` |

---

## 7. Verificação

```bash
# Logs estruturados (dev)
npm run dev 2>&1 | grep '"level":50' | jq .

# Logs em prod (JSON)
docker logs autotrader 2>&1 | jq 'select(.level==50)'

# Sentry — forçar erro
curl -X POST http://localhost:3000/api/debug/throw 2>&1 | jq .

# OTEL — verificar traces chegando
curl http://localhost:4318/v1/traces -X POST -H "Content-Type: application/json" -d '{}' -i | head

# Metrics
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3000/api/metrics
```
