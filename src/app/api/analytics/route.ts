// GET /api/analytics
//   ?range=24h|7d|30d|all   (default: 24h)
//
// Returns:
//   {
//     equityCurve: [{ timestamp, tradingBalanceUsd, reserveBalanceUsd,
//                     peakBalanceUsd, realizedPnlUsd, unrealizedPnlUsd,
//                     totalEquityUsd, openPositionsCount, drawdownPct }],
//     summary: {
//       startEquityUsd, endEquityUsd, absChangeUsd, pctChange,
//       maxEquityUsd, minEquityUsd, maxDrawdownPct,
//       snapshotCount, rangeStart, rangeEnd
//     },
//     bySymbol: [{ symbol, trades, wins, losses, winRate, totalPnlUsd, avgPnlUsd }],
//     byDayOfWeek: [{ dow, trades, wins, losses, totalPnlUsd }],   // 0=Sun..6=Sat
//     byHour: [{ hour, trades, wins, losses, totalPnlUsd }],        // 0..23
//     streaks: { currentWinStreak, currentLossStreak, longestWinStreak, longestLossStreak },
//     bestTrade: { symbol, pnlUsd, pnlPct, exitAt } | null,
//     worstTrade: { symbol, pnlUsd, pnlPct, exitAt } | null
//   }

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { handleApiError } from "@/lib/api/error-handler";
import { checkRateLimit } from "@/lib/rate-limit";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

export const dynamic = "force-dynamic";

