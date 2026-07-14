// src/lib/trading/proxy-trust.ts
//
// v19.3.2 HOTFIX-FIX (operator review of v19.3.1):
//
// The v19.3.1 hotfix had a critical flaw: when no trusted proxy was
// configured (the actual deployment topology of this project — bind
// 127.0.0.1 has been the primary security posture since v18, no reverse
// proxy has ever been configured), it returned the sentinel string
// "direct-untrusted" for ALL direct connections. That sentinel was a
// single shared bucket — exactly the same self-DoS shape as the original
// global Date[] bug, just renamed. For the deployment that is actually
// running today, the hotfix did not fix the bug; it only prepared the
// ground for a future behind-proxy deployment that does not exist yet.
//
// The correct fallback for the "no trusted proxy" path is the TCP socket
// peer address of the incoming connection. Unlike an HTTP header (which
// is just text the client chooses to send), the TCP socket peer address
// is established by the kernel during the TCP handshake — the client
// cannot complete the handshake without using its real source IP. This
// is exactly the non-spoofable identifier the per-IP rate limiter needs
// when there is no proxy relaying XFF.
//
// In Next.js 16 App Router, route handlers receive a Web `Request` which
// does not expose the underlying socket. The `connection()` function
// from `next/headers` returns `Promise<void>` in Next.js 16 (it's just
// a dynamic-rendering marker — the `peer.address` API that existed
// briefly in 15.3 was REMOVED). `NextRequest.ip` was also removed.
// There is NO supported way to read the TCP peer address from inside
// a route handler.
//
// To get the peer address anyway, `src/instrumentation.ts` installs a
// monkey-patch on `http.Server.prototype.emit` (in
// `src/lib/request-peer-capture.ts`) that intercepts the 'request'
// event BEFORE Next.js wraps the Node IncomingMessage into a Web
// `Request`, reads `req.socket.remoteAddress`, and stores it in an
// AsyncLocalStorage (`src/lib/request-peer-als.ts`). Route handlers
// read it via `getRequestPeerAddress()`. This is the Next.js 16 App
// Router equivalent of Pages Router's `req.socket.remoteAddress`.
//
// This module now implements the correct trust model:
//
//   1. If SIGNER_PROXY_SHARED_SECRET env var is set AND the request
//      carries an `x-internal-proxy-secret` header matching the secret,
//      we are behind a trusted reverse proxy. The proxy is responsible
//      for overwriting any client-supplied `x-forwarded-for` /
//      `x-real-ip` (Caddy: `header_up X-Forwarded-For {remote}`). In
//      this mode we trust XFF's leftmost entry as the real client IP —
//      the socket peer in this case is the proxy itself, not the client.
//
//   2. Otherwise (no secret configured, OR secret doesn't match, OR the
//      request didn't come through a proxy that set the secret), we use
//      `connection().peer.address` directly as the per-IP key. This is
//      non-spoofable for direct connections and gives real per-IP
//      isolation for the deployment this project actually runs.
//
//      The sentinel "direct-untrusted" is GONE. The only fallback when
//      `peer.address` is null (theoretically possible in some edge
//      runtime adapters, never observed in Node.js runtime) is the
//      string "unidentifiable-socket" — a last-resort bucket that
//      should never be hit in practice but is named so it is visible
//      in the audit log if it ever is.
//
// KNOWN UNRESOLVED CASE (documented in runbook §13.7): if the process
// runs behind NAT or Docker userland-proxy without terminating TLS/HTTP,
// `peer.address` collapses to a single gateway IP for multiple real
// origins. This is a deployment-environment limitation, not a code
// bug — and the global aggregate cap (50 failures/1h) still catches
// distributed attacks in that scenario, because the global counter is
// independent of the per-IP Map.
//
// Why a shared secret for the proxy case (not a proxy-IP allowlist)?
//   In Next.js App Router, even with `connection()` we only see the
//   immediate TCP peer — which, behind a proxy, is the proxy itself.
//   We cannot distinguish "request from Caddy on 127.0.0.1" from
//   "request from an attacker on 127.0.0.1 who found the loopback
//   bind" by IP alone. The shared secret is the application-layer
//   equivalent of the proxy-IP allowlist: only a proxy that knows the
//   secret can mark a request as trusted. The secret must be generated
//   once, set in BOTH the proxy config and the app env, and never
//   exposed to clients. Caddy config snippet:
//
//     reverse_proxy localhost:3000 {
//       header_up X-Internal-Proxy-Secret {env.SIGNER_PROXY_SHARED_SECRET}
//       header_up X-Forwarded-For {remote}
//     }
//
//   And in the app env (e.g., .env.local or systemd EnvironmentFile):
//
//     SIGNER_PROXY_SHARED_SECRET=<64-hex-char-random-string>

function getProxySecret(): string | undefined {
  const v = process.env.SIGNER_PROXY_SHARED_SECRET?.trim();
  return v && v.length > 0 ? v : undefined;
}

/**
 * PURE decision function — no I/O, no Next.js runtime dependency.
 *
 * Takes a headers accessor (Request.headers works), a peer address
 * (TCP socket remote address, or null), and the proxy secret (or
 * undefined). Returns the trusted client IP string to use as the
 * per-IP rate-limit key.
 *
 * Exported so unit tests can call it directly without having to mock
 * the Next.js `connection()` async context.
 */
