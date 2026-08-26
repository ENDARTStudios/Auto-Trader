// middleware.ts — Next.js middleware (edge/node)
// Docs: docs/WAF_RATE_LIMIT.md + docs/TLS_HSTS.md + docs/RBAC.md
// Runs on every request matching `config.matcher`.

import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // 1. Auth guard for /api/* (edge-safe: only checks cookie presence, DB check is in handler)
  // Allowlist: health and login are public; everything else 401 if no session cookie
  const publicApi = pathname === '/api/health' || pathname === '/api/auth/login' || pathname.startsWith('/api/auth/login');
  if (pathname.startsWith('/api/') && !publicApi) {
    const hasSession = req.cookies.get('session')?.value;
    if (!hasSession) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  // Page guard: / (dashboard) requires session, redirect to /login
  if (pathname === '/' || pathname.startsWith('/dashboard')) {
    const hasSession = req.cookies.get('session')?.value;
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }
  // If logged in and visiting /login, redirect to /
  if (pathname === '/login') {
    const hasSession = req.cookies.get('session')?.value;
    if (hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next();

  // 2. Security headers — defense in depth (also set in Caddy + next.config headers())
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  // HSTS — only in production (never on localhost, would pin http://localhost as https)
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  // Request ID for observability correlation
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  res.headers.set('X-Request-Id', requestId);

  return res;
}

export const config = {
  matcher: ['/api/:path*', '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
