import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /meridian\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /meridian\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: ".auth/meridian.json" },
    },
  ],
});
