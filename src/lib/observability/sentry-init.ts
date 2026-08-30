// src/lib/observability/sentry-init.ts — S28 T002: Sentry init (no-op if package not installed)
import { logger } from "@/lib/trading/logger";

let initialized = false;

export async function initSentry(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    logger.info("obs", "Sentry DSN not configured — Sentry disabled");
    return;
  }
  try {
    // Dynamic import — package may not be installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/nextjs");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
      beforeSend(event: unknown) {
        const e = event as { request?: { headers?: Record<string, unknown> }; extra?: Record<string, unknown> };
        const scrub = ["ENCRYPTION_KEY", "SESSION_SECRET", "SENTRY_DSN", "STRIPE_SECRET_KEY"];
        if (e.request?.headers) for (const k of scrub) delete e.request.headers[k];
        if (e.extra) for (const k of scrub) delete e.extra[k];
        return event;
      },
    });
    logger.info("obs", `Sentry initialized (dsn=${dsn.slice(0, 30)}...)`);
  } catch (e) {
    logger.warn("obs", `Sentry package not installed (run \`npm install @sentry/nextjs\` in production): ${(e as Error).message}`);
  }
}

export function captureSentryException(e: Error, context?: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/nextjs");
    Sentry.captureException(e, { extra: context });
  } catch {
    // package not installed — no-op
  }
}
