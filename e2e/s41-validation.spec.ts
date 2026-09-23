import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// T052 — S41 validation: prefs mass-assignment/IDOR, news sanitization,
// pricing redirect, palette RBAC/keyboard/focus-trap (Playwright-native a11y).

async function loginApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: JSON.stringify({ email, password }),
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  const cookies = (await res.headersArray())
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((c) => c.value.split(';')[0])
    .join('; ');
  expect(cookies.length).toBeGreaterThan(0);
  return cookies;
}

async function loginUi(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForURL('/', { timeout: 10_000 });
}

async function dismissWizardIfOpen(page: Page) {
  const skip = page.getByTestId('onboarding-skip');
  if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skip.click();
  }
}

test('prefs mass-assignment: privileged fields stripped, 200', async ({ request }) => {
  const cookie = await loginApi(request, 'viewer@local', 'Viewer123!');
  const put = await request.put('/api/preferences', {
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    data: JSON.stringify({
      riskTolerance: 'balanced',
      goals: ['growth'],
      role: 'super_admin',
      permissions: ['*'],
      userId: 'someone-else',
    }),
  });
  expect(put.status()).toBe(200);
  const body = await put.json();
  expect(body.preferences).not.toHaveProperty('role');
  expect(body.preferences).not.toHaveProperty('permissions');
  expect(body.preferences).not.toHaveProperty('userId');
  expect(body.preferences.riskTolerance).toBe('balanced');

  const get = await request.get('/api/preferences', { headers: { Cookie: cookie } });
  expect(get.status()).toBe(200);
  const persisted = await get.json();
  expect(persisted.preferences).not.toHaveProperty('role');
});

test('prefs isolation: viewer PUT cannot touch admin prefs (no IDOR surface)', async ({
  request,
}) => {
  const viewerCookie = await loginApi(request, 'viewer@local', 'Viewer123!');
  const adminCookie = await loginApi(request, 'admin@local', 'Admin123!');

  const before = await (
    await request.get('/api/preferences', { headers: { Cookie: adminCookie } })
  ).json();

  await request.put('/api/preferences', {
    headers: { Cookie: viewerCookie, 'Content-Type': 'application/json' },
    data: JSON.stringify({ riskTolerance: 'aggressive', goals: ['income'] }),
  });

  const after = await (
    await request.get('/api/preferences', { headers: { Cookie: adminCookie } })
  ).json();
  expect(after.preferences).toEqual(before.preferences);
});

test('news API returns sanitized shape (tolerant to degraded sandbox)', async ({
  request,
}) => {
  const cookie = await loginApi(request, 'viewer@local', 'Viewer123!');
  const res = await request.get('/api/news?limit=12', { headers: { Cookie: cookie } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.items)).toBe(true);
  expect(typeof body.degraded).toBe('boolean');
  for (const item of body.items) {
    for (const field of [item.title, item.summary]) {
      expect(field).not.toMatch(/<script/i);
      expect(field).not.toMatch(/<svg/i);
      expect(field).not.toMatch(/<iframe/i);
      expect(field).not.toMatch(/onerror\s*=/i);
      expect(field).not.toMatch(/onload\s*=/i);
    }
    expect(item.link).toMatch(/^https:/);
  }
});

test('pricing logged-out subscribe redirects to /login via router', async ({ page }) => {
  await page.goto('/pricing');
  // first subscribe button (Free plan downgrade or Pro subscribe)
  await page.getByRole('button').first().click();
  await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
});

test('palette viewer RBAC + keyboard + focus trap', async ({ page }) => {
  await loginUi(page, 'viewer@local', 'Viewer123!');
  await dismissWizardIfOpen(page);

  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // viewer must not see privileged kill action
  await dialog.getByRole('combobox').fill('kill');
  await expect(page.getByTestId('palette-action-kill')).toHaveCount(0);

  // logout action is visible to everyone
  await dialog.getByRole('combobox').fill('logout');
  await expect(page.getByTestId('palette-action-logout')).toBeVisible();

  // focus trap: tabbing stays inside the dialog
  await dialog.getByRole('combobox').fill('');
  await dialog.getByRole('combobox').focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeAttached();
    const inside = await dialog.locator(':focus').count();
    expect(inside).toBe(1);
  }

  // Escape closes and returns focus control
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 5_000 });
});
