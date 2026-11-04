import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import fs from "fs";
import path from "path";
import { requirePermission } from "@/lib/auth/session";
import { withSystemRls } from "@/lib/auth/rls-context";
import { handleApiError } from "@/lib/api/error-handler";

// GET /api/system/info — returns DB stats (table counts + file size + uptime)
export async function GET(req: Request) {
  try {
    await requirePermission("system:read")(req);
  } catch (err) {
    return handleApiError(err, "GET /api/system/info");
  }
  const [
    configCount,
    positionsOpen,
    positionsClosed,
    rounds,
    appLogs,
    scamReports,
    marketSnapshots,
    aiInsights,
    siteAudits,
    positionAlerts,
    backtestResults,
    performanceSnapshots,
    notifChannels,
    notifLogs,
    tradingSchedules,
  ] = await Promise.all([
    db.config.count(),
    // Position será STRICT (round 8) — contagens de sistema.
    withSystemRls((tx) => tx.position.count({ where: { status: "open" } })),
    withSystemRls((tx) =>
      tx.position.count({ where: { status: { in: ["closed", "killed", "liquidated"] } } })
    ),
    db.round.count(),
    db.appLog.count(),
    db.scamReport.count(),
    db.marketSnapshot.count(),
    db.aIInsight.count(),
    db.siteAudit.count(),
    db.positionAlert.count(),
    db.backtestResult.count(),
    db.performanceSnapshot.count(),
    // NotificationChannel é STRICT (round 6): contagem precisa de contexto de
    // sistema (rota já exige system:read).
    withSystemRls((tx) => tx.notificationChannel.count()),
    db.notificationLog.count(),
    db.tradingSchedule.count(),
  ]);

  // DB file size
  const dbPath = path.resolve(process.cwd(), "db/custom.db");
  let dbSizeBytes = 0;
  try {
    const stat = fs.statSync(dbPath);
    dbSizeBytes = stat.size;
  } catch {
    /* ignore */
  }

  // Memory usage
  const mem = process.memoryUsage();

  return NextResponse.json({
    tables: {
      config: configCount,
      positionsOpen,
      positionsClosed,
      positionsTotal: positionsOpen + positionsClosed,
      rounds,
      appLogs,
      scamReports,
      marketSnapshots,
      aiInsights,
      siteAudits,
      positionAlerts,
      backtestResults,
      performanceSnapshots,
      notificationChannels: notifChannels,
      notificationLogs: notifLogs,
      tradingSchedules,
    },
    db: {
      path: "db/custom.db",
      sizeBytes: dbSizeBytes,
      sizeMb: Math.round((dbSizeBytes / 1024 / 1024) * 100) / 100,
    },
    runtime: {
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
    },
    schema: {
      prismaModels: 15, // updated count after adding TradingSchedule
    },
    timestamp: new Date().toISOString(),
  });
}
