import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const rounds = await db.round.findMany({
    orderBy: { id: "desc" },
    take: 30,
  });
  return NextResponse.json(
    rounds.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      tradingBalanceUsd: r.tradingBalanceUsd,
      reserveBalanceUsd: r.reserveBalanceUsd,
      tokensScanned: r.tokensScanned,
      tokensPassedFilter: r.tokensPassedFilter,
      tokensRejectedScam: r.tokensRejectedScam,
      positionsOpened: r.positionsOpened,
      positionsClosed: r.positionsClosed,
      roundPnlUsd: r.roundPnlUsd,
      status: r.status,
      notes: r.notes,
    }))
  );
}
