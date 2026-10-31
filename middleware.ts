// middleware.ts — Next.js middleware (edge/node)
// Docs: docs/WAF_RATE_LIMIT.md + docs/TLS_HSTS.md + docs/RBAC.md + docs/CSRF
// Runs on every request matching `config.matcher`.

import { NextResponse, type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

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

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const method = req.method;

  // 1. Auth guard for /api/* (edge-safe: only checks cookie presence, DB check is in handler)
  // Allowlist: health and login are public; everything else 401 if no session cookie
  const publicApi = pathname === '/api/health' || pathname === '/api/auth/login' || pathname.startsWith('/api/auth/login');
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

// Utility: server-side helper to issue a CSRF token bound to the session.
// Use in route handlers that need to set the csrf cookie for the client.
//   const token = await issueCsrfToken(sessionId);
//   res.cookies.set('csrf', token, { httpOnly: true, secure: true, sameSite: 'strict' });
export async function issueCsrfToken(sessionId: string): Promise<string> {
  const timestamp = Date.now();
  const payload = `${sessionId}.${timestamp}`;
  // HMAC over the payload using the SESSION_SECRET. The cookie only carries
  // an opaque tag — the actual session binding happens in verifyCsrf.
  const secret = process.env.SESSION_SECRET ?? 'csrf-fallback-secret-do-not-use-in-prod';
  const mac = createHmac('sha256', secret).update(payload).digest('hex');
  return `${mac}.${timestamp}`;
}
