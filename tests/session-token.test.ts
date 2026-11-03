import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import {
  SESSION_SECRET_MIN_LENGTH,
  getSessionSecret,
  signSessionToken,
  verifySignedSessionToken,
} from '@/lib/auth/session-token';

// Round 1 hardening (P0): stateless signed session cookie.
// These tests are hermetic — they pass an explicit secret, so they do not
// depend on .env. Product: src/lib/auth/session-token.ts.

const SECRET = 'unit-test-session-secret-0123456789abcdef'; // >= 32 chars
const OTHER_SECRET = 'another-unit-test-secret-abcdef0123456789';
const TOKEN = 'a'.repeat(64); // shape of generateToken(): 32 random bytes hex

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('session-token — signing', () => {
  it('produces <token>.<hmacSha256Hex>', () => {
    const signed = signSessionToken(TOKEN, SECRET);
    expect(signed).toBe(TOKEN + '.' + hmacHex(SECRET, TOKEN));
    expect(signed).toMatch(/^[0-9a-f]{64}\.[0-9a-f]{64}$/);
  });

  it('is deterministic for the same token + secret', () => {
    expect(signSessionToken(TOKEN, SECRET)).toBe(signSessionToken(TOKEN, SECRET));
  });

  it('different secrets produce different signatures', () => {
    expect(signSessionToken(TOKEN, SECRET)).not.toBe(signSessionToken(TOKEN, OTHER_SECRET));
  });

  it('refuses to sign an empty token', () => {
    expect(() => signSessionToken('', SECRET)).toThrow();
  });
});

describe('session-token — verification', () => {
  it('accepts a valid signed value and returns the opaque token', () => {
    expect(verifySignedSessionToken(signSessionToken(TOKEN, SECRET), SECRET)).toBe(TOKEN);
  });

  it('rejects a tampered token (signature no longer matches)', () => {
    const signed = signSessionToken(TOKEN, SECRET);
    const tampered = 'b' + signed.slice(1);
    expect(verifySignedSessionToken(tampered, SECRET)).toBeNull();
  });

  it('rejects a tampered MAC', () => {
    const signed = signSessionToken(TOKEN, SECRET);
    const [tok, mac] = signed.split('.');
    const flipped = mac[0] === 'a' ? 'b' : 'a';
    expect(verifySignedSessionToken(tok + '.' + flipped + mac.slice(1), SECRET)).toBeNull();
  });

  it('rejects a value signed with another secret', () => {
    expect(verifySignedSessionToken(signSessionToken(TOKEN, OTHER_SECRET), SECRET)).toBeNull();
  });

  it('rejects unsigned / malformed values', () => {
    expect(verifySignedSessionToken(null, SECRET)).toBeNull();
    expect(verifySignedSessionToken(undefined, SECRET)).toBeNull();
    expect(verifySignedSessionToken('', SECRET)).toBeNull();
    expect(verifySignedSessionToken(TOKEN, SECRET)).toBeNull(); // no MAC
    expect(verifySignedSessionToken(TOKEN + '.', SECRET)).toBeNull(); // empty MAC
    expect(verifySignedSessionToken('.' + hmacHex(SECRET, TOKEN), SECRET)).toBeNull(); // empty token
    expect(verifySignedSessionToken(TOKEN + '.not-hex', SECRET)).toBeNull();
    expect(verifySignedSessionToken(TOKEN + '.' + 'ab'.repeat(20), SECRET)).toBeNull(); // short digest
  });

  it('never throws on hostile input', () => {
    for (const value of ['..', '...', 'x.y.z', '.'.repeat(500), 'a'.repeat(10_000)]) {
      expect(() => verifySignedSessionToken(value, SECRET)).not.toThrow();
    }
  });
});

describe('session-token — getSessionSecret production fail-closed', () => {
  // NODE_ENV is typed readonly by Next's ambient types; process.env itself is
  // writable at runtime (vitest), so go through an index-signature view.
  const env = process.env as Record<string, string | undefined>;
  const originalEnv = env.NODE_ENV;
  const originalSecret = env.SESSION_SECRET;

  afterEach(() => {
    if (originalEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = originalEnv;
    if (originalSecret === undefined) delete env.SESSION_SECRET;
    else env.SESSION_SECRET = originalSecret;
  });

  it('exposes the minimum secret length (32)', () => {
    expect(SESSION_SECRET_MIN_LENGTH).toBe(32);
  });

  it('throws in production when SESSION_SECRET is missing', () => {
    env.NODE_ENV = 'production';
    delete env.SESSION_SECRET;
    expect(() => getSessionSecret()).toThrow(/SESSION_SECRET/);
    // signing/verification fail closed as well
    expect(() => signSessionToken(TOKEN)).toThrow(/SESSION_SECRET/);
    expect(verifySignedSessionToken(signSessionToken(TOKEN, SECRET))).toBeNull();
  });

  it('throws in production when SESSION_SECRET is shorter than 32 chars', () => {
    env.NODE_ENV = 'production';
    env.SESSION_SECRET = '0123456789abcdef0123456789abcde'; // 31
    expect(() => getSessionSecret()).toThrow(/at least 32/);
  });

  it('accepts a >=32 chars SESSION_SECRET in production', () => {
    env.NODE_ENV = 'production';
    env.SESSION_SECRET = 'p'.repeat(32);
    expect(getSessionSecret()).toBe('p'.repeat(32));
  });

  it('falls back to a dev secret outside production', () => {
    env.NODE_ENV = 'test';
    delete env.SESSION_SECRET;
    const secret = getSessionSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThanOrEqual(32);
    // round-trip with the fallback secret
    expect(verifySignedSessionToken(signSessionToken(TOKEN))).toBe(TOKEN);
  });
});
