"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TileHealth = "ok" | "warn" | "error" | "idle";

export interface TelemetryTileData {
  /** short uppercase label, e.g. "LATENCY" or "RPC" */
  label: string;
  /** value to display, e.g. "42ms" or "OK" */
  value: React.ReactNode;
  /** optional sub-label, e.g. "p99" */
  sub?: string;
  /** health state, drives the dot color */
  health?: TileHealth;
  /** pulse the dot (for live indicators) */
  pulse?: boolean;
  /** optional accent color override — if provided, uses this for the value text */
  accent?: "emerald" | "red" | "cyan" | "amber" | "violet" | "blue" | "neutral";
}

interface TelemetryStripProps {
  tiles: TelemetryTileData[];
  /** optional section title shown on the left */
  title?: string;
  className?: string;
}

const healthDotClass: Record<TileHealth, string> = {
  ok: "ok",
  warn: "warn",
  error: "error",
  idle: "idle",
};

const accentTextMap: Record<NonNullable<TelemetryTileData["accent"]>, string> = {
  emerald: "text-emerald-300",
  red: "text-red-300",
  cyan: "text-cyan-300",
  amber: "text-amber-300",
  violet: "text-violet-300",
  blue: "text-blue-300",
  neutral: "text-foreground",
};

/**
 * TelemetryStrip — dense horizontal strip of system telemetry tiles.
 *
 * Designed to fit ~12-18 tiles per row on a wide terminal viewport.
 * Each tile: 6px dot + tiny uppercase label + tabular value.
 *
 * Use cases:
 *   - Latency / RPC / Signer / Pipeline / Health
 *   - CPU / RAM / Gas / TPS / Block / Mempool
 *   - Queue / Workers / MEV / Simulation / Approval / Liquidity
 */
export function TelemetryStrip({ tiles, title, className }: TelemetryStripProps) {
  return (
    <section
      className={cn(
        "terminal-card rounded-lg px-3 py-2 flex items-center gap-2 overflow-x-auto",
        className
      )}
    >
      {title && (
        <div className="shrink-0 flex items-center gap-1.5 pr-2 border-r border-border/40">
          <span className="health-dot ok pulse" />
          <span className="label-mono text-[9px] text-muted-foreground font-semibold tracking-wider">
            {title}
          </span>
        </div>
      )}
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="telemetry-tile rounded px-2 py-1 flex items-center gap-1.5 shrink-0 min-w-[88px]"
            title={t.sub}
          >
            <span
              className={cn(
                "health-dot",
                healthDotClass[t.health ?? "idle"],
                t.pulse && "pulse"
              )}
            />
            <div className="flex flex-col min-w-0 leading-tight">
              <span className="label-mono text-[8px] text-muted-foreground truncate">
                {t.label}
              </span>
              <span
                className={cn(
                  "label-mono text-[10px] font-semibold tabular truncate",
                  t.accent ? accentTextMap[t.accent] : "text-foreground"
                )}
              >
                {t.value}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
