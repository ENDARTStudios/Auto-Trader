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
    const rl = checkRateLimit(ip, "/api/logs");
    if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, "logs:read")) throw new ForbiddenError("logs:read");
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);
  const level = url.searchParams.get("level");

  const where: Record<string, unknown> = {};
  if (level) where.level = level;

  const logs = await db.appLog.findMany({
    where,
    orderBy: { id: "desc" },
    take: limit,
  });

    return NextResponse.json(
      logs.map((l) => ({
        id: l.id,
        level: l.level,
        source: l.source,
        message: l.message,
        context: l.context,
        createdAt: l.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    return handleApiError(err, "GET /api/logs");
  }
}
