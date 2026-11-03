// proxy.ts — Next.js Proxy (Node.js runtime since v16; file convention renamed
// from `middleware.ts`, which is deprecated and will be removed).
// Docs: docs/WAF_RATE_LIMIT.md + docs/TLS_HSTS.md + docs/RBAC.md + docs/CSRF
// Runs on every request matching `config.matcher`.
//
// SECURITY MODEL (round 1 hardening)
// ----------------------------------
// 1. /api/* auth: the session cookie is `<opaque-token>.<hmac>`. The proxy
//    verifies the HMAC statelessly (no DB) and returns 401 for missing/invalid
//    signatures. The handler still re-validates the Session row (expiry,
//    user.isActive, rate limit) via requireSession — the proxy is a cheap
//    pre-gate, not the authorization decision.
// 2. CSRF: double-submit token HMAC-bound to the session cookie value, 1h
//    window + same-origin check on mutating requests (see src/lib/csrf.ts).
// 3. Page guards (/dashboard, /login) use the same signature check.

import { NextResponse, type NextRequest } from 'next/server';
import { verifySignedSessionToken } from './lib/auth/session-token';
import { isPublicApiPath, isCsrfExemptPath } from './lib/auth/public-routes';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  isTrustedOrigin,
  verifyCsrfToken,
} from './lib/csrf';

const SESSION_COOKIE = 'session';

// STATE-MUTATING_METHODS require CSRF validation per OWASP A01.
const STATE_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isStateMutating(method: string): boolean {
  return STATE_MUTATING_METHODS.has(method.toUpperCase());
}

/** Raw (signed) session cookie value; null when absent. */
function sessionCookieValue(req: NextRequest): string | null {
  return req.cookies.get(SESSION_COOKIE)?.value ?? null;
}

/** Opaque token when the cookie signature is valid, else null (stateless). */
function verifiedSessionToken(req: NextRequest): string | null {
  return verifySignedSessionToken(sessionCookieValue(req));
}

/** Effective public host, accounting for reverse proxies (Railway/Caddy). */
function requestHost(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-host');
  // Some proxies append a comma-separated chain; the first entry is the
  // client-facing host.
  const host = forwarded?.split(',')[0]?.trim() ?? req.headers.get('host') ?? req.nextUrl.host;
  return host ? host.trim() : null;
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const method = req.method;

  // ---------------------------------------------------------------------
  // 1. Auth pre-gate for /api/* — signature only, no DB.
  //    Public allowlist is EXACT and shared with tests (src/lib/auth/public-routes).
  // ---------------------------------------------------------------------
  if (pathname.startsWith('/api/') && !isPublicApiPath(pathname)) {
    if (!verifiedSessionToken(req)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  // ---------------------------------------------------------------------
  // 2. CSRF for state-mutating /api/* requests.
  //    a) Same-origin check ALWAYS applies when the browser sent Origin
  //       (defense in depth, including login/forgot/reset).
  //    b) Double-submit token applies to every non-exempt mutation that
  //       carries a session cookie. Without a session cookie there is no
  //       credential to protect — the handler answers 401 (its requireSession).
  // ---------------------------------------------------------------------
  if (pathname.startsWith('/api/') && isStateMutating(method)) {
    const origin = req.headers.get('origin');
    if (!isTrustedOrigin(origin, requestHost(req))) {
      return NextResponse.json(
        { error: 'csrf_failed', reason: 'origin_mismatch' },
        { status: 403 },
      );
    }

    const cookieValue = sessionCookieValue(req);
    if (cookieValue && !isCsrfExemptPath(pathname)) {
      const csrf = verifyCsrfToken(req.headers.get(CSRF_HEADER), cookieValue);
      if (!csrf.valid) {
        return NextResponse.json(
          { error: 'csrf_failed', reason: csrf.reason },
          { status: 403 },
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // 3. Page guards — /dashboard requires a signed session, /login redirects
  //    authenticated users to the dashboard.
  // ---------------------------------------------------------------------
  if (pathname.startsWith('/dashboard')) {
    if (!verifiedSessionToken(req)) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }
  if (pathname === '/login') {
    if (verifiedSessionToken(req)) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next();

  // ---------------------------------------------------------------------
  // 4. Security headers — defense in depth (also set in Caddy + next.config)
  // ---------------------------------------------------------------------
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  res.headers.set('X-Request-Id', requestId);

  return res;
}

export const config = {
  matcher: ['/api/:path*', '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
