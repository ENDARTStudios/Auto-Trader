import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/trading/logger";

// POST /api/system/maintenance — executes a maintenance action.
// Body: { action: "clear_logs" | "clear_market_snapshots" | "clear_performance_snapshots" | "clear_old_alerts" }
//
// All actions are scoped to old/excess data — they NEVER delete positions,
// rounds, config, balances, or notification channels.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

  let deleted = 0;
  let label = "";

  switch (action) {
    case "clear_logs":
      // Keep last 500 logs, delete everything older than 7 days
      deleted = await db.appLog.deleteMany({
        where: { createdAt: { lt: cutoff7d } },
      }).then((r) => r.count);
      label = "Logs > 7 dias removidos";
      break;

    case "clear_market_snapshots":
      deleted = await db.marketSnapshot.deleteMany({
        where: { analyzedAt: { lt: cutoff } },
      }).then((r) => r.count);
      label = "Market snapshots > 30 dias removidos";
      break;

    case "clear_performance_snapshots":
      // Keep last 7 days of snapshots (enough for analytics range)
      deleted = await db.performanceSnapshot.deleteMany({
        where: { timestamp: { lt: cutoff7d } },
      }).then((r) => r.count);
      label = "Performance snapshots > 7 dias removidos";
      break;

    case "clear_old_alerts":
      // Delete resolved alerts older than 7 days
      deleted = await db.positionAlert.deleteMany({
        where: {
          resolvedAt: { not: null },
          detectedAt: { lt: cutoff7d },
        },
      }).then((r) => r.count);
      label = "Alertas resolvidos > 7 dias removidos";
      break;

    case "clear_notification_logs":
      // Keep last 1000 notification logs
      deleted = await db.notificationLog.deleteMany({
        where: { sentAt: { lt: cutoff7d } },
      }).then((r) => r.count);
      label = "Logs de notificação > 7 dias removidos";
      break;

    case "clear_scam_reports":
      // Delete scam reports for tokens we never opened a position in, older than 30 days
      deleted = await db.scamReport.deleteMany({
        where: { analyzedAt: { lt: cutoff } },
      }).then((r) => r.count);
      label = "Scam reports > 30 dias removidos";
      break;

    case "clear_ai_insights":
      deleted = await db.aIInsight.deleteMany({
        where: { createdAt: { lt: cutoff7d } },
      }).then((r) => r.count);
      label = "AI insights > 7 dias removidos";
      break;

    case "vacuum":
      // SQLite VACUUM to reclaim disk space. We run it via $executeRawUnsafe.
      try {
        await db.$executeRawUnsafe("VACUUM");
        label = "VACUUM executado";
      } catch (err) {
        return NextResponse.json(
          { error: `VACUUM falhou: ${String(err)}` },
          { status: 500 }
        );
      }
      break;

    default:
      return NextResponse.json(
        { error: `Ação desconhecida: ${action}` },
        { status: 400 }
      );
  }

  logger.info("api", `Maintenance: ${label}`, { action, deleted });

  return NextResponse.json({
    ok: true,
    action,
    label,
    deleted,
    timestamp: new Date().toISOString(),
  });
}
