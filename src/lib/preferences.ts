import { z } from "zod";

export type RiskTolerance = "conservative" | "balanced" | "aggressive";

export interface UserPreferences {
  riskTolerance?: RiskTolerance;
  goals?: string[];
  preferredChains?: string[];
  preferredSources?: string[];
}

const nonEmptyStringArray = z.preprocess(
  (arr) => {
    if (!Array.isArray(arr)) return arr;
    return arr
      .filter((s) => !(typeof s === "string" && s.trim().length === 0))
      .map((s) => (typeof s === "string" ? s.trim() : s));
  },
  z.array(z.string().min(1).max(64)).max(20)
);

export const preferencesSchema = z.object({
  riskTolerance: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  goals: nonEmptyStringArray.optional(),
  preferredChains: nonEmptyStringArray.optional(),
  preferredSources: nonEmptyStringArray.optional(),
});

export function parsePreferences(json: string | null | undefined): UserPreferences {
  if (!json) return {};
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function serializePreferences(prefs: UserPreferences): string {
  const cleaned = preferencesSchema.parse(prefs);
  return JSON.stringify(cleaned);
}
