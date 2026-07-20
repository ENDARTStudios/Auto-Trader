import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { getDiversificationSnapshot } from "@/lib/trading/diversification";
import { getConfig } from "@/lib/trading/config";

// GET /api/diversification — current diversification snapshot + caps
export async function GET() {
  try {
    const [snapshot, cfg] = await Promise.all([
      getDiversificationSnapshot(),
      getConfig(),
    ]);
    return NextResponse.json({
      snapshot,
      caps: {
        maxPositionsPerSymbol: cfg.maxPositionsPerSymbol,
        maxPositionsPerChain: cfg.maxPositionsPerChain,
        maxPositionsPerStrategy: cfg.maxPositionsPerStrategy,
        maxPositionsPerRound: cfg.maxPositionsPerRound,
      },
      enabledStrategies: cfg.enabledStrategies,
    });
  } catch (err) {
    logger.error("api", `Erro lendo diversification: ${String(err)}`);
    return NextResponse.json({ error: "Failed to fetch diversification" }, { status: 500 });
  }
}
