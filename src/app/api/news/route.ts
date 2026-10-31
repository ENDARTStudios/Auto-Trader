import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";
import { getNews } from "@/lib/trading/news";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

// GET /api/news?limit=20 — aggregated crypto news from RSS feeds (cached 5min)
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/news");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }

    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) {
      throw new ForbiddenError("dashboard:read");
    }

    const url = new URL(req.url);
    const parsed = parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : 20;

    const result = await getNews(limit);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err, "GET /api/news");
  }
}
