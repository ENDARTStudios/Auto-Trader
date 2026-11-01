import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTES = [
  "overview", "markets", "token/SOL", "portfolio", "position/SOL", "strategy",
  "backtest", "analytics", "journal", "risk", "copilot", "alerts", "data",
  "settings", "billing", "admin", "design", "landing", "login", "signup",
  "reset", "onboarding",
];

for (const route of ROUTES) {
  test(`${route} renders without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`#/${route}`);
    await page.waitForTimeout(400);

    await expect(page.locator("body")).not.toBeEmpty();
    const hasShell = await page.locator(".app, .auth, .ob, .pub").count();
    expect(hasShell, "app shell should render").toBeGreaterThan(0);
    expect(errors, `console errors on ${route}`).toEqual([]);
  });
}

test.describe("responsive", () => {
  const widths = [390, 768, 1440];
  const pages = ["overview", "markets", "portfolio", "risk", "copilot", "journal"];
  for (const width of widths) {
    for (const route of pages) {
      test(`${route} has no horizontal overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`#/${route}`);
        await page.waitForTimeout(350);
        const { scrollW, innerW } = await page.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
        }));
        expect(scrollW, `document overflow at ${width}px`).toBeLessThanOrEqual(innerW + 1);
      });
    }
  }
});

test("command palette opens and closes instantly (keyboard action)", async ({ page }) => {
  await page.goto("#/overview");
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator(".palette");
  await expect(palette).toBeVisible();
  const duration = await page.evaluate(() => {
    const el = document.querySelector(".palette");
    return el ? getComputedStyle(el).transitionDuration : null;
  });
  expect(duration, "keyboard-initiated overlays must not animate").toBe("0s");
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
});

test("command palette navigates to a route", async ({ page }) => {
  await page.goto("#/overview");
  await page.keyboard.press("ControlOrMeta+k");
  await page.fill("#pq", "risk");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/risk/);
});

test("kill switch requires the typed confirmation", async ({ page }) => {
  await page.goto("#/risk");
  await page.locator("[data-kill]").first().click();
  const ok = page.locator(".modal [data-ok]");
  await expect(ok).toBeDisabled();
  await page.fill(".modal input", "HALT");
  await expect(ok).toBeEnabled();
  await ok.click();
  await expect(page.locator(".toast")).toContainText("Kill switch triggered");
});

test("meters animate with transform, never width", async ({ page }) => {
  await page.goto("#/risk");
  const transition = await page.locator(".meter > span").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { prop: cs.transitionProperty, width: cs.width, transform: cs.transform };
  });
  expect(transition.prop).toContain("transform");
  expect(transition.prop).not.toContain("width");
  expect(transition.transform).not.toBe("none");
});

test("buttons give press feedback", async ({ page }) => {
  await page.goto("#/overview");
  const btn = page.locator(".btn-primary").first();
  const t = await btn.evaluate((el) => getComputedStyle(el).transitionProperty);
  expect(t).toContain("transform");
});

for (const route of ["overview", "markets", "risk", "login"]) {
  test(`axe: no serious or critical violations on ${route}`, async ({ page }) => {
    await page.goto(`#/${route}`);
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const bad = results.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""));
    expect(
      bad.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })),
      `serious/critical a11y violations on ${route}`
    ).toEqual([]);
  });
}
