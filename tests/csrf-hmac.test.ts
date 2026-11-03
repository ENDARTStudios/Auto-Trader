import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'crypto';
import {
  CSRF_TOLERANCE_MS,
  issueCsrfToken,
  isTrustedOrigin,
  verifyCsrfToken,
} from '@/lib/csrf';

// Round 1 hardening (P0): CSRF is now a REAL HMAC, bound to the SIGNED session
// cookie value, with a 1h window and a same-origin check.
// Product: src/lib/csrf.ts + src/proxy.ts (wiring).

const SECRET = 'csrf-unit-test-secret-0123456789abcdef'; // >= 32 chars
const SESSION_COOKIE = 'token-a.' + 'f'.repeat(64); // signed cookie value (shape)
const OTHER_SESSION_COOKIE = 'token-b.' + 'e'.repeat(64);
const NOW = 1_760_000_000_000;

let originalSecret: string | undefined;

beforeAll(() => {
  originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

function issue(sessionCookieValue: string, now = NOW): string {
  return issueCsrfToken(sessionCookieValue, now);
}

describe('csrf — issuance', () => {
  it('produces <hmacHex>.<timestampMs>', () => {
    const token = issue(SESSION_COOKIE);
    expect(token).toMatch(/^[0-9a-f]{64}\.\d{13}$/);
    expect(token.endsWith('.' + NOW)).toBe(true);
  });

  it('HMAC covers session cookie value AND timestamp', () => {
    const token = issue(SESSION_COOKIE);
    const [mac, ts] = token.split('.');
    const expected = createHmac('sha256', SECRET)
      .update(`${SESSION_COOKIE}.${ts}`)
      .digest('hex');
    expect(mac).toBe(expected);
    expect(mac).not.toBe(
      createHmac('sha256', SECRET).update(`${OTHER_SESSION_COOKIE}.${ts}`).digest('hex'),
    );
  });

  it('refuses to issue without a session cookie value', () => {
    expect(() => issue('')).toThrow();
  });
});

describe('csrf — verification', () => {
  it('accepts a freshly issued token for the same session', () => {
    expect(verifyCsrfToken(issue(SESSION_COOKIE), SESSION_COOKIE, NOW)).toEqual({ valid: true });
  });

  it('rejects a forged pair (token minted by the client, not the server)', () => {
    // Attacker knows the session cookie value (they hold the browser) but not
    // the secret: a self-computed HMAC with a guessed secret must fail.
    const forgedMac = createHmac('sha256', 'guessed-secret')
      .update(`${SESSION_COOKIE}.${NOW}`)
      .digest('hex');
    const result = verifyCsrfToken(`${forgedMac}.${NOW}`, SESSION_COOKIE, NOW);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('csrf_mismatch');
  });

  it('rejects replay with a DIFFERENT session cookie (cross-session fixation)', () => {
    const token = issue(SESSION_COOKIE);
    const result = verifyCsrfToken(token, OTHER_SESSION_COOKIE, NOW);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('csrf_mismatch');
  });

  it('rejects a timestamp tampered after issuance (window extension attempt)', () => {
    const [mac] = issue(SESSION_COOKIE).split('.');
    const result = verifyCsrfToken(`${mac}.${NOW + 60_000}`, SESSION_COOKIE, NOW + 60_000);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('csrf_mismatch');
  });

  it('rejects an expired token (older than 1h) but accepts the edge', () => {
    const token = issue(SESSION_COOKIE);
    expect(verifyCsrfToken(token, SESSION_COOKIE, NOW + CSRF_TOLERANCE_MS).valid).toBe(true);
    const expired = verifyCsrfToken(token, SESSION_COOKIE, NOW + CSRF_TOLERANCE_MS + 1);
    expect(expired.valid).toBe(false);
    if (!expired.valid) expect(expired.reason).toBe('csrf_expired');
  });

  it('reports precise failures for missing/malformed inputs', () => {
    const missingHeader = verifyCsrfToken(null, SESSION_COOKIE, NOW);
    expect(missingHeader.valid).toBe(false);
    if (!missingHeader.valid) expect(missingHeader.reason).toBe('missing_csrf_header');

    const missingSession = verifyCsrfToken(issue(SESSION_COOKIE), null, NOW);
    expect(missingSession.valid).toBe(false);
    if (!missingSession.valid) expect(missingSession.reason).toBe('missing_session');

    for (const bad of ['abc', 'no-dot', `abc.${NOW}`, `${'a'.repeat(64)}.NaN`]) {
      const res = verifyCsrfToken(bad, SESSION_COOKIE, NOW);
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.reason).toBe('csrf_malformed');
    }
  });

  it('never throws on hostile input', () => {
    for (const bad of ['.'.repeat(100), 'x'.repeat(10_000), `${'z'.repeat(64)}.${NOW}`]) {
      expect(() => verifyCsrfToken(bad, SESSION_COOKIE, NOW)).not.toThrow();
    }
  });
});

describe('csrf — same-origin check', () => {
  it('accepts matching origin/host', () => {
    expect(isTrustedOrigin('https://app.example.com', 'app.example.com')).toBe(true);
    expect(isTrustedOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(isTrustedOrigin('https://APP.Example.com', 'app.example.com')).toBe(true);
  });

  it('rejects a divergent origin (classic CSRF from evil.com)', () => {
    expect(isTrustedOrigin('https://evil.example.com', 'app.example.com')).toBe(false);
    expect(isTrustedOrigin('https://app.example.com.evil.io', 'app.example.com')).toBe(false);
    expect(isTrustedOrigin('https://evil.example.com:443', 'app.example.com')).toBe(false);
  });

  it('compares hosts, not schemes (TLS is terminated at Railway/Caddy)', () => {
    // Behind the reverse proxy the app sees http:// internally while the browser
    // sent Origin: https:// — the HMAC token is what protects the mutation.
    expect(isTrustedOrigin('http://app.example.com', 'app.example.com')).toBe(true);
  });

  it('rejects a mismatched port', () => {
    expect(isTrustedOrigin('http://localhost:4000', 'localhost:3000')).toBe(false);
  });

  it('allows absent Origin (non-browser clients still need the CSRF token)', () => {
    expect(isTrustedOrigin(null, 'app.example.com')).toBe(true);
    expect(isTrustedOrigin(undefined, 'app.example.com')).toBe(true);
  });

  it('rejects opaque/malformed origins', () => {
    expect(isTrustedOrigin('null', 'app.example.com')).toBe(false);
    expect(isTrustedOrigin('not a url', 'app.example.com')).toBe(false);
    expect(isTrustedOrigin('https://app.example.com', null)).toBe(false);
  });
});
