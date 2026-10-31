

---

## [Conteudo mesclado de ERROR_REPORTING.md — reorganizacao docs 2026-09-27]

# Error Reporting â€” Error Boundary + Captura de Logs

> **VersÃ£o:** 1.0 â€” 2026-08-26
> **Stack:** React Error Boundary + Sentry + OpenTelemetry + Pino + crash-logger sÃ­ncrono
> **PrincÃ­pio:** Nenhum erro some silenciosamente. Todo erro Ã© capturado, logado, notificado e rastreÃ¡vel atÃ© o ator + timestamp + stack.

---

## 1. Camadas de Captura

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  UI Layer                                                       â”‚
â”‚  ErrorBoundary (root + por painel) â†’ fallback UI + Sentry.captureâ”‚
â”‚  + TanStack Query onError â†’ toast + Sentry                      â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  API Layer (Next.js Route Handlers)                             â”‚
â”‚  try/catch global â†’ NextResponse 500 genÃ©rico + Pino error log  â”‚
â”‚  + Zod validation 400 + RBAC 403 + RateLimit 429                â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Engine / Domain Layer                                          â”‚
â”‚  logger.error(source, msg, context) â†’ AppLog (Prisma) + Pino    â”‚
â”‚  + event-bus error events â†’ SSE AlertsToast                     â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Process Layer (Node)                                           â”‚
â”‚  instrumentation.ts â†’ crash-logger.ts (sync file)               â”‚
â”‚  uncaughtException + unhandledRejection â†’ logs/crash-*.log      â”‚
â”‚  + Sentry.captureException + process.exit(1)                    â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Observability                                                  â”‚
â”‚  Sentry (errors) + OTEL (traces/metrics) + Pino (logs)          â”‚
â”‚  â†’ Datadog / New Relic / Loki (via OTLP endpoint)               â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 2. Error Boundary (`src/components/error-boundary.tsx`)

```tsx
// src/components/error-boundary.tsx
'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { captureError } from '@/lib/observability/sentry';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  label?: string; // ex: "MarketPanel" â€” aparece no Sentry + UI
}

interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    captureError(error, {
      label: this.props.label ?? 'unknown',
      componentStack: info.componentStack ?? undefined,
    });
    // TambÃ©m loga no console em dev para DX
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Erro em {this.props.label ?? 'componente'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Este painel encontrou um erro. O resto do dashboard continua funcionando.
            </p>
            {process.env.NODE_ENV !== 'production' && this.state.error && (
              <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">
                {this.state.error.message}
              </pre>
            )}
            <Button variant="outline" size="sm" onClick={() => this.setState({ hasError: false, error: null })}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

// Hook para erros em event handlers / async (fora do render)
export function useErrorHandler(label?: string) {
  return React.useCallback((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    captureError(err, { label: label ?? 'useErrorHandler' });
  }, [label]);
}
```

**Onde usar:**

```tsx
// src/app/layout.tsx â€” root boundary (pega tudo)
import { ErrorBoundary } from '@/components/error-boundary';
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ErrorBoundary label="RootLayout">
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}

// src/app/page.tsx â€” por painel (isolamento)
import { ErrorBoundary } from '@/components/error-boundary';
<ErrorBoundary label="MarketPanel"><MarketPanel /></ErrorBoundary>
<ErrorBoundary label="SurveillancePanel"><SurveillancePanel /></ErrorBoundary>
// etc â€” 1 boundary por panel = falha isolada, resto funciona
```

---

## 3. Sentry (`src/lib/observability/sentry.ts`)

```ts
// src/lib/observability/sentry.ts
import * as Sentry from '@sentry/nextjs';
import { getEnv } from '@/lib/env';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] DSN not set â€” Sentry disabled (dev mode)');
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event, hint) {
      // Scrub secrets â€” nunca enviar ENCRYPTION_KEY etc
      const scrub = ['ENCRYPTION_KEY', 'SESSION_SECRET', 'apiKey', 'apiSecret', 'password'];
      if (event.request?.headers) {
        for (const k of scrub) delete (event.request.headers as any)[k];
      }
      if (event.extra) {
        for (const k of scrub) delete (event.extra as any)[k];
      }
      return event;
    },
  });
}

export function captureError(error: Error, context?: Record<string, unknown>): void {
  // 1. Sempre loga via Pino/AppLog (mesmo sem Sentry)
  console.error('[captureError]', context?.label ?? 'unknown', error.message);

  // 2. Sentry se configurado
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error, { extra: context });
  }

  // 3. OTEL span error status (se OTEL ativo)
  // ver src/lib/observability/otel.ts
}
```

**InstalaÃ§Ã£o (SPRINT):**

```bash
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
# wizard cria sentry.client.config.ts + sentry.server.config.ts + next.config.ts wrap
```

---

## 4. OpenTelemetry (`src/lib/observability/otel.ts`)

