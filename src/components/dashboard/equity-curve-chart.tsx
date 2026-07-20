"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
  XAxis,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";

export interface EquityPoint {
  /** ISO timestamp OR display label */
  t: string;
  /** Total equity in USD at this point */
  v: number;
}

interface EquityCurveChartProps {
  data: EquityPoint[];
  className?: string;
  height?: number;
  positiveColor?: string;
  negativeColor?: string;
}

function fmtUsd(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtTime(t: string) {
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return t;
  }
}

/**
 * Equity Curve — main visual anchor of the dashboard.
 * Sits at the top, immediately communicates the trading account's trajectory.
 *
 * - Gradient fill that turns emerald (gain) or red (loss) based on net delta
 * - Minimal axes (Y right-aligned, no labels on X to preserve density)
 * - Hover tooltip with formatted USD and time
 */
export function EquityCurveChart({
  data,
  className,
  height = 220,
  positiveColor = "oklch(0.78 0.18 152)",
  negativeColor = "oklch(0.66 0.22 25)",
}: EquityCurveChartProps) {
  const isGain = data.length >= 2 ? data[data.length - 1].v >= data[0].v : true;
  const color = isGain ? positiveColor : negativeColor;
  const gradId = React.useId();

  // Domain padding so curve doesn't touch edges
  const values = data.map((d) => d.v);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 100;
  const padding = (max - min) * 0.12 || max * 0.05 || 10;
  const yDomain: [number, number] = [min - padding, max + padding];

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="oklch(1 0 0 / 0.04)"
            strokeDasharray="3 6"
            vertical={false}
          />
          <XAxis
            dataKey="t"
            tickFormatter={fmtTime}
            stroke="oklch(0.62 0.008 264)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis
            domain={yDomain}
            tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
            stroke="oklch(0.62 0.008 264)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={42}
            orientation="right"
          />
          <Tooltip
            cursor={{ stroke: "oklch(1 0 0 / 0.15)", strokeWidth: 1 }}
            contentStyle={{
              background: "oklch(0.19 0.006 264 / 0.95)",
              border: "1px solid oklch(1 0 0 / 0.10)",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 11,
              fontFamily: "var(--font-geist-mono), monospace",
              color: "oklch(0.96 0.002 264)",
              backdropFilter: "blur(8px)",
            }}
            labelStyle={{ color: "oklch(0.62 0.008 264)", fontSize: 10 }}
            labelFormatter={fmtTime}
            formatter={(v: number) => [fmtUsd(v), "Equity"]}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradId})`}
            dot={false}
            activeDot={{
              r: 3,
              fill: color,
              stroke: "oklch(0.13 0.005 264)",
              strokeWidth: 1.5,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
