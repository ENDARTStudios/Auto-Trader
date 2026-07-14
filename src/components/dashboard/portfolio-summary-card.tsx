"use client";

import { Progress } from "@/components/ui/progress";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  PieChart,
  Target,
  Activity,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  EngineSnapshot,
  PositionRow,
  RoundRow,
} from "@/hooks/use-trading-data";

interface SurveillanceCounts {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

interface PortfolioSummaryCardProps {
  status: EngineSnapshot;
  positions: PositionRow[];
  rounds: RoundRow[];
  surveillanceCounts: SurveillanceCounts;
  platforms: { approved: number; total: number; pending: number };
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
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return fmtUsd(n, 2);
}

function fmtPct(n: number, decimals = 2): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}%`;
}

interface StatBlockProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: "emerald" | "red" | "cyan" | "amber" | "violet" | "neutral";
}

const statAccentMap: Record<NonNullable<StatBlockProps["accent"]>, string> = {
  emerald: "text-emerald-400",
  red: "text-red-400",
  cyan: "text-cyan-400",
  amber: "text-amber-400",
  violet: "text-violet-400",
  neutral: "text-foreground",
};

function StatBlock({ label, value, sub, icon, accent = "neutral" }: StatBlockProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {icon && <span className="size-3 opacity-70">{icon}</span>}
        <p className="label-mono text-[10px] text-muted-foreground">{label}</p>
      </div>
      <p className={cn("text-lg font-semibold tabular leading-none", statAccentMap[accent])}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] text-muted-foreground leading-tight">{sub}</p>
      )}
    </div>
  );
}

export function PortfolioSummaryCard({
  status,
  positions,
  rounds,
  surveillanceCounts,
  platforms,
}: PortfolioSummaryCardProps) {
  /* ----- derived ----- */
  const unrealizedPnlUsd = positions.reduce(
    (sum, p) => sum + (p.unrealizedPnlUsd ?? 0),
    0
  );
  const totalPnlUsd = status.realizedPnlUsd + unrealizedPnlUsd;
  const pnlPositive = totalPnlUsd >= 0;
  const unrealizedPositive = unrealizedPnlUsd >= 0;

  const deployedCapital = positions.reduce(
    (sum, p) => sum + (p.entryAmountUsd ?? 0),
    0
  );
  const deployedCurrentValue = deployedCapital + unrealizedPnlUsd;
  const capitalUtilizationPct =
    status.tradingBalanceUsd + deployedCapital > 0
      ? (deployedCapital / (status.tradingBalanceUsd + deployedCapital)) * 100
      : 0;

  const totalEquity =
    status.tradingBalanceUsd + deployedCurrentValue + status.reserveBalanceUsd;
  const peakEquity = status.peakBalanceUsd + status.reserveBalanceUsd;
  const drawdownPct =
    peakEquity > 0 ? ((peakEquity - totalEquity) / peakEquity) * 100 : 0;

  const completedRounds = rounds
    .filter((r) => r.status === "completed" && r.roundPnlUsd !== null)
    .slice(0, 5);
  const recentRoundsPnl = completedRounds.reduce(
    (sum, r) => sum + (r.roundPnlUsd ?? 0),
    0
  );
  const winningRounds = completedRounds.filter(
    (r) => (r.roundPnlUsd ?? 0) > 0
  ).length;
  const roundWinRate =
    completedRounds.length > 0
      ? (winningRounds / completedRounds.length) * 100
      : 0;

  const winsSum = positions
    .filter((p) => (p.pnlUsd ?? 0) > 0)
    .reduce((sum, p) => sum + (p.pnlUsd ?? 0), 0);
  const lossesSum = Math.abs(
    positions
      .filter((p) => (p.pnlUsd ?? 0) < 0)
      .reduce((sum, p) => sum + (p.pnlUsd ?? 0), 0)
  );
  const profitFactor = lossesSum > 0 ? winsSum / lossesSum : winsSum > 0 ? 99 : 0;
  const totalPlatformApprovals =
    platforms.total > 0 ? (platforms.approved / platforms.total) * 100 : 0;

  const realizedPct =
    Math.abs(status.realizedPnlUsd) + Math.abs(unrealizedPnlUsd) > 0
      ? (Math.abs(status.realizedPnlUsd) /
          (Math.abs(status.realizedPnlUsd) + Math.abs(unrealizedPnlUsd))) *
        100
      : 0;
  const unrealizedPct = 100 - realizedPct;

  return (
    <section className="glass-card rounded-lg overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PieChart className="size-4 text-emerald-400" />
          <h3 className="text-sm font-semibold tracking-tight">Resumo do Portfólio</h3>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded border label-mono text-[10px] font-medium",
              pnlPositive
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-red-500/10 border-red-500/30 text-red-300"
            )}
          >
            {pnlPositive ? (
              <TrendingUp className="size-3" />
            ) : (
              <TrendingDown className="size-3" />
            )}
            {fmtPct(status.peakBalanceUsd > 0 ? (totalPnlUsd / status.peakBalanceUsd) * 100 : 0)} ROI
          </span>
          {drawdownPct > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-300 label-mono text-[10px] font-medium">
              <TrendingDown className="size-3" />
              -{drawdownPct.toFixed(1)}% DD
            </span>
          )}
          {surveillanceCounts.critical > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-500/40 bg-red-500/15 text-red-300 label-mono text-[10px] font-medium animate-pulse">
              <ShieldAlert className="size-3" />
              {surveillanceCounts.critical} CRÍTICO
            </span>
          )}
        </div>
      </div>

      {/* Body: primary stats grid */}
      <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBlock
          label="Patrimônio Total"
          value={fmtUsd(totalEquity)}
          sub={`Pico ${fmtUsd(peakEquity)}`}
          icon={<Wallet className="size-3" />}
        />
        <StatBlock
          label="P&L Total"
          value={fmtUsd(totalPnlUsd)}
          accent={pnlPositive ? "emerald" : "red"}
          sub={
            <>
              Realizado {fmtUsd(status.realizedPnlUsd)} · Aberto{" "}
              <span className={unrealizedPositive ? "text-emerald-400" : "text-red-400"}>
                {fmtUsd(unrealizedPnlUsd)}
              </span>
            </>
          }
          icon={pnlPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
        />
        <StatBlock
          label="Win Rate"
          value={`${status.winRate.toFixed(1)}%`}
          sub={`${status.wins}W / ${status.losses}L · PF ${profitFactor === 99 ? "∞" : profitFactor.toFixed(2)}`}
          icon={<Target className="size-3" />}
        />
        <StatBlock
          label="Capital Alocado"
          value={`${capitalUtilizationPct.toFixed(0)}%`}
          sub={`${fmtUsdCompact(deployedCurrentValue)} em ${positions.length} pos.`}
          icon={<Activity className="size-3" />}
        />
      </div>

      {/* Capital utilization bar */}
      <div className="px-5 pb-4 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] label-mono">
          <span className="text-muted-foreground">Utilização de Capital</span>
          <span className="text-muted-foreground tabular">
            {fmtUsdCompact(deployedCapital)} deployed · {fmtUsdCompact(status.tradingBalanceUsd)} livre · {fmtUsdCompact(status.reserveBalanceUsd)} reserva
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500/80 to-emerald-400 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(capitalUtilizationPct, 100)}%` }}
          />
        </div>
      </div>

      {/* P&L composition bar */}
      {(Math.abs(status.realizedPnlUsd) > 0 || Math.abs(unrealizedPnlUsd) > 0) && (
        <div className="px-5 pb-4 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] label-mono">
            <span className="text-muted-foreground">Composição P&L · {fmtUsdCompact(totalPnlUsd)}</span>
            <span className="text-muted-foreground">
              {realizedPct.toFixed(0)}% realizado · {unrealizedPct.toFixed(0)}% aberto
            </span>
          </div>
          <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
            <div
              className={status.realizedPnlUsd >= 0 ? "bg-emerald-500" : "bg-red-500"}
              style={{ width: `${realizedPct}%` }}
            />
            <div
              className={unrealizedPnlUsd >= 0 ? "bg-emerald-400/70" : "bg-red-400/70"}
              style={{ width: `${unrealizedPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Secondary metrics row */}
      <div className="px-5 py-3 border-t border-border/40 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBlock
          label="Rounds (5R)"
          value={
            <span className={recentRoundsPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
              {fmtUsd(recentRoundsPnl)}
            </span>
          }
          sub={`${fmtPct(roundWinRate)} win rate`}
          icon={<Coins className="size-3" />}
        />
        <StatBlock
          label="P&L médio / posição"
          value={
            status.totalPositionsClosed > 0
              ? fmtUsd(status.realizedPnlUsd / status.totalPositionsClosed)
              : "—"
          }
          icon={<Activity className="size-3" />}
        />
        <StatBlock
          label="Vigilância"
          value={
            surveillanceCounts.total === 0 ? (
              <span className="text-emerald-400">OK</span>
            ) : (
              <span className="text-amber-400">
                {surveillanceCounts.total} alerta(s)
              </span>
            )
          }
          sub={
            surveillanceCounts.total > 0
              ? `${surveillanceCounts.critical} crítico · ${surveillanceCounts.warning} warn`
              : "Tudo sob controle"
          }
          icon={<ShieldAlert className="size-3" />}
          accent={surveillanceCounts.total > 0 ? "amber" : "emerald"}
        />
        <StatBlock
          label="Plataformas"
          value={`${platforms.approved}/${platforms.total}`}
          sub={`${totalPlatformApprovals.toFixed(0)}% aprovadas`}
          icon={<PieChart className="size-3" />}
        />
      </div>
    </section>
  );
}
