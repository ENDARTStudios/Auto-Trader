import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { analyzeWatchlistToken } from "@/lib/trading/watchlist";
import { requirePermission } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";

// POST /api/watchlist/[id]/analyze — trigger on-demand AI sentiment analysis
//
// Returns the AIInsightResult (recommendation, confidence, keySignals,
// modelOutput, durationMs). The insight is already persisted to the
// AIInsight table by the agent, so it also shows up in the AI Agents tab.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePermission("watchlist:manage")(req);
    const { id } = await params;
    const start = Date.now();
    const result = await analyzeWatchlistToken(id);
    const durationMs = Date.now() - start;
    logger.info(
      "api",
      `Watchlist analyze ${id} → ${result.recommendation} (${result.confidence}%) ${durationMs}ms`
    );
    return NextResponse.json({ insight: result, durationMs });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") {
      return handleApiError(err, "POST /api/watchlist/[id]/analyze");
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("api", `Erro em watchlist analyze: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
