"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Ban, Coins, Play, Square, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ helpers */
export type Health = "ok" | "warn" | "error" | "idle";

export interface HealthIndicator {
  /** short uppercase label, e.g. "ENGINE" */
  label: string;
  /** short value, e.g. "ONLINE" or "42ms" */
  value: string;
  /** health state, drives the dot color */
  health: Health;
  /** pulse the dot when true (used for live/active indicators) */
  pulse?: boolean;
  /** optional tooltip-style detail shown under value */
  detail?: string;
}

interface TerminalHeaderProps {
  engineStatus: "stopped" | "running" | "killed" | "paused";
  engineMode: "paper" | "live";
  loopState: string;
  /** explicit health indicators row — order matters (left to right) */
  indicators: HealthIndicator[];
  /** engine actions */
  onStart: () => void;
  onStop: () => void;
  onKill: () => void;
  startDisabled?: boolean;
  stopDisabled?: boolean;
  killDisabled?: boolean;
  isStarting?: boolean;
  isStopping?: boolean;
  isKilling?: boolean;
  /** optional notification count badge */
  notificationCount?: number;
  onNotificationsClick?: () => void;
}

/* health dot color + label map */
const healthDotClass: Record<Health, string> = {
  ok: "ok",
  warn: "warn",
  error: "error",
  idle: "idle",
};

const healthLabelClass: Record<Health, string> = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  error: "text-red-300",
  idle: "text-muted-foreground",
};

/* ------------------------------------------------------------------ component */
/**
 * TerminalHeader
 *
 * The top bar of the institutional terminal.
 *
 * Layout (left → right):
 *   1. Brand block (logo glyph + "AUTO TRADER" title + tagline)
 *   2. Dense status indicator strip (Engine/RPC/Signer/Pipeline/Latency/Mode…)
 *      Each item = 6px dot + tiny label + value. High information density.
 *   3. Engine controls (Start/Stop + KILL)
 *
 * Visual identity: "Cyber Financial Terminal" — dark glass, deep elevation,
 * subtle scan-line shimmer, heartbeat on the brand glyph.
 */
export function TerminalHeader({
  engineStatus,
  engineMode,
  loopState,
  indicators,
  onStart,
  onStop,
  onKill,
  startDisabled,
  stopDisabled,
  killDisabled,
  isStarting,
  isStopping,
  isKilling,
  notificationCount,
  onNotificationsClick,
}: TerminalHeaderProps) {
  const isRunning = engineStatus === "running";
  const isKilled = engineStatus === "killed";

  return (
    <header className="sticky top-0 z-50 terminal-card rounded-none border-x-0 border-t-0 scan-line">
      {/* ---------- Row 1: brand + status strip + actions ---------- */}
      <div className="px-4 lg:px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0 shrink-0">
          <div className="relative size-8 rounded-md bg-gradient-to-br from-emerald-500/25 via-cyan-500/10 to-transparent border border-emerald-500/30 flex items-center justify-center shrink-0 heartbeat">
            <Coins className="size-4 text-emerald-400" />
            {/* tiny corner accent — feels like a power LED */}
            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-emerald-400 status-dot-pulse text-emerald-400" />
          </div>
          <div className="hidden md:block min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="text-[13px] font-semibold tracking-[0.18em] leading-none label-mono">
                AUTO TRADER
              </h1>
              <span className="text-[9px] text-muted-foreground leading-none label-mono">
                v0.3
              </span>
            </div>
            <p className="text-[9px] text-muted-foreground/80 leading-tight mt-0.5 label-mono">
              Cyber Financial Terminal
            </p>
          </div>
        </div>

        {/* Dense status indicator strip — center, only on lg+ */}
        <div className="hidden lg:flex items-center gap-0.5 flex-1 min-w-0 justify-center overflow-hidden">
          {indicators.map((ind) => (
            <div
              key={ind.label}
              className="telemetry-tile rounded px-2.5 py-1 flex items-center gap-1.5 min-w-0"
              title={ind.detail ?? ind.value}
            >
              <span
                className={cn(
                  "health-dot",
                  healthDotClass[ind.health],
                  ind.pulse && "pulse"
                )}
              />
              <div className="flex flex-col min-w-0 leading-tight">
                <span className="label-mono text-[8px] text-muted-foreground truncate">
                  {ind.label}
                </span>
                <span
                  className={cn(
                    "label-mono text-[10px] font-semibold tabular truncate",
                    healthLabelClass[ind.health]
                  )}
                >
                  {ind.value}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Engine controls + notifications */}
        <div className="flex items-center gap-1.5 shrink-0">
          {onNotificationsClick && (
            <button
              onClick={onNotificationsClick}
              className="relative size-8 rounded-md border border-border/60 bg-muted/30 hover:bg-muted/50 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Notificações"
            >
              <Bell className="size-3.5" />
              {(notificationCount ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-amber-500/30 text-amber-200 text-[9px] font-bold tabular">
                  {Math.min(notificationCount ?? 0, 99)}
                </span>
              )}
            </button>
          )}

          {!isRunning ? (
            <Button
              size="sm"
              variant="default"
              onClick={onStart}
              disabled={startDisabled || isStarting}
              className="gap-1.5 h-8 bg-emerald-500/90 hover:bg-emerald-500 text-emerald-950 font-semibold"
            >
              <Play className="size-3.5" />
              <span className="hidden sm:inline label-mono text-[10px]">START</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={onStop}
              disabled={stopDisabled || isStopping}
              className="gap-1.5 h-8"
            >
              <Square className="size-3.5" />
              <span className="hidden sm:inline label-mono text-[10px]">STOP</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onKill}
            disabled={killDisabled || isKilling}
            className="gap-1.5 h-8 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300 font-semibold"
          >
            <Ban className="size-3.5" />
            <span className="hidden sm:inline label-mono text-[10px]">KILL</span>
          </Button>
        </div>
      </div>

      {/* ---------- Row 2: kill-switch inline banner ---------- */}
      {isKilled && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-4 lg:px-6">
          <div className="h-9 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <Ban className="size-3.5 text-red-400" />
              <span className="label-mono text-red-300 text-[10px] font-semibold">
                KILL SWITCH ACTIVE
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-red-300/90 text-[11px]">{loopState}</span>
            </div>
            <span className="label-mono text-[9px] text-red-300/60">
              ENGINE HALTED · ALL POSITIONS LIQUIDATED
            </span>
          </div>
        </div>
      )}

      {/* ---------- Row 3: secondary compact strip (md + sm) ---------- */}
      {/* On smaller screens the dense strip above doesn't fit; show a compact version */}
      <div className="lg:hidden border-t border-border/40 px-4 py-1.5 flex items-center gap-3 overflow-x-auto">
        <span className="label-mono text-[9px] text-muted-foreground shrink-0">
          {engineMode.toUpperCase()}
        </span>
        <span className="text-muted-foreground/40 shrink-0">·</span>
        {indicators.slice(0, 4).map((ind) => (
          <div key={ind.label} className="flex items-center gap-1 shrink-0">
            <span
              className={cn(
                "health-dot",
                healthDotClass[ind.health],
                ind.pulse && "pulse"
              )}
            />
            <span className="label-mono text-[9px] text-muted-foreground">
              {ind.label}
            </span>
            <span
              className={cn(
                "label-mono text-[9px] font-semibold tabular",
                healthLabelClass[ind.health]
              )}
            >
              {ind.value}
            </span>
          </div>
        ))}
      </div>
    </header>
  );
}
