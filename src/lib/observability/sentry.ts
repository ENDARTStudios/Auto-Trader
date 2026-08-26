// src/lib/observability/sentry.ts — Sentry wrapper (no-op if DSN not set)

export function captureError(error: Error, context?: Record<string, unknown>): void {
  // Always log locally
  console.error('[captureError]', context?.label ?? 'unknown', error.message, context ?? '');

  // Sentry — only if DSN is configured and @sentry/nextjs is installed
  try {
    // Dynamic to avoid hard dependency when Sentry not installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/nextjs') as typeof import('@sentry/nextjs');
    if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.captureException(error, { extra: context });
    }
  } catch {
    // Sentry not installed — local log is enough for dev
  }
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: Record<string, unknown>): void {
  console.log(`[captureMessage:${level}]`, message, context ?? '');
  try {
    // eslint-disable-next-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/nextjs') as typeof import('@sentry/nextjs');
    if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.captureMessage(message, { level, extra: context });
    }
  } catch {
    // no-op
  }
}
