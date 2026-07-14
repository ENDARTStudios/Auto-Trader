"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { EquityCurveChart, type EquityPoint } from "./equity-curve-chart";
import { TrendingUp, TrendingDown, Activity, Zap, Target, Crosshair } from "lucide-react";

interface EquityCurvePanelProps {
  data: EquityPoint[];
  currentEquity: number;
  peakEquity: number;
  realizedPnl: number;
  initialCapital: number;
  unrealizedPnl?: number;
  isLive: boolean;
  isRunning: boolean;
  lastLoopAt?: string | null;
  className?: string;
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
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(2)}k`;
  return fmtUsd(n, 2);
}

/**
 * EquityCurvePanel — DOMINANT focal element of the workspace.
 *
 * Per operator spec: "O gráfico principal deve ocupar quase toda a largura"
 * and "Gráfico principal ocupando aproximadamente metade da área acima da dobra."
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ EQUITY CURVE                          $12,832.45  +11.58%  ●LIVE │
 *   │                                                                  │
 *   │                                                                  │
 *   │                  (full-width chart, ~360-420px tall)             │
 *   │                                                                  │
 *   │                                                                  │
 *   │ ───────────────────────────────────────────────────────────────  │
 *   │ ROI          REALIZED     UNREALIZED    DRAWDOWN                 │
 *   │ +18.52%      +$1,253      +$49.50       -4.10%                   │
 *   │ ▲ +$1,332    ▲ +18.42%    OPEN 2        PEAK $13,380             │
 *   │ ████████     ────────     ────────      ████████                 │
 *   │ ───────────────────────────────────────────────────────────────  │
 *   │ TRADING      RESERVE      EXPOSURE      WIN RATE                 │
 *   │ $11,549      $1,283       $324          78.0%                    │
 *   │ DEPLOYABLE   COLD         AT RISK 28%   W7 L2 9 TRADES           │
 *   └──────────────────────────────────────────────────────────────────┘
 */
export function EquityCurvePanel({
  data,
  currentEquity,
  peakEquity,
  realizedPnl,
  initialCapital,
  unrealizedPnl = 0,
  isLive,
  isRunning,
  lastLoopAt,
  className,
}: EquityCurvePanelProps) {
  const roi =
    initialCapital > 0 ? ((currentEquity - initialCapital) / initialCapital) * 100 : 0;
  const drawdown = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
  const deltaAbsolute = currentEquity - initialCapital;
  const pnlPositive = realizedPnl >= 0;
  const unrealPositive = unrealizedPnl >= 0;
  const roiPositive = roi >= 0;

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
    <section
      className={cn(
        "ws-panel ws-panel-l1 focal-pulse scan-line rounded-lg overflow-hidden relative",
        className
      )}
    >
      <div className="absolute inset-0 grid-overlay opacity-30 pointer-events-none" />

      {/* ============== HEADER ROW — brand + live equity + status ============== */}
      <div className="relative flex items-start justify-between px-6 pt-4 pb-2 flex-wrap gap-4">
        {/* Left: brand + label */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative size-9 rounded-md bg-gradient-to-br from-emerald-500/30 via-cyan-500/15 to-transparent border border-emerald-500/40 flex items-center justify-center shrink-0 heartbeat">
            <Activity className="size-4 text-emerald-300" />
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-400 status-dot-pulse text-emerald-400" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[14px] font-bold tracking-[0.22em] leading-none label-mono">
                EQUITY CURVE
              </h2>
              <span className="label-mono text-[9px] text-muted-foreground/70">
                {isRunning ? "TRACKING" : "STANDBY"}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="label-mono text-[9px] text-muted-foreground">
                {data.length} snapshots · initial {fmtUsdCompact(initialCapital)}
              </span>
              <span
                className={cn(
                  "label-mono text-[9px] font-semibold tabular transition-all",
                  tickPulse ? "text-emerald-300 tick-flash" : "text-muted-foreground"
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
              "tabular text-[40px] sm:text-[48px] font-bold leading-none tracking-tight transition-all",
              tickPulse && "tick-flash"
            )}
          >
            {fmtUsd(currentEquity)}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={cn(
                "inline-flex items-center gap-0.5 label-mono text-[10px] font-semibold px-1.5 py-0.5 rounded tabular",
                roiPositive
                  ? "bg-buy-10 text-buy"
                  : "bg-sell-10 text-sell"
              )}
            >
              {roiPositive ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
              {roi >= 0 ? "+" : ""}
              {roi.toFixed(2)}%
            </span>
            <span className="label-mono text-[9px] text-muted-foreground">all-time ROI</span>
          </div>
        </div>

        {/* Right: status block */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "label-mono text-[10px] font-bold px-2 py-1 rounded border tabular flex items-center gap-1.5",
                isLive
                  ? "bg-sell-10 text-sell border-sell-30"
                  : "bg-chain-10 text-chain border-chain-30"
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
                  ? "bg-buy-10 text-buy border-buy-30"
                  : "bg-muted/40 text-muted-foreground border-border/60"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isRunning ? "bg-emerald-400 status-dot-pulse text-emerald-400" : "bg-muted-foreground/40"
                )}
              />
              {isRunning ? "ENGINE ONLINE" : "ENGINE IDLE"}
            </span>
          </div>
          <div className="label-mono text-[9px] text-muted-foreground">
            peak {fmtUsdCompact(peakEquity)}
          </div>
        </div>
      </div>

      {/* ============== CHART — full width, dominant ============== */}
      <div className="relative px-4 pb-1">
        {data.length >= 2 ? (
          <EquityCurveChart data={data} height={380} />
        ) : (
          <div className="h-[380px] flex flex-col items-center justify-center text-center gap-3 relative">
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
      <div className="px-6 py-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <HeroStatCell
          label="ROI"
          value={`${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`}
          sub={`delta ${deltaAbsolute >= 0 ? "+" : ""}${fmtUsdCompact(deltaAbsolute)}`}
          accent={roiPositive ? "buy" : "sell"}
          icon={roiPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          hint="ALL-TIME"
          progress={Math.max(0, Math.min(100, roi + 50))}
        />
        <HeroStatCell
          label="REALIZED"
          value={`${pnlPositive ? "+" : ""}${fmtUsdCompact(realizedPnl)}`}
          sub="lifetime"
          accent={pnlPositive ? "buy" : "sell"}
          icon={pnlPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          hint="PNL"
        />
        <HeroStatCell
          label="UNREALIZED"
          value={`${unrealPositive ? "+" : ""}${fmtUsdCompact(unrealizedPnl)}`}
          sub="open positions"
          accent={unrealPositive ? "buy" : "sell"}
          icon={<Zap className="size-3" />}
          hint="OPEN"
        />
        <HeroStatCell
          label="DRAWDOWN"
          value={`-${drawdown.toFixed(2)}%`}
          sub={`peak ${fmtUsdCompact(peakEquity)}`}
          accent="sell"
          icon={<TrendingDown className="size-3" />}
          hint="FROM PEAK"
          progress={Math.min(100, drawdown * 4)}
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
  accent: "buy" | "sell" | "chain" | "warn" | "ai" | "neutral";
  icon?: React.ReactNode;
  hint?: string;
  progress?: number;
}

const heroAccentVar: Record<HeroStatCellProps["accent"], string> = {
  buy: "var(--color-buy)",
  sell: "var(--color-sell)",
  chain: "var(--color-chain)",
  warn: "var(--color-warn)",
  ai: "var(--color-ai)",
  neutral: "oklch(0.65 0.005 264)",
};

function HeroStatCell({ label, value, sub, accent, icon, hint, progress }: HeroStatCellProps) {
  const color = heroAccentVar[accent];
  return (
    <div
      className="mini-panel rounded-md px-3 py-2.5 flex flex-col gap-1.5"
      style={{ ["--accent" as string]: color } as React.CSSProperties}
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
          <span className="label-mono text-[8px] text-muted-foreground/70 shrink-0">{hint}</span>
        )}
      </div>
      <div
        className="tabular text-[20px] font-bold leading-none tracking-tight truncate"
        style={{ color }}
      >
        {value}
      </div>
      {typeof progress === "number" && (
        <div className="telemetry-bar-track" style={{ height: 4 }}>
          <div
            className="telemetry-bar-fill"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
      {sub && (
        <div className="label-mono text-[8.5px] text-muted-foreground/70 truncate">{sub}</div>
      )}
    </div>
  );
}
