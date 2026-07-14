import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { listStrategicCapabilities, getRoadmapStats } from "@/lib/trading/strategic-roadmap";

// GET /api/roadmap — list all strategic capabilities + aggregate stats
export async function GET() {
  try {
    const [capabilities, stats] = await Promise.all([
      listStrategicCapabilities(),
      getRoadmapStats(),
    ]);
    return NextResponse.json({ capabilities, stats });
  } catch (err) {
    logger.error("api", `Erro lendo roadmap: ${String(err)}`);
    return NextResponse.json({ error: "Failed to fetch roadmap" }, { status: 500 });
  }
}
