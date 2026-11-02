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
    // No dev server a primeira visita compila a rota e um redirect interno pode
    // abortar a navegação (ERR_ABORTED). Uma repetição resolve.
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(path, { waitUntil: "load", timeout: 60_000 });
        break;
      } catch (err) {
        if (attempt >= 1 || !/ERR_ABORTED/.test(String(err))) throw err;
        await page.waitForTimeout(1500);
      }
    }
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


test("canais de alerta: cria, edita e remove", async ({ page }) => {
  await page.goto("/alerts");
  await expect(page.locator(".mrd-title")).toContainText("Alerts", { timeout: 20_000 });

  await page.getByRole("button", { name: /new channel/i }).click();
  const modal = page.locator(".mrd-modal");
  await expect(modal).toBeVisible();
  await modal.locator("input").first().fill("E2E canal");
  await modal.locator("select").selectOption("webhook");
  await modal.locator('input[type="text"]').last().fill("https://example.com/e2e-hook");
  await modal.getByRole("button", { name: /criar canal/i }).click();

  await expect(page.locator(".mrd-side").getByText("E2E canal")).toBeVisible({ timeout: 15_000 });

  await page.locator(".mrd-side").getByRole("button", { name: "E2E canal" }).click();
  await expect(modal.getByRole("button", { name: /^remover$/i })).toBeVisible();
  await modal.getByRole("button", { name: /^remover$/i }).click();
  await expect(page.locator(".mrd-side").getByText("E2E canal")).toHaveCount(0, { timeout: 15_000 });
});

test("MFA: painel de setup mostra segredo e campo de código", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.locator(".mrd-title")).toContainText("Settings", { timeout: 20_000 });
  await page.getByRole("button", { name: /^configurar$/i }).click();

  await expect(page.getByText("Código de 6 dígitos gerado pelo app")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /ativar mfa/i })).toBeDisabled();
  await page.getByRole("button", { name: /^cancelar$/i }).click();
  await expect(page.getByText("Código de 6 dígitos gerado pelo app")).toHaveCount(0);
});

test("copilot mostra ledger de evidências da resposta", async ({ page }) => {
  await page.goto("/copilot");
  await expect(page.locator(".mrd-title")).toContainText("Copilot", { timeout: 20_000 });
  await page.fill(".mrd-compose textarea", "drawdown atual?");
  await page.locator(".mrd-compose button").click();
  await expect(page.getByText(/números auditados/)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/com fonte|sem fonte/).first()).toBeVisible();
});

test("MCP orders_list responde somente leitura", async ({ page }) => {
  await page.goto("/overview");
  const out = await page.evaluate(async () => {
    const r = await fetch("/api/mcp", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "orders_list" } }),
    });
    const body = await r.json();
    const text = body?.result?.content?.[0]?.text ?? "{}";
    return { status: r.status, orders: JSON.parse(text).orders?.length ?? -1 };
  });
  expect(out.status).toBe(200);
  expect(out.orders).toBeGreaterThanOrEqual(0);
});

test("detalhe da posição mostra o ciclo da ordem", async ({ page }) => {
  // Consulta a API antes de navegar: sem posições o teste é skip explícito.
  const res = await page.request.get("/api/positions");
  const body = await res.json().catch(() => null);
  const rows = Array.isArray(body) ? body : (body?.positions ?? []);
  const open = rows.filter((p: { status?: string }) => p.status === "open");
  if (open.length === 0) test.skip(true, "sem posições no ambiente");

  await page.goto("/portfolio");
  const link = page.locator('a[href^="/positions/"]').first();
  await expect(link).toBeVisible({ timeout: 25_000 });
  await link.click();
  await expect(page.getByText("Ciclo da ordem")).toBeVisible({ timeout: 25_000 });
});

test("indicador SSE fica live no shell", async ({ page }) => {
  await page.goto("/overview");
  await expect(page.locator(".mrd-live")).toHaveText(/SSE/i, { timeout: 20_000 });
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

  test("callback OAuth com state inválido volta ao login com erro", async ({ page }) => {
    await page.goto("/api/auth/google/callback?code=fake&state=wrong");
    await expect(page).toHaveURL(/\/login\?error=google_state/, { timeout: 15_000 });
    await expect(page.locator(".mrd-banner")).toContainText("expirou");
  });

  test("raiz anônima cai na landing", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/welcome/, { timeout: 15_000 });
  });
});
