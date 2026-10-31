// proxy.ts — Next.js Proxy (Node.js runtime since v16; file convention renamed
// from `middleware.ts`, which is deprecated and will be removed).
// Docs: docs/WAF_RATE_LIMIT.md + docs/TLS_HSTS.md + docs/RBAC.md + docs/CSRF
// Runs on every request matching `config.matcher`.

import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'csrf';
const CSRF_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour

// STATE-MUTATING_METHODS require CSRF validation per OWASP A01.
const STATE_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// PUBLIC_API_PATHS that do not require CSRF (auth endpoints, webhooks with
// their own signature schemes, or static resources).
const PUBLIC_CSRF_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/forgot',
  '/api/auth/reset',
  '/api/webhooks/stripe',
  '/api/auth/mfa', // MFA setup uses its own session check
]);

function isStateMutating(method: string): boolean {
  return STATE_MUTATING_METHODS.has(method.toUpperCase());
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function verifyCsrf(req: NextRequest): { valid: boolean; reason?: string } {
  // 1. Webhook endpoints use their own signature schemes (e.g. Stripe HMAC).
  //    Skip CSRF for them — they are not browser-driven.
  if (req.nextUrl.pathname.startsWith('/api/webhooks/')) {
    return { valid: true };
  }

  // 2. Other public API paths may still be state-mutating; they validate via
  //    rate limit + their own domain guards (login is rate-limited 5/60s).
  if (PUBLIC_CSRF_PATHS.has(req.nextUrl.pathname)) {
    return { valid: true };
  }

  const headerToken = req.headers.get(CSRF_HEADER);
  const cookieValue = req.cookies.get(CSRF_COOKIE)?.value;

  if (!headerToken) return { valid: false, reason: 'missing_csrf_header' };
  if (!cookieValue) return { valid: false, reason: 'missing_csrf_cookie' };
  if (!safeEqual(headerToken, cookieValue)) return { valid: false, reason: 'csrf_mismatch' };

  // 4. Optional timestamp window (token format: <hex>.<timestampMs>)
  const dotIdx = headerToken.indexOf('.');
  if (dotIdx > 0) {
    const ts = Number(headerToken.slice(dotIdx + 1));
    if (Number.isFinite(ts) && Math.abs(Date.now() - ts) > CSRF_TOLERANCE_MS) {
      return { valid: false, reason: 'csrf_expired' };
    }
  }

  return { valid: true };
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const method = req.method;

  // 1. Auth guard for /api/* (cookie presence only; DB check is in handler)
  // Allowlist: health, login e fluxo de recuperação de senha (forgot/reset) são públicos —
  // usuário deslogado precisa deles; proteção = rate limit 5/60s + token single-use.
  const publicApi =
    pathname === '/api/health' ||
    pathname.startsWith('/api/auth/login') ||
    pathname === '/api/auth/forgot' ||
    pathname === '/api/auth/reset';
  if (pathname.startsWith('/api/') && !publicApi) {
    const hasSession = req.cookies.get('session')?.value;
    if (!hasSession) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  // 2. CSRF for state-mutating /api/* requests (browser-driven, not webhooks)
  if (pathname.startsWith('/api/') && isStateMutating(method)) {
    const csrf = verifyCsrf(req);
    if (!csrf.valid) {
      return NextResponse.json({ error: 'csrf_failed', reason: csrf.reason }, { status: 403 });
    }
  }

  // 3. Page guard: / (dashboard) requires session, redirect to /login
  if (pathname === '/' || pathname.startsWith('/dashboard')) {
    const hasSession = req.cookies.get('session')?.value;
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }
  if (pathname === '/login') {
    const hasSession = req.cookies.get('session')?.value;
    if (hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next();

  // 4. Security headers — defense in depth (also set in Caddy + next.config headers())
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

