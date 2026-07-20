import { NextResponse } from "next/server";
import { getScoutSkipStats } from "@/lib/trading/scout-skip-stats";

// GET /api/scout-skip-stats
//
// Returns the 5 SCOUT skip counters as an array. The engine snapshot at
// /api/status also includes these (under `scoutSkipStats`), but exposing
// a dedicated endpoint makes the API self-describing and lets the UI
// invalidate just this query on reset instead of the whole status.
export async function GET() {
  const map = await getScoutSkipStats();
  const order = ["ok", "schedule", "sourceHealth", "pauseWindow", "roundActive"] as const;
  const rows = order.map((reason) => ({
    reason,
    count: map[reason].count,
    lastAt: map[reason].lastAt?.toISOString() ?? null,
  }));
  return NextResponse.json({ stats: rows });
}
