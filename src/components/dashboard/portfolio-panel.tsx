"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { PositionRow } from "@/hooks/use-trading-data";

interface PortfolioPanelProps {
  positions: PositionRow[];
  isLoading?: boolean;
  className?: string;
  maxHeight?: number;
}

function fmtUsd(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtUsdCompact(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(2)}k`;
  return fmtUsd(n, 2);
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

/**
 * PortfolioPanel — Level-2 panel showing open positions as compact rows.
 *
 * Layout: PAIR | QTY | ENTRY | CURRENT | uP&L | SCAM
 *
 * Color: P&L drives the row accent (positive=buy, negative=sell).
 * Compact density, monospace numbers, optional scroll.
 */
export function PortfolioPanel({
  positions,
  isLoading,
  className,
  maxHeight,
}: PortfolioPanelProps) {
  return (
    <div className={cn("ws-panel ws-panel-l1 rounded-lg flex flex-col", className)}>
      <div className="ws-panel-header">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400 status-dot-pulse text-emerald-400" />
          <span className="ws-panel-title">Portfolio</span>
          <span className="ws-panel-subtitle">· {positions.length} open positions</span>
        </div>
        <span className="label-mono text-[9px] text-muted-foreground">LIVE</span>
      </div>

      {/* Column headers */}
      <div
        className="portfolio-row-header grid"
        style={{ gridTemplateColumns: "1.2fr 0.8fr 0.9fr 0.9fr 0.7fr 0.9fr", gap: "0.5rem" }}
      >
        <span>PAIR</span>
        <span className="text-right">QTY</span>
        <span className="text-right">ENTRY</span>
        <span className="text-right">CURRENT</span>
        <span className="text-right">uP&L</span>
        <span className="text-right">SCAM</span>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ maxHeight: maxHeight ?? 320 }}>
        {isLoading && positions.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground label-mono">
            Carregando posições…
          </div>
        ) : positions.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground label-mono">
            Nenhuma posição aberta.
          </div>
        ) : (
          positions.map((p) => {
            const pnl = p.unrealizedPnlUsd ?? 0;
            const pnlPct = p.unrealizedPnlPct ?? 0;
            const isProfit = pnl >= 0;
            return (
              <div
                key={p.id}
                className={cn("portfolio-row", isProfit ? "accent-buy" : "accent-sell")}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-[12px] text-foreground truncate">
                    {p.symbol}
                  </div>
                  <div className="label-mono text-[8px] text-muted-foreground tracking-wider">
                    {p.source}
                    {p.chain && ` · ${p.chain}`}
                  </div>
                </div>
                <span className="text-right text-[11px] text-muted-foreground tabular">
                  {p.entryQty.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                </span>
                <span className="text-right text-[11px] text-foreground/80 tabular">
                  ${fmtPrice(p.entryPriceUsd)}
                </span>
                <span className="text-right text-[11px] text-foreground/80 tabular">
                  {p.currentPriceUsd ? `$${fmtPrice(p.currentPriceUsd)}` : "—"}
                </span>
                <span
                  className="text-right text-[11px] font-bold tabular flex items-center justify-end gap-0.5"
                  style={{ color: isProfit ? "var(--color-buy)" : "var(--color-sell)" }}
                >
                  {isProfit ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
                  {pnl >= 0 ? "+" : ""}
                  {fmtUsdCompact(pnl)}
                  <span className="text-[9px] opacity-70 ml-0.5">
                    ({pnlPct >= 0 ? "+" : ""}
                    {pnlPct.toFixed(1)}%)
                  </span>
                </span>
                <span className="text-right">
                  <span
                    className={cn(
                      "label-mono text-[9px] font-bold px-1.5 py-0.5 rounded border tabular",
                      p.scamScore >= 80
                        ? "bg-sell-10 text-sell border-sell-30"
                        : p.scamScore >= 60
                        ? "bg-warn-10 text-warn border-warn-30"
                        : "bg-buy-10 text-buy border-buy-30"
                    )}
                  >
                    {p.scamScore}
                  </span>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
