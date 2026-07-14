import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { resetSourceHealthCounters, type SourceName } from "@/lib/trading/source-health";

// POST /api/source-health/reset
// Body: { source?: "binance"|"dexscreener"|"goplus"|"zai"|"rdap"|"safebrowsing" }
// If `source` is omitted, ALL sources are reset.
//
// Resets counters (successCount24h, errorCount24h, window*, rateLimited) but
// preserves lastSuccessAt / lastErrorAt / lastErrorMsg as audit trail.
export async function POST(req: Request) {
  try {
    let body: { source?: string } = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is OK — treat as "reset all"
    }
    const source = body.source as SourceName | undefined;
    const result = await resetSourceHealthCounters(source);
    logger.info("api", `SourceHealth reset: ${result.reset} fonte(s) (${source ?? "todas"})`);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api", `Erro resetando source-health: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to reset source health" },
      { status: 500 }
    );
  }
}
