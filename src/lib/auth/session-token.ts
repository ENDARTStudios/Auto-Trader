// src/lib/auth/session-token.ts — Stateless HMAC signing for the opaque session
// cookie. This module is PURE (no db import) so the proxy/middleware can validate
// the cookie signature without touching the database; the route handler still
// re-checks the Session row (expiry, user.isActive, rate limit) in requireSession.
//
// Cookie format: `<opaque-token>.<hmacSha256Hex>`
//   - opaque-token: 64 hex chars (randomBytes(32), see session.ts:generateToken)
//   - hmac:         HMAC-SHA256(SESSION_SECRET, opaque-token), hex
//
// Rationale: without a signature, an attacker can set an arbitrary `session`
// cookie value. The proxy only checked *presence*, then the handler hit the DB —
// meaning every request with a forged cookie became a DB query (auth bypass at
// the proxy layer + trivial DB amplification). Signing makes the proxy check
// real: a forged cookie is rejected with 401 before any handler runs.

import { createHmac, timingSafeEqual } from 'crypto';

/** Minimum accepted length for SESSION_SECRET in production. */
export const SESSION_SECRET_MIN_LENGTH = 32;

/** Dev/test-only fallback. NEVER used when NODE_ENV === 'production'. */
const DEV_FALLBACK_SECRET = 'auto-trader-dev-only-session-secret-0000';

let warnedAboutFallback = false;

/**
 * Returns the HMAC secret used to sign sessions + CSRF tokens.
 * Production is FAIL-CLOSED: a missing/short SESSION_SECRET throws, so the app
 * refuses to issue or validate sessions with a weak/deterministic secret.
 * Dev/test fall back to a public constant (with a one-time warning) so the
 * app and the test suite stay runnable without secrets.
 */
export function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!configured || configured.length < SESSION_SECRET_MIN_LENGTH) {
      throw new Error(
        'SESSION_SECRET must be set with at least ' +
          SESSION_SECRET_MIN_LENGTH +
          ' characters in production',
      );
    }
    return configured;
  }

  if (configured && configured.length > 0) return configured;

  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      '[auth] SESSION_SECRET ausente — usando fallback de dev/test. Defina SESSION_SECRET (>=32 chars) em produção.',
    );
  }
  return DEV_FALLBACK_SECRET;
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Signs an opaque session token: `${token}.${hmacHex}`.
 * @param token opaque token (usually 64 hex chars)
 * @param secret override (tests); defaults to getSessionSecret()
 */
export function signSessionToken(token: string, secret?: string): string {
  if (!token) throw new Error('signSessionToken requires a non-empty token');
  const key = secret ?? getSessionSecret();
  return `${token}.${hmacHex(key, token)}`;
}

/**
 * Verifies a signed session cookie value and returns the opaque token, or null
 * when the value is malformed / tampered / signed with another secret.
 * Timing-safe comparison on the MAC.
 */
export function verifySignedSessionToken(
  value: string | null | undefined,
  secret?: string,
): string | null {
  if (!value || typeof value !== 'string') return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0 || separator === value.length - 1) return null;

  const token = value.slice(0, separator);
  const providedMac = value.slice(separator + 1).toLowerCase();
  if (token.length === 0) return null;
  // MAC must be canonical hex of the expected digest length, otherwise
  // timingSafeEqual would throw on length mismatch.
  if (!/^[0-9a-f]{64}$/.test(providedMac)) return null;

  let key: string;
  try {
    key = secret ?? getSessionSecret();
  } catch {
    // Production without a proper secret: fail closed (invalid session).
    return null;
  }

  const expectedMac = hmacHex(key, token);
  try {
    const equal = timingSafeEqual(
      Buffer.from(expectedMac, 'hex'),
      Buffer.from(providedMac, 'hex'),
    );
    return equal ? token : null;
  } catch {
    return null;
  }
}
