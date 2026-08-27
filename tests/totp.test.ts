import { describe, it, expect } from 'vitest';
import { generateSecret, totp, verify, otpauthUrl, base32Encode, base32Decode } from '@/lib/auth/totp';

describe('TOTP', () => {
  it('generateSecret 32 chars base32', () => {
    const s = generateSecret();
    expect(s.length).toBe(32);
    expect(/^[A-Z2-7]+$/.test(s)).toBe(true);
  });

  it('totp 6 digits and verify true', () => {
    const s = generateSecret();
    const t = totp(s);
    expect(t.length).toBe(6);
    expect(/^\d{6}$/.test(t)).toBe(true);
    expect(verify(t, s)).toBe(true);
  });

  it('verify false for wrong token', () => {
    const s = generateSecret();
    expect(verify('000000', s)).toBe(false);
    expect(verify('123', s)).toBe(false);
  });

  it('verify window', () => {
    const s = generateSecret();
    const now = Date.now();
    const t = totp(s, now);
    // same time -> true
    expect(verify(t, s, 1, now)).toBe(true);
    // 31 sec later -> still within window 1 (next step)
    expect(verify(t, s, 1, now + 31_000)).toBe(true);
    // 90 sec later -> outside window 1 (3 steps away) should be false if we use window 1
    // But with window 1, 90 sec is 3 steps, so false
    // Use a fresh totp at now+90s to verify distance
    const far = totp(s, now + 90_000);
    expect(verify(far, s, 1, now)).toBe(false);
  });

  it('otpauthUrl contains secret and issuer', () => {
    const s = generateSecret();
    const url = otpauthUrl(s, 'admin@local');
    expect(url.startsWith('otpauth://totp/')).toBe(true);
    expect(url).toContain(`secret=${s}`);
    expect(url).toContain('issuer=Auto+Trader');
  });

  it('base32 roundtrip', () => {
    const buf = Buffer.from('HelloWorld12345');
    const enc = base32Encode(buf);
    const dec = base32Decode(enc);
    expect(dec.equals(buf)).toBe(true);
  });
});
