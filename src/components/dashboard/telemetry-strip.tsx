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
 * TelemetryStrip v2 — dense grid of system telemetry tiles.
 *
 * Supports up to 18+ indicators in a responsive grid layout:
 *   - xl: 9 cols (2 rows of 9 = 18 tiles visible)
 *   - lg: 6 cols (3 rows of 6 = 18 tiles)
 *   - md: 4 cols
 *   - sm: 2 cols
 *
 * Each tile: 6px dot + tiny uppercase label + tabular value + sub-label.
 * Includes a "live" scan-line effect to convey "alive" feeling.
 */
export function TelemetryStrip({ tiles, title, className }: TelemetryStripProps) {
  return (
    <section
      className={cn(
        "terminal-card rounded-lg px-4 py-2.5 relative overflow-hidden",
        className
      )}
    >
      {/* Title row */}
      {title && (
        <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-border/40">
          <div className="flex items-center gap-2">
            <span className="health-dot ok pulse" />
            <span className="label-mono text-[10px] text-foreground font-semibold tracking-[0.2em]">
              {title}
            </span>
            <span className="label-mono text-[9px] text-muted-foreground">
              · {tiles.length} channels
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="label-mono text-[9px] text-muted-foreground/70">
              LIVE STREAM
            </span>
            <span className="size-1.5 rounded-full bg-emerald-400 status-dot-pulse text-emerald-400" />
          </div>
        </div>
      )}

      {/* Tile grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9 gap-1.5">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="telemetry-tile rounded px-2 py-1.5 flex items-center gap-1.5 min-w-0"
            title={t.sub}
          >
            <span
              className={cn(
                "health-dot shrink-0",
                healthDotClass[t.health ?? "idle"],
                t.pulse && "pulse"
              )}
            />
            <div className="flex flex-col min-w-0 leading-tight flex-1">
              <div className="flex items-center justify-between gap-1 min-w-0">
                <span className="label-mono text-[8px] text-muted-foreground truncate tracking-wider">
                  {t.label}
                </span>
                {t.sub && (
                  <span className="label-mono text-[7px] text-muted-foreground/50 shrink-0">
                    {t.sub}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "label-mono text-[11px] font-semibold tabular truncate",
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