export function resolveTrustedClientIp(opts: {
  headers: { get(name: string): string | null };
  peerAddress: string | null;
  proxySecret: string | undefined;
}): string {
  const { headers, peerAddress, proxySecret } = opts;

  // Trusted-proxy mode: only entered if a shared secret is configured.
  if (proxySecret) {
    const provided = headers.get("x-internal-proxy-secret")?.trim();
    if (provided && provided === proxySecret) {
      // Secret matches — request came through the trusted proxy. The
      // proxy is responsible for overwriting XFF with the real client
      // chain. We take the leftmost (original client).
      const xff = headers.get("x-forwarded-for");
      if (xff) {
        const first = xff.split(",")[0]?.trim();
        if (first) return first;
      }
      // XFF missing despite the secret matching — proxy is misconfigured
      // (set the secret but didn't set XFF). Fall back to x-real-ip.
      const xri = headers.get("x-real-ip");
      if (xri) return xri.trim();
      // Last resort in trusted-proxy mode: the socket peer is the proxy
      // itself. We have no way to identify the real client. Use the
      // peer address as the bucket key — at worst this collapses all
      // proxy traffic to one bucket (degraded but not bypassable).
      return peerAddress ?? "unidentifiable-socket";
    }
    // Secret mismatch — either the proxy is misconfigured, or someone
    // is trying to forge a trusted request directly (bypassing the
    // proxy). Either way, do NOT trust any client-supplied header.
    // Fall through to peer address.
  }

  // Direct mode (no proxy secret configured, OR secret didn't match).
  // The TCP socket peer address is non-spoofable: completing the TCP
  // handshake requires the real source IP. This is the correct per-IP
  // key for the deployment this project actually runs (bind 127.0.0.1,
  // no reverse proxy).
  //
  // The "direct-untrusted" sentinel from v19.3.1 is GONE — that was
  // the bug the operator caught: a fixed shared bucket recreated the
  // original self-DoS for the actual deployment topology.
  return peerAddress ?? "unidentifiable-socket";
}

/**
 * Production wrapper — called from route handlers. Reads the TCP socket
 * peer address from the AsyncLocalStorage populated by the
 * `http.Server.prototype.emit` monkey-patch in
 * `src/lib/request-peer-capture.ts` (installed at boot via
 * `src/instrumentation.ts`), and passes it to the pure
 * `resolveTrustedClientIp` decision function.
 *
 * WHY NOT `connection()` from `next/headers`?
 *   In Next.js 16, `connection()` returns `Promise<void>` — it's just a
 *   dynamic-rendering marker. The `peer.address` API that existed
 *   briefly in Next.js 15.3 was REMOVED in 16. There is no supported
 *   way to read the TCP peer address from inside a route handler.
 *   The AsyncLocalStorage + http.Server monkey-patch is the honest
 *   equivalent — it captures `req.socket.remoteAddress` at the HTTP
 *   server level, before Next.js wraps the Node IncomingMessage into
 *   a Web `Request`. See `src/lib/request-peer-capture.ts` for the
 *   full rationale.
 *
 * Returns the resolved IP synchronously (the ALS read is sync). The
 * function is async only for API stability — if a future Next.js
 * version restores a `connection().peer.address`-style API, we can
 * switch to it without changing the call sites.
 *
 * MUST be called inside a request context (route handler / server
 * component / server action) for the ALS to be populated. Calling
 * outside a request context (e.g., in a CLI script) returns the
 * "unidentifiable-socket" fallback — but the rate limiter itself
 * takes the IP as a string argument, so tests bypass this wrapper
 * and call `walletVault.unlockAsync(passphrase, sourceIpString)`
 * directly.
 */
export async function extractTrustedClientIp(req: Request): Promise<string> {
  // Dynamic import keeps this module importable from non-request
  // contexts (tests, scripts). The ALS module is Node-only.
  let peerAddress: string | null = null;
  try {
    const { getRequestPeerAddress } = await import("@/lib/request-peer-als");
    peerAddress = getRequestPeerAddress();
  } catch (err) {
    // Defensive — should not happen in a real route handler (the ALS
    // module is plain Node.js, no exotic deps). If it does, we fall
    // through with peerAddress = null and the pure function returns
    // "unidentifiable-socket". The audit log will show that bucket
    // name so the operator can investigate.
    peerAddress = null;
  }
  return resolveTrustedClientIp({
    headers: req.headers,
    peerAddress,
    proxySecret: getProxySecret(),
  });
}

/**
 * Whether the app is configured to run behind a trusted proxy. Exposed for
 * /health endpoints and operator dashboards so the operator can verify at
 * a glance whether per-IP rate limiting is using XFF (trusted proxy mode)
 * or direct socket peer address (the default for this project's bind-
 * to-127.0.0.1 topology).
 *
 * Reads env live (not captured at module load) so runtime config changes
 * are reflected immediately.
 */
export function isBehindTrustedProxy(): boolean {
  return getProxySecret() !== undefined;
}
