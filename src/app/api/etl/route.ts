// src/app/api/etl/route.ts — ETL control/status endpoint (real data only)
//
// GET  /api/etl — status das fontes (últimos DataSource rows + contagem). Exige
//                 sessão + permissão system:read.
// POST /api/etl — executa runETL() de verdade. Exige sessão + system:admin
//                 (usado por operador/cron). Persiste proveniência por fonte:
//                 status "ok" só quando o dado veio de HTTP 2xx.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, requirePermission } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";
import { logger } from "@/lib/trading/logger";
import { runETL } from "@/lib/etl/run";

export const dynamic = "force-dynamic";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

// GET /api/etl — status + histórico recente de ingestão
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/etl");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "system:read")) throw new ForbiddenError("system:read");

    const rows = await db.dataSource.findMany({ orderBy: { startedAt: "desc" }, take: 40 });
    // Último registro por fonte — é o que a UI deve mostrar como "estado atual".
    const latestBySource = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latestBySource.has(r.name)) latestBySource.set(r.name, r);

    const sources = Array.from(latestBySource.values()).map((r) => ({
      name: r.name,
      url: r.url,
      status: r.status,
      provenance: r.status === "ok" ? "live" : "error",
      recordsCount: r.recordsCount,
      error: r.error,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    }));
    const hasError = sources.some((s) => s.status !== "ok");

    return NextResponse.json({
      ok: true,
      degraded: hasError,
      sources,
      history: rows.map((r) => ({
        name: r.name,
        status: r.status,
        recordsCount: r.recordsCount,
        error: r.error,
        startedAt: r.startedAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/etl");
  }
}

// POST /api/etl — executa a ingestão real agora
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/etl:run");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
    // requirePermission já resolve a sessão e valida o RBAC (system:admin)
    const session = await requirePermission("system:admin")(req);

    const started = Date.now();
    const result = await runETL();
    logger.info(
      "api",
      `ETL manual por ${session.email}: ${result.sources
        .map((s) => `${s.name}=${s.status}`)
        .join(" ")} (${Date.now() - started}ms)`
    );

    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result });
  } catch (err) {
    return handleApiError(err, "POST /api/etl");
  }
}
