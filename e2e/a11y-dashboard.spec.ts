import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expectNoSeriousOrCritical, type AxeSummary } from './a11y-helpers';

// T064 — dashboard-wide a11y gate (TDD: expected RED until remediation).
// Asserts zero serious/critical on the full dashboard and always logs node
// evidence (truncated html + selectors, seed data only) for diagnosis.

async function loginUi(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForURL('/', { timeout: 10_000 });
}

test('axe dashboard-wide: zero serious/critical violations', async ({ page }) => {
  await loginUi(page, 'viewer@local', 'Viewer123!');
  const skip = page.getByTestId('onboarding-skip');
  if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skip.click();
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  // Let lazy panels settle so scrollable regions reach final overflow state.
  await page.waitForTimeout(2_000);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const evidence = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        html: String(n.html).slice(0, 300),
      })),
    }));
  console.log(`[a11y-dashboard-evidence] ${JSON.stringify(evidence).slice(0, 8000)}`);

  const summary: AxeSummary = {
    seriousOrCritical: results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, impact: v.impact ?? 'unknown', nodes: v.nodes.length })),
    moderateOrMinor: [],
  };
  expectNoSeriousOrCritical(summary, 'dashboard-wide');
});
