"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { EquityCurveChart, type EquityPoint } from "./equity-curve-chart";
import { TrendingUp, TrendingDown, Activity, Wallet, Layers } from "lucide-react";

interface EquityHeroProps {
  data: EquityPoint[];
  /** current total equity (trading + reserve) */
  currentEquity: number;
  /** peak equity */
  peakEquity: number;
  /** realized P&L in USD */
  realizedPnl: number;
  /** initial capital estimate, for ROI calc */
  initialCapital: number;
  /** live unrealized P&L sum (open positions) */
  unrealizedPnl?: number;
  /** reserve balance */
  reserveBalance: number;
  /** trading balance */
  tradingBalance: number;
  /** is the engine live (true) or paper (false)? */
  isLive: boolean;
  /** is the engine running? */
  isRunning: boolean;
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

/**
 * EquityHero — the dominant focal point of the dashboard.
 *
 * Occupies ~40-50% of above-the-fold space. Layout:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  EQUITY CURVE                                  [LIVE/PAPER] │
 *   │                                                              │
 *   │                                                              │
 *   │   (full-width chart, 280-340px tall)                         │
 *   │                                                              │
 *   │                                                              │
 *   │  ROI +12.8%   PnL +$1,283   DD -4.1%   PEAK   NOW   UNREAL   │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Visual identity:
 *   - terminal-hero surface (max elevation)
 *   - focal-pulse outline (subtle "primary" signal)
 *   - scan-line shimmer (alive feel)
 *   - 6-stat overlay row at the bottom (compact, dense, tabular)
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
}: EquityHeroProps) {
  const roi =
    initialCapital > 0 ? ((currentEquity - initialCapital) / initialCapital) * 100 : 0;
  const drawdown =
    peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
  const pnlPositive = realizedPnl >= 0;
  const unrealPositive = unrealizedPnl >= 0;
  const roiPositive = roi >= 0;

  return (
    <section
      className={cn(
        "terminal-hero focal-pulse scan-line rounded-lg overflow-hidden relative"
      )}
    >
      {/* Subtle top accent line — emphasizes "focal" status */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, oklch(0.78 0.18 152 / 0.4) 50%, transparent 100%)",
        }}
      />

      {/* Header row */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="size-7 rounded-md bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
            <Activity className="size-3.5 text-emerald-400" />
          </div>
          <div className="flex flex-col">
            <h2 className="text-[13px] font-semibold tracking-[0.18em] leading-none label-mono">
              EQUITY CURVE
            </h2>
            <span className="text-[9px] text-muted-foreground/70 leading-tight mt-0.5 label-mono">
              {data.length} snapshots · cumulative
            </span>
          </div>
        </div>

        {/* Big "current equity" display, right-aligned */}
        <div className="flex items-baseline gap-4">
          <div className="text-right">
            <div className="label-mono text-[9px] text-muted-foreground">TOTAL EQUITY</div>
            <div className="tabular text-[26px] font-semibold leading-none tracking-tight">
              {fmtUsd(currentEquity)}
            </div>
          </div>
          <div
            className={cn(
              "label-mono text-[9px] font-semibold px-1.5 py-0.5 rounded border",
              isLive
                ? "bg-red-500/15 text-red-300 border-red-500/40"
                : "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
            )}
          >
            {isLive ? "● LIVE" : "○ PAPER"}
          </div>
        </div>
      </div>

      {/* Chart — full width, generous height for focal dominance (~45% of viewport) */}
      <div className="px-3 pb-1">
        {data.length >= 2 ? (
          <EquityCurveChart data={data} height={380} />
        ) : (
          <div className="h-[380px] flex flex-col items-center justify-center text-center gap-2">
            <Activity className="size-6 text-muted-foreground/40" />
            <div className="label-mono text-[10px] text-muted-foreground">
              AGUARDANDO ROUNDS PARA CONSTRUIR EQUITY CURVE
            </div>
            <div className="text-[10px] text-muted-foreground/70 max-w-xs">
              {isRunning
                ? "Engine online — primeiro snapshot aparecerá após o fechamento do próximo round."
                : "Inicie a engine para começar a coletar snapshots."}
            </div>
          </div>
        )}
      </div>

      {/* Bottom stat strip — 6 cells, dense, panel-divider on top */}
      <div className="panel-divider mx-4 mt-1" />
      <div className="px-5 py-3 grid grid-cols-3 md:grid-cols-6 gap-x-4 gap-y-2">
        <HeroStat
          label="ROI"
          value={`${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`}
          sub={fmtUsdCompact(currentEquity - initialCapital)}
          accent={roiPositive ? "emerald" : "red"}
        />
        <HeroStat
          label="REALIZED PNL"
          value={`${pnlPositive ? "+" : ""}${fmtUsdCompact(realizedPnl)}`}
          sub="lifetime"
          accent={pnlPositive ? "emerald" : "red"}
          icon={pnlPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
        />
        <HeroStat
          label="UNREALIZED"
          value={`${unrealPositive ? "+" : ""}${fmtUsdCompact(unrealizedPnl)}`}
          sub="open positions"
          accent={unrealPositive ? "emerald" : "red"}
        />
        <HeroStat
          label="DRAWDOWN"
          value={`-${drawdown.toFixed(2)}%`}
          sub={`peak ${fmtUsdCompact(peakEquity)}`}
          accent="red"
        />
        <HeroStat
          label="TRADING"
          value={fmtUsdCompact(tradingBalance)}
          sub="deployable"
          accent="cyan"
          icon={<Wallet className="size-3" />}
        />
        <HeroStat
          label="RESERVE"
          value={fmtUsdCompact(reserveBalance)}
          sub="cold"
          accent="cyan"
          icon={<Layers className="size-3" />}
        />
      </div>
    </section>
  );
}

/* ----------------------------------------------------- internal hero stat */
interface HeroStatProps {
  label: string;
  value: string;
  sub?: string;
  accent: "emerald" | "red" | "cyan" | "amber" | "violet" | "neutral";
  icon?: React.ReactNode;
}

const heroAccentMap: Record<HeroStatProps["accent"], string> = {
  emerald: "oklch(0.78 0.18 152)",
  red: "oklch(0.66 0.22 25)",
  cyan: "oklch(0.74 0.16 200)",
  amber: "oklch(0.82 0.16 85)",
  violet: "oklch(0.70 0.18 290)",
  neutral: "oklch(0.96 0.002 264)",
};

function HeroStat({ label, value, sub, accent, icon }: HeroStatProps) {
  const color = heroAccentMap[accent];
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        {icon && <span className="size-3 shrink-0" style={{ color }}>{icon}</span>}
        <span className="label-mono text-[9px] text-muted-foreground truncate">
          {label}
        </span>
      </div>
      <div
        className="tabular text-[16px] font-semibold leading-none mt-1 truncate"
        style={{ color }}
      >
        {value}
      </div>
      {sub && (
        <div className="label-mono text-[8px] text-muted-foreground/70 mt-0.5 truncate">
          {sub}
        </div>
      )}
    </div>
  );
}
