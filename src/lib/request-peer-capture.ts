// src/lib/request-peer-capture.ts
//
// v19.3.2: Monkey-patches `http.Server.prototype.emit` to intercept the
// 'request' event and capture `req.socket.remoteAddress` into the
// AsyncLocalStorage from request-peer-als.ts.
//
// WHY THIS EXISTS:
//   Next.js 16 App Router does NOT expose the TCP socket peer address to
//   route handlers. The `connection()` function from `next/headers`
//   returns `Promise<void>` (it's just a dynamic-rendering marker — the
//   `peer.address` API that existed briefly in Next.js 15.3 was REMOVED
//   in 16). `NextRequest.ip` was also removed. There is no supported
//   way to read the non-spoofable TCP source IP from inside a route
//   handler.
//
//   This module implements the honest equivalent: intercept the request
//   at the HTTP server level, BEFORE Next.js wraps the Node
//   IncomingMessage into a Web `Request`, and store the peer address
//   in an AsyncLocalStorage. Route handlers then read it via
//   `getRequestPeerAddress()` from request-peer-als.ts.
//
//   This is the Next.js 16 App Router equivalent of Pages Router's
//   `req.socket.remoteAddress`. Non-spoofable for direct connections.
//
// HOW IT WORKS:
//   `http.Server` is an `EventEmitter`. When a new HTTP request arrives,
//   the server emits a 'request' event with `(req, res)` where `req` is
//   a Node `IncomingMessage` with `req.socket.remoteAddress`. We
//   override `emit` to detect this event, read the peer address, and
//   call the original `emit` inside `runWithPeerAddress(peer, ...)`.
//   The AsyncLocalStorage propagates the value through the async chain
//   (including through Next.js's internal request-handling pipeline)
//   so that route handlers, server components, and server actions can
//   all read it.
//
// IDEMPOTENT:
//   Safe to call multiple times — the monkey-patch checks a sentinel
//   property (`__peerCaptureInstalled`) on the prototype to avoid
//   double-installation. This matters because Next.js dev mode can
//   re-evaluate instrumentation.ts on hot reloads.
//
// COUPLING TO http.Server (v19.3.2-review, operator point 3):
//   This mechanism depends on the request flowing through Node's
//   `http.Server.prototype.emit('request', req, res)` — which is the
//   standard Node.js HTTP/1.1 server path, and the path Next.js takes
//   for its App Router route handlers in the Node.js runtime. If the
//   deployment ever moves to:
//
//     - HTTP/2 via `http2.createSecureServer()` directly (without an
//       http.Server-compatible adapter) — http2 servers emit a 'stream'
//       event, not 'request', so this patch silently does nothing.
//     - A "custom server" mode where Next.js is mounted on a server
//       that doesn't use http.Server (e.g., a Fastify adapter that
//       re-emits requests differently) — same silent degradation.
//     - A Node.js runtime adapter that wraps IncomingMessage before
//       emitting 'request' (e.g., a serverless platform that synthesizes
//       req objects from cloud events) — req.socket may be absent,
//       peerAddress falls back to null, downstream sees
//       "unidentifiable-socket".
//
//   In ALL of these cases, the patch DOES NOT crash — it silently
//   stops capturing peer addresses, and `getRequestPeerAddress()`
//   returns null. Downstream, `resolveTrustedClientIp` maps null to
//   the `"unidentifiable-socket"` bucket — a NAMED bucket that surfaces
//   in the audit log (so the operator can detect the degradation by
//   looking for that bucket name) but, if left unaddressed, collapses
//   all direct connections to one shared bucket (back to the v19.3.1
//   self-DoS shape, just with a different bucket name).
//
//   DETECTION: the operator runbook (§13.7) includes a SQL query for
//   audit-log entries with `sourceIp = 'unidentifiable-socket'`. If
//   that count is non-zero in a deployment that expects direct
//   connections (no proxy), it means the monkey-patch is NOT
//   capturing peer addresses — investigate the runtime / server
//   adapter before treating the rate limiter as functional.
//
//   MIGRATION PATH: if the project moves off `http.Server`, the fix
//   is to re-implement peer-address capture at whatever layer DOES
//   see the raw TCP socket. For HTTP/2, that's the 'stream' event
//   handler's `session.socket.remoteAddress`. For a custom server
//   adapter, it's whatever the adapter exposes. The pure decision
//   function `resolveTrustedClientIp` does NOT change — only the
//   capture mechanism does.

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { runWithPeerAddress } from "./request-peer-als";

const INSTALL_SENTINEL = "__peerCaptureInstalled";

type EmitArgs = unknown[];
type OriginalEmit = typeof http.Server.prototype.emit;

