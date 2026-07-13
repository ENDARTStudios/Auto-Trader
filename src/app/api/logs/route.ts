import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: Request) {
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
}
