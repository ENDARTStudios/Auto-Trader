// Validação visual da produção (Railway) — somente leitura: login + views
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = 'D:/tmp/ui-audit-prod';
mkdirSync(OUT, { recursive: true });
const base = 'https://auto-trader-production-0cbc.up.railway.app';
const browser = await chromium.launch();
const out = [];
async function shot(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try { await fn(page); await page.screenshot({ path: `${OUT}/${name}.png` }); out.push(`OK ${name}`); }
  catch (e) { out.push(`FAIL ${name}: ${String(e).slice(0, 90)}`); }
  await ctx.close();
}
await shot('prod-01-login', async (p) => { await p.goto(`${base}/login`, { waitUntil: 'networkidle' }); });
await shot('prod-02-dashboard', async (p) => {
  await p.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'admin@local');
  await p.fill('input[type="password"]', 'Admin123!');
  await p.click('button[type="submit"]');
  await p.waitForURL(`${base}/`, { timeout: 20000 });
  await p.waitForTimeout(3000);
});
console.log(out.join('\n'));
await browser.close();