```ts
// src/lib/observability/otel.ts â€” SPRINT implementa se OTEL_EXPORTER_OTLP_ENDPOINT setado
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

let sdk: NodeSDK | null = null;

export function initOTel(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.log('[otel] OTLP endpoint not set â€” OTEL disabled');
    return;
  }
  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  console.log(`[otel] OTEL started â†’ ${endpoint}`);
}

export function shutdownOTel(): Promise<void> | void {
  return sdk?.shutdown();
}
```

Suporta **Sentry, Datadog, New Relic, Grafana Tempo** â€” todos falam OTLP. Basta apontar `OTEL_EXPORTER_OTLP_ENDPOINT`.

---

## 5. Logger Pino + AppLog (`src/lib/observability/logger.ts`)

```ts
// JÃ¡ existe src/lib/trading/logger.ts â€” SPRINT evolui para Pino estruturado

import pino from 'pino';
import { db } from '@/lib/db';

export const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['password', 'passwordHash', 'token', 'apiKey', 'apiSecret', 'ENCRYPTION_KEY', 'SESSION_SECRET', 'req.headers.authorization'],
    censor: '[REDACTED]',
  },
  // Em prod: JSON puro para Loki/Datadog. Em dev: pino-pretty
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

// Wrapper que persiste em AppLog (Prisma) + Pino
export const logger = {
  info: (source: string, message: string, context?: unknown) => {
    pinoLogger.info({ source, context }, message);
    // Fire-and-forget AppLog (nÃ£o bloqueia)
    db.appLog.create({ data: { level: 'info', source, message, context: context ? JSON.stringify(context) : null } }).catch(() => {});
  },
  warn: (source: string, message: string, context?: unknown) => {
    pinoLogger.warn({ source, context }, message);
    db.appLog.create({ data: { level: 'warn', source, message, context: context ? JSON.stringify(context) : null } }).catch(() => {});
  },
  error: (source: string, message: string, context?: unknown) => {
    pinoLogger.error({ source, context }, message);
    db.appLog.create({ data: { level: 'error', source, message, context: context ? JSON.stringify(context) : null } }).catch(() => {});
  },
};
```

---

## 6. Crash Logger SÃ­ncrono (jÃ¡ existe â€” `src/lib/crash-logger.ts` + `src/instrumentation.ts`)

- `instrumentation.ts:register()` roda ANTES de qualquer request handler (earliest hook Next.js).
- `crash-logger.ts` registra `uncaughtException` + `unhandledRejection` com `fs.writeFileSync` (sync I/O â€” nunca perde tail).
- Escreve em `logs/crash-<kind>-<epoch>.log` + `logs/boot.log` marker.
- Depois de flush: `process.exit(1)` â€” estado indefinido nÃ£o continua (evita corrupÃ§Ã£o de vault).

**VerificaÃ§Ã£o:**

```bash
ls logs/crash-*.log 2>/dev/null | head
cat logs/boot.log | tail
```

---

## 7. TanStack Query Global Error Handler

```ts
// src/app/providers.tsx
import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { captureError } from '@/lib/observability/sentry';
import { toast } from 'sonner';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      captureError(error as Error, { label: 'tanstack:query', queryKey: query.queryKey });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      captureError(error as Error, { label: 'tanstack:mutation', mutationKey: mutation.options.mutationKey });
      toast.error(`Erro: ${(error as Error).message}`);
    },
  }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});
```

---

## 8. API Route Error Handling

```ts
// src/lib/api/error-handler.ts â€” helper para rotas
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { pinoLogger } from '@/lib/observability/logger';
import { captureError } from '@/lib/observability/sentry';

export function handleApiError(error: unknown, route: string): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'validation_error', details: error.flatten() }, { status: 400 });
  }
  if ((error as any)?.status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if ((error as any)?.status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if ((error as any)?.status === 429) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  // 500 â€” nunca vazar stack em prod
  const err = error instanceof Error ? error : new Error(String(error));
  pinoLogger.error({ route, err: err.message, stack: err.stack }, 'Unhandled API error');
  captureError(err, { label: `api:${route}` });

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'internal_error', requestId: (error as any)?.requestId }, { status: 500 });
  }
  return NextResponse.json({ error: 'internal_error', message: err.message, stack: err.stack }, { status: 500 });
}

// Uso em rota:
// export async function GET(req: NextRequest) {
//   try { ... } catch (e) { return handleApiError(e, 'GET /api/positions'); }
// }
```

---

## 9. Checklist â€” Simule um Erro em ProduÃ§Ã£o

> CritÃ©rio do enunciado: "Simule um erro em produÃ§Ã£o: confira se existem logs Ãºteis, monitoramento, analytics, eventos de conversÃ£o, alertas para falhas crÃ­ticas. FaÃ§a ela falhar e veja se vocÃª consegue descobrir: o que aconteceu, onde e com quem."

