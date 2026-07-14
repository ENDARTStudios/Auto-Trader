// POST /api/debug/crash-test
//
// v19.2-CHECK2: deliberate crash trigger for verifying the synchronous crash
// handler is "armed" and fires under concurrent load.
//
// The operator's review flagged that "zero crash-*.log during the stress test"
// is only strong evidence if we can confirm the handler was actually armed and
// firing DURING the load — not just at boot. A cheap way to check this: trigger
// a deliberate crash mid-stress-test and confirm crash-*.log is produced even
// with the server under concurrent load.
//
// SECURITY: this endpoint is GATED by env var ENABLE_CRASH_TEST_ENDPOINT=1.
// It is NEVER enabled by default. The gate is checked at request time (not
// just at module load) so flipping the env requires a process restart —
// an attacker who can set env vars already has more power than this endpoint
// gives them.
//
// Even when enabled, the endpoint only accepts a specific `type` parameter
// to prevent accidental triggering by generic POST probes.
//
// Usage from the stress test script:
//   curl -X POST http://localhost:3100/api/debug/crash-test \
//     -H "Content-Type: application/json" \
//     -d '{"type":"uncaught","secret":"..."}'
//
// The `secret` field must match ENABLE_CRASH_TEST_SECRET env var (if set).
// This prevents a stray curl from a health check or monitoring tool from
// crashing the server.

import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";

export async function POST(req: Request) {
  // GATE 1: env var must be explicitly set to "1"
  if (process.env.ENABLE_CRASH_TEST_ENDPOINT !== "1") {
    return NextResponse.json(
      { error: "Crash test endpoint is not enabled" },
      { status: 404 }
    );
  }

  let body: { type?: string; secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // GATE 2: if a secret is configured, the request must match it
  const configuredSecret = process.env.ENABLE_CRASH_TEST_SECRET;
  if (configuredSecret && body.secret !== configuredSecret) {
    logger.warn("api", "Crash test endpoint called with wrong secret", {
      hasSecret: !!body.secret,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // GATE 3: type must be one of the known crash kinds
  //
  // NOTE: a synchronous `throw` inside this async route handler does NOT
  // become an uncaughtException — Next.js wraps route handlers in a
  // try/catch that converts throws to 500 responses. To actually trigger
  // the crash handler, we must throw OUTSIDE the request's promise chain:
  //   - "uncaught"  → throw inside setTimeout (escapes Next's try/catch)
  //   - "unhandled" → reject a promise with no .catch()
  const type = body.type;
  if (type !== "uncaught" && type !== "unhandled") {
    return NextResponse.json(
      {
        error: "Missing or invalid 'type'. Must be 'uncaught' | 'unhandled'",
      },
      { status: 400 }
    );
  }

  // Log that we're about to crash — this goes to AppLog (async) and may or
  // may not land before the process dies. The crash handler's synchronous
  // file write is the reliable record.
  logger.warn("api", `!!! CRASH TEST ENDPOINT TRIGGERED — type=${type}`, {
    pid: process.pid,
    uptime: process.uptime(),
  });

  // We respond BEFORE crashing so the caller gets a confirmation. The crash
  // happens on the next tick. In practice, the response may or may not reach
  // the client before the process exits — but that's OK, the caller can
  // verify success by checking for the crash-*.log file.
  //
  // We use a short setTimeout to give the response a chance to flush, then
  // crash. This is a best-effort race; the crash handler's synchronous file
  // write is the reliable signal either way.
  setTimeout(() => {
    if (type === "uncaught") {
      // Synchronous throw inside a setTimeout callback — becomes an
      // uncaughtException (not a promise rejection). This escapes Next.js's
      // route-handler try/catch because it's outside the request's promise
      // chain.
      throw new Error(
        `DELIBERATE CRASH TEST (uncaughtException) — pid=${process.pid} uptime=${process.uptime().toFixed(1)}s`
      );
    }
    // "unhandled": create a promise that rejects with no .catch() — becomes
    // an unhandledRejection.
    Promise.reject(
      new Error(
        `DELIBERATE CRASH TEST (unhandledRejection) — pid=${process.pid} uptime=${process.uptime().toFixed(1)}s`
      )
    );
  }, 100);

  // For both types, we return a response first (the crash is deferred
  // via setTimeout). The caller can verify success by checking for the
  // crash-*.log file within ~200ms.
  return NextResponse.json({
    ok: true,
    message: `Crash triggered (type=${type}). Check logs/crash-*.log within ~200ms.`,
    pid: process.pid,
  });
}
