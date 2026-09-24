import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// T062 — shared a11y gate helpers (no test() registration here so both the
// Playwright spec and the vitest policy test can import this module).

export interface AxeSummary {
  seriousOrCritical: Array<{ id: string; impact: string; nodes: number }>;
  moderateOrMinor: Array<{ id: string; impact: string; nodes: number }>;
}

export async function scanAxe(
  page: Page,
  context = 'page',
  includeSelector?: string,
): Promise<AxeSummary> {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
  if (includeSelector) builder.include(includeSelector);
  const results = await builder.analyze();
  const impactOf = (v: { impact?: string | null }): string => v.impact ?? 'unknown';
  const byImpact = (impacts: string[]) =>
    results.violations
      .filter((v) => impacts.includes(impactOf(v)))
      .map((v) => ({ id: v.id, impact: impactOf(v), nodes: v.nodes.length }));
  const summary: AxeSummary = {
    seriousOrCritical: byImpact(['serious', 'critical']),
    moderateOrMinor: byImpact(['moderate', 'minor']),
  };
  if (summary.moderateOrMinor.length > 0) {
    console.log(`[a11y-backlog:${context}]`, JSON.stringify(summary.moderateOrMinor));
  }
  return summary;
}

export function expectNoSeriousOrCritical(summary: AxeSummary, context: string) {
  expect(
    summary.seriousOrCritical,
    `axe serious/critical violations in ${context}: ${JSON.stringify(summary.seriousOrCritical)}`,
  ).toEqual([]);
}

/**
 * Dismiss the open dialog via Escape with retries. A single Escape can be
 * swallowed (e.g. cmdk input handling, post-axe focus on body), so retry
 * until hidden instead of asserting on the first keypress.
 */
export async function closeDialogViaEscape(page: Page, timeoutMs = 12_000) {
  const dialog = page.getByRole('dialog');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await dialog.count()) === 0 || !(await dialog.first().isVisible().catch(() => false))) {
      return;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }
  await expect(dialog).toBeHidden({ timeout: 5_000 });
}
