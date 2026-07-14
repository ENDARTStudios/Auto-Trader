"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { EquityCurveChart, type EquityPoint } from "./equity-curve-chart";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Wallet,
  Layers,
  Zap,
  Target,
  Crosshair,
} from "lucide-react";

interface EquityHeroProps {
  data: EquityPoint[];
  currentEquity: number;
  peakEquity: number;
  realizedPnl: number;
  initialCapital: number;
  unrealizedPnl?: number;
  reserveBalance: number;
  tradingBalance: number;
  isLive: boolean;
  isRunning: boolean;
  /** total wins */
  wins?: number;
  /** total losses */
  losses?: number;
  /** open positions count */
  openPositions?: number;
  /** total exposure in USD */
  exposureUsd?: number;
  /** last loop timestamp (ISO) — used for "live" feel */
  lastLoopAt?: string | null;
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

function fmtUsdFull(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(2)}k`;
  return fmtUsd(n, 2);
}

/**
 * EquityHero v2 — the DOMINANT focal point of the dashboard.
 *
 * Layout (50%+ of above-the-fold space):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ ▓ EQUITY CURVE                          $12,832.45  ● LIVE  │
 *   │   TOTAL EQUITY · INITIAL $11,500 · +$1,332.45                │
 *   │                                                              │
 *   │                                                              │
 *   │                  (full-width chart, 460-520px tall)          │
 *   │                                                              │
 *   │                                                              │
 *   │   ────────────────────────────────────────────────────       │
 *   │   ROI          REALIZED     UNREALIZED   DRAWDOWN            │
 *   │   +11.58%      +$1,283      +$49.50      -4.10%              │
 *   │   ▲ +$1,332    LIFETIME     OPEN 2       PEAK $13,380        │
 *   │   ────────────────────────────────────────────────────       │
 *   │   TRADING      RESERVE      EXPOSURE     WIN RATE            │
 *   │   $11,549.23   $1,283.22    $324.10      78.0%               │
 *   │   DEPLOYABLE   COLD         AT RISK 28%  W7 L2 9 TRADES      │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Visual identity:
 *   - terminal-hero-v2 surface (max elevation, 5-tier shadow + ambient glow)
 *   - focal-pulse outline (subtle "primary" signal)
 *   - scan-line shimmer (alive feel)
 *   - 8-stat dense overlay at the bottom (2 rows of 4 cells)
 */
export function EquityHero({
  data,
  currentEquity,
  peakEquity,
  realizedPnl,
  initialCapital,
  unrealizedPnl = 0,
  reserveBalance,
  tradingBalance,
  isLive,
  isRunning,
  wins = 0,
  losses = 0,
  openPositions = 0,
  exposureUsd = 0,
  lastLoopAt,
}: EquityHeroProps) {
  const roi =
    initialCapital > 0 ? ((currentEquity - initialCapital) / initialCapital) * 100 : 0;
  const drawdown =
    peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
  const pnlPositive = realizedPnl >= 0;
  const unrealPositive = unrealizedPnl >= 0;
  const roiPositive = roi >= 0;
  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const exposurePct =
    tradingBalance > 0 ? (exposureUsd / tradingBalance) * 100 : 0;
  const deltaAbsolute = currentEquity - initialCapital;

  // "Live" pulse — last loop tick animation
  const [tickPulse, setTickPulse] = React.useState(false);
  const prevLoop = React.useRef<string | null | undefined>(lastLoopAt);
  React.useEffect(() => {
    if (prevLoop.current !== lastLoopAt) {
      prevLoop.current = lastLoopAt;
      setTickPulse(true);
      const t = setTimeout(() => setTickPulse(false), 700);
      return () => clearTimeout(t);
    }
  }, [lastLoopAt]);

  return (
    <section className="terminal-hero-v2 focal-pulse scan-line rounded-lg overflow-hidden relative">
      {/* Subtle grid overlay — adds "terminal screen" texture */}
      <div className="absolute inset-0 grid-overlay opacity-30 pointer-events-none" />

      {/* ============== HEADER ROW — brand + live equity + status ============== */}
      <div className="relative flex items-start justify-between px-6 pt-5 pb-3 flex-wrap gap-4">
        {/* Left: brand + label */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative size-10 rounded-md bg-gradient-to-br from-emerald-500/30 via-cyan-500/15 to-transparent border border-emerald-500/40 flex items-center justify-center shrink-0 heartbeat">
            <Activity className="size-5 text-emerald-300" />
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-400 status-dot-pulse text-emerald-400" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[15px] font-bold tracking-[0.22em] leading-none label-mono">
                EQUITY CURVE
              </h2>
              <span className="label-mono text-[9px] text-muted-foreground/70">
                {isRunning ? "TRACKING" : "STANDBY"}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="label-mono text-[9px] text-muted-foreground">
                {data.length} snapshots
              </span>
              <span className="text-muted-foreground/40 text-[9px]">·</span>
              <span className="label-mono text-[9px] text-muted-foreground">
                initial {fmtUsdCompact(initialCapital)}
              </span>
              <span className="text-muted-foreground/40 text-[9px]">·</span>
              <span
                className={cn(
                  "label-mono text-[9px] font-semibold tabular transition-all",
                  tickPulse ? "text-emerald-300" : "text-muted-foreground",
                  tickPulse && "tick-flash"
                )}
              >
                {deltaAbsolute >= 0 ? "+" : ""}
                {fmtUsdCompact(deltaAbsolute)}
              </span>
            </div>
          </div>
        </div>

        {/* Center: massive TOTAL EQUITY number */}
        <div className="flex-1 flex flex-col items-center justify-center min-w-[200px] py-1">
          <div className="label-mono text-[10px] text-muted-foreground tracking-[0.3em]">
            TOTAL EQUITY
          </div>
          <div
            className={cn(
              "tabular text-[42px] sm:text-[52px] font-bold leading-none tracking-tight transition-all",
              tickPulse && "tick-flash"
            )}
            style={
              tickPulse
                ? ({ ["--tick-color" as string]: "oklch(0.78 0.18 152)" } as React.CSSProperties)
                : undefined
            }
          >
            {fmtUsd(currentEquity)}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={cn(
                "inline-flex items-center gap-0.5 label-mono text-[10px] font-semibold px-1.5 py-0.5 rounded tabular",
                roiPositive
                  ? "text-emerald-300 bg-emerald-500/10"
                  : "text-red-300 bg-red-500/10"
              )}
            >
              {roiPositive ? (
                <TrendingUp className="size-2.5" />
              ) : (
                <TrendingDown className="size-2.5" />
              )}
              {roi >= 0 ? "+" : ""}
              {roi.toFixed(2)}%
            </span>
            <span className="label-mono text-[9px] text-muted-foreground">
              all-time ROI
            </span>
          </div>
        </div>

        {/* Right: status block */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "label-mono text-[10px] font-bold px-2 py-1 rounded border tabular flex items-center gap-1.5",
                isLive
                  ? "bg-red-500/15 text-red-300 border-red-500/40"
                  : "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isLive ? "bg-red-400 status-dot-pulse text-red-400" : "bg-cyan-400"
                )}
              />
              {isLive ? "LIVE" : "PAPER"}
            </span>
            <span
              className={cn(
                "label-mono text-[10px] font-bold px-2 py-1 rounded border tabular flex items-center gap-1.5",
                isRunning
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                  : "bg-muted/40 text-muted-foreground border-border/60"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isRunning
                    ? "bg-emerald-400 status-dot-pulse text-emerald-400"
                    : "bg-muted-foreground/40"
                )}
              />
              {isRunning ? "ENGINE ONLINE" : "ENGINE IDLE"}
            </span>
          </div>
          <div className="label-mono text-[9px] text-muted-foreground">
            peak {fmtUsdCompact(peakEquity)} · reserve {fmtUsdCompact(reserveBalance)}
          </div>
        </div>
      </div>

      {/* ============== CHART — full width, dominant ============== */}
      <div className="relative px-4 pb-1">
        {data.length >= 2 ? (
          <EquityCurveChart data={data} height={460} />
        ) : (
          <div className="h-[460px] flex flex-col items-center justify-center text-center gap-3 relative">
            <div className="absolute inset-0 grid-overlay opacity-20" />
            <Activity className="size-10 text-muted-foreground/30 relative" />
            <div className="label-mono text-[11px] text-muted-foreground relative tracking-wider">
              AGUARDANDO ROUNDS PARA CONSTRUIR EQUITY CURVE
            </div>
            <div className="text-[10px] text-muted-foreground/70 max-w-xs relative">
              {isRunning
                ? "Engine online — primeiro snapshot aparecerá após o fechamento do próximo round."
                : "Inicie a engine para começar a coletar snapshots."}
            </div>
          </div>
        )}
      </div>

      {/* ============== STAT GRID — 2 rows of 4 cells ============== */}
      <div className="panel-divider mx-6 mt-2" />
      <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <HeroStatCell
          label="ROI"
          value={`${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`}
          sub={`delta ${deltaAbsolute >= 0 ? "+" : ""}${fmtUsdCompact(deltaAbsolute)}`}
          accent={roiPositive ? "emerald" : "red"}
          icon={roiPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          hint="ALL-TIME"
          progress={Math.max(0, Math.min(100, roi + 50))}
        />
        <HeroStatCell
          label="REALIZED PNL"
          value={`${pnlPositive ? "+" : ""}${fmtUsdFull(realizedPnl)}`}
          sub={`${wins}W · ${losses}L · ${totalTrades} trades`}
          accent={pnlPositive ? "emerald" : "red"}
          icon={pnlPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          hint="LIFETIME"
        />
        <HeroStatCell
          label="UNREALIZED"
          value={`${unrealPositive ? "+" : ""}${fmtUsdFull(unrealizedPnl)}`}
          sub={`${openPositions} open positions`}
          accent={unrealPositive ? "emerald" : "red"}
          icon={<Zap className="size-3" />}
          hint="OPEN"
        />
        <HeroStatCell
          label="DRAWDOWN"
          value={`-${drawdown.toFixed(2)}%`}
          sub={`peak ${fmtUsdCompact(peakEquity)}`}
          accent="red"
          icon={<TrendingDown className="size-3" />}
          hint="FROM PEAK"
          progress={Math.min(100, drawdown * 4)}
        />
        <HeroStatCell
          label="TRADING BALANCE"
          value={fmtUsdFull(tradingBalance)}
          sub="deployable capital"
          accent="cyan"
          icon={<Wallet className="size-3" />}
          hint="DEPLOY"
        />
        <HeroStatCell
          label="RESERVE"
          value={fmtUsdFull(reserveBalance)}
          sub="cold storage"
          accent="cyan"
          icon={<Layers className="size-3" />}
          hint="COLD"
        />
        <HeroStatCell
          label="EXPOSURE"
          value={fmtUsdFull(exposureUsd)}
          sub={`${exposurePct.toFixed(1)}% of trading`}
          accent={exposurePct > 50 ? "amber" : "neutral"}
          icon={<Crosshair className="size-3" />}
          hint="AT RISK"
          progress={Math.min(100, exposurePct)}
        />
        <HeroStatCell
          label="WIN RATE"
          value={`${winRate.toFixed(1)}%`}
          sub={`${wins}W · ${losses}L · ${totalTrades} trades`}
          accent="violet"
          icon={<Target className="size-3" />}
          hint={`${totalTrades} TRADES`}
          progress={winRate}
        />
      </div>
    </section>
  );
}

/* ----------------------------------------------------- hero stat cell */
interface HeroStatCellProps {
  label: string;
  value: string;
  sub?: string;
  accent: "emerald" | "red" | "cyan" | "amber" | "violet" | "neutral";
  icon?: React.ReactNode;
  hint?: string;
  progress?: number;
}

const heroAccentMap: Record<HeroStatCellProps["accent"], string> = {
  emerald: "oklch(0.78 0.18 152)",
  red: "oklch(0.66 0.22 25)",
  cyan: "oklch(0.74 0.16 200)",
  amber: "oklch(0.82 0.16 85)",
  violet: "oklch(0.70 0.18 290)",
  neutral: "oklch(0.96 0.002 264)",
};

function HeroStatCell({ label, value, sub, accent, icon, hint, progress }: HeroStatCellProps) {
  const color = heroAccentMap[accent];
  return (
    <div
      className="mini-panel rounded-md px-3 py-2.5 flex flex-col gap-1.5"
      style={{ ["--instrument-accent" as string]: color }}
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && (
            <span className="shrink-0 size-3" style={{ color }}>
              {icon}
            </span>
          )}
          <span className="label-mono text-[9px] text-muted-foreground truncate tracking-wider">
            {label}
          </span>
        </div>
        {hint && (
          <span className="label-mono text-[8px] text-muted-foreground/70 shrink-0">
            {hint}
          </span>
        )}
      </div>
      <div
        className="tabular text-[22px] font-bold leading-none tracking-tight truncate"
        style={{ color }}
      >
        {value}
      </div>
      {typeof progress === "number" && (
        <div className="progress-rail">
          <div
            className="progress-rail-fill"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
      {sub && (
        <div className="label-mono text-[8.5px] text-muted-foreground/70 truncate">
          {sub}
        </div>
      )}
    </div>
  );
}
