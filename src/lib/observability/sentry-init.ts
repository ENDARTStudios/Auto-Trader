// src/lib/observability/sentry-init.ts — inicialização do error tracking.
//
// Dois caminhos, nesta ordem:
//   1. SDK oficial (@sentry/nextjs) — usado se estiver instalado (hoje NÃO está).
//   2. Transporte HTTP por envelope (src/lib/observability/sentry-http.ts) —
//      sempre disponível, sem dependência. É o caminho real em produção hoje.
import { logger } from '@/lib/trading/logger';
import {
  captureErrorHttp,
  captureSentryEvent,
  getSentryDsn,
  isSentryConfigured,
} from '@/lib/observability/sentry-http';

let initialized = false;
let httpTransportEnabled = false;
let sdkActive = false;

const SCRUB_KEYS = [
  'ENCRYPTION_KEY',
  'SESSION_SECRET',
  'SENTRY_DSN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'AI_API_KEY',
  'TYPESAFE_API_KEY',
];

export async function initSentry(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!isSentryConfigured()) {
    logger.info('obs', 'Sentry DSN não configurado — error tracking desligado (no-op)');
    return;
  }

  // Caminho 1: SDK oficial, se existir na árvore.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/nextjs');
    Sentry.init({
      dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      beforeSend(event: unknown) {
        const e = event as {
          request?: { headers?: Record<string, unknown> };
          extra?: Record<string, unknown>;
          tags?: Record<string, unknown>;
        };
        for (const k of SCRUB_KEYS) {
          if (e.request?.headers) delete e.request.headers[k];
          if (e.extra) delete e.extra[k];
          if (e.tags) delete e.tags[k];
        }
        return event;
      },
    });
    sdkActive = true;
    logger.info('obs', 'Sentry SDK inicializado');
    return;
  } catch {
    // Pacote ausente (esperado): cai para o transporte HTTP.
  }

  // Caminho 2: transporte HTTP por envelope — sem dependência, sem build step.
  const dsn = getSentryDsn();
  httpTransportEnabled = true;
  logger.info(
    'obs',
    'Sentry HTTP transport habilitado (host=' + (dsn ? dsn.host : '?') + ', projeto=' + (dsn ? dsn.projectId : '?') + ')',
  );
}

export function isSentryEnabled(): boolean {
  return sdkActive || httpTransportEnabled;
}

export function captureSentryException(e: Error, context?: Record<string, unknown>): void {
  if (sdkActive) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/nextjs');
      Sentry.captureException(e, { extra: context });
      return;
    } catch {
      // SDK desapareceu em runtime — segue para o transporte HTTP.
    }
  }
  captureErrorHttp(e, context);
}

export function captureSentryMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, unknown>,
): void {
  if (sdkActive) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/nextjs');
      Sentry.captureMessage(message, { level, extra: context });
      return;
    } catch {
      // cai para HTTP
    }
  }
  void captureSentryEvent({ level, message, extra: context });
}
