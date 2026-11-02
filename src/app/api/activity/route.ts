import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { handleApiError } from "@/lib/api/error-handler";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const SOURCES = ["risk", "engine", "portfolio", "stripe-webhook"];

// GET /api/activity?limit=12 — timeline persistida para o card Activity.
// Usa AppLog (fonte de verdade do que aconteceu), sem expor contexto interno.
export async function GET(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const rl = checkRateLimit(ip, "/api/activity");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }

    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "12", 10) || 12, 50);

    const rows = await db.appLog.findMany({
      where: { source: { in: SOURCES } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, level: true, source: true, message: true, createdAt: true },
    });

    return NextResponse.json({
      events: rows.map((r) => ({
        id: `log-${r.id}`,
        level: r.level,
        source: r.source,
        message: r.source === "stripe-webhook" && /^evt_/.test(r.message) ? "evento recebido e verificado" : r.message,
        at: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/activity");
  }
}
