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

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

/**
 * WatchlistScreener — institutional-grade token screener.
 *
 * Layout: PAIR | PRICE | 1m | 5m | VOL
 *
 * Color-coded change cells:
 *   - Positive change → buy/emerald
 *   - Negative change → sell/red
 *   - Zero / null → muted
 *
 * Compact rows with monospaced numbers for instant scanning.
 * Source/chain badge inline with pair name.
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

      {/* Column headers */}
      <div className="screener-row-header grid" style={{ gridTemplateColumns: "1.4fr 1fr 0.7fr 0.7fr 0.9fr", gap: "0.5rem" }}>
        <span>PAIR</span>
        <span className="text-right">PRICE</span>
        <span className="text-right">1m</span>
        <span className="text-right">5m</span>
        <span className="text-right">VOL</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: 360 }}>
        {isLoading && rows.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground label-mono">
            Carregando…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground label-mono">
            {filter ? "Nenhum par corresponde ao filtro." : "Watchlist vazia."}
          </div>
        ) : (
          filtered.map((r, i) => {
            const chg1Color = r.change1m > 0 ? "text-buy" : r.change1m < 0 ? "text-sell" : "text-muted-foreground";
            const chg5Color = r.change5m > 0 ? "text-buy" : r.change5m < 0 ? "text-sell" : "text-muted-foreground";
            return (
              <div key={`${r.pair}-${i}`} className="screener-row">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="screener-pair truncate">{r.pair}</span>
                  {r.source && (
                    <span
                      className={cn(
                        "label-mono text-[8px] px-1 rounded shrink-0",
                        r.source === "cex" ? "bg-chain-10 text-chain" : "bg-ai-10 text-ai"
                      )}
                    >
                      {r.source}
                    </span>
                  )}
                  {r.chain && (
                    <span className="label-mono text-[8px] text-muted-foreground/70 shrink-0">
                      {r.chain}
                    </span>
                  )}
                </div>
                <span className="screener-price">${fmtPrice(r.price)}</span>
                <span className={cn("screener-chg", chg1Color)}>
                  {r.change1m > 0 ? <ArrowUp className="inline size-2.5 mr-0.5" /> : r.change1m < 0 ? <ArrowDown className="inline size-2.5 mr-0.5" /> : null}
                  {fmtPct(r.change1m)}
                </span>
                <span className={cn("screener-chg", chg5Color)}>
                  {r.change5m > 0 ? <ArrowUp className="inline size-2.5 mr-0.5" /> : r.change5m < 0 ? <ArrowDown className="inline size-2.5 mr-0.5" /> : null}
                  {fmtPct(r.change5m)}
                </span>
                <span className="screener-vol">${fmtVol(r.vol24h)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
