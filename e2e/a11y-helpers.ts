import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// T062 — shared a11y gate helpers (no test() registration here so both the
// Playwright spec and the vitest policy test can import this module).

export interface AxeSummary {
  seriousOrCritical: Array<{ id: string; impact: string; nodes: number }>;
  moderateOrMinor: Array<{ id: string; impact: string; nodes: number }>;
}

export async function scanAxe(page: Page, context = 'page'): Promise<AxeSummary> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
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
