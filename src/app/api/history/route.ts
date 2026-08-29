import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { handleApiError } from "@/lib/api/error-handler";
import { checkRateLimit } from "@/lib/rate-limit";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/history");
    if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, "positions:read")) throw new ForbiddenError("positions:read");
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
  } catch (err) {
    return handleApiError(err, "GET /api/history");
  }
}
