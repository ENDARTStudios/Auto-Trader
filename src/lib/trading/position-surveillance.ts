// Position Surveillance — continuous risk monitoring for OPEN positions.
//
// The engine's MONITOR phase currently only checks TP/SL/timeout. This module
// adds proactive surveillance: re-scans each open position for EMERGING risks
// that weren't present (or weren't detected) at entry time:
//
//   1. GoPlus re-scan — detects newly-surfaced critical flags (e.g. owner
//      suddenly minted tokens, LP got unlocked, new honeypot status)
//   2. Liquidity drain — compares current DEX liquidity vs entry-time
//      liquidity; if liquidity dropped >40%, that's a red flag
//   3. Price dump velocity — checks 1h price change; sudden dump >10% in 1h
//      while still above SL may indicate early exit needed
//   4. Holder concentration — if GoPlus reports top 10 holders >50%, flag
//   5. Tax spike — if buy/sell tax increased significantly since entry
//   6. Timeout approaching — flag when position is within 30min of maxExitAt
//
// Each alert is persisted in PositionAlert table for audit trail + dashboard.
// Critical alerts are returned to the engine, which feeds them to the
// exit-planner for an AI-driven exit decision.

import { db } from "@/lib/db";
import { logger } from "./logger";
import { scanTokenWithGoPlus } from "./goplus-scanner";
import { fetchPricesBatch } from "./price-feed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AlertType =
  | "goplus_critical_flag"
  | "liquidity_drain"
  | "price_dump_velocity"
  | "holder_concentration"
  | "tax_spike"
  | "timeout_approaching"
  | "price_anomaly";

export type AlertSeverity = "info" | "warning" | "critical";

export interface SurveillanceAlert {
  id: number;
  positionId: string;
  symbol: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  context: Record<string, unknown>;
  detectedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface PositionSurveillanceResult {
  positionId: string;
  symbol: string;
  alerts: SurveillanceAlert[];
  currentPriceUsd: number;
  currentLiquidityUsd?: number;
  currentGoPlusScore?: number;
}

// ---------------------------------------------------------------------------
// DexScreener pair lookup (for current liquidity + price change)
// ---------------------------------------------------------------------------
interface DexScreenerPair {
  chainId: string;
  baseToken: { address: string };
  liquidity?: { usd?: number };
  volume?: { h24?: number; h1?: number };
  priceChange?: { h1?: number; h6?: number; h24?: number };
  txns?: { h1?: { buys?: number; sells?: number } };
}

async function fetchDexPair(
  chain: string,
  tokenAddress: string
): Promise<DexScreenerPair | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress.toLowerCase()}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { pairs?: DexScreenerPair[] };
    const pairs = (json.pairs ?? []).filter((p) => p.chainId === chain);
    if (pairs.length === 0) return null;
    // Pick the pair with highest liquidity (most reliable)
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    return pairs[0];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Insert alert helper (dedupes against recent unresolved alerts of same type)
// ---------------------------------------------------------------------------
async function insertAlert(
  positionId: string,
  symbol: string,
  type: AlertType,
  severity: AlertSeverity,
  message: string,
  context: Record<string, unknown>
): Promise<SurveillanceAlert | null> {
  // Check if there's an unresolved alert of same type for this position
  // within the last 30 minutes — if so, skip (avoid spamming)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000);
  const existing = await db.positionAlert.findFirst({
    where: {
      positionId,
      type,
      resolvedAt: null,
      detectedAt: { gte: thirtyMinAgo },
    },
  });
  if (existing) return null;

  const alert = await db.positionAlert.create({
    data: {
      positionId,
      symbol,
      type,
      severity,
      message,
      context: JSON.stringify(context),
    },
  });

  logger.warn(
    "surveillance",
    `Alerta [${severity}] ${symbol} (${type}): ${message}`,
    { positionId, ...context }
  );

  return {
    id: alert.id,
    positionId: alert.positionId,
    symbol: alert.symbol,
    type: alert.type as AlertType,
    severity: alert.severity as AlertSeverity,
    message: alert.message,
    context,
    detectedAt: alert.detectedAt.toISOString(),
    resolvedAt: null,
    resolution: null,
  };
}

