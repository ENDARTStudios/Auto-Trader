import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { resetScoutSkipStats } from "@/lib/trading/scout-skip-stats";

// POST /api/scout-skip-stats/reset
//
// Resets all 5 SCOUT skip counters (schedule / sourceHealth / pauseWindow /
// roundActive / ok) to 0 and clears lastAt. Used by the operator via the
// "Reset counters" button on the SCOUT telemetry card in the System panel.
//
// No body parameters — always resets all reasons (singletons make sense as
// a unit; partial reset would skew the operator's view of recent vs. older
// skips).
export async function POST() {
  try {
    const result = await resetScoutSkipStats();
    logger.info("api", `ScoutSkipStat reset: ${result.reset} razão(ões)`);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api", `Erro resetando scout-skip-stats: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to reset scout skip stats" },
      { status: 500 }
    );
  }
}
