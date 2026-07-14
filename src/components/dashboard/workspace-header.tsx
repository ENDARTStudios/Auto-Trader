"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Ban, Coins, Play, Square, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ types */
export type Health = "ok" | "warn" | "error" | "idle";

export interface HealthBarItem {
  label: string;
  value: string;
  health: Health;
  pulse?: boolean;
  detail?: string;
}

interface WorkspaceHeaderProps {
  engineStatus: "stopped" | "running" | "killed" | "paused";
  engineMode: "paper" | "live";
  loopState: string;
  healthBars: HealthBarItem[];
  blockNumber?: string | number | null;
  onStart: () => void;
  onStop: () => void;
  onKill: () => void;
  startDisabled?: boolean;
  stopDisabled?: boolean;
  killDisabled?: boolean;
  isStarting?: boolean;
  isStopping?: boolean;
  isKilling?: boolean;
  notificationCount?: number;
  onNotificationsClick?: () => void;
}

/* health → accent class map */
const healthAccent: Record<Health, string> = {
  ok: "accent-buy",
  warn: "accent-warn",
  error: "accent-sell",
  idle: "accent-neutral",
};

const healthDotClass: Record<Health, string> = {
  ok: "ok",
  warn: "warn",
  error: "error",
  idle: "idle",
};

/**
 * WorkspaceHeader
 *
 * Top bar of the institutional workspace. Two rows:
 *   Row 1: Brand · Engine controls · Notifications
 *   Row 2: Health-bar strip (ENGINE · RPC · SIGNER · PIPELINE · DATABASE · BLOCK)
 *
 * The health-bar strip is always visible — it's the "system health bar"
 * the operator requested. Each item is a colored dot + label + value.
 */
export function WorkspaceHeader({
  engineStatus,
  engineMode,
  loopState,
  healthBars,
  blockNumber,
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
}: WorkspaceHeaderProps) {
  const isRunning = engineStatus === "running";
  const isKilled = engineStatus === "killed";

  return (
    <header className="sticky top-0 z-50 ws-panel rounded-none border-x-0 border-t-0 scan-line">
      {/* ---------- Row 1: brand + controls ---------- */}
      <div className="px-4 lg:px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0 shrink-0">
          <div className="relative size-8 rounded-md bg-gradient-to-br from-emerald-500/25 via-cyan-500/10 to-transparent border border-emerald-500/30 flex items-center justify-center shrink-0 heartbeat">
            <Coins className="size-4 text-emerald-400" />
            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-emerald-400 status-dot-pulse text-emerald-400" />
          </div>
          <div className="hidden md:block min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="text-[13px] font-semibold tracking-[0.18em] leading-none label-mono">
                AUTO TRADER
              </h1>
              <span
                className={cn(
                  "label-mono text-[9px] font-bold leading-none px-1.5 py-0.5 rounded border",
                  isLive(engineMode)
                    ? "bg-red-500/15 text-red-300 border-red-500/40"
                    : "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                )}
              >
                {isLive(engineMode) ? "LIVE" : "PAPER"} · {engineStatus.toUpperCase()}
              </span>
            </div>
            <p className="text-[9px] text-muted-foreground/80 leading-tight mt-0.5 label-mono">
              Institutional Crypto Trading OS
            </p>
          </div>
        </div>

        {/* Center — loop state badge (lg+) */}
        <div className="hidden lg:flex items-center gap-2 flex-1 min-w-0 justify-center overflow-hidden">
          <div className="health-bar accent-system">
            <span className="health-dot ok pulse" />
            <span className="health-bar-label">{loopState ?? "idle"}</span>
          </div>
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

      {/* ---------- Row 3: SYSTEM HEALTH BAR (always visible) ---------- */}
      <div className="border-t border-border/40 px-4 lg:px-6 py-2 flex items-center gap-2 overflow-x-auto">
        <span className="label-mono text-[9px] text-muted-foreground shrink-0 mr-1 tracking-[0.16em]">
          SYSTEM
        </span>
        {healthBars.map((it) => (
          <div
            key={it.label}
            className={cn("health-bar shrink-0", healthAccent[it.health])}
            title={it.detail ?? it.value}
          >
            <span
              className={cn(
                "health-dot",
                healthDotClass[it.health],
                it.pulse && "pulse"
              )}
            />
            <span className="health-bar-label">{it.label}</span>
            <span className="health-bar-value">{it.value}</span>
          </div>
        ))}
        {blockNumber != null && (
          <div className="health-bar accent-chain shrink-0 ml-auto">
            <span className="health-dot ok pulse" />
            <span className="health-bar-label">BLOCK</span>
            <span className="health-bar-value">
              {typeof blockNumber === "number"
                ? blockNumber.toLocaleString("en-US")
                : blockNumber}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}

function isLive(mode: string): boolean {
  return mode === "live";
}
