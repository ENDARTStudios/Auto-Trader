// src/lib/auth/public-routes.ts — single source of truth for the /api/*
// allowlist that the proxy lets through WITHOUT a valid signed session cookie.
//
// Keep this list EXACT and minimal. Anything not listed here must validate the
// session in the route handler (requireSession/requirePermission) — see
// tests/security-routes.test.ts, which enforces this contract for every
// src/app/api/**/route.ts file.
//
// Allowed:
//   /api/health               full health report (probes)
//   /api/health/live|ready    Kubernetes liveness/readiness probes
//   /api/auth/login           credential exchange (rate-limited)
//   /api/auth/google*         OAuth start + callback (state cookie)
//   /api/auth/forgot|reset    password recovery (single-use token + rate limit)
//   /api/webhooks/*           HMAC-signed by the provider (e.g. Stripe)
//   /api/i18n/*               public UI messages used by /login before auth
//                             (GET only, static JSON, no user data)
export const PUBLIC_API_EXACT: ReadonlySet<string> = new Set([
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
  '/api/auth/login',
  '/api/auth/google',
  '/api/auth/google/callback',
  '/api/auth/forgot',
  '/api/auth/reset',
]);

export const PUBLIC_API_PREFIXES: readonly string[] = [
  '/api/webhooks/',
  '/api/i18n/',
];

/** True when `pathname` may be served without a valid signed session cookie. */
export function isPublicApiPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return true;
  if (PUBLIC_API_EXACT.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// CSRF exemptions. These are NOT public routes (they still need a session
// unless individually public above); they are simply not browser-driven state
// mutations, so the double-submit token does not apply:
//   - login/forgot/reset: no session exists yet (rate-limited + same-origin)
//   - google: OAuth redirect/callback (state parameter)
//   - webhooks: provider HMAC signature
//   - mcp: machine-to-machine bearer/JWT auth
const CSRF_EXEMPT_EXACT: ReadonlySet<string> = new Set([
  '/api/auth/login',
  '/api/auth/forgot',
  '/api/auth/reset',
  '/api/auth/mfa',
  '/api/mcp',
]);

const CSRF_EXEMPT_PREFIXES: readonly string[] = [
  '/api/webhooks/',
  '/api/auth/google',
];

export function isCsrfExemptPath(pathname: string): boolean {
  if (CSRF_EXEMPT_EXACT.has(pathname)) return true;
  return CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
