import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { listRecentAlerts, runSurveillance, resolveAlertsForPosition } from "@/lib/trading/position-surveillance";
import { logger } from "@/lib/trading/logger";
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

const postSchema = z.object({
  action: z.enum(["scan_now", "resolve"]),
  positionId: z.string().optional(),
  resolution: z.string().optional(),
});

// GET /api/surveillance?limit=50
// Returns recent position surveillance alerts (newest first)
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/surveillance");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "logs:read")) throw new ForbiddenError("logs:read");

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const onlyOpen = url.searchParams.get("open") === "1";

    let alerts = await listRecentAlerts(Math.min(limit, 200));

    if (onlyOpen) {
      alerts = alerts.filter((a) => a.resolvedAt === null);
    }

    const counts = {
      critical: alerts.filter((a) => a.severity === "critical" && !a.resolvedAt).length,
      warning: alerts.filter((a) => a.severity === "warning" && !a.resolvedAt).length,
      info: alerts.filter((a) => a.severity === "info" && !a.resolvedAt).length,
      total: alerts.filter((a) => !a.resolvedAt).length,
    };

    return NextResponse.json({ alerts, counts });
  } catch (err) {
    return handleApiError(err, "GET /api/surveillance");
  }
}

// POST /api/surveillance
// Body: { action: "scan_now" | "resolve", positionId?, resolution? }
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/surveillance");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "logs:read")) throw new ForbiddenError("logs:read");

    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    if (body.action === "scan_now") {
      const openPositions = await db.position.findMany({
        where: { status: "open" },
      });
      if (openPositions.length === 0) {
        return NextResponse.json({
          ok: true,
          message: "Nenhuma posição aberta para vigiar",
          results: [],
        });
      }
      const results = await runSurveillance(
        openPositions.map((p) => ({
          id: p.id,
          symbol: p.symbol,
          tokenId: p.tokenId,
          chain: p.chain,
          source: p.source,
          entryPriceUsd: p.entryPriceUsd,
          entryAmountUsd: p.entryAmountUsd,
          entryAt: p.entryAt,
          takeProfitPrice: p.takeProfitPrice,
          stopLossPrice: p.stopLossPrice,
          maxExitAt: p.maxExitAt,
        }))
      );
      const totalAlerts = results.reduce((s, r) => s + r.alerts.length, 0);
      logger.info("api", `Scan manual: ${totalAlerts} alerta(s) em ${results.length} posições`);
      return NextResponse.json({
        ok: true,
        message: `Scan executado: ${totalAlerts} alerta(s) em ${results.length} posições`,
        results,
      });
    }

    if (body.action === "resolve") {
      if (!body.positionId) {
        return NextResponse.json(
          { ok: false, error: "positionId obrigatório para resolve" },
          { status: 400 }
        );
      }
      await resolveAlertsForPosition(
        body.positionId,
        body.resolution ?? "dismissed"
      );
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { ok: false, error: "Action inválido (use scan_now ou resolve)" },
      { status: 400 }
    );
  } catch (err) {
    return handleApiError(err, "POST /api/surveillance");
  }
}
