import { describe, it, expect, beforeEach, vi } from 'vitest';

// Lightweight integration tests for live_trading config and health split.
// These tests do not need a real DB — they only verify in-memory helpers
// and the shape of the returned config / response.

describe('live_trading config (S25 T002)', () => {
  beforeEach(() => {
    // reset module cache between tests
    vi.resetModules();
  });

  it('default config is OFF + testnet + $1k cap', async () => {
    const { getLiveTradingConfig } = await import("../src/lib/feature-flags/live-trading");
    const { invalidateLiveTradingCache } = await import("../src/lib/feature-flags/live-trading");
    invalidateLiveTradingCache();
    const cfg = await getLiveTradingConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.testnet).toBe(true);
    expect(cfg.maxPositionUsd).toBe(1000);
    expect(cfg.allowedChains).toEqual(["base", "arbitrum", "optimism", "ethereum"]);
    expect(cfg.killSwitchSecondsToConfirm).toBe(5);
  });

  it("isLiveTradingEnabled returns false by default", async () => {
    const { isLiveTradingEnabled } = await import("../src/lib/feature-flags/live-trading");
    const { invalidateLiveTradingCache } = await import("../src/lib/feature-flags/live-trading");
    invalidateLiveTradingCache();
    expect(await isLiveTradingEnabled()).toBe(false);
  });
});
