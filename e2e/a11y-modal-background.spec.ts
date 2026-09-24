import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { closeDialogViaEscape } from './a11y-helpers';

// T066 — modal background inert validation + formal color-contrast proof.
// Thesis: with a Radix dialog open, background is aria-hidden (hideOthers) +
// focus-trapped + pointer-blocked, so axe color-contrast nodes in the
// background are provably unreachable — a formal false positive, not an
// assumed one. Any flagged node OUTSIDE hidden subtrees fails the gate.

async function loginUi(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForURL('/', { timeout: 10_000 });
}

async function dismissWizardIfOpen(page: Page) {
  const skip = page.getByTestId('onboarding-skip');
  if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skip.click();
  }
}

/** True when the element matched by selector sits in an AT-hidden subtree. */
async function isAtHidden(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    return Boolean(el.closest('[aria-hidden="true"], [inert]'));
  }, selector);
}

interface ContrastFinding {
  nodes: Array<{ target: string[]; html: string }>;
}

/** Full-page axe with modal open; returns color-contrast findings only. */
async function contrastWithModalOpen(page: Page): Promise<ContrastFinding> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules([
      'aria-progressbar-name',
      'button-name',
      'scrollable-region-focusable',
    ])
    .analyze();
  const rule = results.violations.find((v) => v.id === 'color-contrast');
  return {
    nodes: (rule?.nodes ?? []).map((n) => ({
      target: n.target.map(String),
      html: String(n.html).slice(0, 200),
    })),
  };
}

async function expectBackgroundAtHidden(page: Page, context: string) {
  // Radix hideOthers must have aria-hidden'd the app root behind the dialog.
  const hidden = await page.evaluate(() => {
    const roots = Array.from(document.body.children).filter(
      (el) => !el.hasAttribute('data-radix-portal') && el.tagName !== 'SCRIPT',
    );
    const states = roots.map((el) => ({
      tag: el.tagName,
      cls: String(el.getAttribute('class') ?? '').slice(0, 60),
      ariaHidden: el.getAttribute('aria-hidden'),
      inert: el.hasAttribute('inert'),
    }));
    return states;
  });
  console.log(`[inert-evidence:${context}]`, JSON.stringify(hidden).slice(0, 2000));
  expect(
    hidden.filter((r) => r.ariaHidden === 'true' || r.inert).length,
    `background must be AT-hidden while dialog open (${context})`,
  ).toBeGreaterThan(0);
}

async function expectContrastOnlyInHidden(page: Page, context: string) {
  const { nodes } = await contrastWithModalOpen(page);
  console.log(
    `[contrast-evidence:${context}]`,
    JSON.stringify(nodes.map((n) => n.target)).slice(0, 3000),
  );
  for (const node of nodes) {
    const sel = node.target[0];
    expect(
      await isAtHidden(page, sel),
      `contrast node must be AT-unreachable (${context}): ${sel} :: ${node.html}`,
    ).toBe(true);
  }
}

test('palette open: background AT-hidden; contrast only in hidden subtrees', async ({
  page,
}) => {
  await loginUi(page, 'viewer@local', 'Viewer123!');
  await dismissWizardIfOpen(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  await expectBackgroundAtHidden(page, 'palette');
  await expectContrastOnlyInHidden(page, 'palette');
  await closeDialogViaEscape(page);
});

test('wizard open: background AT-hidden; contrast only in hidden subtrees', async ({
  page,
}) => {
  // trader@local is never touched by other specs: wizard auto-opens.
  await loginUi(page, 'trader@local', 'Trader123!');
  await expect(page.getByTestId('onboarding-step-0')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  await expectBackgroundAtHidden(page, 'wizard');
  await expectContrastOnlyInHidden(page, 'wizard');
});
