"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export type MetricAccent =
  | "emerald"
  | "cyan"
  | "amber"
  | "magenta"
  | "violet"
  | "red"
  | "neutral";

const accentColorMap: Record<MetricAccent, string> = {
  emerald: "oklch(0.78 0.18 152)",
  cyan: "oklch(0.74 0.16 200)",
  amber: "oklch(0.82 0.16 85)",
  magenta: "oklch(0.68 0.21 350)",
  violet: "oklch(0.70 0.18 290)",
  red: "oklch(0.66 0.22 25)",
  neutral: "oklch(0.62 0.008 264)",
};

const accentBorderMap: Record<MetricAccent, string> = {
  emerald: "accent-border-emerald",
  cyan: "accent-border-cyan",
  amber: "accent-border-amber",
  magenta: "accent-border-magenta",
  violet: "accent-border-violet",
  red: "accent-border-red",
  neutral: "accent-border-neutral",
};

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: MetricAccent;
  trend?: {
    value: number; // percentage, signed
    label?: string;
  };
  spark?: number[];
  className?: string;
  children?: React.ReactNode;
}

/**
 * Premium metric card with:
 *  - glass-card surface (depth, blur, subtle gradient)
 *  - accent left-border for visual identity
 *  - sparkline + trend badge in the header
 *  - tabular numerics for value
 */
export function MetricCard({
  label,
  value,
  sub,
  icon,
  accent = "neutral",
  trend,
  spark,
  className,
  children,
}: MetricCardProps) {
  const accentColor = accentColorMap[accent];
  const trendPositive = (trend?.value ?? 0) > 0;
  const trendNegative = (trend?.value ?? 0) < 0;
  const trendZero = (trend?.value ?? 0) === 0;

  return (
    <div
      className={cn(
        "glass-card rounded-lg px-4 py-3.5 flex flex-col gap-2 relative overflow-hidden",
        accentBorderMap[accent],
        className
      )}
    >
      {/* Header: label + icon */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && (
            <span
              className="shrink-0 size-3.5"
              style={{ color: accentColor }}
            >
              {icon}
            </span>
          )}
          <span className="label-mono text-[10px] text-muted-foreground truncate">
            {label}
          </span>
        </div>

        {/* Sparkline */}
        {spark && spark.length >= 2 && (
          <Sparkline
            data={spark}
            width={72}
            height={24}
            color={accentColor}
            className="shrink-0 opacity-90"
          />
        )}
      </div>

      {/* Value */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="tabular text-[28px] font-semibold tracking-tight leading-none">
          {value}
        </span>
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded",
              trendZero && "text-muted-foreground bg-muted",
              trendPositive && "text-emerald-400 bg-emerald-500/10",
              trendNegative && "text-red-400 bg-red-500/10"
            )}
          >
            {trendZero ? (
              <Minus className="size-3" />
            ) : trendPositive ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {Math.abs(trend.value).toFixed(2)}%
            {trend.label && (
              <span className="text-muted-foreground ml-0.5 font-normal">
                {trend.label}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Sub text */}
      {sub && (
        <p className="text-[11px] text-muted-foreground leading-snug truncate">
          {sub}
        </p>
      )}

      {children}
    </div>
  );
}
