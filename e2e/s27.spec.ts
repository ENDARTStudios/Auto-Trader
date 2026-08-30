import { test, expect } from '@playwright/test';

// S27 T001: end-to-end tests for MFA flow, billing, live-trader

test.describe('S27 e2e (no dev server required)', () => {
  test('mfa setup requires auth (401 without cookie)', async ({ request }) => {
    const res = await request.post('/api/auth/mfa/setup');
    expect(res.status()).toBe(401);
  });

  test('mfa verify requires auth (401 without cookie)', async ({ request }) => {
    const res = await request.post('/api/auth/mfa/verify', {
      data: { token: '123456' },
    });
    expect(res.status()).toBe(401);
  });

  test('login without totp works for non-MFA user (admin@local)', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'admin@local', password: 'Admin123!' },
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.ok).toBeTruthy();
    expect(data.user.role).toBe('super_admin');
  });

  test('login with wrong password returns 401', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'admin@local', password: 'wrong' },
    });
    expect(res.status()).toBe(401);
  });

  test('login page has email + password fields and submit button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type=submit]')).toBeVisible();
    await expect(page.locator('#totp')).toBeHidden();
  });

  test('billing subscribe requires auth (401 without cookie)', async ({ request }) => {
    const res = await request.post('/api/billing/subscription', {
      data: { action: 'upgrade', plan: 'pro' },
    });
    expect(res.status()).toBe(401);
  });

  test('live trader stubs return valid structure', async () => {
    const { cexMarketOrder, dexSwapExactTokensSingle, LIVE_TRADER_CONFIG } = await import('@/lib/chain/live-trader');
    const order = await cexMarketOrder({ symbol: 'BTC/USDT', side: 'buy', amountUsd: 100, type: 'market' });
    expect(order.ok).toBe(true);
    expect(order.exchange).toBe('cex');

    const swap = await dexSwapExactTokensSingle({
      chain: 'base', tokenIn: '0xA0b86991c6218b36c1d1D4F73CA3dab40Eb8Fd9Da',
      tokenOut: '0x4200000000000000000000000000000000000006', amountInWei: 1000000000000000000n,
      amountOutMinWei: 0n, to: '0x0000000000000000000000000000000000000000',
      deadline: Math.floor(Date.now() / 1000) + 600,
    });
    expect(swap.ok).toBe(true);
    expect(swap.exchange).toBeUndefined(); // swap returns txHash not exchange
    expect(LIVE_TRADER_CONFIG.testnet).toBe(true);
  });
});
