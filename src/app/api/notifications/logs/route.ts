import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";

// GET /api/notifications/logs?limit=100&channelId=...&eventType=...
export async function GET(req: Request) {
  try {
    await requirePermission("audit:read")(req);
    const url = new URL(req.url);
    const limit = Math.min(500, parseInt(url.searchParams.get("limit") ?? "100", 10));
    const channelId = url.searchParams.get("channelId");
    const eventType = url.searchParams.get("eventType");

    const where: Record<string, unknown> = {};
    if (channelId) where.channelId = channelId;
    if (eventType) where.eventType = eventType;

    const logs = await db.notificationLog.findMany({
      where,
      orderBy: { id: "desc" },
      take: limit,
    });

    const total = await db.notificationLog.count({ where });

    return NextResponse.json({
      logs,
      total,
      limit,
    });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") {
      return handleApiError(err, "GET /api/notifications/logs");
    }
    return NextResponse.json(
      { error: `Failed to list logs: ${String(err)}` },
      { status: 500 }
    );
  }
}
