// Watchlist module — operator-curated tokens to monitor WITHOUT auto-trading.
//
// Capabilities:
//   • list / add / update / remove watchlist tokens
//   • refreshPrices() — called from engine.tick() each loop; fetches current
//     price for every enabled watchlist token via price-feed.ts, populates
//     addedPriceUsd on first sight, updates lastPriceUsd/lastCheckedAt,
//     and logs a watchlist_alert event when |delta%| first crosses the
//     configured threshold (one-shot per cross to avoid spamming).
//   • analyzeToken(id) — runs synthesizeNewsSentiment via ai-agent.ts and
//     returns the AIInsightResult (already persisted to AIInsight table by
//     the agent). Used by the "Analyze now" button in the dashboard.
//
// All watchlist data is independent from Position/Round/ScamReport — it does
// not auto-trade. AI insights generated from watchlist analysis are tagged
// with the standard agentRole="news_sentiment" and the token's symbol so they
// show up in the AI Agents tab for full audit trail.

import { db } from "@/lib/db";
import { logger } from "./logger";
import { fetchPriceUsd } from "./price-feed";
import { synthesizeNewsSentiment, type AIInsightResult } from "./ai-agent";
import type { TokenCandidate, TokenSource } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface WatchlistTokenInput {
  symbol: string;
  source: TokenSource;
  chain?: string | null;
  tokenId?: string | null;
  notes?: string | null;
  alertThresholdPct?: number;
  enabled?: boolean;
}