export function installRequestPeerCapture(): void {
  const proto = http.Server.prototype as http.Server & {
    [INSTALL_SENTINEL]?: boolean;
    [originalEmitSymbol]?: OriginalEmit;
  };

  if (proto[INSTALL_SENTINEL]) {
    // Already installed — idempotent guard against double-install on
    // hot reloads in dev mode.
    return;
  }

  const originalEmit = proto.emit;
  proto[originalEmitSymbol] = originalEmit;
  proto[INSTALL_SENTINEL] = true;

  proto.emit = function patchedEmit(
    this: http.Server,
    event: string,
    ...args: EmitArgs
  ): boolean {
    // Only intercept the 'request' event. Other events ('connection',
    // 'upgrade', 'error', etc.) pass through unchanged.
    if (event !== "request") {
      return originalEmit.apply(this, [event, ...args] as Parameters<OriginalEmit>);
    }

    // The 'request' event signature is (req: IncomingMessage, res: ServerResponse).
    const [req, res] = args as [IncomingMessage, ServerResponse];

    // v19.3.2-review (operator review of v19.3.2): The original patchedEmit
    // did NOT wrap the peer-address capture in try/catch. The capture itself
    // is defensive (?.  + ?? null), but if anything inside this interception
    // path ever throws — a future code change, a corrupted socket object, a
    // bug in AsyncLocalStorage.run() under memory pressure — the exception
    // would propagate UP through `emit()` and crash the HTTP server on EVERY
    // request, not just one. That is a strictly worse failure mode than the
    // silent-crash bug this whole investigation is about. The operator's
    // directive: "any error in the capture degrades to the shared
    // 'unidentifiable-socket' bucket, NEVER propagates the exception through
    // the original emit()".
    //
    // We therefore:
    //   1. Compute peerAddress inside try/catch. On any error, fall back to
    //      null (which resolveTrustedClientIp maps to "unidentifiable-socket"
    //      — a named bucket so it's visible in the audit log if it ever
    //      fires).
    //   2. Wrap the originalEmit.apply() inside runWithPeerAddress in a
    //      SECOND try/catch. If AsyncLocalStorage.run() itself somehow
    //      throws (corrupted ALS instance, V8 hook stack overflow), we
    //      still dispatch the original emit WITHOUT the ALS context —
    //      the route handler will see "unidentifiable-socket" via
    //      getRequestPeerAddress() returning null, and the request still
    //      completes. We log the failure synchronously to stderr + the
    //      crash log directory so it surfaces in the next investigation.
    let peerAddress: string | null = null;
    try {
      // Read the TCP socket peer address. For direct connections this is
      // the real client IP (non-spoofable — TCP handshake requires the
      // real source IP). For behind-proxy connections this is the proxy's
      // IP — but the proxy case is handled by the shared-secret + XFF
      // trust model in proxy-trust.ts; the ALS value is only used as the
      // fallback when no proxy secret is configured.
      //
      // `req.socket` can be null in rare cases (e.g., the request was
      // already destroyed before the event fired). Fall back to null —
      // the consumer (proxy-trust.ts) handles null by returning
      // "unidentifiable-socket".
      peerAddress = req.socket?.remoteAddress ?? null;
    } catch (captureErr) {
      // Defensive — should never happen with the optional chaining above,
      // but if `req` is not actually an IncomingMessage (e.g., a custom
      // server emits a 'request' event with non-standard args), accessing
      // `req.socket` could throw. Degrade gracefully.
      peerAddress = null;
      try {
        process.stderr.write(
          `[request-peer-capture] WARN: peer address capture threw — falling back to "unidentifiable-socket". err=${String(captureErr)}\n`
        );
      } catch {
        // Even stderr.write can throw if stderr is closed (rare but
        // possible during process shutdown). Swallow — we MUST NOT let
        // any exception escape through emit().
      }
    }

    // Run the original emit inside the AsyncLocalStorage so the peer
    // address propagates to the route handler.
    //
    // v19.3.2-structural-review (operator review of draft-6):
    //
    // The previous version of this block had a single try/catch around
    // `runWithPeerAddress(peerAddress, () => originalEmit.apply(...))`.
    // That was WRONG. `AsyncLocalStorage.run(store, callback)` does NOT
    // catch exceptions thrown inside `callback` — they propagate out of
    // `.run()` just like any other synchronous exception. So that single
    // try/catch was catching TWO structurally different cases:
    //
    //   (a) ALS SETUP failed (runWithPeerAddress threw before invoking
    //       the callback — e.g., ALS instance corrupted, V8 hook stack
    //       overflow). This IS our code, IS recoverable, and IS what
    //       the operator's directive ("any error in the capture
    //       degrades to 'unidentifiable-socket', NEVER propagates the
    //       exception through emit()") covers.
    //
    //   (b) DOWNSTREAM HANDLER threw (originalEmit.apply() fired the
    //       'request' listeners, one of which threw synchronously —
    //       e.g., a real bug in Next.js's request pipeline, or in a
    //       route handler). This is NOT our code, is NOT recoverable
    //       by us, and MUST propagate to Node's `uncaughtException`
    //       handler so that crash-logger.ts writes the trace and the
    //       process exits + restarts exactly as it would without the
    //       monkey-patch.
    //
    // The previous version caught BOTH and, for both, re-dispatched
    // `originalEmit.apply()`. For case (b) this was strictly worse than
    // the bug being fixed:
    //   - The downstream handler ran TWICE (duplicate side effects:
    //     duplicate DB writes, duplicate state mutations).
    //   - If the second invocation also threw, the original exception
    //     was masked by the second one — crash-logger.ts would log the
    //     SECOND error, not the FIRST, misdirecting the investigation.
    //   - If the second invocation did NOT throw (state was mutated by
    //     the first run, taking a different code path), the response
    //     was sent normally and the original exception was SILENTLY
    //     SWALLOWED — no crash log, no stack trace, exactly the
    //     "silent hang without log" pattern this whole investigation
    //     exists to catch.
    //
    // FIX: use a sentinel `enteredHandler` that flips to true ONLY once
    // we've entered the callback passed to `runWithPeerAddress`. This
    // distinguishes the two cases:
    //
    //   - If we catch AND `enteredHandler === false` → ALS setup threw
    //     BEFORE the callback ran. Recover by dispatching originalEmit
    //     WITHOUT the ALS context (downstream sees null →
    //     "unidentifiable-socket" bucket). This is the only case the
    //     operator's directive covers.
    //
    //   - If we catch AND `enteredHandler === true` → the callback was
    //     entered, meaning the exception came from INSIDE the callback
    //     (i.e., from originalEmit / downstream handler). This is NOT
    //     our exception to catch. RE-THROW it so it propagates through
    //     `http.Server.prototype.emit` to Node's `uncaughtException`
    //     handler, where crash-logger.ts writes the trace and the
    //     process exits + restarts exactly as before the patch existed.
    //     We do NOT re-dispatch originalEmit — that would double-execute
    //     the downstream handler.
    let enteredHandler = false;
    try {
      return runWithPeerAddress(peerAddress, () => {
        enteredHandler = true;
        return originalEmit.apply(this, [event, ...args] as Parameters<OriginalEmit>);
      });
    } catch (err) {
      if (enteredHandler) {
        // Case (b): the exception came from INSIDE the callback — i.e.,
        // from originalEmit.apply() / a downstream 'request' listener.
        // This is NOT an ALS-setup error and is NOT ours to catch.
        // Re-throw so crash-logger.ts + Node's uncaughtException behave
        // exactly as they would without the monkey-patch. We MUST NOT
        // re-dispatch originalEmit (that would double-execute the
        // handler and compound the side effects).
        throw err;
      }
      // Case (a): ALS setup itself threw BEFORE the callback ran. This
      // is the only case the operator's directive covers: "any error in
      // the capture degrades to 'unidentifiable-socket', NEVER
      // propagates the exception through emit()". Dispatch WITHOUT the
      // ALS context — downstream sees null via getRequestPeerAddress()
      // (which maps to "unidentifiable-socket").
      try {
        process.stderr.write(
          `[request-peer-capture] WARN: AsyncLocalStorage.run() threw during SETUP (callback was NOT entered) — dispatching WITHOUT peer-address context. err=${String(err)}\n`
        );
      } catch {
        // Swallow — see above.
      }
      return originalEmit.apply(this, [event, ...args] as Parameters<OriginalEmit>);
    }
  };
}

// Symbol used to store the original emit on the prototype, so we can
// restore it if ever needed (e.g., for testing).
const originalEmitSymbol = Symbol("__originalEmit");

/**
 * Test-only helper: removes the monkey-patch and restores the original
 * `http.Server.prototype.emit`. Used by the test suite to verify the
 * patch is installed correctly without leaving side effects on the
 * global prototype between test runs.
 */
export function uninstallRequestPeerCaptureForTest(): void {
  const proto = http.Server.prototype as http.Server & {
    [INSTALL_SENTINEL]?: boolean;
    [originalEmitSymbol]?: OriginalEmit;
  };
  if (!proto[INSTALL_SENTINEL]) return;
  if (proto[originalEmitSymbol]) {
    proto.emit = proto[originalEmitSymbol];
  }
  delete proto[INSTALL_SENTINEL];
  delete proto[originalEmitSymbol];
}
