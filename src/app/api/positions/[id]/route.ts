import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchPricesBatch } from "@/lib/trading/price-feed";

// GET /api/positions/[id] — returns full position detail aggregated with all
// related data: scam report, AI insights, surveillance alerts, market snapshots,
// round info, and current live price (if open).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const position = await db.position.findUnique({ where: { id } });
  if (!position) {
    return NextResponse.json({ error: "Posição não encontrada" }, { status: 404 });
  }

  // Parallel: scam report (by symbol+tokenId), AI insights (by symbol/tokenId),
  // surveillance alerts (by positionId), market snapshots (by symbol, last 20),
  // round info, current price (if open).
  const isOpen = position.status === "open";

  const [scamReport, aiInsights, surveillanceAlerts, marketSnapshots, round] =
    await Promise.all([
      db.scamReport.findFirst({
        where: {
          symbol: position.symbol,
          ...(position.tokenId ? { tokenId: position.tokenId } : {}),
        },
        orderBy: { analyzedAt: "desc" },
      }),
      db.aIInsight.findMany({
        where: {
          OR: [
            { symbol: position.symbol },
            ...(position.tokenId ? [{ tokenId: position.tokenId }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.positionAlert.findMany({
        where: { positionId: position.id },
        orderBy: { detectedAt: "desc" },
        take: 50,
      }),
      db.marketSnapshot.findMany({
        where: { symbol: position.symbol },
        orderBy: { analyzedAt: "desc" },
        take: 30,
      }),
      db.round.findUnique({ where: { id: position.roundId } }),
    ]);

  // Fetch current price only for open positions
  let currentPriceUsd: number | null = null;
  let unrealizedPnlUsd: number | null = null;
  let unrealizedPnlPct: number | null = null;
  if (isOpen) {
    const prices = await fetchPricesBatch([
      {
        id: position.id,
        symbol: position.symbol,
        source: position.source as "cex" | "dex",
        chain: position.chain,
        tokenId: position.tokenId,
      },
    ]);
    currentPriceUsd = prices.get(position.id) ?? 0;
    if (currentPriceUsd > 0) {
      unrealizedPnlUsd =
        (currentPriceUsd - position.entryPriceUsd) * position.entryQty;
      unrealizedPnlPct =
        position.entryPriceUsd > 0
          ? ((currentPriceUsd - position.entryPriceUsd) /
              position.entryPriceUsd) *
            100
          : 0;
    }
  }

  // Parse scamBreakdown JSON if present
  let scamBreakdown: any = null;
  if (position.scamBreakdown) {
    try {
      scamBreakdown = JSON.parse(position.scamBreakdown);
    } catch {
      scamBreakdown = null;
    }
  }

  // Parse scam report findings
  let scamFindings: any = null;
  if (scamReport?.findings) {
    try {
      scamFindings = JSON.parse(scamReport.findings);
    } catch {
      scamFindings = null;
    }
  }

  // Serialize market snapshots to compact format for mini-chart
  const marketChart = marketSnapshots
    .reverse()
    .map((s) => ({
      t: s.analyzedAt.toISOString(),
      p: s.priceUsd,
      rsi: s.rsi14,
      signal: s.signalLabel,
    }));

  return NextResponse.json({
    position: {
      id: position.id,
      symbol: position.symbol,
      source: position.source,
      chain: position.chain,
      tokenId: position.tokenId,
      status: position.status,
      entryPriceUsd: position.entryPriceUsd,
      entryAmountUsd: position.entryAmountUsd,
      entryQty: position.entryQty,
      entryAt: position.entryAt.toISOString(),
      exitPriceUsd: position.exitPriceUsd,
      exitAmountUsd: position.exitAmountUsd,
      exitAt: position.exitAt?.toISOString() ?? null,
      exitReason: position.exitReason,
      pnlUsd: position.pnlUsd,
      pnlPct: position.pnlPct,
      takeProfitPrice: position.takeProfitPrice,
      stopLossPrice: position.stopLossPrice,
      maxExitAt: position.maxExitAt.toISOString(),
      scamScore: position.scamScore,
      scamBreakdown,
      roundId: position.roundId,
      // Live data (open positions only)
      currentPriceUsd,
      unrealizedPnlUsd,
      unrealizedPnlPct,
    },
    scamReport: scamReport
      ? {
          score: scamReport.score,
          passed: scamReport.passed,
          honeypotScore: scamReport.honeypotScore,
          liquidityScore: scamReport.liquidityScore,
          contractScore: scamReport.contractScore,
          taxScore: scamReport.taxScore,
          holderScore: scamReport.holderScore,
          ageScore: scamReport.ageScore,
          findings: scamFindings,
          analyzedAt: scamReport.analyzedAt.toISOString(),
        }
      : null,
    aiInsights: aiInsights.map((i) => ({
      id: i.id,
      agentRole: i.agentRole,
      recommendation: i.recommendation,
      confidence: i.confidence,
      promptSummary: i.promptSummary,
      modelOutput: i.modelOutput,
      keySignals: i.keySignals,
      durationMs: i.durationMs,
      error: i.error,
      createdAt: i.createdAt.toISOString(),
    })),
    surveillanceAlerts: surveillanceAlerts.map((a) => ({
      id: a.id,
      type: a.type,
      severity: a.severity,
      message: a.message,
      context: a.context,
      detectedAt: a.detectedAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      resolution: a.resolution,
    })),
    marketChart,
    round: round
      ? {
          id: round.id,
          startedAt: round.startedAt.toISOString(),
          endedAt: round.endedAt?.toISOString() ?? null,
          tokensScanned: round.tokensScanned,
          tokensPassedFilter: round.tokensPassedFilter,
          positionsOpened: round.positionsOpened,
          positionsClosed: round.positionsClosed,
          roundPnlUsd: round.roundPnlUsd,
          status: round.status,
        }
      : null,
  });
}
