// src/lib/csrf.ts — CSRF double-submit token, HMAC-bound to the session cookie.
//
// Token format: `<hmacSha256Hex>.<timestampMs>`
//   HMAC = HMAC-SHA256(SESSION_SECRET, `${sessionCookieValue}.${timestampMs}`)
//
// Why bind to the *session cookie value* (which is itself signed — see
// src/lib/auth/session-token.ts):
//   - A token issued for session A is useless with session B (blocks token
//     fixation / cross-user replay).
//   - The value cannot be forged without the server secret.
//   - The timestamp gives a bounded 1h window, so a leaked token is not valid
//     forever.
//
// The cookie is intentionally NOT httpOnly: the browser must mirror it in the
// `x-csrf-token` header (double submit). Verification lives here (pure, testable
// without Next.js); src/proxy.ts wires it to the actual request.

import { createHmac, timingSafeEqual } from 'crypto';
import { getSessionSecret } from './auth/session-token';

export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_COOKIE = 'csrf';
export const CSRF_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour

export type CsrfCheck =
  | { valid: true }
  | {
      valid: false;
      reason:
        | 'missing_csrf_header'
        | 'missing_session'
        | 'csrf_malformed'
        | 'csrf_expired'
        | 'csrf_mismatch';
    };

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Issues a CSRF token bound to the given session cookie value.
 * @param sessionCookieValue the SIGNED session cookie value (what the browser
 *        sends back in the `session` cookie), not the raw opaque token.
 */
export function issueCsrfToken(sessionCookieValue: string, now: number = Date.now()): string {
  if (!sessionCookieValue) {
    throw new Error('issueCsrfToken requires the session cookie value');
  }
  const timestamp = now;
  const mac = hmacHex(getSessionSecret(), `${sessionCookieValue}.${timestamp}`);
  return `${mac}.${timestamp}`;
}

/**
 * Verifies the double-submit pair: header token must be a valid HMAC for the
 * current session cookie value and inside the tolerance window.
 */
export function verifyCsrfToken(
  headerToken: string | null | undefined,
  sessionCookieValue: string | null | undefined,
  now: number = Date.now(),
): CsrfCheck {
  if (!headerToken) return { valid: false, reason: 'missing_csrf_header' };
  if (!sessionCookieValue) return { valid: false, reason: 'missing_session' };

  const separator = headerToken.lastIndexOf('.');
  if (separator <= 0 || separator === headerToken.length - 1) {
    return { valid: false, reason: 'csrf_malformed' };
  }
  const providedMac = headerToken.slice(0, separator).toLowerCase();
  const timestamp = Number(headerToken.slice(separator + 1));
  if (!/^[0-9a-f]{64}$/.test(providedMac) || !Number.isFinite(timestamp)) {
    return { valid: false, reason: 'csrf_malformed' };
  }
  if (Math.abs(now - timestamp) > CSRF_TOLERANCE_MS) {
    return { valid: false, reason: 'csrf_expired' };
  }

  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return { valid: false, reason: 'csrf_mismatch' };
  }
  const expectedMac = hmacHex(secret, `${sessionCookieValue}.${timestamp}`);
  try {
    const equal = timingSafeEqual(
      Buffer.from(expectedMac, 'hex'),
      Buffer.from(providedMac, 'hex'),
    );
    return equal ? { valid: true } : { valid: false, reason: 'csrf_mismatch' };
  } catch {
    return { valid: false, reason: 'csrf_mismatch' };
  }
}

/**
 * Same-origin check for state-mutating requests.
 * Browsers always attach `Origin` on cross-origin POST/PUT/PATCH/DELETE; when
 * present it must match the request host. Absent `Origin` = non-browser client
 * (curl, server-to-server, webhook) — the CSRF token still applies, so we let
 * it through to the token check.
 */
export function isTrustedOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
): boolean {
  if (!origin) return true;
  if (!host) return false;
  if (origin === 'null') return false; // sandboxed iframe / file://
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const expectedHost = host.trim().toLowerCase();
  return parsed.host.toLowerCase() === expectedHost;
}
