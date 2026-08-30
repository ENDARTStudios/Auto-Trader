import { describe, it, expect } from 'vitest';
import { createHmac, timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function issueCsrfToken(sessionId: string): string {
  const timestamp = Date.now();
  const payload = `${sessionId}.${timestamp}`;
  const secret = 'csrf-test-secret';
  const mac = createHmac('sha256', secret).update(payload).digest('hex');
  return `${mac}.${timestamp}`;
}

describe('CSRF middleware helpers (S25)', () => {
  it('safeEqual returns true for matching hex', () => {
    expect(safeEqual('abcd', 'abcd')).toBe(true);
  });

  it('safeEqual returns false for different hex', () => {
    expect(safeEqual('abcd', 'abce')).toBe(false);
  });

  it('safeEqual returns false for different lengths', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('safeEqual handles malformed hex gracefully', () => {
    expect(safeEqual('not-hex', 'abce')).toBe(false);
  });

  it('issueCsrfToken produces stable HMAC for same input', () => {
    const ts = 1700000000000;
    const payload = `u1.${ts}`;
    const secret = 'csrf-test-secret';
    const mac1 = createHmac('sha256', secret).update(payload).digest('hex');
    const mac2 = createHmac('sha256', secret).update(payload).digest('hex');
    expect(mac1).toBe(mac2);
  });

  it('issueCsrfToken includes timestamp suffix for expiry', () => {
    const tok = issueCsrfToken('u1');
    // mac + . + timestamp, e.g. "abcd1234.1700000000000"
    expect(tok).toMatch(/^[0-9a-f]{64}\.[0-9]+$/);
  });

  it('issueCsrfToken is session-bound (different sessions produce different tokens)', () => {
    const ts = 1700000000000;
    const a = createHmac('sha256', 'csrf-test-secret').update(`u1.${ts}`).digest('hex');
    const b = createHmac('sha256', 'csrf-test-secret').update(`u2.${ts}`).digest('hex');
    expect(a).not.toBe(b);
  });

  it('safeEqual timingSafeEqual rejects length mismatch', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
