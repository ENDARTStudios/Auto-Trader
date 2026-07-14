// src/lib/request-peer-als.ts
//
// v19.3.2: Next.js 16 App Router does NOT expose the TCP socket peer
// address to route handlers. The `connection()` function from
// `next/headers` returns `Promise<void>` (it's just a dynamic-rendering
// marker — the `peer.address` API that existed briefly in Next.js 15.3
// was REMOVED in 16). `NextRequest.ip` was also removed. There is no
// supported way to read the non-spoofable TCP source IP from inside a
// route handler.
//
// This module implements the honest equivalent: an AsyncLocalStorage
// that holds the TCP peer address for the current request. The peer
// address is captured at the HTTP server level (in instrumentation.ts,
// by monkey-patching `http.Server.prototype.emit` to intercept the
// 'request' event) BEFORE Next.js wraps the Node IncomingMessage into
// a Web `Request`. The route handler then reads it from this
// AsyncLocalStorage via `getRequestPeerAddress()`.
//
// This is the Next.js 16 App Router equivalent of Pages Router's
// `req.socket.remoteAddress`. It is non-spoofable for direct connections
// (the TCP handshake requires the real source IP).
//
// BEHIND A REVERSE PROXY: the peer address captured here is the PROXY's
// IP, not the real client's. That's correct — the proxy case is handled
// by the shared-secret + XFF trust model in proxy-trust.ts. The ALS
// value is only used as the FALLBACK when no proxy secret is configured
// (i.e., for direct connections, which is the actual deployment topology
// of this project — bind 127.0.0.1 since v18).

import { AsyncLocalStorage } from "node:async_hooks";

const requestPeerAls = new AsyncLocalStorage<string | null>();

/**
 * Run a handler with the given peer address set as the current request's
 * peer. Called from the http.Server emit monkey-patch in
 * instrumentation.ts. The peer address is then available to any code
 * running inside the handler (including route handlers, server
 * components, server actions) via `getRequestPeerAddress()`.
 */
export function runWithPeerAddress<T>(
  peerAddress: string | null,
  handler: () => T
): T {
  return requestPeerAls.run(peerAddress, handler);
}

/**
 * Read the TCP socket peer address of the current request, or null if
 * called outside a request context (e.g., from a CLI script, a
 * background timer, or a startup hook).
 *
 * This is the Next.js 16 App Router equivalent of Pages Router's
 * `req.socket.remoteAddress`. Non-spoofable for direct connections.
 *
 * BEHIND A REVERSE PROXY: returns the proxy's IP, not the real client's.
 * The proxy case is handled by the shared-secret + XFF trust model in
 * proxy-trust.ts — this value is only used as the fallback when no
 * proxy secret is configured.
 */
export function getRequestPeerAddress(): string | null {
  return requestPeerAls.getStore() ?? null;
}
