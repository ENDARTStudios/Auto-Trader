import { describe, it, expect } from "vitest";
import { z } from "zod";
import { preferencesSchema, type UserPreferences } from "@/lib/preferences";

describe("preferencesSchema", () => {
  it("accepts valid riskTolerance", () => {
    const r = preferencesSchema.safeParse({ riskTolerance: "conservative" });
    expect(r.success).toBe(true);
    const r2 = preferencesSchema.safeParse({ riskTolerance: "aggressive" });
    expect(r2.success).toBe(true);
    const r3 = preferencesSchema.safeParse({ riskTolerance: "balanced" });
    expect(r3.success).toBe(true);
  });

  it("rejects invalid riskTolerance", () => {
    const r = preferencesSchema.safeParse({ riskTolerance: "yolo" });
    expect(r.success).toBe(false);
  });

  it("accepts full payload", () => {
    const payload: UserPreferences = {
      riskTolerance: "balanced",
      goals: ["swing", "long-term"],
      preferredChains: ["base", "arbitrum"],
      preferredSources: ["cex", "dex"],
    };
    const r = preferencesSchema.safeParse(payload);
    expect(r.success).toBe(true);
  });

  it("accepts empty object (all fields optional)", () => {
    const r = preferencesSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("rejects non-array goals", () => {
    const r = preferencesSchema.safeParse({ goals: "not-an-array" });
    expect(r.success).toBe(false);
  });

  it("rejects non-string elements in preferredChains", () => {
    const r = preferencesSchema.safeParse({ preferredChains: [1, 2] });
    expect(r.success).toBe(false);
  });

  it("limits arrays to 20 items", () => {
    const many = Array.from({ length: 21 }, (_, i) => `item${i}`);
    const r = preferencesSchema.safeParse({ goals: many });
    expect(r.success).toBe(false);
    const ok = preferencesSchema.safeParse({ goals: many.slice(0, 20) });
    expect(ok.success).toBe(true);
  });

  it("trims empty strings out of arrays", () => {
    const r = preferencesSchema.parse({ preferredChains: ["base", "", "  "] });
    expect(r.preferredChains).toEqual(["base"]);
  });

  it("round-trips through JSON", () => {
    const original: UserPreferences = {
      riskTolerance: "conservative",
      goals: ["income"],
      preferredChains: ["base"],
      preferredSources: ["dex"],
    };
    const parsed = preferencesSchema.parse(JSON.parse(JSON.stringify(original)));
    expect(parsed).toEqual(original);
  });
});
