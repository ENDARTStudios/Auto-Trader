import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/notifications/logs?limit=100&channelId=...&eventType=...
export async function GET(req: Request) {
  try {
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
    return NextResponse.json(
      { error: `Failed to list logs: ${String(err)}` },
      { status: 500 }
    );
  }
}
