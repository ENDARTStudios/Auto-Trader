import { test, expect } from "@playwright/test";

/**
 * Smoke do shell Meridian. Roda contra um dev server já no ar:
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test --config playwright.meridian.config.ts
 *
 * A sessão é criada uma vez em meridian.setup.ts (storage state) para não
 * esbarrar no rate limit de /api/auth/login.
 */

const ROUTES: [string, string][] = [
  ["/overview", "Mission control"],
  ["/markets", "Markets"],
  ["/portfolio", "Portfolio"],
  ["/strategy", "Strategy"],
  ["/risk", "Risk"],
  ["/analytics", "Analytics"],
  ["/journal", "Journal"],
  ["/backtest", "Backtest"],
  ["/copilot", "AI Copilot"],
  ["/alerts", "Alerts"],
  ["/data", "Data"],
  ["/settings", "Settings"],
  ["/billing", "Billing"],
  ["/admin", "Users"],
  ["/onboarding", "Primeiros passos"],
];

test("rotas do shell respondem sem erro de página", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));

  for (const [path, heading] of ROUTES) {
    await page.goto(path);
    await expect(page.locator(".mrd-title")).toContainText(heading, { timeout: 20_000 });
    await expect(page.locator(".mrd-rail")).toBeVisible();
  }

  expect(errors, `erros de página: ${errors.join(" | ")}`).toHaveLength(0);
});

test("sessão na raiz vai para /overview", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/overview/, { timeout: 15_000 });
  await expect(page.locator(".mrd-title")).toContainText("Mission control");
});

test("kill switch exige HALT e não dispara sem confirmação", async ({ page }) => {
  await page.goto("/risk");
  await page.getByRole("button", { name: /trigger kill switch/i }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: /trigger kill switch/i });
  await expect(confirm).toBeDisabled();

  await dialog.locator("input[placeholder='HALT']").fill("HALT");
  await expect(confirm).toBeEnabled();
  await dialog.getByRole("button", { name: /^cancel$/i }).click();
  await expect(dialog).toBeHidden();
});

test.describe("anônimo", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("páginas públicas abrem sem sessão", async ({ page }) => {
    for (const [path, heading] of [
      ["/welcome", "O motor que mostra"],
      ["/pricing", "Você paga pelo"],
      ["/signup", "não abre cadastro"],
    ] as [string, string][]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(heading, { timeout: 15_000 });
    }
    await page.goto("/forgot");
    await expect(page.getByRole("heading", { level: 2 })).toContainText("Recuperar acesso");
  });

  test("raiz anônima cai na landing", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/welcome/, { timeout: 15_000 });
  });
});