const RANGES: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: 0, // special: from epoch
};

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/analytics");
    if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");
    const url = new URL(req.url);
    const rangeKey = url.searchParams.get("range") ?? "24h";
    const rangeMs = RANGES[rangeKey] ?? RANGES["24h"];
    // For "all", use epoch (1970-01-01). For others, subtract from now.
    const since = rangeMs > 0 ? new Date(Date.now() - rangeMs) : new Date(0);
    // ----- Equity curve from PerformanceSnapshot -----
    const snapshots = await db.performanceSnapshot.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: "asc" },
    });

    const equityCurve = snapshots.map((s) => ({
      timestamp: s.timestamp.toISOString(),
      tradingBalanceUsd: s.tradingBalanceUsd,
      reserveBalanceUsd: s.reserveBalanceUsd,
      peakBalanceUsd: s.peakBalanceUsd,
      realizedPnlUsd: s.realizedPnlUsd,
      unrealizedPnlUsd: s.unrealizedPnlUsd,
      totalEquityUsd: s.totalEquityUsd,
      openPositionsCount: s.openPositionsCount,
      drawdownPct: s.drawdownPct,
    }));

    // ----- Summary stats -----
    let summary = {
      startEquityUsd: 0,
      endEquityUsd: 0,
      absChangeUsd: 0,
      pctChange: 0,
      maxEquityUsd: 0,
      minEquityUsd: 0,
      maxDrawdownPct: 0,
      snapshotCount: 0,
      rangeStart: null as string | null,
      rangeEnd: null as string | null,
    };
    if (snapshots.length > 0) {
      const equities = snapshots.map((s) => s.totalEquityUsd);
      const start = snapshots[0];
      const end = snapshots[snapshots.length - 1];
      summary = {
        startEquityUsd: start.totalEquityUsd,
        endEquityUsd: end.totalEquityUsd,
        absChangeUsd: end.totalEquityUsd - start.totalEquityUsd,
        pctChange:
          start.totalEquityUsd > 0
            ? ((end.totalEquityUsd - start.totalEquityUsd) / start.totalEquityUsd) * 100
            : 0,
        maxEquityUsd: Math.max(...equities),
        minEquityUsd: Math.min(...equities),
        maxDrawdownPct: Math.max(...snapshots.map((s) => s.drawdownPct)),
        snapshotCount: snapshots.length,
        rangeStart: start.timestamp.toISOString(),
        rangeEnd: end.timestamp.toISOString(),
      };
    }

    // ----- Closed positions in range (for breakdowns) -----
    const closedPositions = await db.position.findMany({
      where: {
        status: "closed",
        exitAt: { gte: since },
      },
      orderBy: { exitAt: "asc" },
    });

    // ----- By symbol -----
    const bySymbolMap = new Map<
      string,
      { symbol: string; trades: number; wins: number; losses: number; totalPnlUsd: number }
    >();
    for (const p of closedPositions) {
      const sym = p.symbol;
      const entry = bySymbolMap.get(sym) ?? {
        symbol: sym,
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnlUsd: 0,
      };
      entry.trades++;
      const pnl = p.pnlUsd ?? 0;
      if (pnl > 0) entry.wins++;
      else if (pnl < 0) entry.losses++;
      entry.totalPnlUsd += pnl;
      bySymbolMap.set(sym, entry);
    }
    const bySymbol = Array.from(bySymbolMap.values())
      .map((e) => ({
        ...e,
        winRate: e.trades > 0 ? (e.wins / e.trades) * 100 : 0,
        avgPnlUsd: e.trades > 0 ? e.totalPnlUsd / e.trades : 0,
      }))
      .sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);

    // ----- By day of week (0=Sun..6=Sat) -----
    const byDayOfWeek = Array.from({ length: 7 }, (_, dow) => ({
      dow,
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnlUsd: 0,
    }));
    for (const p of closedPositions) {
      if (!p.exitAt) continue;
      const dow = new Date(p.exitAt).getDay();
      const pnl = p.pnlUsd ?? 0;
      byDayOfWeek[dow].trades++;
      if (pnl > 0) byDayOfWeek[dow].wins++;
      else if (pnl < 0) byDayOfWeek[dow].losses++;
      byDayOfWeek[dow].totalPnlUsd += pnl;
    }

    // ----- By hour of day (0..23) -----
    const byHour = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnlUsd: 0,
    }));
    for (const p of closedPositions) {
      if (!p.exitAt) continue;
      const hour = new Date(p.exitAt).getHours();
      const pnl = p.pnlUsd ?? 0;
      byHour[hour].trades++;
      if (pnl > 0) byHour[hour].wins++;
      else if (pnl < 0) byHour[hour].losses++;
      byHour[hour].totalPnlUsd += pnl;
    }

    // ----- Streaks (across all closed positions, not just range) -----
    const allClosed = await db.position.findMany({
      where: { status: "closed", exitAt: { not: null } },
      orderBy: { exitAt: "asc" },
      select: { pnlUsd: true },
    });
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    let longestWinStreak = 0;
    let longestLossStreak = 0;
    let curWin = 0;
    let curLoss = 0;
    for (const p of allClosed) {
      const pnl = p.pnlUsd ?? 0;
      if (pnl > 0) {
        curWin++;
        curLoss = 0;
        longestWinStreak = Math.max(longestWinStreak, curWin);
      } else if (pnl < 0) {
        curLoss++;
        curWin = 0;
        longestLossStreak = Math.max(longestLossStreak, curLoss);
      } else {
        curWin = 0;
        curLoss = 0;
      }
    }
    // Compute current streak from the end
    for (let i = allClosed.length - 1; i >= 0; i--) {
      const pnl = allClosed[i].pnlUsd ?? 0;
      if (pnl > 0) {
        if (currentLossStreak > 0) break;
        currentWinStreak++;
      } else if (pnl < 0) {
        if (currentWinStreak > 0) break;
        currentLossStreak++;
      } else {
        break;
      }
    }

    // ----- Best / worst trade in range -----
    let bestTrade: {
      symbol: string;
      pnlUsd: number;
      pnlPct: number;
      exitAt: string;
    } | null = null;
    let worstTrade: {
      symbol: string;
      pnlUsd: number;
      pnlPct: number;
      exitAt: string;
    } | null = null;
    for (const p of closedPositions) {
      const pnl = p.pnlUsd ?? 0;
      const pct = p.pnlPct ?? 0;
      const exitAt = p.exitAt?.toISOString() ?? "";
      if (!bestTrade || pnl > bestTrade.pnlUsd) {
        bestTrade = { symbol: p.symbol, pnlUsd: pnl, pnlPct: pct, exitAt };
      }
      if (!worstTrade || pnl < worstTrade.pnlUsd) {
        worstTrade = { symbol: p.symbol, pnlUsd: pnl, pnlPct: pct, exitAt };
      }
    }

    return NextResponse.json({
      range: rangeKey,
      equityCurve,
      summary,
      bySymbol,
      byDayOfWeek,
      byHour,
      streaks: {
        currentWinStreak,
        currentLossStreak,
        longestWinStreak,
        longestLossStreak,
      },
      bestTrade,
      worstTrade,
      closedPositionsCount: closedPositions.length,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/analytics");
  }
}
