import { NextResponse } from "next/server";
import { db } from "@/lib/db";
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

// GET /api/ai-insights?limit=50
// Returns recent AI agent insights (thesis, contract audit, news sentiment)
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/ai-insights");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "logs:read")) throw new ForbiddenError("logs:read");

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const role = url.searchParams.get("role");

    const where = role ? { agentRole: role } : {};
    const insights = await db.aIInsight.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });

    const parsed = insights.map((i) => ({
      ...i,
      keySignals: (() => {
        try {
          return JSON.parse(i.keySignals ?? "[]") as string[];
        } catch {
          return [];
        }
      })(),
    }));

    return NextResponse.json(parsed);
  } catch (err) {
    return handleApiError(err, "GET /api/ai-insights");
  }
}
