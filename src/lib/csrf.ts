// src/lib/csrf.ts — server-side helper for issuing CSRF tokens.
//
// Moved out of the request-boundary file (proxy.ts) so the proxy file keeps the
// single-function convention required by Next.js 16 (`export function proxy`).
// Verification lives in proxy.ts; issuance lives here, for route handlers that
// need to set the `csrf` cookie for the browser.
//
//   const token = await issueCsrfToken(sessionId);
//   res.cookies.set('csrf', token, { httpOnly: true, secure: true, sameSite: 'strict' });

import { createHmac } from 'crypto';

export async function issueCsrfToken(sessionId: string): Promise<string> {
  const timestamp = Date.now();
  const payload = `${sessionId}.${timestamp}`;
  // HMAC over the payload using the SESSION_SECRET. The cookie only carries an
  // opaque tag — the actual session binding happens in verifyCsrf (proxy.ts).
  const secret = process.env.SESSION_SECRET ?? 'csrf-fallback-secret-do-not-use-in-prod';
  const mac = createHmac('sha256', secret).update(payload).digest('hex');
  return `${mac}.${timestamp}`;
}
