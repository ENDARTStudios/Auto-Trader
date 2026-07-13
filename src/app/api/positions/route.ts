import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchPricesBatch } from "@/lib/trading/price-feed";
import type { PositionRow } from "@/lib/trading/types";

export async function GET() {
  const openPositions = await db.position.findMany({
    where: { status: "open" },
    orderBy: { entryAt: "desc" },
    take: 50,
  });

  const prices = await fetchPricesBatch(
    openPositions.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      source: p.source as "cex" | "dex",
      chain: p.chain,
      tokenId: p.tokenId,
    }))
  );

  const rows: PositionRow[] = openPositions.map((p) => {
    const currentPrice = prices.get(p.id) ?? 0;
    const unrealizedPnlUsd =
      currentPrice > 0 ? (currentPrice - p.entryPriceUsd) * p.entryQty : 0;
    const unrealizedPnlPct =
      p.entryPriceUsd > 0
        ? ((currentPrice - p.entryPriceUsd) / p.entryPriceUsd) * 100
        : 0;
    return {
      id: p.id,
      symbol: p.symbol,
      source: p.source as "cex" | "dex",
      chain: p.chain,
      tokenId: p.tokenId,
      status: "open",
      entryPriceUsd: p.entryPriceUsd,
      entryAmountUsd: p.entryAmountUsd,
      entryQty: p.entryQty,
      entryAt: p.entryAt.toISOString(),
      exitPriceUsd: null,
      exitAmountUsd: null,
      exitAt: null,
      exitReason: null,
      pnlUsd: null,
      pnlPct: null,
      takeProfitPrice: p.takeProfitPrice,
      stopLossPrice: p.stopLossPrice,
      maxExitAt: p.maxExitAt.toISOString(),
      scamScore: p.scamScore,
      scamBreakdown: p.scamBreakdown,
      roundId: p.roundId,
      currentPriceUsd: currentPrice,
      unrealizedPnlUsd,
      unrealizedPnlPct,
    };
  });

  return NextResponse.json(rows);
}
