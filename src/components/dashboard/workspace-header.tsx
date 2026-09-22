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

/** Technical status cell — appears in the SYSTEM HEALTH BAR row */
export interface TechCell {
  label: string;
  value: string;
  detail?: string;
  health: Health;
  pulse?: boolean;
}

interface WorkspaceHeaderProps {
  engineStatus: "stopped" | "running" | "killed" | "paused";
  engineMode: "paper" | "live";
  loopState: string;
  healthBars: HealthBarItem[];
  /** Always-visible technical status cells (ENGINE/RPC/SIGNER/PIPELINE/DATABASE/BLOCK/NETWORK) */
  techCells: TechCell[];
  /** Software version string e.g. "v0.3.1" */
  version?: string;
  /** Engine uptime in seconds (for the UTC-clock-adjacent uptime chip) */
  uptimeSec?: number;
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
  onOpenPalette?: () => void;
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

function fmtUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "00:00:00";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function useUtcClock(): string {
  const [now, setNow] = React.useState<string>("");
  React.useEffect(() => {
    const tick = () => {
      const d = new Date();
      const hh = d.getUTCHours().toString().padStart(2, "0");
      const mm = d.getUTCMinutes().toString().padStart(2, "0");
      const ss = d.getUTCSeconds().toString().padStart(2, "0");
      setNow(`${hh}:${mm}:${ss} UTC`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * WorkspaceHeader — institutional terminal top bar.
 *
 * Three rows:
 *   Row 1: Brand · Engine controls · Notifications · UTC clock · Uptime · Version
 *   Row 2: (conditional) Kill-switch banner
 *   Row 3: TECH STRIP — ENGINE · RPC · SIGNER · PIPELINE · DATABASE · BLOCK · NETWORK
 *          Always visible. Each cell: dot + label + value + detail.
 */
export function WorkspaceHeader({
  engineStatus,
  engineMode,
  loopState,
  techCells,
  version = "v0.3.1",
  uptimeSec = 0,
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
  onOpenPalette,
}: WorkspaceHeaderProps) {
  const isRunning = engineStatus === "running";
  const isKilled = engineStatus === "killed";
  const utcClock = useUtcClock();
  const uptimeStr = fmtUptime(uptimeSec);

  return (
    <header className="sticky top-0 z-50 ws-panel rounded-none border-x-0 border-t-0 scan-line">
      {/* ---------- Row 1: brand + controls + meta ---------- */}
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
                  engineMode === "live"
                    ? "bg-red-500/15 text-red-300 border-red-500/40"
                    : "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                )}
              >
                {engineMode.toUpperCase()} · {engineStatus.toUpperCase()}
              </span>
              <span className="label-mono text-[9px] text-muted-foreground/60 leading-none">
                {version}
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

        {/* Right: meta + controls */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Uptime + UTC clock — technical meta strip */}
          <div className="hidden sm:flex items-center gap-3 pr-3 border-r border-border/40">
            <div className="flex flex-col items-end leading-none gap-0.5">
              <span className="label-mono text-[8px] text-muted-foreground tracking-[0.14em]">
                UPTIME
              </span>
              <span className="label-mono text-[10px] font-bold tabular text-foreground/90">
                {uptimeStr}
              </span>
            </div>
            <div className="flex flex-col items-end leading-none gap-0.5">
              <span className="label-mono text-[8px] text-muted-foreground tracking-[0.14em]">
                CLOCK
              </span>
              <span className="label-mono text-[10px] font-bold tabular text-chain">
                {utcClock}
              </span>
            </div>
          </div>

          {onOpenPalette && (
            <button
              onClick={onOpenPalette}
              className="hidden sm:flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border/60 bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Command palette (Ctrl/⌘+K)"
              data-testid="open-command-palette"
            >
              <span className="label-mono text-[10px]">⌘K</span>
            </button>
          )}

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

      {/* ---------- Row 3: TECH STRIP (always visible status bar) ---------- */}
      <div className="border-t border-border/40 px-4 lg:px-6 py-1.5">
        <div className="tech-strip">
          <span className="label-mono text-[9px] text-muted-foreground shrink-0 mr-1 tracking-[0.16em]">
            STATUS
          </span>
          {techCells.map((cell) => (
            <div
              key={cell.label}
              className={cn("tech-cell", healthAccent[cell.health])}
              title={cell.detail ?? cell.value}
            >
              <span
                className={cn(
                  "tech-cell-dot",
                  healthDotClass[cell.health],
                  cell.pulse && "pulse"
                )}
              />
              <span className="tech-cell-label">{cell.label}</span>
              <span className="tech-cell-value">{cell.value}</span>
              {cell.detail && (
                <span className="tech-cell-detail hidden xl:inline">· {cell.detail}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
