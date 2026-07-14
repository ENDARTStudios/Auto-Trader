import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { getCurrentRiskScale, RISK_SCALE_BANDS } from "@/lib/trading/risk-scaling";

// GET /api/risk-scale — current risk scale assessment + band table
export async function GET() {
  try {
    const [assessment, bands] = await Promise.all([
      getCurrentRiskScale(),
      Promise.resolve(RISK_SCALE_BANDS),
    ]);
    return NextResponse.json({ assessment, bands });
  } catch (err) {
    logger.error("api", `Erro lendo risk scale: ${String(err)}`);
    return NextResponse.json({ error: "Failed to fetch risk scale" }, { status: 500 });
  }
}
