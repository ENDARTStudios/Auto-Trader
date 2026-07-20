// Records periodic PerformanceSnapshot rows for the Analytics tab.
//
// Why throttle?
//   The engine ticks every ~30s. Recording a snapshot every tick would
//   bloat the DB (2880 rows/day). We throttle to one snapshot per minute
//   by checking the timestamp of the most recent row.
//
// What we record:
//   - tradingBalanceUsd, reserveBalanceUsd, peakBalanceUsd from singletons
//   - unrealizedPnlUsd = sum of (currentPrice - entryPrice) * qty for open positions
//   - totalEquityUsd = trading + reserve + unrealized
//   - drawdownPct = (peak - totalEquity) / peak * 100, clamped to >= 0
//
// The equity curve in the Analytics tab is built from these snapshots.

import { db } from "@/lib/db";
import { fetchPricesBatch } from "./price-feed";
import { logger } from "./logger";

const MIN_SNAPSHOT_INTERVAL_MS = 60_000; // 1 minute
const MAX_ROWS = 50_000; // ~35 days at 1-min granularity; trim older

let lastSnapshotAt = 0;

export async function recordSnapshotIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastSnapshotAt < MIN_SNAPSHOT_INTERVAL_MS) {
    return;
  }

  try {
    // Check the DB for the most recent snapshot (covers process restarts)
    const latest = await db.performanceSnapshot.findFirst({
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });
    if (latest) {
      const ageMs = now - latest.timestamp.getTime();
      if (ageMs < MIN_SNAPSHOT_INTERVAL_MS) {
        lastSnapshotAt = latest.timestamp.getTime();
        return;
      }
    }

    const tb = await db.tradingBalance.findUnique({ where: { id: "singleton" } });
    const rb = await db.reserve.findUnique({ where: { id: "singleton" } });
    if (!tb || !rb) return;

    const openPositions = await db.position.findMany({
      where: { status: "open" },
    });

    let unrealizedPnlUsd = 0;
    if (openPositions.length > 0) {
      const prices = await fetchPricesBatch(
        openPositions.map((p) => ({
          id: p.id,
          symbol: p.symbol,
          source: p.source as "cex" | "dex",
          chain: p.chain,
          tokenId: p.tokenId,
        }))
      );
      for (const pos of openPositions) {
        const price = prices.get(pos.id) ?? pos.entryPriceUsd;
        const qty = pos.entryQty;
        const delta = (price - pos.entryPriceUsd) * qty;
        unrealizedPnlUsd += delta;
      }
    }

    const tradingBalanceUsd = tb.balanceUsd;
    const reserveBalanceUsd = rb.balanceUsd;
    const peakBalanceUsd = tb.peakBalanceUsd;
    const realizedPnlUsd = tb.realizedPnlUsd;
    const totalEquityUsd = tradingBalanceUsd + reserveBalanceUsd + unrealizedPnlUsd;
    const drawdownPct =
      peakBalanceUsd > 0
        ? Math.max(0, ((peakBalanceUsd - totalEquityUsd) / peakBalanceUsd) * 100)
        : 0;

    await db.performanceSnapshot.create({
      data: {
        tradingBalanceUsd,
        reserveBalanceUsd,
        peakBalanceUsd,
        realizedPnlUsd,
        unrealizedPnlUsd,
        totalEquityUsd,
        openPositionsCount: openPositions.length,
        drawdownPct,
      },
    });
    lastSnapshotAt = now;

    // Trim old snapshots (cheap heuristic: delete rows with id < (max - MAX_ROWS))
    const latestRow = await db.performanceSnapshot.findFirst({
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (latestRow) {
      const cutoff = latestRow.id - MAX_ROWS;
      if (cutoff > 0) {
        await db.performanceSnapshot.deleteMany({ where: { id: { lt: cutoff } } });
      }
    }
  } catch (err) {
    logger.warn("engine", "Falha ao gravar performance snapshot", {
      error: String(err),
    });
  }
}
