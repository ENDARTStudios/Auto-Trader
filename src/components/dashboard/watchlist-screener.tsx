"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Search } from "lucide-react";

export interface ScreenerRow {
  pair: string;
  price: number;
  change1m: number;
  change5m: number;
  vol24h: number;
  source?: "cex" | "dex";
  chain?: string;
  /** Bid-ask spread in basis points (DEX) or pips (CEX). 0 if unknown. */
  spreadBps?: number;
  /** Pool liquidity USD (DEX) or depth USD (CEX). 0 if unknown. */
  liquidityUsd?: number;
  /** Token age in days (DEX tokens only). */
  ageDays?: number;
  /** Risk classification 0-100 (higher = riskier). Derived from scam score. */
  riskScore?: number;
  /** Composite signal score -100..100. */
  signalScore?: number;
}

interface WatchlistScreenerProps {
  rows: ScreenerRow[];
  isLoading?: boolean;
  className?: string;
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

function fmtVol(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function fmtLiq(n: number): string {
  if (n <= 0) return "—";
  return `$${fmtVol(n)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function fmtAge(days?: number): string {
  if (days == null) return "—";
  if (days < 1) return "<1d";
  if (days < 30) return `${Math.floor(days)}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function riskClass(score?: number): string {
  if (score == null) return "screener-risk-med";
  if (score < 40) return "screener-risk-low";
  if (score < 70) return "screener-risk-med";
  return "screener-risk-high";
}

function riskLabel(score?: number): string {
  if (score == null) return "—";
  if (score < 40) return "LOW";
  if (score < 70) return "MED";
  return "HIGH";
}

/**
 * WatchlistScreener — institutional token screener.
 *
 * Columns (9): PAIR · PRICE · 1m · 5m · VOL · SPREAD · LIQ · AGE · RISK
 * Plus inline SCORE badge next to PAIR.
 */
export function WatchlistScreener({ rows, isLoading, className }: WatchlistScreenerProps) {
  const [filter, setFilter] = React.useState("");
  const filtered = React.useMemo(() => {
    if (!filter.trim()) return rows;
    const f = filter.toLowerCase();
    return rows.filter((r) => r.pair.toLowerCase().includes(f));
  }, [rows, filter]);

  return (
    <div className={cn("ws-panel ws-panel-l3 rounded-lg flex flex-col", className)}>
      {/* Panel header */}
      <div className="ws-panel-header">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400 status-dot-pulse text-emerald-400" />
          <span className="ws-panel-title">Watchlist</span>
          <span className="ws-panel-subtitle">· screener · {rows.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Search className="size-3 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter pair…"
            className="bg-transparent text-[10px] label-mono outline-none border-b border-transparent focus:border-emerald-500/40 text-foreground placeholder:text-muted-foreground/60 w-24"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto" style={{ maxHeight: 360 }}>
        <table className="portfolio-table">
          <thead>
            <tr>
              <th className="text-left">PAIR</th>
              <th>PRICE</th>
              <th>1m</th>
              <th>5m</th>
              <th>VOL</th>
              <th>SPREAD</th>
              <th>LIQ</th>
              <th>AGE</th>
              <th>RISK</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-[11px] text-muted-foreground label-mono py-6">
                  Carregando…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-[11px] text-muted-foreground label-mono py-6">
                  {filter ? "Nenhum par corresponde ao filtro." : "Watchlist vazia."}
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => {
                const chg1Color = r.change1m > 0 ? "pnl-pos" : r.change1m < 0 ? "pnl-neg" : "pnl-flat";
                const chg5Color = r.change5m > 0 ? "pnl-pos" : r.change5m < 0 ? "pnl-neg" : "pnl-flat";
                return (
                  <tr key={`${r.pair}-${i}`}>
                    <td className="text-left">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="flex flex-col leading-tight min-w-0">
                          <span className="font-semibold text-[11px] text-foreground truncate">
                            {r.pair}
                          </span>
                          <span className="label-mono text-[8px] text-muted-foreground tracking-wider">
                            {r.source ?? "—"}
                            {r.chain && ` · ${r.chain}`}
                          </span>
                        </div>
                        {typeof r.signalScore === "number" && (
                          <span
                            className={cn(
                              "screener-row-score shrink-0",
                              r.signalScore >= 50
                                ? "screener-risk-low"
                                : r.signalScore >= 0
                                ? "screener-risk-med"
                                : "screener-risk-high"
                            )}
                            title={`Signal score: ${r.signalScore}`}
                          >
                            {r.signalScore > 0 ? "+" : ""}
                            {r.signalScore}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>${fmtPrice(r.price)}</td>
                    <td className={chg1Color}>
                      <span className="inline-flex items-center justify-end gap-0.5">
                        {r.change1m > 0 ? <ArrowUp className="size-2.5" /> : r.change1m < 0 ? <ArrowDown className="size-2.5" /> : null}
                        {fmtPct(r.change1m)}
                      </span>
                    </td>
                    <td className={chg5Color}>
                      <span className="inline-flex items-center justify-end gap-0.5">
                        {r.change5m > 0 ? <ArrowUp className="size-2.5" /> : r.change5m < 0 ? <ArrowDown className="size-2.5" /> : null}
                        {fmtPct(r.change5m)}
                      </span>
                    </td>
                    <td className="text-muted-foreground">${fmtVol(r.vol24h)}</td>
                    <td className="text-muted-foreground">
                      {r.spreadBps != null && r.spreadBps > 0 ? `${r.spreadBps.toFixed(1)}bp` : "—"}
                    </td>
                    <td className="text-muted-foreground">{fmtLiq(r.liquidityUsd ?? 0)}</td>
                    <td className="text-muted-foreground">{fmtAge(r.ageDays)}</td>
                    <td>
                      <span
                        className={cn(
                          "screener-row-score",
                          riskClass(r.riskScore)
                        )}
                      >
                        {riskLabel(r.riskScore)}
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
