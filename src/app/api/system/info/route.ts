import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import fs from "fs";
import path from "path";

// GET /api/system/info — returns DB stats (table counts + file size + uptime)
export async function GET() {
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
    db.position.count({ where: { status: "open" } }),
    db.position.count({ where: { status: { in: ["closed", "killed", "liquidated"] } } }),
    db.round.count(),
    db.appLog.count(),
    db.scamReport.count(),
    db.marketSnapshot.count(),
    db.aIInsight.count(),
    db.siteAudit.count(),
    db.positionAlert.count(),
    db.backtestResult.count(),
    db.performanceSnapshot.count(),
    db.notificationChannel.count(),
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
