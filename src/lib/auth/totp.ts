// src/lib/auth/totp.ts — TOTP (RFC 6238) with base32, otpauth URL, verify window
import { randomBytes, createHmac } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(str: string): Buffer {
  const clean = str.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 char: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateSecret(bytes = 20): string {
  // 20 bytes = 160 bits = 32 base32 chars (RFC recommended)
  return base32Encode(randomBytes(bytes));
}

function hotp(secret: string, counter: number, digits = 6): string {
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  // 64-bit big-endian counter
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = code % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

export function totp(secret: string, timeMs = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step);
  return hotp(secret, counter, digits);
}

export function verify(token: string, secret: string, window = 1, timeMs = Date.now(), step = 30, digits = 6): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const counter = Math.floor(timeMs / 1000 / step);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, counter + i, digits) === token) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, email: string, issuer = 'Auto Trader'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => randomBytes(6).toString('hex').toUpperCase()); // 12 hex chars
}
