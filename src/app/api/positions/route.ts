import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchPricesBatch } from "@/lib/trading/price-feed";
import type { PositionRow } from "@/lib/trading/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = (req.headers as unknown as Headers).get?.("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/positions");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }
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
  } catch (err) {
    return handleApiError(err, "GET /api/positions");
  }
}
