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
    const rl = checkRateLimit(ip, "/api/rounds");
    if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");
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
  } catch (err) {
    return handleApiError(err, "GET /api/rounds");
  }
}