| Passo | Como | EvidÃªncia |
|---|---|---|
| 1. Ativar Sentry | Setar `SENTRY_DSN` em `.env` | `initSentry()` loga `[sentry] initialized` |
| 2. ForÃ§ar erro | `throw new Error('test-sentry-'+Date.now())` em rota `/api/debug/throw` (sÃ³ dev) | `captureError` + `crash-logger` |
| 3. Verificar captura | Sentry dashboard â†’ Issues â†’ `test-sentry-*` | Stack + label + actorId + IP |
| 4. Verificar AppLog | `GET /api/logs?level=error` | Linha com `source`, `message`, `context` |
| 5. Verificar crash file | `ls logs/crash-*.log` | Sync dump com stack completo |
| 6. Verificar alerta | Telegram/Discord channel subscribed a `engine_error` | Mensagem push em <5s |
| 7. Verificar trace | OTEL endpoint â†’ Grafana/Datadog | Span com `error=true` + `exception.message` |

**Perguntas que o sistema responde apÃ³s o erro:**

- **O que aconteceu?** `error.message` + `stack` + `label` (ex: `MarketPanel`, `api:/api/positions`)
- **Onde?** `route` + `componentStack` + `prevHash` chain (audit)
- **Com quem?** `actorId` + `actorRole` + `ip` (AuditLog) â€” se foi aÃ§Ã£o de usuÃ¡rio
- **Quando?** `timestamp` + `seq` monotonic (hash-chain)



---

## [Conteudo mesclado de ERROR_HANDLING.md — reorganizacao docs 2026-09-27]

# ERROR_HANDLING â€” ConvenÃ§Ãµes de Erro

> **VersÃ£o:** 1.0 â€” 2026-09-23
> **Pilares:** erro tratado Ã© erro tipado + logado + respondido com formato estÃ¡vel. Pipeline de report: [ERROR_REPORTING.md](./ERROR_REPORTING.md). Runbook: [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md).

---

## 1. Camadas e responsabilidade

| Camada | Mecanismo | Arquivo |
|---|---|---|
| API routes | `handleApiError` + Zod nos inputs | `src/lib/api/error-handler.ts` |
| React (painÃ©is) | ErrorBoundary por painel + `captureError` no QueryCache | `src/app/providers.tsx`, componentes dashboard |
| Global | crash-logger persistente | `src/lib/crash-logger.ts` |
| Observabilidade | Sentry + OTel | `src/lib/observability/sentry.ts`, `otel.ts` |
| Engine | event-bus + RiskEvent no Prisma + kill switches | `src/lib/trading/event-bus.ts`, `risk_config.json` |

## 2. Regras

1. **Nunca engolir:** sem `catch {}` vazio; todo catch loga com contexto (rota, ownerId, requestId).
2. **Resposta estÃ¡vel de API:** shape Ãºnico de erro (status + `error.code` + mensagem segura) â€” detalhes internos/stack nunca vazam para o client (sanitizaÃ§Ã£o em `src/lib/sanitize.ts`).
3. **Erros de domÃ­nio tipados:** `src/lib/auth/errors.ts` define o padrÃ£o; erros novos seguem o mesmo estilo (classe/marker + cÃ³digo estÃ¡vel).
4. **Fail-safe no engine:** erro de feed/dados â†’ kill switch `feed_stale_switch` (`close_neutralize`), nunca "seguir com Ãºltimo preÃ§o".
5. **Erro de fonte externa:** retry com backoff + registro em `SourceHealth`; fonte degradada nÃ£o bloqueia o loop inteiro.
6. **Boundaries por painel:** um painel quebrado nÃ£o derruba o dashboard (padrÃ£o S01-T004).

## 3. Taxonomia (use estes cÃ³digos em novas APIs)

| CÃ³digo | Significado | Status |
|---|---|---|
| `VALIDATION_ERROR` | Zod rejeitou input | 400 |
| `UNAUTHENTICATED` | Sem sessÃ£o/cookie invÃ¡lido | 401 |
| `FORBIDDEN` | RBAC negou (ver [RBAC.md](./RBAC.md)) | 403 |
| `NOT_FOUND` | Recurso inexistente ou fora do RLS | 404 |
| `RATE_LIMITED` | Rate limit excedido | 429 |
| `INTERNAL` | Erro nÃ£o-classificado (logado com requestId) | 500 |
| `UNAVAILABLE` | DependÃªncia externa/feed degradado | 503 |

## 4. Fluxo de um erro (exemplo prÃ¡tico)

```
POST /api/kill-switch (viewer)
 â†’ requireSession ok â†’ hasPermission falha
 â†’ AuthzError(FORBIDDEN) â†’ handleApiError â†’ 403 {error:{code:"FORBIDDEN"}}
 â†’ appendAuditLog (hash-chain) â†’ Sentry breadcrumb
```

## 5. PÃ³s-incidente

- Erros 5xx recorrentes abrem incidente ([INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md)).
- EpisÃ³dios do engine viram aprendizado taxonomizado ([MEMORY.md](./MEMORY.md) Â§4, [ITERATION.md](./ITERATION.md)).

---

**Relacionados:** [API.md](./API.md) Â· [ERROR_REPORTING.md](./ERROR_REPORTING.md) Â· [MONITORING.md](./MONITORING.md)

