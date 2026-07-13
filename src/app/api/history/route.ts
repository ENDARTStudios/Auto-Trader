import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

  const closed = await db.position.findMany({
    where: { status: { in: ["closed", "liquidated", "killed"] } },
    orderBy: { exitAt: "desc" },
    take: limit,
  });

  return NextResponse.json(
    closed.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      source: p.source,
      chain: p.chain,
      tokenId: p.tokenId,
      status: p.status,
      entryPriceUsd: p.entryPriceUsd,
      entryAmountUsd: p.entryAmountUsd,
      entryQty: p.entryQty,
      entryAt: p.entryAt.toISOString(),
      exitPriceUsd: p.exitPriceUsd,
      exitAmountUsd: p.exitAmountUsd,
      exitAt: p.exitAt?.toISOString() ?? null,
      exitReason: p.exitReason,
      pnlUsd: p.pnlUsd,
      pnlPct: p.pnlPct,
      takeProfitPrice: p.takeProfitPrice,
      stopLossPrice: p.stopLossPrice,
      maxExitAt: p.maxExitAt.toISOString(),
      scamScore: p.scamScore,
      roundId: p.roundId,
    }))
  );
}
