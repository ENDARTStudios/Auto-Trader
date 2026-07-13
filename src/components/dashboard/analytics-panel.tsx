"use client";

// AnalyticsPanel — performance analytics dashboard tab.
//
// Sections:
//   1. Range selector (24h / 7d / 30d / all)
//   2. 4 stat cards: Total Return %, Max Drawdown %, Current Streak, Snapshots
//   3. Equity curve SVG (large) — total equity + peak line + drawdown shading
//   4. Drawdown chart SVG (separate, below equity)
//   5. P&L by symbol bar chart SVG (top 10 symbols by absolute P&L)
//   6. Day-of-week heatmap (7 cells, color-coded by P&L)
//   7. Hour-of-day heatmap (24 cells, color-coded by P&L)
//   8. Best/Worst trade cards
//
// All charts are SVG inline (no chart library) — consistent with backtest-panel.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useAnalytics,
  type AnalyticsRange,
  type EquityPoint,
} from "@/hooks/use-trading-data";
import { TrendingUp, TrendingDown, Activity, Award, AlertTriangle } from "lucide-react";

const RANGES: { key: AnalyticsRange; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "Tudo" },
];

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function fmtUsd(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number, decimals = 2): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}%`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ----------------------------------------------------------------------------
// Equity curve SVG
// ----------------------------------------------------------------------------
function EquityCurveChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
        Dados insuficientes para o equity curve (mínimo 2 snapshots).
      </div>
    );
  }

  const W = 800;
  const H = 280;
  const padL = 60;
  const padR = 20;
  const padT = 20;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const equities = points.map((p) => p.totalEquityUsd);
  const peaks = points.map((p) => p.peakBalanceUsd);
  const minE = Math.min(...equities, ...peaks);
  const maxE = Math.max(...equities, ...peaks);
  const range = maxE - minE || 1;
  const pad = range * 0.1;
  const yMin = minE - pad;
  const yMax = maxE + pad;
  const yRange = yMax - yMin || 1;

  const x = (i: number) => padL + (i / (points.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - ((v - yMin) / yRange) * innerH;

  const equityPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.totalEquityUsd).toFixed(1)}`)
    .join(" ");

  const peakPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.peakBalanceUsd).toFixed(1)}`)
    .join(" ");

  // Drawdown area: shade region between equity and peak when equity < peak
  const ddAreas: string[] = [];
  let segStart: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const eq = points[i].totalEquityUsd;
    const pk = points[i].peakBalanceUsd;
    if (eq < pk) {
      if (segStart === null) segStart = i;
    } else {
      if (segStart !== null) {
        const startIdx = segStart;
        const endIdx = i;
        const segPath = `M ${x(startIdx).toFixed(1)} ${y(points[startIdx].peakBalanceUsd).toFixed(1)} ` +
          points.slice(startIdx, endIdx + 1).map((p, j) => `L ${x(startIdx + j).toFixed(1)} ${y(p.peakBalanceUsd).toFixed(1)}`).join(" ") +
          ` L ${x(endIdx).toFixed(1)} ${y(points[endIdx].totalEquityUsd).toFixed(1)} ` +
          points.slice(startIdx, endIdx + 1).reverse().map((p, j) => `L ${x(endIdx - j).toFixed(1)} ${y(p.totalEquityUsd).toFixed(1)}`).join(" ") +
          " Z";
        ddAreas.push(segPath);
        segStart = null;
      }
    }
  }
  if (segStart !== null) {
    const startIdx = segStart;
    const endIdx = points.length - 1;
    const segPath = `M ${x(startIdx).toFixed(1)} ${y(points[startIdx].peakBalanceUsd).toFixed(1)} ` +
      points.slice(startIdx, endIdx + 1).map((p, j) => `L ${x(startIdx + j).toFixed(1)} ${y(p.peakBalanceUsd).toFixed(1)}`).join(" ") +
      ` L ${x(endIdx).toFixed(1)} ${y(points[endIdx].totalEquityUsd).toFixed(1)} ` +
      points.slice(startIdx, endIdx + 1).reverse().map((p, j) => `L ${x(endIdx - j).toFixed(1)} ${y(p.totalEquityUsd).toFixed(1)}`).join(" ") +
      " Z";
    ddAreas.push(segPath);
  }

  // Y-axis ticks (5)
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (yRange * i) / 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-64" preserveAspectRatio="none">
      {/* Grid */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(t)}
            y2={y(t)}
            stroke="currentColor"
            className="text-muted/20"
            strokeWidth={1}
          />
          <text
            x={padL - 6}
            y={y(t) + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[10px] font-mono"
          >
            {fmtUsd(t, 0)}
          </text>
        </g>
      ))}

      {/* Drawdown shading */}
      {ddAreas.map((d, i) => (
        <path key={`dd-${i}`} d={d} fill="rgba(239, 68, 68, 0.18)" />
      ))}

      {/* Peak line (dashed) */}
      <path
        d={peakPath}
        fill="none"
        stroke="rgb(148, 163, 184)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />

      {/* Equity line */}
      <path
        d={equityPath}
        fill="none"
        stroke={
          points[points.length - 1].totalEquityUsd >= points[0].totalEquityUsd
            ? "rgb(34, 197, 94)"
            : "rgb(239, 68, 68)"
        }
        strokeWidth={2}
      />

      {/* Legend */}
      <g transform={`translate(${W - padR - 150}, ${padT + 4})`}>
        <line x1={0} x2={16} y1={6} y2={6} stroke="rgb(34, 197, 94)" strokeWidth={2} />
        <text x={20} y={9} className="fill-foreground text-[10px]">Equity total</text>
        <line x1={0} x2={16} y1={20} y2={20} stroke="rgb(148, 163, 184)" strokeWidth={1.5} strokeDasharray="4 4" />
        <text x={20} y={23} className="fill-foreground text-[10px]">Peak balance</text>
      </g>
    </svg>
  );
}

// ----------------------------------------------------------------------------
// Drawdown chart SVG
// ----------------------------------------------------------------------------
function DrawdownChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground text-xs">
        Dados insuficientes.
      </div>
    );
  }

  const W = 800;
  const H = 120;
  const padL = 60;
  const padR = 20;
  const padT = 8;
  const padB = 20;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const dds = points.map((p) => p.drawdownPct);
  const maxDd = Math.max(...dds, 0.1);

  const x = (i: number) => padL + (i / (points.length - 1)) * innerW;
  const y = (v: number) => padT + (v / maxDd) * innerH;

  const ddPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.drawdownPct).toFixed(1)}`)
    .join(" ");
  const ddArea = ddPath + ` L ${x(points.length - 1).toFixed(1)} ${padT} L ${x(0).toFixed(1)} ${padT} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const v = maxDd * f;
        return (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(v)}
              y2={y(v)}
              stroke="currentColor"
              className="text-muted/20"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[10px] font-mono"
            >
              {v.toFixed(1)}%
            </text>
          </g>
        );
      })}
      <path d={ddArea} fill="rgba(239, 68, 68, 0.25)" />
      <path d={ddPath} fill="none" stroke="rgb(239, 68, 68)" strokeWidth={1.5} />
    </svg>
  );
}

// ----------------------------------------------------------------------------
// P&L by symbol bar chart
// ----------------------------------------------------------------------------
function BySymbolChart({
  rows,
}: {
  rows: { symbol: string; totalPnlUsd: number; trades: number; winRate: number }[];
}) {
  const top = rows.slice(0, 10);
  if (top.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
        Sem posições fechadas no período.
      </div>
    );
  }

  const maxAbs = Math.max(...top.map((r) => Math.abs(r.totalPnlUsd)), 0.01);
  return (
    <div className="space-y-1.5">
      {top.map((r) => {
        const isPos = r.totalPnlUsd >= 0;
        const widthPct = (Math.abs(r.totalPnlUsd) / maxAbs) * 50; // max 50% of width
        return (
          <div key={r.symbol} className="flex items-center gap-2 text-xs">
            <div className="w-20 truncate font-mono text-right">{r.symbol}</div>
            <div className="flex-1 flex items-center">
              {/* Center bar — positive goes right (green), negative goes left (red) */}
              <div className="flex-1 flex justify-center">
                <div className="w-1/2 flex justify-end">
                  {!isPos && (
                    <div
                      className="bg-red-500/80 h-5 rounded-l"
                      style={{ width: `${widthPct * 2}%` }}
                      title={`${r.totalPnlUsd.toFixed(2)} USD`}
                    />
                  )}
                </div>
                <div className="w-px bg-muted-foreground/40 h-5" />
                <div className="w-1/2 flex justify-start">
                  {isPos && (
                    <div
                      className="bg-emerald-500/80 h-5 rounded-r"
                      style={{ width: `${widthPct * 2}%` }}
                      title={`${r.totalPnlUsd.toFixed(2)} USD`}
                    />
                  )}
                </div>
              </div>
            </div>
            <div
              className={`w-20 text-right font-mono ${
                isPos ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {isPos ? "+" : ""}
              {r.totalPnlUsd.toFixed(2)}
            </div>
            <div className="w-24 text-right text-muted-foreground text-[10px]">
              {r.trades}t · {r.winRate.toFixed(0)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Day-of-week heatmap
// ----------------------------------------------------------------------------
function DowHeatmap({
  rows,
}: {
  rows: { dow: number; trades: number; totalPnlUsd: number }[];
}) {
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.totalPnlUsd)), 0.01);
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {rows.map((r) => {
        const intensity = Math.abs(r.totalPnlUsd) / maxAbs;
        const isPos = r.totalPnlUsd >= 0;
        const bg = r.trades === 0
          ? "bg-muted/20"
          : isPos
          ? `rgba(34, 197, 94, ${0.15 + intensity * 0.6})`
          : `rgba(239, 68, 68, ${0.15 + intensity * 0.6})`;
        return (
          <div
            key={r.dow}
            className={`rounded p-2 text-center text-xs border ${bg} border-border`}
            title={`${r.trades} trades, P&L ${r.totalPnlUsd.toFixed(2)} USD`}
          >
            <div className="font-semibold">{DOW_LABELS[r.dow]}</div>
            <div className="text-[10px] text-muted-foreground">{r.trades}t</div>
            <div
              className={`text-[10px] font-mono ${
                r.trades === 0
                  ? "text-muted-foreground"
                  : isPos
                  ? "text-emerald-300"
                  : "text-red-300"
              }`}
            >
              {r.trades === 0 ? "—" : `${isPos ? "+" : ""}${r.totalPnlUsd.toFixed(1)}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Hour-of-day heatmap
// ----------------------------------------------------------------------------
function HourHeatmap({
  rows,
}: {
  rows: { hour: number; trades: number; totalPnlUsd: number }[];
}) {
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.totalPnlUsd)), 0.01);
  return (
    <div className="grid grid-cols-12 gap-1">
      {rows.map((r) => {
        const intensity = Math.abs(r.totalPnlUsd) / maxAbs;
        const isPos = r.totalPnlUsd >= 0;
        const bg = r.trades === 0
          ? "bg-muted/20"
          : isPos
          ? `rgba(34, 197, 94, ${0.15 + intensity * 0.6})`
          : `rgba(239, 68, 68, ${0.15 + intensity * 0.6})`;
        return (
          <div
            key={r.hour}
            className={`rounded p-1 text-center text-[10px] border ${bg} border-border`}
            title={`${r.hour}h: ${r.trades} trades, P&L ${r.totalPnlUsd.toFixed(2)} USD`}
          >
            <div className="font-mono text-muted-foreground">{r.hour.toString().padStart(2, "0")}</div>
            <div
              className={`font-mono ${
                r.trades === 0
                  ? "text-muted-foreground/50"
                  : isPos
                  ? "text-emerald-300"
                  : "text-red-300"
              }`}
            >
              {r.trades === 0 ? "·" : `${isPos ? "+" : ""}${r.totalPnlUsd.toFixed(0)}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------
export function AnalyticsPanel() {
  const [range, setRange] = useState<AnalyticsRange>("24h");
  const { data, isLoading, isError } = useAnalytics(range);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Carregando analytics...
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-red-400">
          Erro carregando analytics.
        </CardContent>
      </Card>
    );
  }

  const s = data.summary;
  const streakLabel =
    data.streaks.currentWinStreak > 0
      ? `${data.streaks.currentWinStreak}W`
      : data.streaks.currentLossStreak > 0
      ? `${data.streaks.currentLossStreak}L`
      : "—";

  return (
    <div className="space-y-4">
      {/* Range selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground mr-2">Período:</span>
        {RANGES.map((r) => (
          <Button
            key={r.key}
            size="sm"
            variant={range === r.key ? "default" : "outline"}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {data.closedPositionsCount} trades fechados no período · {s?.snapshotCount ?? 0} snapshots
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Retorno no período</span>
              {(s?.pctChange ?? 0) >= 0 ? (
                <TrendingUp className="size-4 text-emerald-400" />
              ) : (
                <TrendingDown className="size-4 text-red-400" />
              )}
            </div>
            <div
              className={`text-2xl font-bold mt-1 ${
                (s?.pctChange ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {fmtPct(s?.pctChange ?? 0)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {fmtUsd(s?.absChangeUsd ?? 0)} · {fmtUsd(s?.startEquityUsd ?? 0)} → {fmtUsd(s?.endEquityUsd ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Max Drawdown</span>
              <AlertTriangle className="size-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold mt-1 text-amber-400">
              {(s?.maxDrawdownPct ?? 0).toFixed(2)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              pico: {fmtUsd(s?.maxEquityUsd ?? 0)} · vale: {fmtUsd(s?.minEquityUsd ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Streak atual</span>
              <Activity className="size-4 text-sky-400" />
            </div>
            <div className="text-2xl font-bold mt-1">{streakLabel}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              longo: {data.streaks.longestWinStreak}W / {data.streaks.longestLossStreak}L
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Trades no período</span>
              <Award className="size-4 text-violet-400" />
            </div>
            <div className="text-2xl font-bold mt-1">{data.closedPositionsCount}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {s?.rangeStart ? `desde ${fmtTime(s.rangeStart)}` : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Equity curve */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="size-4" /> Equity Curve
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EquityCurveChart points={data.equityCurve} />
        </CardContent>
      </Card>

      {/* Drawdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingDown className="size-4" /> Drawdown (%)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DrawdownChart points={data.equityCurve} />
        </CardContent>
      </Card>

      {/* By symbol + Best/Worst */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">P&L por símbolo (top 10)</CardTitle>
          </CardHeader>
          <CardContent>
            <BySymbolChart rows={data.bySymbol} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Melhor & Pior trade</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.bestTrade ? (
              <div className="rounded border border-emerald-500/30 bg-emerald-950/40 p-3">
                <div className="flex items-center justify-between">
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                    MELHOR
                  </Badge>
                  <span className="text-xs text-muted-foreground">{fmtTime(data.bestTrade.exitAt)}</span>
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="font-mono font-semibold">{data.bestTrade.symbol}</span>
                  <span className="text-emerald-400 font-mono">
                    +{data.bestTrade.pnlUsd.toFixed(2)} ({fmtPct(data.bestTrade.pnlPct)})
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">Sem trades no período.</div>
            )}
            {data.worstTrade ? (
              <div className="rounded border border-red-500/30 bg-red-950/40 p-3">
                <div className="flex items-center justify-between">
                  <Badge className="bg-red-500/20 text-red-300 border-red-500/30">
                    PIOR
                  </Badge>
                  <span className="text-xs text-muted-foreground">{fmtTime(data.worstTrade.exitAt)}</span>
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="font-mono font-semibold">{data.worstTrade.symbol}</span>
                  <span className="text-red-400 font-mono">
                    {data.worstTrade.pnlUsd.toFixed(2)} ({fmtPct(data.worstTrade.pnlPct)})
                  </span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Day of week + Hour of day heatmaps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">P&L por dia da semana</CardTitle>
          </CardHeader>
          <CardContent>
            <DowHeatmap rows={data.byDayOfWeek} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">P&L por hora do dia</CardTitle>
          </CardHeader>
          <CardContent>
            <HourHeatmap rows={data.byHour} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
