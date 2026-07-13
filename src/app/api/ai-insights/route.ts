import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/ai-insights?limit=50
// Returns recent AI agent insights (thesis, contract audit, news sentiment)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const role = url.searchParams.get("role"); // optional filter

  const where = role ? { agentRole: role } : {};
  const insights = await db.aIInsight.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });

  // Parse keySignals from JSON string
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
}
