// sentry.client.config.ts — Sentry client init (no-op if DSN empty or package not installed)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/nextjs');
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
  if (dsn) {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      beforeSend(event: unknown) {
        // Scrub secrets (see docs/ERROR_REPORTING.md)
        const e = event as { request?: { headers?: Record<string, unknown> }; extra?: Record<string, unknown> };
        const scrub = ['ENCRYPTION_KEY', 'SESSION_SECRET', 'apiKey', 'apiSecret', 'password'];
        if (e.request?.headers) for (const k of scrub) delete e.request.headers[k];
        if (e.extra) for (const k of scrub) delete e.extra[k];
        return event as never;
      },
    });
    console.log('[sentry] client initialized');
  }
} catch {
  // Sentry not installed — no-op in dev without DSN
}
