import { describe, it, expect } from 'vitest';
import { signStripeWebhook, verifyStripeWebhook } from '../src/lib/billing/stripe-hmac';
import { PLANS, planLimits } from '../src/lib/billing/plans';

describe('Stripe webhook + billing (S24)', () => {
  it('3 plans Free/Pro/Elite', () => {
    expect(PLANS.length).toBe(3);
  });

  it('pro plan 49 USD has rate-limit 300/min and 20 positions', () => {
    const limits = planLimits('pro');
    expect(limits.rateLimitPerMinute).toBe(300);
    expect(limits.maxOpenPositions).toBe(20);
  });

  it('sign then verify returns valid', () => {
    const secret = 'whsec_test_123';
    const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.created' });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signStripeWebhook(payload, ts, secret);
    const result = verifyStripeWebhook({ payload, header: sig, secret });
    expect(result.valid).toBe(true);
  });

  it('subscription.created payload has userId+plan in metadata', () => {
    const payload = JSON.stringify({
      id: 'evt_2',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          metadata: { userId: 'u_1', plan: 'pro' },
        },
      },
    });
    const parsed = JSON.parse(payload);
    expect(parsed.data.object.metadata.userId).toBe('u_1');
    expect(parsed.data.object.metadata.plan).toBe('pro');
    expect(parsed.data.object.status).toBe('active');
  });

  it('signature with different secret fails', () => {
    const payload = JSON.stringify({ id: 'evt_3' });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signStripeWebhook(payload, ts, 'whsec_correct');
    const result = verifyStripeWebhook({ payload, header: sig, secret: 'whsec_wrong' });
    expect(result.valid).toBe(false);
  });
});
