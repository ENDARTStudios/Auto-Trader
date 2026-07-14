// Persistent SCOUT skip telemetry.
//
// v14.1 stored these counters in-memory only, so they reset to 0 every time
// the engine restarted. v15 moves them to a SQLite table (ScoutSkipStat)
// so the operator can see the cumulative picture across restarts.
//
// Five fixed reasons:
//   "schedule"     — outside trading schedule window
//   "sourceHealth" — a critical source (binance/dexscreener/goplus/zai) was degraded/down
//   "pauseWindow"  — circuit breaker active (consecutiveLosses >= 5 → 1h pause)
//   "roundActive"  — a round is still in progress, skip SCOUT
//   "ok"           — SCOUT ran productively (the positive counter)
//
// We upsert on each tick so the row is created lazily on first occurrence.
// The engine reads them via getScoutSkipStats() to populate EngineSnapshot.

import { db } from "@/lib/db";
import { logger } from "./logger";

export type ScoutSkipReason =
  | "schedule"
  | "sourceHealth"
  | "pauseWindow"
  | "roundActive"
  | "ok";

const ALL_REASONS: ScoutSkipReason[] = [
  "schedule",
  "sourceHealth",
  "pauseWindow",
  "roundActive",
  "ok",
];

export interface ScoutSkipStatsRow {
  reason: ScoutSkipReason;
  count: number;
  lastAt: Date | null;
}

/**
 * Increment the counter for a given reason and stamp lastAt = now.
 * Silent on error — telemetry must never break the engine.
 */
export async function recordScoutSkip(reason: ScoutSkipReason): Promise<void> {
  try {
    await db.scoutSkipStat.upsert({
      where: { reason },
      create: { reason, count: 1, lastAt: new Date() },
      update: { count: { increment: 1 }, lastAt: new Date() },
    });
  } catch (err) {
    logger.debug("engine", `ScoutSkipStat upsert(${reason}) failed: ${String(err)}`);
  }
}

/**
 * Read all 5 counters. Missing rows are returned with count=0/lastAt=null
 * so the consumer always sees a complete map.
 */
export async function getScoutSkipStats(): Promise<Record<ScoutSkipReason, ScoutSkipStatsRow>> {
  const rows = await db.scoutSkipStat.findMany();
  const map = new Map<string, ScoutSkipStatsRow>();
  for (const r of rows) {
    map.set(r.reason, {
      reason: r.reason as ScoutSkipReason,
      count: r.count,
      lastAt: r.lastAt,
    });
  }
  // Backfill missing reasons with zero-count rows
  const result = {} as Record<ScoutSkipReason, ScoutSkipStatsRow>;
  for (const reason of ALL_REASONS) {
    result[reason] =
      map.get(reason) ?? { reason, count: 0, lastAt: null };
  }
  return result;
}

/**
 * Reset all counters to 0. Used by the operator via a button in the
 * System panel (analogous to "Reset counters" in the Source Health panel).
 */
export async function resetScoutSkipStats(): Promise<{ reset: number }> {
  const rows = await db.scoutSkipStat.findMany({ select: { reason: true } });
  if (rows.length === 0) return { reset: 0 };
  await db.scoutSkipStat.updateMany({
    where: { reason: { in: rows.map((r) => r.reason) } },
    data: { count: 0, lastAt: null },
  });
  logger.info("engine", `ScoutSkipStat counters resetados: ${rows.length} razão/ões`);
  return { reset: rows.length };
}
