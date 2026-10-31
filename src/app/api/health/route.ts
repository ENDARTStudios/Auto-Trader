import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/health
// - /api/health = full health report (liveness + readiness + DB + uptime)
// - /api/health/live = Kubernetes liveness probe (just process up)
// - /api/health/ready = Kubernetes readiness probe (DB reachable)
//
// Liveness: returns 200 with `{ status: "live" }` always (process is up).
// Readiness: returns 200 if DB query OK, 503 otherwise.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const now = new Date().toISOString();

  if (pathname.endsWith("/live")) {
    // Liveness — process is up, no dependencies
    return NextResponse.json({ status: "live", timestamp: now });
  }

  if (pathname.endsWith("/ready")) {
    // Readiness — DB must be reachable
    try {
      const start = Date.now();
      await db.featureFlag.findFirst({ select: { id: true } });
      const dbLatencyMs = Date.now() - start;
      return NextResponse.json(
        { status: "ready", timestamp: now, dbLatencyMs },
        { status: 200 }
      );
    } catch (err) {
      return NextResponse.json(
        { status: "not_ready", error: String(err), timestamp: now },
        { status: 503 }
      );
    }
  }

  // Full health report (default for /api/health)
  try {
    const start = Date.now();
    const flag = await db.featureFlag.findFirst({ select: { id: true, key: true } });
    const dbLatencyMs = Date.now() - start;
    return NextResponse.json({
      status: "ok",
      timestamp: now,
      db: { reachable: true, latencyMs: dbLatencyMs, sample: flag?.key ?? null },
    });
  } catch (err) {
    return NextResponse.json(
      { status: "degraded", error: String(err), timestamp: now },
      { status: 503 }
    );
  }
}
