// src/lib/billing/stripe-hmac.ts — Stripe webhook signature verification using built-in crypto
import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TOLERANCE_SECONDS = 300; // 5 minutes

export interface StripeSignatureParts {
  timestamp: string;
  signature: string;
}

export function parseStripeHeader(header: string | null | undefined): StripeSignatureParts | null {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim());
  let timestamp = '';
  let signature = '';
  for (const part of parts) {
    if (part.startsWith('t=')) timestamp = part.slice(2);
    else if (part.startsWith('v1=')) signature = part.slice(3);
  }
  if (!timestamp || !signature) return null;
  return { timestamp, signature };
}

export function verifyStripeWebhook(opts: {
  payload: string;
  header: string | null | undefined;
  secret: string;
  toleranceSeconds?: number;
}): { valid: boolean; reason?: string } {
  const { payload, header, secret, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS } = opts;
  const parts = parseStripeHeader(header);
  if (!parts) return { valid: false, reason: 'invalid_header' };

  const ts = Number(parts.timestamp);
  if (!Number.isFinite(ts)) return { valid: false, reason: 'invalid_timestamp' };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_outside_tolerance' };
  }

  const expected = createHmac('sha256', secret).update(`${parts.timestamp}.${payload}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  let signatureBuf: Buffer;
  try {
    signatureBuf = Buffer.from(parts.signature, 'hex');
  } catch {
    return { valid: false, reason: 'invalid_signature_encoding' };
  }
  if (expectedBuf.length !== signatureBuf.length) {
    return { valid: false, reason: 'signature_length_mismatch' };
  }
  const ok = timingSafeEqual(expectedBuf, signatureBuf);
  return ok ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}

export function signStripeWebhook(payload: string, timestamp: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}
