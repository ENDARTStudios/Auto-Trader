"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { EquityCurveChart, type EquityPoint } from "./equity-curve-chart";
import { TrendingUp, TrendingDown, Activity, Zap } from "lucide-react";

/** Pre-computed performance metrics derived from rounds + history in page.tsx */
export interface PerformanceMetrics {
  /** Return on investment (%) vs initial capital */
  roiPct: number;
  /** Periodic Sharpe ratio (mean/std of per-round returns). 0 if not computable. */
  sharpe: number;
  /** Current drawdown from peak equity (%) */
  drawdownPct: number;
  /** Current deployed capital (USD) — trading balance + unrealized PnL */
  capital: number;
  /** Win rate (%) — wins / (wins + losses) */
  winRate: number;
  /** Profit factor = sum(wins) / abs(sum(losses)). Infinity if no losses. */
  profitFactor: number;
  /** Expectancy (USD) = average PnL per trade */
  expectancy: number;
  /** Number of trades used for stats */
  trades: number;
}

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
  metrics?: PerformanceMetrics;
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

function fmtNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

function fmtProfitFactor(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n >= 100) return `${n.toFixed(0)}`;
  return n.toFixed(2);
}

/**
 * EquityCurvePanel — DOMINANT focal element of the workspace.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ EQUITY CURVE                  $12,832.45  +11.58%  ●LIVE          │
 *   │                                                                  │
 *   │              (full-width chart, ~340-380px tall)                 │
 *   │                                                                  │
 *   │ ───────────────────────────────────────────────────────────────  │
 *   │ ROI | SHARPE | DRAWDOWN | CAPITAL | WIN% | PF | EXPECT | TRADES  │
 *   │ 18.52 | 1.84 | -4.10% | $12,832 | 78.0% | 2.34 | +$49 | 9        │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * The 7 KPIs sit inline with the chart in a single strip.
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
  metrics,
  className,
}: EquityCurvePanelProps) {
  const roi = metrics?.roiPct ?? (initialCapital > 0 ? ((currentEquity - initialCapital) / initialCapital) * 100 : 0);
  const drawdown = metrics?.drawdownPct ?? (peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0);
  const deltaAbsolute = currentEquity - initialCapital;
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

  // KPI cells (8 cells, last is TRADES count)
  const sharpe = metrics?.sharpe ?? 0;
  const sharpePositive = sharpe >= 0;
  const winRate = metrics?.winRate ?? 0;
  const profitFactor = metrics?.profitFactor ?? 0;
  const expectancy = metrics?.expectancy ?? 0;
  const trades = metrics?.trades ?? 0;
  const capital = metrics?.capital ?? currentEquity;

  return (
    <section
      className={cn(
        "ws-panel ws-panel-l1 focal-pulse scan-line rounded-lg overflow-hidden relative",
        className
      )}
    >
      <div className="absolute inset-0 grid-overlay opacity-30 pointer-events-none" />

      {/* ============== HEADER ROW ============== */}
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

      {/* ============== CHART ============== */}
      <div className="relative px-4 pb-1">
        {data.length >= 2 ? (
          <EquityCurveChart data={data} height={340} />
        ) : (
          <div className="h-[340px] flex flex-col items-center justify-center text-center gap-3 relative">
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

      {/* ============== KPI STRIP — 8 metrics inline with chart ============== */}
      <div className="panel-divider mx-6 mt-1" />
      <div className="kpi-strip">
        <KpiCell
          label="ROI"
          value={`${roi >= 0 ? "+" : ""}${fmtNum(roi)}%`}
          sub={`delta ${deltaAbsolute >= 0 ? "+" : ""}${fmtUsdCompact(deltaAbsolute)}`}
          accent={roiPositive ? "buy" : "sell"}
          icon={roiPositive ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
        />
        <KpiCell
          label="SHARPE"
          value={fmtNum(sharpe, 2)}
          sub="periodic · non-annualized"
          accent={sharpePositive ? "buy" : "sell"}
        />
        <KpiCell
          label="DRAWDOWN"
          value={`-${fmtNum(drawdown)}%`}
          sub={`peak ${fmtUsdCompact(peakEquity)}`}
          accent="sell"
          icon={<TrendingDown className="size-2.5" />}
        />
        <KpiCell
          label="CAPITAL"
          value={fmtUsdCompact(capital)}
          sub={`deployed · ${trades} trades`}
          accent="chain"
        />
        <KpiCell
          label="WIN RATE"
          value={`${fmtNum(winRate, 1)}%`}
          sub={metrics ? `${metrics.trades ? Math.round(winRate * trades / 100) : 0}W / ${trades - Math.round(winRate * trades / 100)}L` : "—"}
          accent="ai"
        />
        <KpiCell
          label="PROFIT FACTOR"
          value={fmtProfitFactor(profitFactor)}
          sub="gross win / gross loss"
          accent={profitFactor >= 1 ? "buy" : "sell"}
        />
        <KpiCell
          label="EXPECTANCY"
          value={`${expectancy >= 0 ? "+" : ""}${fmtUsdCompact(expectancy)}`}
          sub="per trade"
          accent={expectancy >= 0 ? "buy" : "sell"}
          icon={<Zap className="size-2.5" />}
        />
        <KpiCell
          label="REALIZED"
          value={`${realizedPnl >= 0 ? "+" : ""}${fmtUsdCompact(realizedPnl)}`}
          sub={`unreal ${unrealizedPnl >= 0 ? "+" : ""}${fmtUsdCompact(unrealizedPnl)}`}
          accent={realizedPnl >= 0 ? "buy" : "sell"}
        />
      </div>
    </section>
  );
}

/* ----------------------------------------------------- KPI cell */
interface KpiCellProps {
  label: string;
  value: string;
  sub?: string;
  accent: "buy" | "sell" | "chain" | "warn" | "ai" | "neutral";
  icon?: React.ReactNode;
}

const kpiAccentVar: Record<KpiCellProps["accent"], string> = {
  buy: "var(--color-buy)",
  sell: "var(--color-sell)",
  chain: "var(--color-chain)",
  warn: "var(--color-warn)",
  ai: "var(--color-ai)",
  neutral: "oklch(0.65 0.005 264)",
};

function KpiCell({ label, value, sub, accent, icon }: KpiCellProps) {
  const color = kpiAccentVar[accent];
  return (
    <div
      className="kpi-cell"
      style={{ ["--accent" as string]: color } as React.CSSProperties}
    >
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <span className="kpi-cell-label">{label}</span>
        {icon && (
          <span className="shrink-0 size-2.5" style={{ color }}>
            {icon}
          </span>
        )}
      </div>
      <span className="kpi-cell-value" style={{ color }}>
        {value}
      </span>
      {sub && <span className="kpi-cell-sub">{sub}</span>}
    </div>
  );
}
