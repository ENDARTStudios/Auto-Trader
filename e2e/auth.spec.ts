import { test, expect } from '@playwright/test';

test('redirect to /login when no cookie', async ({ page }) => {
  await page.goto('/');
  // middleware or client guard should redirect to /login
  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  await expect(page.locator('text=Auto Trader — Login')).toBeVisible();
});

test('viewer cannot POST kill-switch (RBAC)', async ({ request }) => {
  // Login as viewer to get cookie
  const loginRes = await request.post('/api/auth/login', {
    data: { email: 'viewer@local', password: 'Viewer123!' },
  });
  expect(loginRes.status()).toBe(200);
  const cookies = await loginRes.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
  const sessionCookie = cookies.map((c) => c.value.split(';')[0]).join('; ');

  const killRes = await request.post('/api/kill-switch', {
    headers: { Cookie: sessionCookie },
    data: { active: true, reason: 'test' },
  });
  expect(killRes.status()).toBe(403);
});

test('login viewer then dashboard shows role', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'viewer@local');
  await page.fill('#password', 'Viewer123!');
  await page.click('button[type=submit]');
  await page.waitForURL('/', { timeout: 5000 });
  await expect(page.locator('text=viewer@local')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=viewer')).toBeVisible();
});
