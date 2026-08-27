// Next.js instrumentation hook — runs ONCE per server boot, before any
// request handler, in BOTH `next dev` and `next start`.
//
// v19-BLOCKING: registers the synchronous-file-logging crash handlers
// before the rest of the app boots. This is the earliest user-land hook
// Next.js exposes, so any crash from this point forward (including crashes
// triggered by request handlers, route modules, or library initialization)
// will have its stack trace synchronously written to logs/crash-<kind>-<epoch>.log
// BEFORE the process exits.
//
// Reference: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
//
// The previous "server died silently" crashes during v18 vault testing never
// produced a stack trace — the async logger (DB write) lost the race with
// process termination. With this hook installed, the next silent crash will
// produce a synchronous file dump that survives termination.
//
// v19.3.2: installs the http.Server emit monkey-patch that captures the
// TCP socket peer address of each incoming request into an
// AsyncLocalStorage. This is the Next.js 16 App Router equivalent of
// Pages Router's `req.socket.remoteAddress` — Next.js 16 does NOT expose
// the TCP peer address to route handlers (the `connection()` function
// from `next/headers` returns `Promise<void>`; `NextRequest.ip` was
// removed). The monkey-patch intercepts the 'request' event at the
// HTTP server level, BEFORE Next.js wraps the Node IncomingMessage
// into a Web `Request`, and stores `req.socket.remoteAddress` in the
// ALS where route handlers can read it via `getRequestPeerAddress()`.
// See src/lib/request-peer-als.ts and src/lib/trading/proxy-trust.ts.
//
// RUNTIME GUARD: Next.js evaluates instrumentation.ts for BOTH the Node.js
// runtime AND the Edge runtime. The crash handlers AND the http.Server
// monkey-patch use Node-only APIs, so we MUST guard the body with
// `process.env.NEXT_RUNTIME === 'nodejs'`. On Edge, the register()
// function is a no-op — which is correct, because Edge runtimes
// (Vercel Edge Functions, Cloudflare Workers) don't have a long-lived
// process to crash in the first place, and don't have a Node http.Server
// to monkey-patch either.

export async function register(): Promise<void> {
  // Skip on Edge runtime — crash handlers are meaningless there (no process,
  // no fs, no long-lived state to corrupt). The guard also prevents Turbopack
  // from trying to bundle fs/process APIs into the Edge bundle.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // Dynamic import to avoid bundling the crash-logger into client bundles.
  // Instrumentation runs server-side only, but Next's bundler may still try
  // to walk the import graph eagerly.
  const { registerCrashHandlers } = await import("@/lib/crash-logger");
  registerCrashHandlers();

  // v19.3.2: install the http.Server emit monkey-patch to capture TCP
  // peer addresses into AsyncLocalStorage. See the file header comment
  // for the full rationale (Next.js 16 App Router does not expose
  // `req.socket.remoteAddress` to route handlers).
  const { installRequestPeerCapture } = await import("@/lib/request-peer-capture");
  installRequestPeerCapture();

  // S05: Observability — OTEL (no-op if OTEL_EXPORTER_OTLP_ENDPOINT empty)
  try {
    const { initOTel } = await import("@/lib/observability/otel");
    await initOTel();
  } catch {
    // OTEL optional — no endpoint means no traces
  }

  // The crash-logger itself writes a boot marker to logs/boot.log on
  // initialization, so we don't need a separate console.log here. Keeping
  // this function side-effect-free (apart from the registration) also helps
  // Turbopack avoid false-positive Edge-runtime warnings about process.pid.
}
