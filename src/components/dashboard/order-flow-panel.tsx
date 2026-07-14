"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { PositionRow, LogRow } from "@/hooks/use-trading-data";

interface OrderFlowPanelProps {
  positions: PositionRow[];
  logs: LogRow[];
  isLoading?: boolean;
  className?: string;
  maxHeight?: number;
}

export interface OrderTick {
  id: string;
  side: "BUY" | "SELL" | "OPEN" | "CLOSE" | "SKIP" | "EXIT";
  symbol: string;
  amountUsd?: number;
  price?: number;
  reason?: string;
  timestamp: string;
}

/**
 * OrderFlowPanel — execution tick stream.
 *
 * Derives a vertical tick stream from positions + logs:
 *   - Position entry → BUY OPEN tick (green accent)
 *   - Position exit → SELL CLOSE tick (red accent, includes PnL if available)
 *   - Engine log "skipped" → SKIP tick (amber accent)
 *
 * Each tick is a compact row with side label + symbol + meta + time.
 * Newest at top, animated entry, vertical scroll.
 */
export function OrderFlowPanel({
  positions,
  logs,
  isLoading,
  className,
  maxHeight,
}: OrderFlowPanelProps) {
  const ticks = React.useMemo<OrderTick[]>(() => {
    const result: OrderTick[] = [];

    // From positions — entries and exits
    for (const p of positions.slice(0, 30)) {
      result.push({
        id: `entry-${p.id}`,
        side: "OPEN",
        symbol: p.symbol,
        amountUsd: p.entryAmountUsd,
        price: p.entryPriceUsd,
        reason: p.source === "cex" ? "cex entry" : `dex entry · ${p.chain ?? "—"}`,
        timestamp: p.entryAt,
      });
      if (p.exitAt && p.exitReason) {
        result.push({
          id: `exit-${p.id}`,
          side: "CLOSE",
          symbol: p.symbol,
          amountUsd: p.exitAmountUsd ?? undefined,
          price: p.exitPriceUsd ?? undefined,
          reason: `${p.exitReason}${p.pnlUsd != null ? ` · pnl ${p.pnlUsd >= 0 ? "+" : ""}$${p.pnlUsd.toFixed(2)}` : ""}`,
          timestamp: p.exitAt,
        });
      }
    }

    // From logs — skipped candidates
    for (const l of logs) {
      const lower = l.message.toLowerCase();
      if (lower.includes("skip") || lower.includes("rejected") || lower.includes("blocked")) {
        // Try to extract symbol from message
        const symbolMatch = l.message.match(/\b([A-Z]{2,10})\b/);
        result.push({
          id: `log-${l.id}`,
          side: "SKIP",
          symbol: symbolMatch?.[1] ?? "—",
          reason: l.message.slice(0, 80),
          timestamp: l.createdAt,
        });
      }
    }

    // Sort newest first
    return result
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 50);
  }, [positions, logs]);

  const sideAccent: Record<OrderTick["side"], string> = {
    BUY: "accent-buy",
    OPEN: "accent-buy",
    SELL: "accent-sell",
    CLOSE: "accent-sell",
    SKIP: "accent-warn",
    EXIT: "accent-sell",
  };

  return (
    <div className={cn("ws-panel ws-panel-l3 rounded-lg flex flex-col", className)}>
      <div className="ws-panel-header">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-cyan-400 status-dot-pulse text-cyan-400" />
          <span className="ws-panel-title">Order Flow</span>
          <span className="ws-panel-subtitle">· {ticks.length} ticks</span>
        </div>
        <span className="label-mono text-[9px] text-muted-foreground">EXEC</span>
      </div>

      <div
        className="flex-1 overflow-y-auto mx-2 mb-2 mt-1 pr-1"
        style={{ maxHeight: maxHeight ?? 320 }}
      >
        {isLoading && ticks.length === 0 ? (
          <div className="text-center text-[10px] text-muted-foreground label-mono py-4">
            waiting for trades…
          </div>
        ) : ticks.length === 0 ? (
          <div className="text-center text-[10px] text-muted-foreground label-mono py-4">
            no execution events yet.
          </div>
        ) : (
          ticks.map((t) => {
            const ts = new Date(t.timestamp);
            const time = ts.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            return (
              <div key={t.id} className={cn("order-tick", sideAccent[t.side])}>
                <span className="order-tick-side">{t.side}</span>
                <span className="order-tick-meta">
                  <span className="text-foreground font-semibold">{t.symbol}</span>
                  {t.amountUsd != null && (
                    <span className="text-muted-foreground ml-1">
                      ${t.amountUsd.toFixed(2)}
                    </span>
                  )}
                  {t.reason && (
                    <span className="text-muted-foreground/70 ml-1">· {t.reason}</span>
                  )}
                </span>
                <span className="order-tick-time">{time}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