export interface WatchlistTokenRow {
  id: string;
  symbol: string;
  source: TokenSource;
  chain: string | null;
  tokenId: string | null;
  notes: string | null;
  alertThresholdPct: number;
  enabled: boolean;
  addedPriceUsd: number | null;
  lastPriceUsd: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Derived (computed in API layer for convenience)
  changePct: number | null;     // (last - added) / added * 100
  alertTriggered: boolean;      // |changePct| >= alertThresholdPct
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toRow(
  w: Awaited<ReturnType<typeof db.watchlistToken.findFirst>>
): WatchlistTokenRow | null {
  if (!w) return null;
  const added = w.addedPriceUsd ?? null;
  const last = w.lastPriceUsd ?? null;
  const changePct =
    added && added > 0 && last !== null
      ? ((last - added) / added) * 100
      : null;
  return {
    id: w.id,
    symbol: w.symbol,
    source: w.source as TokenSource,
    chain: w.chain,
    tokenId: w.tokenId,
    notes: w.notes,
    alertThresholdPct: w.alertThresholdPct,
    enabled: w.enabled,
    addedPriceUsd: added,
    lastPriceUsd: last,
    lastCheckedAt: w.lastCheckedAt ? w.lastCheckedAt.toISOString() : null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    changePct,
    alertTriggered:
      changePct !== null && Math.abs(changePct) >= w.alertThresholdPct,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export async function listWatchlist(): Promise<WatchlistTokenRow[]> {
  const rows = await db.watchlistToken.findMany({
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map((w) => toRow(w)!).filter(Boolean);
}

export async function addWatchlist(
  input: WatchlistTokenInput
): Promise<WatchlistTokenRow> {
  const created = await db.watchlistToken.create({
    data: {
      symbol: input.symbol.toUpperCase().trim(),
      source: input.source,
      chain: input.source === "dex" ? (input.chain ?? null) : null,
      tokenId: input.source === "dex" ? (input.tokenId ?? null) : null,
      notes: input.notes ?? null,
      alertThresholdPct: Math.max(0, Math.min(100, input.alertThresholdPct ?? 10)),
      enabled: input.enabled ?? true,
    },
  });
  // Eagerly fetch the initial price so the UI has something to show
  try {
    const price = await fetchPriceUsd(
      created.symbol,
      created.source as TokenSource,
      created.chain,
      created.tokenId
    );
    if (price > 0) {
      await db.watchlistToken.update({
        where: { id: created.id },
        data: {
          addedPriceUsd: price,
          lastPriceUsd: price,
          lastCheckedAt: new Date(),
        },
      });
    }
  } catch (err) {
    logger.warn(
      "engine",
      `Watchlist: preço inicial falhou para ${created.symbol}`,
      { error: String(err) }
    );
  }
  const fresh = await db.watchlistToken.findUnique({ where: { id: created.id } });
  logger.info(
    "engine",
    `Watchlist: token adicionado — ${created.symbol} (${created.source})`
  );
  return toRow(fresh)!;
}

export async function updateWatchlist(
  id: string,
  patch: Partial<Pick<WatchlistTokenRow, "notes" | "alertThresholdPct" | "enabled">>
): Promise<WatchlistTokenRow | null> {
  const data: Record<string, unknown> = {};
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.alertThresholdPct !== undefined) {
    data.alertThresholdPct = Math.max(0, Math.min(100, patch.alertThresholdPct));
  }
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (Object.keys(data).length === 0) {
    return toRow(await db.watchlistToken.findUnique({ where: { id } }));
  }
  await db.watchlistToken.update({ where: { id }, data });
  const fresh = await db.watchlistToken.findUnique({ where: { id } });
  return toRow(fresh);
}

export async function removeWatchlist(id: string): Promise<boolean> {
  try {
    await db.watchlistToken.delete({ where: { id } });
    logger.info("engine", `Watchlist: token removido (id=${id})`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Price refresh — invoked from engine.tick() each loop.
//
// Iterates all enabled watchlist tokens, fetches current price, populates
// addedPriceUsd on first sight, and logs a one-shot alert when the price
// crosses the configured threshold (positive OR negative).
// ---------------------------------------------------------------------------
const alertedSet = new Set<string>(); // in-memory: tokens that already alerted since last reset

export async function refreshWatchlistPrices(): Promise<void> {
  const tokens = await db.watchlistToken.findMany({
    where: { enabled: true },
  });
  if (tokens.length === 0) return;

  const BATCH = 6;
  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (w) => {
        try {
          const price = await fetchPriceUsd(
            w.symbol,
            w.source as TokenSource,
            w.chain,
            w.tokenId
          );
          if (price <= 0) return;
          const now = new Date();

          // Populate addedPriceUsd on first successful fetch
          const addedPrice = w.addedPriceUsd ?? price;

          // Detect threshold crossing (one-shot)
          if (addedPrice > 0) {
            const pct = ((price - addedPrice) / addedPrice) * 100;
            const breached = Math.abs(pct) >= w.alertThresholdPct;
            const key = w.id;
            if (breached && !alertedSet.has(key)) {
              alertedSet.add(key);
              const dir = pct > 0 ? "↑" : "↓";
              logger.warn(
                "engine",
                `Watchlist ALERT: ${w.symbol} ${dir} ${pct.toFixed(2)}% (threshold ±${w.alertThresholdPct}%) — added $${addedPrice.toFixed(6)} → $${price.toFixed(6)}`,
                { symbol: w.symbol, pct, threshold: w.alertThresholdPct }
              );
            } else if (!breached && alertedSet.has(key)) {
              // Reset so we can alert again on a fresh cross
              alertedSet.delete(key);
            }
          }

          await db.watchlistToken.update({
            where: { id: w.id },
            data: {
              addedPriceUsd: addedPrice,
              lastPriceUsd: price,
              lastCheckedAt: now,
            },
          });
        } catch (err) {
          logger.warn(
            "engine",
            `Watchlist: refresh falhou para ${w.symbol}`,
            { error: String(err) }
          );
        }
      })
    );
  }
}

// ---------------------------------------------------------------------------
// On-demand AI analysis — runs synthesizeNewsSentiment (the same agent used
// during SCOUT) but on a watchlist token. The insight is persisted to the
// AIInsight table inside callAgent() so it shows up in the AI Agents tab.
// ---------------------------------------------------------------------------
export async function analyzeWatchlistToken(
  id: string
): Promise<AIInsightResult> {
  const w = await db.watchlistToken.findUnique({ where: { id } });
  if (!w) {
    throw new Error("Token não encontrado na watchlist");
  }

  // Refresh price immediately so the analyst has fresh data
  let currentPrice = w.lastPriceUsd ?? 0;
  try {
    const fresh = await fetchPriceUsd(
      w.symbol,
      w.source as TokenSource,
      w.chain,
      w.tokenId
    );
    if (fresh > 0) {
      currentPrice = fresh;
      await db.watchlistToken.update({
        where: { id: w.id },
        data: { lastPriceUsd: fresh, lastCheckedAt: new Date() },
      });
    }
  } catch {
    /* keep lastPriceUsd */
  }

  const candidate: TokenCandidate = {
    symbol: w.symbol,
    source: w.source as TokenSource,
    chain: w.chain ?? undefined,
    tokenId: w.tokenId ?? undefined,
    priceUsd: currentPrice,
    volume24hUsd: 0,
    liquidityUsd: 0,
  };

  logger.info("engine", `Watchlist: análise de IA solicitada para ${w.symbol}`);
  const result = await synthesizeNewsSentiment(candidate);
  return result;
}

// ---------------------------------------------------------------------------
// Reset alerts (used by the UI "reset alert" button so the operator can
// re-receive the alert after acknowledging it).
// ---------------------------------------------------------------------------
export async function resetAlert(id: string): Promise<void> {
  alertedSet.delete(id);
  // Also reset addedPriceUsd to current lastPrice so subsequent alerts are
  // measured from "now" — gives the operator a fresh baseline.
  const w = await db.watchlistToken.findUnique({ where: { id } });
  if (w && w.lastPriceUsd !== null) {
    await db.watchlistToken.update({
      where: { id },
      data: { addedPriceUsd: w.lastPriceUsd },
    });
  }
}