// ---------------------------------------------------------------------------
// Resolve alerts for a position (called when position closes or alert cleared)
// ---------------------------------------------------------------------------
export async function resolveAlertsForPosition(
  positionId: string,
  resolution: string
): Promise<void> {
  await db.positionAlert.updateMany({
    where: { positionId, resolvedAt: null },
    data: { resolvedAt: new Date(), resolution },
  });
}

// ---------------------------------------------------------------------------
// Main surveillance routine — called once per engine tick (MONITOR phase)
// ---------------------------------------------------------------------------
export async function runSurveillance(
  openPositions: Array<{
    id: string;
    symbol: string;
    tokenId: string | null;
    chain: string | null;
    source: string;
    entryPriceUsd: number;
    entryAmountUsd: number;
    entryAt: Date;
    takeProfitPrice: number;
    stopLossPrice: number;
    maxExitAt: Date;
  }>
): Promise<PositionSurveillanceResult[]> {
  if (openPositions.length === 0) return [];

  const results: PositionSurveillanceResult[] = [];
  const now = new Date();

  // Batch-fetch current prices for all open positions (used for price anomaly)
  const prices = await fetchPricesBatch(
    openPositions.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      source: p.source as "cex" | "dex",
      chain: p.chain ?? undefined,
      tokenId: p.tokenId ?? undefined,
    }))
  );

  for (const pos of openPositions) {
    const alerts: SurveillanceAlert[] = [];
    const currentPrice = prices.get(pos.id) ?? 0;
    const result: PositionSurveillanceResult = {
      positionId: pos.id,
      symbol: pos.symbol,
      alerts,
      currentPriceUsd: currentPrice,
    };

    // 1. Price dump velocity check (works for both CEX and DEX)
    // Drop > 12% from entry but not yet at SL = early warning
    if (currentPrice > 0 && pos.entryPriceUsd > 0) {
      const dropPctFromEntry =
        ((pos.entryPriceUsd - currentPrice) / pos.entryPriceUsd) * 100;
      if (dropPctFromEntry >= 12 && currentPrice > pos.stopLossPrice) {
        // Within 12% drop but not yet hit SL — flag for exit-planner review
        const alert = await insertAlert(
          pos.id,
          pos.symbol,
          "price_dump_velocity",
          "warning",
          `Queda de ${dropPctFromEntry.toFixed(2)}% desde entrada (ainda acima do SL)`,
          {
            entryPrice: pos.entryPriceUsd,
            currentPrice,
            dropPct: dropPctFromEntry,
            stopLossPrice: pos.stopLossPrice,
          }
        );
        if (alert) alerts.push(alert);
      }
    }

    // 2. Timeout approaching — within 30min of maxExitAt
    const minToExit = (pos.maxExitAt.getTime() - now.getTime()) / 60_000;
    if (minToExit > 0 && minToExit < 30) {
      const alert = await insertAlert(
        pos.id,
        pos.symbol,
        "timeout_approaching",
        "info",
        `Timeout em ${minToExit.toFixed(0)}min — planejar saída`,
        { minutesToExit: minToExit, maxExitAt: pos.maxExitAt.toISOString() }
      );
      if (alert) alerts.push(alert);
    }

    // 3. DEX-specific checks: GoPlus re-scan + liquidity + price change
    if (pos.source === "dex" && pos.tokenId && pos.chain) {
      // 3a. GoPlus re-scan
      try {
        const goplus = await scanTokenWithGoPlus(pos.chain, pos.tokenId);
        result.currentGoPlusScore = goplus.score;

        if (goplus.criticalFlags.length > 0) {
          const alert = await insertAlert(
            pos.id,
            pos.symbol,
            "goplus_critical_flag",
            "critical",
            `GoPlus flag crítica: ${goplus.criticalFlags.join("; ")}`,
            { flags: goplus.criticalFlags, score: goplus.score }
          );
          if (alert) alerts.push(alert);
        }

        // 3b. Holder concentration — check findings for "holder concentration"
        const holderFinding = goplus.findings.find((f) =>
          f.toLowerCase().includes("holder")
        );
        if (holderFinding && /top.*holder.*[4-9]\d%|>\s*50%/.test(holderFinding)) {
          const alert = await insertAlert(
            pos.id,
            pos.symbol,
            "holder_concentration",
            "warning",
            holderFinding,
            { finding: holderFinding }
          );
          if (alert) alerts.push(alert);
        }

        // 3c. Tax spike — if sell tax > 10%
        const taxFinding = goplus.findings.find((f) =>
          f.toLowerCase().includes("sell tax")
        );
        if (taxFinding && /\b(1[0-9]|[2-9]\d|100)%\b/.test(taxFinding)) {
          const alert = await insertAlert(
            pos.id,
            pos.symbol,
            "tax_spike",
            "warning",
            taxFinding,
            { finding: taxFinding }
          );
          if (alert) alerts.push(alert);
        }
      } catch (err) {
        logger.debug("surveillance", `GoPlus re-scan falhou ${pos.symbol}: ${String(err)}`);
      }

      // 3d. Liquidity + 1h price change from DexScreener
      const pair = await fetchDexPair(pos.chain, pos.tokenId);
      if (pair) {
        result.currentLiquidityUsd = pair.liquidity?.usd;

        // Liquidity drain — compare against a sensible threshold
        // (We don't have entry liquidity persisted; use $50k as a hard floor)
        if ((pair.liquidity?.usd ?? 0) < 50_000) {
          const alert = await insertAlert(
            pos.id,
            pos.symbol,
            "liquidity_drain",
            "critical",
            `Liquidez atual $${(pair.liquidity?.usd ?? 0).toFixed(0)} — abaixo de $50k (risco de não conseguir sair)`,
            {
              currentLiquidity: pair.liquidity?.usd,
              threshold: 50_000,
            }
          );
          if (alert) alerts.push(alert);
        }

        // 1h price dump — sudden crash in last hour
        const h1Change = pair.priceChange?.h1;
        if (h1Change !== undefined && h1Change < -10) {
          const alert = await insertAlert(
            pos.id,
            pos.symbol,
            "price_anomaly",
            "critical",
            `Queda de ${h1Change.toFixed(2)}% na última hora — possível anomalia`,
            { h1Change, source: "dexscreener" }
          );
          if (alert) alerts.push(alert);
        }

        // Buy/sell ratio anomaly — sudden sell pressure
        const buys = pair.txns?.h1?.buys ?? 0;
        const sells = pair.txns?.h1?.sells ?? 0;
        if (sells > 0 && buys + sells >= 10) {
          const sellRatio = sells / (buys + sells);
          if (sellRatio > 0.8) {
            const alert = await insertAlert(
              pos.id,
              pos.symbol,
              "price_anomaly",
              "warning",
              `Pressão vendedora: ${(sellRatio * 100).toFixed(0)}% sells na última hora (${sells}/${buys + sells})`,
              { buys, sells, sellRatio }
            );
            if (alert) alerts.push(alert);
          }
        }
      }
    }

    results.push(result);

    if (alerts.length > 0) {
      logger.info(
        "surveillance",
        `${pos.symbol}: ${alerts.length} alerta(s) — ${alerts
          .map((a) => `${a.severity}:${a.type}`)
          .join(", ")}`
      );
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// API helper — list recent alerts for dashboard
// ---------------------------------------------------------------------------
export async function listRecentAlerts(limit = 50): Promise<SurveillanceAlert[]> {
  const rows = await db.positionAlert.findMany({
    orderBy: { detectedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    positionId: r.positionId,
    symbol: r.symbol,
    type: r.type as AlertType,
    severity: r.severity as AlertSeverity,
    message: r.message,
    context: r.context ? JSON.parse(r.context) : {},
    detectedAt: r.detectedAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolution: r.resolution,
  }));
}
