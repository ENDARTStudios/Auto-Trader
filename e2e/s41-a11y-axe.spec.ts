import { test, expect, type Page } from '@playwright/test';
import { scanAxe, expectNoSeriousOrCritical } from './a11y-helpers';

// T062 — S41 axe validation (TDD: strict on serious/critical, backlog rest).
// Fails on serious/critical violations; moderate/minor are logged as backlog.

async function loginUi(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForURL('/', { timeout: 10_000 });
}

test('axe: dashboard with news panel has no serious/critical violations', async ({
  page,
}) => {
  await loginUi(page, 'viewer@local', 'Viewer123!');
  // Dismiss onboarding wizard if it auto-opened (fresh seed => not onboarded).
  const skip = page.getByTestId('onboarding-skip');
  if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skip.click();
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  const summary = await scanAxe(page, 'dashboard+news');
  expectNoSeriousOrCritical(summary, 'dashboard+news');
});

test('axe: command palette dialog has no serious/critical violations', async ({
  page,
}) => {
  await loginUi(page, 'viewer@local', 'Viewer123!');
  const skip = page.getByTestId('onboarding-skip');
  if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skip.click();
  }
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const summary = await scanAxe(page, 'palette-open');
  expectNoSeriousOrCritical(summary, 'palette-open');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 5_000 });
});

test('axe: onboarding wizard steps have no serious/critical violations', async ({
  page,
}) => {
  await loginUi(page, 'viewer@local', 'Viewer123!');
  const wizard = page.getByTestId('onboarding-step-0');
  // Fresh seed => wizard auto-opens at step 0. If already onboarded (dirty
  // local DB), open via... skip: wizard is auto-open only, so require it.
  await expect(wizard).toBeVisible({ timeout: 10_000 });
  const summary = await scanAxe(page, 'wizard-step-0');
  expectNoSeriousOrCritical(summary, 'wizard-step-0');
});

test('axe: pricing page has no serious/critical violations', async ({ page }) => {
  await page.goto('/pricing', { waitUntil: 'networkidle' });
  const summary = await scanAxe(page, 'pricing');
  expectNoSeriousOrCritical(summary, 'pricing');
});
