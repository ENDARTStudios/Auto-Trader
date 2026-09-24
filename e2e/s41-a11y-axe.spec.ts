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

test('axe: news panel (incl. loading/degraded) has no serious/critical violations', async ({
  page,
}) => {
  await loginUi(page, 'viewer@local', 'Viewer123!');
  // Dismiss onboarding wizard if it auto-opened (fresh seed => not onboarded).
  const skip = page.getByTestId('onboarding-skip');
  if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skip.click();
  }
  const panel = page.getByTestId('news-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const summary = await scanAxe(page, 'news-panel', '[data-testid="news-panel"]');
  expectNoSeriousOrCritical(summary, 'news-panel');
});

test('axe backlog probe: full dashboard scan is log-only (never fails)', async ({
  page,
}) => {
  // Pre-existing dashboard-wide issues (progressbar/button/scrollable, from
  // CI run 35936927008) are tracked openly in docs/a11y-s41-report.md — this
  // probe keeps them visible in CI logs without gating S41 acceptance.
  await loginUi(page, 'viewer@local', 'Viewer123!');
  const skip = page.getByTestId('onboarding-skip');
  if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skip.click();
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  const summary = await scanAxe(page, 'dashboard-full-backlog-probe');
  console.log('[a11y-backlog:dashboard-full]', JSON.stringify(summary));
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
  // Scope to the dialog: backdrop-dimming of the page behind would otherwise
  // pollute contrast results with non-palette content.
  const summary = await scanAxe(page, 'palette-open', '[role="dialog"]');
  expectNoSeriousOrCritical(summary, 'palette-open');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 5_000 });
});

test('axe: onboarding wizard steps have no serious/critical violations', async ({
  page,
}) => {
  // trader@local is never touched by other specs (no prefs PUT/seed flag),
  // so the wizard deterministically auto-opens for a fresh login.
  await loginUi(page, 'trader@local', 'Trader123!');
  const wizard = page.getByTestId('onboarding-step-0');
  await expect(wizard).toBeVisible({ timeout: 15_000 });
  const summary = await scanAxe(page, 'wizard-step-0', '[role="dialog"]');
  expectNoSeriousOrCritical(summary, 'wizard-step-0');
});

test('axe: pricing page has no serious/critical violations', async ({ page }) => {
  await page.goto('/pricing', { waitUntil: 'networkidle' });
  const summary = await scanAxe(page, 'pricing');
  expectNoSeriousOrCritical(summary, 'pricing');
});
