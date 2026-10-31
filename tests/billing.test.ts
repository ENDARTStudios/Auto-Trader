// tests/billing.test.ts — S19: billing plans + Stripe HMAC (no deps install)
import { describe, it, expect } from 'vitest';
import { PLANS, getPlan, planLimits } from '@/lib/billing/plans';
import { verifyStripeWebhook, signStripeWebhook, parseStripeHeader } from '@/lib/billing/stripe-hmac';

describe('Billing plans', () => {
  it('3 plans Free/Pro/Elite', () => {
    expect(PLANS.length).toBe(3);
    expect(PLANS.map((p) => p.id)).toEqual(['free', 'pro', 'elite']);
  });

  it('Free price 0, Pro 49, Elite 199', () => {
    expect(getPlan('free')?.priceUsdMonthly).toBe(0);
    expect(getPlan('pro')?.priceUsdMonthly).toBe(49);
    expect(getPlan('elite')?.priceUsdMonthly).toBe(199);
  });

  it('getPlan returns undefined for invalid', () => {
    expect(getPlan('invalid')).toBeUndefined();
  });

  it('planLimits defaults to Free on invalid', () => {
    const limits = planLimits('invalid');
    expect(limits.rateLimitPerMinute).toBe(30);
    expect(limits.maxOpenPositions).toBe(1);
  });

  it('planLimits returns Pro limits', () => {
    const limits = planLimits('pro');
    expect(limits.rateLimitPerMinute).toBe(300);
    expect(limits.maxOpenPositions).toBe(20);
  });
});

describe('Stripe webhook HMAC', () => {
  const secret = 'whsec_test_secret_1234567890abcdef';
  const payload = JSON.stringify({ id: 'evt_test', type: 'invoice.paid' });

  it('parseStripeHeader extracts t and v1', () => {
    const header = 't=1234567890,v1=abc123';
    const parts = parseStripeHeader(header);
    expect(parts?.timestamp).toBe('1234567890');
    expect(parts?.signature).toBe('abc123');
  });

  it('parseStripeHeader returns null on null', () => {
    expect(parseStripeHeader(null)).toBeNull();
    expect(parseStripeHeader('')).toBeNull();
  });

  it('valid signature verifies OK', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = signStripeWebhook(payload, timestamp, secret);
    const result = verifyStripeWebhook({ payload, header: sig, secret });
    expect(result.valid).toBe(true);
  });

  it('invalid signature rejected', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = signStripeWebhook(payload, timestamp, 'wrong_secret');
    const result = verifyStripeWebhook({ payload, header: sig, secret });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('expired timestamp rejected', () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 1000);
    const sig = signStripeWebhook(payload, oldTimestamp, secret);
    const result = verifyStripeWebhook({ payload, header: sig, secret });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('timestamp_outside_tolerance');
  });

  it('malformed header rejected', () => {
    const result = verifyStripeWebhook({ payload, header: 'invalid', secret });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_header');
  });

  it('signature length mismatch rejected', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = `t=${timestamp},v1=abc`; // too short
    const result = verifyStripeWebhook({ payload, header: sig, secret });
    expect(result.valid).toBe(false);
  });
});
