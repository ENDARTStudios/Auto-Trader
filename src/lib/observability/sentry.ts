// src/lib/observability/sentry.ts — wrapper de error tracking usado pelas rotas.
//
// Contrato: NUNCA lança (chamado no caminho de erro de requests) e sempre registra
// localmente. Telemetria: SDK oficial se instalado; senão transporte HTTP por
// envelope (src/lib/observability/sentry-http.ts), que funciona sem dependência.
import { captureErrorHttp, captureSentryEvent } from '@/lib/observability/sentry-http';

function dsnConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
}

// Retorna true quando o SDK oficial enviou o evento (evita envio duplicado).
function trySdkCapture(error: Error, context?: Record<string, unknown>): boolean {
  if (!dsnConfigured()) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/nextjs') as typeof import('@sentry/nextjs');
    if (!Sentry || typeof Sentry.captureException !== 'function') return false;
    Sentry.captureException(error, { extra: context });
    return true;
  } catch {
    return false; // pacote ausente — o transporte HTTP assume
  }
}

function trySdkMessage(
  message: string,
  level: 'info' | 'warning' | 'error',
  context?: Record<string, unknown>,
): boolean {
  if (!dsnConfigured()) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/nextjs') as typeof import('@sentry/nextjs');
    if (!Sentry || typeof Sentry.captureMessage !== 'function') return false;
    Sentry.captureMessage(message, { level, extra: context });
    return true;
  } catch {
    return false;
  }
}

export function captureError(error: Error, context?: Record<string, unknown>): void {
  // Log local sempre (fonte de verdade para quem lê logs/crash.log).
  console.error('[captureError]', context?.label ?? 'unknown', error.message, context ?? '');
  if (trySdkCapture(error, context)) return;
  // Sem SDK (caso real hoje): envia por HTTP, fire-and-forget.
  captureErrorHttp(error, context);
}

export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, unknown>,
): void {
  console.log('[captureMessage:' + level + ']', message, context ?? '');
  if (trySdkMessage(message, level, context)) return;
  void captureSentryEvent({ level, message, extra: context });
}
