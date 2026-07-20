"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export type InstrumentAccent =
  | "emerald"  // profit / positive
  | "red"      // loss / risk
  | "cyan"     // blockchain / chain
  | "amber"    // warning
  | "violet"   // AI / model
  | "blue"     // system
  | "neutral"; // default

const accentColorMap: Record<InstrumentAccent, string> = {
  emerald: "oklch(0.78 0.18 152)",
  red: "oklch(0.66 0.22 25)",
  cyan: "oklch(0.74 0.16 200)",
  amber: "oklch(0.82 0.16 85)",
  violet: "oklch(0.70 0.18 290)",
  blue: "oklch(0.70 0.16 230)",
  neutral: "oklch(0.62 0.008 264)",
};

interface SubStat {
  label: string;
  value: string | number;
  /** optional accent for the value */
  accent?: InstrumentAccent;
}

interface InstrumentMetricProps {
  /** main uppercase label (e.g. "REALIZED PNL") */
  label: string;
  /** main value — large, tabular */
  value: React.ReactNode;
  /** accent color */
  accent?: InstrumentAccent;
  /** optional icon (small, 3.5x3.5) */
  icon?: React.ReactNode;
  /** signed percentage trend — renders a badge */
  trend?: {
    value: number;
    label?: string;
  };
  /** micro sparkline above the value */
  spark?: number[];
  /** sub-stats row — aircraft-panel style */
  subStats?: SubStat[];
  /** progress bar value 0..100 — uses accent color */
  progress?: number;
  /** small status hint shown in top-right (e.g. "LIVE", "PAPER") */
  statusHint?: React.ReactNode;
  /** fires when value changes — adds a flash highlight */
  flashOnChange?: boolean;
  /** flash key — pass the latest value to trigger animation */
  flashKey?: string | number;
  className?: string;
  children?: React.ReactNode;
}

/**
 * InstrumentMetric — aircraft-panel style metric card.
 *
 * Designed to feel like an instrument on a cockpit dash:
 *   - Accent top-edge glow (2px gradient bar)
 *   - Compact label + status hint + sparkline row
 *   - Large tabular value + trend badge
 *   - Panel-divider
 *   - Sub-stats grid (2-4 micro cells) like 7W / 2L / 78%
 *   - Optional progress rail with accent glow
 *
 * Each card has its own visual identity via the accent color, breaking
 * the "all cards look identical" feel of standard SaaS dashboards.
 */
export function InstrumentMetric({
  label,
  value,
  accent = "neutral",
  icon,
  trend,
  spark,
  subStats,
  progress,
  statusHint,
  flashOnChange = false,
  flashKey,
  className,
  children,
}: InstrumentMetricProps) {
  const accentColor = accentColorMap[accent];
  const trendPositive = (trend?.value ?? 0) > 0;
  const trendNegative = (trend?.value ?? 0) < 0;
  const trendZero = (trend?.value ?? 0) === 0;

  /* flash-on-change — adds tick-flash class for 480ms when flashKey changes */
  const [flash, setFlash] = React.useState(false);
  const prevKey = React.useRef<string | number | undefined>(flashKey);
  React.useEffect(() => {
    if (!flashOnChange) return;
    if (prevKey.current !== flashKey) {
      prevKey.current = flashKey;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 500);
      return () => clearTimeout(t);
    }
  }, [flashKey, flashOnChange]);

  return (
    <div
      className={cn(
        "instrument-card-v2 rounded-md px-3 py-2.5 flex flex-col gap-1.5",
        className
      )}
      style={{ ["--instrument-accent" as string]: accentColor }}
    >
      {/* Row 1: label + icon + status hint */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && (
            <span className="shrink-0 size-3.5" style={{ color: accentColor }}>
              {icon}
            </span>
          )}
          <span className="label-mono text-[9px] text-muted-foreground truncate">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {statusHint && (
            <span className="label-mono text-[9px] text-muted-foreground/70 truncate">
              {statusHint}
            </span>
          )}
        </div>
      </div>

      {/* Row 2: sparkline (compact, right-aligned) */}
      {spark && spark.length >= 2 && (
        <div className="flex justify-end -mt-0.5 -mb-0.5">
          <Sparkline
            data={spark}
            width={88}
            height={20}
            color={accentColor}
            strokeWidth={1.25}
            className="opacity-90"
          />
        </div>
      )}

      {/* Row 3: main value + trend badge */}
      <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
        <span
          className={cn(
            "tabular text-[18px] font-semibold tracking-tight leading-none truncate",
            flash && "tick-flash"
          )}
          style={flash ? ({ ["--tick-color" as string]: accentColor } as React.CSSProperties) : undefined}
        >
          {value}
        </span>
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[10px] font-semibold px-1 py-0.5 rounded tabular",
              trendZero && "text-muted-foreground bg-muted/60",
              trendPositive && "text-emerald-300 bg-emerald-500/10",
              trendNegative && "text-red-300 bg-red-500/10"
            )}
          >
            {trendZero ? (
              <Minus className="size-2.5" />
            ) : trendPositive ? (
              <ArrowUpRight className="size-2.5" />
            ) : (
              <ArrowDownRight className="size-2.5" />
            )}
            {Math.abs(trend.value).toFixed(2)}%
            {trend.label && (
              <span className="text-muted-foreground ml-0.5 font-normal text-[9px]">
                {trend.label}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Row 4: progress rail (optional) */}
      {typeof progress === "number" && (
        <div className="progress-rail">
          <div
            className="progress-rail-fill"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}

      {/* Row 5: panel divider + sub-stats grid (aircraft panel) */}
      {subStats && subStats.length > 0 && (
        <>
          <div className="panel-divider mt-1" />
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1">
            {subStats.map((s, i) => (
              <div key={i} className="min-w-0">
                <div className="label-mono text-[8px] text-muted-foreground truncate">
                  {s.label}
                </div>
                <div
                  className="label-mono text-[10px] font-semibold tabular truncate"
                  style={
                    s.accent
                      ? { color: accentColorMap[s.accent] }
                      : undefined
                  }
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {children}
    </div>
  );
}
