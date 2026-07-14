import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { getSourceHealth } from "@/lib/trading/source-health";

// GET /api/source-health — list all source health rows with derived status
export async function GET() {
  try {
    const sources = await getSourceHealth();
    return NextResponse.json({ sources });
  } catch (err) {
    logger.error("api", `Erro listando source-health: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to list source health" },
      { status: 500 }
    );
  }
}
