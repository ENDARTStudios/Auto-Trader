"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { LogRow } from "@/hooks/use-trading-data";

interface LogsConsoleProps {
  logs: LogRow[];
  isLoading?: boolean;
  className?: string;
  /** max height in px; defaults to fill parent */
  maxHeight?: number;
}

/* Source → accent class (matches the operator's color map) */
const SOURCE_ACCENT: Record<string, string> = {
  engine: "accent-system",
  risk: "accent-sell",
  scam: "accent-ai",
  cex: "accent-chain",
  dex: "accent-chain",
  portfolio: "accent-buy",
  api: "accent-system",
  selector: "accent-ai",
  market: "accent-system",
  ai: "accent-ai",
  goplus: "accent-ai",
  site: "accent-system",
  surveillance: "accent-warn",
  exit_planner: "accent-ai",
  rising: "accent-chain",
  scout: "accent-system",
  platform: "accent-system",
};

function getSourceClass(source: string): string {
  return SOURCE_ACCENT[source] ?? "accent-neutral";
}

/**
 * LogsConsole — monospace log stream rendered as a console.
 *
 * Layout per line:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ 17:41:05   ENGINE     Pair DRV/USDT skipped (no price)     │
 *   │ 17:41:07   PIPELINE   Simulation OK                        │
 *   │ 17:41:08   SIGNER     Request accepted                     │
 *   │ 17:41:09   RPC        Broadcast success                    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * - Monospace font, ~11px
 * - Continuous scroll (newest at top, autoscrolls)
 * - Color-coded by level: debug=muted, info=neutral, warn=amber, error=red
 * - Source badge colored per category (engine=blue, blockchain=cyan, etc.)
 * - Compact line height for high density
 */
export function LogsConsole({ logs, isLoading, className, maxHeight }: LogsConsoleProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Sort newest-first so the latest is always at the top
  const sorted = React.useMemo(() => {
    return [...logs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [logs]);

  return (
    <div className={cn("ws-panel ws-panel-l3 rounded-lg flex flex-col", className)}>
      <div className="ws-panel-header">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400 status-dot-pulse text-emerald-400" />
          <span className="ws-panel-title">Logs</span>
          <span className="ws-panel-subtitle">· console · {logs.length}</span>
        </div>
        <span className="label-mono text-[9px] text-muted-foreground">STREAM</span>
      </div>

      <div
        ref={containerRef}
        className="console flex-1 mx-2 mb-2"
        style={{ maxHeight: maxHeight ?? 320 }}
      >
        {isLoading && logs.length === 0 ? (
          <div className="text-center text-[10px] text-muted-foreground label-mono py-4">
            booting console…
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center text-[10px] text-muted-foreground label-mono py-4">
            no log entries yet.
          </div>
        ) : (
          sorted.map((l) => {
            const ts = new Date(l.createdAt);
            const time = ts.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            const sourceClass = getSourceClass(l.source);
            return (
              <div key={l.id} className={cn("console-line", `level-${l.level}`)}>
                <span className="console-time">{time}</span>
                <span className={cn("console-source bg-muted/40", sourceClass)}>
                  {l.source.toUpperCase()}
                </span>
                <span className="console-msg">
                  {l.message}
                  {l.context && (
                    <span className="text-muted-foreground/60 ml-1">· {l.context}</span>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
