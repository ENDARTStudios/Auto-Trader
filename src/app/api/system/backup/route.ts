import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/trading/logger";

// GET /api/system/backup — exports the full DB as a JSON download.
// Excludes transient runtime state (engineRunning, killSwitch fields) — those are
// restored separately by the operator after import. We keep everything else,
// including closed positions, rounds, logs, scam reports, snapshots, etc.
export async function GET() {
  const [
    config,
    positions,
    rounds,
    appLogs,
    scamReports,
    marketSnapshots,
    aiInsights,
    siteAudits,
    positionAlerts,
    backtestResults,
    performanceSnapshots,
    notificationChannels,
    notificationLogs,
    reserve,
    tradingBalance,
    riskEvents,
    tradingSchedule,
  ] = await Promise.all([
    db.config.findFirst(),
    db.position.findMany(),
    db.round.findMany(),
    db.appLog.findMany({ orderBy: { createdAt: "desc" }, take: 5000 }),
    db.scamReport.findMany(),
    db.marketSnapshot.findMany({ orderBy: { analyzedAt: "desc" }, take: 5000 }),
    db.aIInsight.findMany(),
    db.siteAudit.findMany(),
    db.positionAlert.findMany(),
    db.backtestResult.findMany(),
    db.performanceSnapshot.findMany(),
    db.notificationChannel.findMany(),
    db.notificationLog.findMany({ orderBy: { sentAt: "desc" }, take: 5000 }),
    db.reserve.findFirst(),
    db.tradingBalance.findFirst(),
    db.riskEvent.findMany(),
    db.tradingSchedule.findMany(),
  ]);

  const payload = {
    _meta: {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: "auto-trader",
      tables: {
        config: config ? 1 : 0,
        positions: positions.length,
        rounds: rounds.length,
        appLogs: appLogs.length,
        scamReports: scamReports.length,
        marketSnapshots: marketSnapshots.length,
        aiInsights: aiInsights.length,
        siteAudits: siteAudits.length,
        positionAlerts: positionAlerts.length,
        backtestResults: backtestResults.length,
        performanceSnapshots: performanceSnapshots.length,
        notificationChannels: notificationChannels.length,
        notificationLogs: notificationLogs.length,
        reserve: reserve ? 1 : 0,
        tradingBalance: tradingBalance ? 1 : 0,
        riskEvents: riskEvents.length,
        tradingSchedule: tradingSchedule.length,
      },
    },
    data: {
      config,
      positions,
      rounds,
      appLogs,
      scamReports,
      marketSnapshots,
      aiInsights,
      siteAudits,
      positionAlerts,
      backtestResults,
      performanceSnapshots,
      notificationChannels,
      notificationLogs,
      reserve,
      tradingBalance,
      riskEvents,
      tradingSchedule,
    },
  };

  logger.info("api", "Backup exportado", { tables: payload._meta.tables });

  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// POST /api/system/backup — restores from an uploaded JSON payload.
// Strategy:
//   - This is a DANGEROUS operation. We only restore into a subset of tables
//     where it makes sense (config, tradingBalance, reserve, tradingSchedule,
//     notificationChannels — i.e. operator-controlled settings). We do NOT
//     overwrite positions, rounds, logs, etc. — those are append-only
//     historical data. If the operator truly wants a full restore, they should
//     drop the DB file and re-import everything via Prisma seed scripts.
//   - For each restorable table we UPSERT (insert-or-update) rows by their
//     primary key. This preserves foreign-key-like relationships.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body || !body.data || !body._meta || body._meta.app !== "auto-trader") {
    return NextResponse.json(
      { error: "Formato de backup inválido (esperado _meta.app='auto-trader')" },
      { status: 400 }
    );
  }
  const d = body.data;
  const restored: Record<string, number> = {};

  // 1. Config (singleton)
  if (d.config) {
    const { id, createdAt, ...patch } = d.config;
    await db.config.upsert({
      where: { id: id ?? "singleton" },
      create: { id: id ?? "singleton", ...patch },
      update: patch,
    });
    restored.config = 1;
  }

  // 2. TradingBalance (singleton)
  if (d.tradingBalance) {
    const { id, createdAt, updatedAt, ...patch } = d.tradingBalance;
    await db.tradingBalance.upsert({
      where: { id: id ?? "singleton" },
      create: { id: id ?? "singleton", ...patch },
      update: patch,
    });
    restored.tradingBalance = 1;
  }

  // 3. Reserve (singleton)
  if (d.reserve) {
    const { id, updatedAt, ...patch } = d.reserve;
    await db.reserve.upsert({
      where: { id: id ?? "singleton" },
      create: { id: id ?? "singleton", ...patch },
      update: patch,
    });
    restored.reserve = 1;
  }

  // 4. TradingSchedule (singleton)
  if (Array.isArray(d.tradingSchedule) && d.tradingSchedule.length > 0) {
    for (const s of d.tradingSchedule) {
      const { id, updatedAt, ...patch } = s;
      await db.tradingSchedule.upsert({
        where: { id: id ?? "singleton" },
        create: { id: id ?? "singleton", ...patch },
        update: patch,
      });
    }
    restored.tradingSchedule = d.tradingSchedule.length;
  }

  // 5. NotificationChannels (by id)
  if (Array.isArray(d.notificationChannels)) {
    let count = 0;
    for (const ch of d.notificationChannels) {
      try {
        const { createdAt, updatedAt, ...patch } = ch;
        await db.notificationChannel.upsert({
          where: { id: ch.id },
          create: patch,
          update: patch,
        });
        count++;
      } catch (err) {
        logger.warn("api", `Erro restaurando canal ${ch.id}`, { error: String(err) });
      }
    }
    restored.notificationChannels = count;
  }

  logger.info("api", "Backup restaurado (parcial — config/balances/schedule/channels)", {
    restored,
  });

  return NextResponse.json({
    ok: true,
    restored,
    note:
      "Restauração parcial: config + balances + schedule + channels. Posições/rounds/logs NÃO foram sobrescritos (dados históricos append-only).",
  });
}
