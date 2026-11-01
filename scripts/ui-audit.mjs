// Auditoria visual UI-UX — screenshots desktop/mobile do Auto Trader
// Login admin@local -> dashboard, abas, mobile 375px. Saída: /tmp/ui-audit/*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/ui-audit';
mkdirSync(OUT, { recursive: true });
const base = 'http://localhost:3000';
const results = [];

const browser = await chromium.launch();
const errors = [];

async function shoot(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] console: ${m.text().slice(0, 120)}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${String(e).slice(0, 120)}`));
  try {
    await fn(page);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    results.push(`OK ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${String(e).slice(0, 100)}`);
  }
  await ctx.close();
}

// login helper
async function login(page) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', 'admin@local');
  await page.fill('input[type="password"]', 'Admin123!');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${base}/`, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

// 1. login page
await shoot('01-login-desktop', async (page) => {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
});
// 2. dashboard desktop
await shoot('02-dashboard-desktop', async (page) => {
  await login(page);
  await page.waitForTimeout(2500);
});
// 3. mobile
await shoot('03-dashboard-mobile', async (page) => {
  const ctx = page.context();
  await ctx.close();
});
const mctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const mpage = await mctx.newPage();
mpage.on('pageerror', (e) => errors.push(`[mobile] pageerror: ${String(e).slice(0, 120)}`));
try {
  await mpage.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await mpage.fill('input[type="email"], input[name="email"]', 'admin@local');
  await mpage.fill('input[type="password"]', 'Admin123!');
  await mpage.click('button[type="submit"]');
  await mpage.waitForURL(`${base}/`, { timeout: 15000 });
  await mpage.waitForTimeout(2500);
  await mpage.screenshot({ path: `${OUT}/03-dashboard-mobile.png`, fullPage: false });
  // horizontal scroll check
  const hscroll = await mpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  results.push(`OK 03-dashboard-mobile (hscroll=${hscroll})`);
} catch (e) {
  results.push(`FAIL 03-dashboard-mobile: ${String(e).slice(0, 100)}`);
}
await mctx.close();

// 4. keyboard focus visibility (tab 5x e screenshot)
await shoot('04-focus-visibility', async (page) => {
  await login(page);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
});

console.log(results.join('\n'));
console.log('--- erros de console/page ---');
console.log(errors.slice(0, 12).join('\n') || '(nenhum)');
await browser.close();
