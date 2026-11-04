import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUserRls } from "@/lib/auth/rls-context";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { handleApiError } from "@/lib/api/error-handler";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  type AttributionPosition,
  type AttributionSnapshot,
  type FactorKey,
  MIN_SAMPLE,
  attribute,
} from "@/lib/analytics/factor-attribution";

export const dynamic = "force-dynamic";

const FACTORS: FactorKey[] = ["momentum", "trend", "volatility", "sentiment", "quality"];

function sinceFor(range: string): Date | null {
  const now = Date.now();
  switch (range) {
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

// GET /api/analytics/attribution?range=24h|7d|30d|all
// Cruza posições fechadas com o snapshot de mercado mais próximo da entrada.
export async function GET(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const rl = checkRateLimit(ip, "/api/analytics/attribution");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }

    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const range = new URL(req.url).searchParams.get("range") ?? "30d";
    const since = sinceFor(range);

    // RLS (prep round 7): contexto do usuário; ownerId no where mantido.
    const positions = await withUserRls(session, (tx) =>
      tx.position.findMany({
        where: {
          ownerId: session.userId,
          status: { in: ["closed", "liquidated", "killed"] },
          ...(since ? { exitAt: { gte: since } } : {}),
        },
        orderBy: { exitAt: "desc" },
        take: 500,
        select: { id: true, symbol: true, entryAt: true, pnlPct: true, pnlUsd: true, scamScore: true },
      })
    );

    if (positions.length === 0) {
      return NextResponse.json({ range, totalTrades: 0, minSample: MIN_SAMPLE, factors: {}, noSample: 0 });
    }

    const symbols = [...new Set(positions.map((p) => p.symbol))];
    const earliest = positions.reduce((min, p) => (p.entryAt < min ? p.entryAt : min), positions[0].entryAt);

    const snapshots = await db.marketSnapshot.findMany({
      where: {
        symbol: { in: symbols },
        analyzedAt: { gte: new Date(earliest.getTime() - 48 * 60 * 60 * 1000) },
      },
      orderBy: { analyzedAt: "desc" },
      take: 2000,
      select: {
        symbol: true,
        analyzedAt: true,
        rsi14: true,
        ema20: true,
        ema50: true,
        bollPercent: true,
        fearGreedClass: true,
      },
    });

    const attributionPositions: AttributionPosition[] = positions.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      entryAt: p.entryAt,
      pnlPct: p.pnlPct,
      pnlUsd: p.pnlUsd,
      scamScore: p.scamScore,
    }));
    const attributionSnapshots: AttributionSnapshot[] = snapshots.map((s) => ({
      symbol: s.symbol,
      analyzedAt: s.analyzedAt,
      rsi14: s.rsi14,
      ema20: s.ema20,
      ema50: s.ema50,
      bollPercent: s.bollPercent,
      fearGreedClass: s.fearGreedClass,
    }));

    const factors: Record<string, unknown> = {};
    for (const key of FACTORS) {
      factors[key] = attribute(key, attributionPositions, attributionSnapshots);
    }

    return NextResponse.json({
      range,
      totalTrades: positions.length,
      snapshots: attributionSnapshots.length,
      minSample: MIN_SAMPLE,
      factors,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/analytics/attribution");
  }
}
