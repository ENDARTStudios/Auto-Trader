import { NextResponse } from "next/server";
import { getScoutSkipStats } from "@/lib/trading/scout-skip-stats";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

// GET /api/scout-skip-stats
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/scout-skip-stats");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const map = await getScoutSkipStats();
    const order = ["ok", "schedule", "sourceHealth", "pauseWindow", "roundActive"] as const;
    const rows = order.map((reason) => ({
      reason,
      count: map[reason].count,
      lastAt: map[reason].lastAt?.toISOString() ?? null,
    }));
    return NextResponse.json({ stats: rows });
  } catch (err) {
    return handleApiError(err, "GET /api/scout-skip-stats");
  }
}
