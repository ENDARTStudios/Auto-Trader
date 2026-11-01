import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // O smoke do shell Meridian tem config própria (porta 3100 + storage state);
  // roda com: npx playwright test --config playwright.meridian.config.ts
  testIgnore: /meridian\.(spec|setup)\.ts/,
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
