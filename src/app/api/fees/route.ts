import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { getFeeStats } from "@/lib/trading/fee-model";
import { computeRoundTripCost } from "@/lib/trading/fee-model";
import { getConfig } from "@/lib/trading/config";

// GET /api/fees — fee statistics + round-trip cost preview
// Query params: ?days=7 (default 7) — time window for stats
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") ?? "7", 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [stats, cfg] = await Promise.all([
      getFeeStats({ since }),
      getConfig(),
    ]);

    // Round-trip cost preview at common position sizes
    const previewSizes = [50, 100, 250, 500, 1000];
    const roundTripPreview = previewSizes.map((size) => {
      const rtc = computeRoundTripCost(size, cfg.feeBps, cfg.slippageBps);
      return { positionSizeUsd: size, ...rtc };
    });

    return NextResponse.json({
      stats,
      config: {
        feeBps: cfg.feeBps,
        slippageBps: cfg.slippageBps,
        feePct: cfg.feeBps / 100,
        slippagePct: cfg.slippageBps / 100,
      },
      roundTripPreview,
    });
  } catch (err) {
    logger.error("api", `Erro listando fee stats: ${String(err)}`);
    return NextResponse.json({ error: "Failed to fetch fee stats" }, { status: 500 });
  }
}
