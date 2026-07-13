import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listRecentAlerts, runSurveillance, resolveAlertsForPosition } from "@/lib/trading/position-surveillance";
import { logger } from "@/lib/trading/logger";

// GET /api/surveillance?limit=50
// Returns recent position surveillance alerts (newest first)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const onlyOpen = url.searchParams.get("open") === "1";

  let alerts = await listRecentAlerts(Math.min(limit, 200));

  if (onlyOpen) {
    alerts = alerts.filter((a) => a.resolvedAt === null);
  }

  // Also return counts by severity for dashboard badge
  const counts = {
    critical: alerts.filter((a) => a.severity === "critical" && !a.resolvedAt).length,
    warning: alerts.filter((a) => a.severity === "warning" && !a.resolvedAt).length,
    info: alerts.filter((a) => a.severity === "info" && !a.resolvedAt).length,
    total: alerts.filter((a) => !a.resolvedAt).length,
  };

  return NextResponse.json({ alerts, counts });
}

// POST /api/surveillance
// Body: { action: "scan_now" | "resolve", positionId?, resolution? }
//   - scan_now: triggers an immediate surveillance pass on all open positions
//     (bypassing the 5-min throttle)
//   - resolve: manually resolves all alerts for a given positionId
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action: "scan_now" | "resolve";
      positionId?: string;
      resolution?: string;
    };

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
    logger.error("api", `Erro /api/surveillance POST: ${String(err)}`);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}
