"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
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
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(2)}k`;
  return fmtUsd(n, 2);
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

function fmtQty(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

/**
 * PortfolioPanel — institutional professional positions table.
 *
 * Columns (9):
 *   PAIR · SIDE · ENTRY · MARK · SIZE · PnL$ · PnL% · TIME · STATUS
 *
 * Color rule (per operator spec): only PnL columns are colored
 * (green positive / red negative). All other cells stay neutral.
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

      <div className="flex-1 overflow-auto" style={{ maxHeight: maxHeight ?? 360 }}>
        <table className="portfolio-table">
          <thead>
            <tr>
              <th className="text-left">PAIR</th>
              <th>SIDE</th>
              <th>ENTRY</th>
              <th>MARK</th>
              <th>SIZE</th>
              <th>PnL $</th>
              <th>PnL %</th>
              <th>TIME</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && positions.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-[11px] text-muted-foreground label-mono py-6">
                  Carregando posições…
                </td>
              </tr>
            ) : positions.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-[11px] text-muted-foreground label-mono py-6">
                  Nenhuma posição aberta.
                </td>
              </tr>
            ) : (
              positions.map((p) => {
                const pnl = p.unrealizedPnlUsd ?? 0;
                const pnlPct = p.unrealizedPnlPct ?? 0;
                const pnlClass = pnl > 0 ? "pnl-pos" : pnl < 0 ? "pnl-neg" : "pnl-flat";
                const mark = p.currentPriceUsd ?? p.entryPriceUsd;
                // Status inference: open=OPEN, otherwise derive from exitReason
                let statusLabel = "OPEN";
                let statusClass = "status-open";
                if (p.status && p.status.toLowerCase() !== "open") {
                  if (p.status.toLowerCase().includes("clos")) {
                    statusLabel = "CLOSED";
                    statusClass = "status-closing";
                  } else if (p.status.toLowerCase().includes("error") || p.status.toLowerCase().includes("fail")) {
                    statusLabel = "ERROR";
                    statusClass = "status-error";
                  } else {
                    statusLabel = p.status.toUpperCase();
                    statusClass = "status-closing";
                  }
                }
                return (
                  <tr key={p.id}>
                    <td className="text-left">
                      <div className="flex flex-col leading-tight">
                        <span className="font-semibold text-[11.5px] text-foreground">
                          {p.symbol}
                        </span>
                        <span className="label-mono text-[8px] text-muted-foreground tracking-wider">
                          {p.source}
                          {p.chain && ` · ${p.chain}`}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="side-buy">LONG</span>
                    </td>
                    <td>${fmtPrice(p.entryPriceUsd)}</td>
                    <td>${fmtPrice(mark)}</td>
                    <td>{fmtQty(p.entryQty)}</td>
                    <td className={pnlClass}>
                      {pnl >= 0 ? "+" : ""}{fmtUsdCompact(pnl)}
                    </td>
                    <td className={pnlClass}>
                      {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                    </td>
                    <td className="text-muted-foreground">
                      {fmtTimeAgo(p.entryAt)}
                    </td>
                    <td>
                      <span className={cn("status-pill", statusClass)}>
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
