// src/lib/trading/feature-flags.ts — Feature flag system
// Catálogo em docs/ARCHITECTURE.md §4.2

import { db } from "@/lib/db";

let cache: Map<string, boolean> | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

export async function isEnabled(key: string, userId?: string): Promise<boolean> {
  // Env override — e.g. FEATURE_ENABLE_LIVE_TRADING=1
  const envKey = `FEATURE_${key.toUpperCase()}`;
  const envVal = process.env[envKey];
  if (envVal != null) return envVal === "1" || envVal === "true";

  if (cache && Date.now() - cacheAt < TTL_MS) {
    return cache.get(key) ?? false;
  }

  try {
    const flags = await db.featureFlag.findMany();
    cache = new Map(flags.map((f) => [f.key, f.enabled]));
    cacheAt = Date.now();
    const flag = flags.find((f) => f.key === key);
    if (!flag) return false;
    if (flag.rolloutPct < 100 && userId) {
      const hash = simpleHash(userId + key) % 100;
      return flag.enabled && hash < flag.rolloutPct;
    }
    return flag.enabled;
  } catch {
    // Table may not exist yet (pre-migration) — default to false
    return false;
  }
}

export async function setFlag(key: string, enabled: boolean, rolloutPct = 100): Promise<void> {
  await db.featureFlag.upsert({
    where: { key },
    create: { key, enabled, rolloutPct },
    update: { enabled, rolloutPct },
  });
  cache = null;
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function __resetFlagCache(): void {
  cache = null;
  cacheAt = 0;
}
