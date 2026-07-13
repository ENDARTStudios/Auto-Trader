"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

function fmtPct(n: number, decimals = 2): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}%`;
}

export function PortfolioSummaryCard({
  status,
  positions,
  rounds,
  surveillanceCounts,
  platforms,
}: PortfolioSummaryCardProps) {
  // --- Compute derived metrics ---
  const unrealizedPnlUsd = positions.reduce(
    (sum, p) => sum + (p.unrealizedPnlUsd ?? 0),
    0
  );
  const unrealizedPnlPct =
    positions.length > 0
      ? positions.reduce((sum, p) => sum + (p.unrealizedPnlPct ?? 0), 0) /
        positions.length
      : 0;
  const totalPnlUsd = status.realizedPnlUsd + unrealizedPnlUsd;

  // Capital utilization: how much of trading balance is deployed in open positions
  const deployedCapital = positions.reduce(
    (sum, p) => sum + (p.entryAmountUsd ?? 0),
    0
  );
  const capitalUtilizationPct =
    status.tradingBalanceUsd + deployedCapital > 0
      ? (deployedCapital /
          (status.tradingBalanceUsd + deployedCapital)) *
        100
      : 0;

  // Total equity = trading balance + deployed capital (current value) + reserve
  // Deployed capital's current value = entry + unrealized PnL
  const deployedCurrentValue = deployedCapital + unrealizedPnlUsd;
  const totalEquity =
    status.tradingBalanceUsd + deployedCurrentValue + status.reserveBalanceUsd;
  const peakEquity = status.peakBalanceUsd + status.reserveBalanceUsd;
  const drawdownPct =
    peakEquity > 0 ? ((peakEquity - totalEquity) / peakEquity) * 100 : 0;

  // Recent rounds (last 5 completed) for trend
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

  // Profit factor: sum of wins / |sum of losses|
  const winsSum = positions
    .filter((p) => (p.pnlUsd ?? 0) > 0)
    .reduce((sum, p) => sum + (p.pnlUsd ?? 0), 0);
  const lossesSum = Math.abs(
    positions
      .filter((p) => (p.pnlUsd ?? 0) < 0)
      .reduce((sum, p) => sum + (p.pnlUsd ?? 0), 0)
  );
  const profitFactor = lossesSum > 0 ? winsSum / lossesSum : winsSum > 0 ? 99 : 0;

  // Avg hold time for closed positions in this set
  // (rounds doesn't give us this, but we can approximate from history not
  // available here — leaving as 'n/a' for now)
  const totalPlatformApprovals =
    platforms.total > 0 ? (platforms.approved / platforms.total) * 100 : 0;

  const pnlPositive = totalPnlUsd >= 0;
  const unrealizedPositive = unrealizedPnlUsd >= 0;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <PieChart className="size-5 text-primary" />
            Resumo do Portfólio
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={pnlPositive ? "default" : "destructive"} className="gap-1">
              {pnlPositive ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              {fmtPct(
                status.peakBalanceUsd > 0
                  ? (totalPnlUsd / status.peakBalanceUsd) * 100
                  : 0
              )}{" "}
              ROI
            </Badge>
            {drawdownPct > 0 && (
              <Badge variant="outline" className="gap-1 text-red-500 border-red-500/30">
                <TrendingDown className="size-3" />
                -{drawdownPct.toFixed(1)}% DD
              </Badge>
            )}
            {surveillanceCounts.critical > 0 && (
              <Badge variant="destructive" className="gap-1 animate-pulse">
                <ShieldAlert className="size-3" />
                {surveillanceCounts.critical} crítico(s)
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Top row: equity + P&L breakdown */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Wallet className="size-3" />
              Patrimônio Total
            </p>
            <p className="text-xl font-bold">{fmtUsd(totalEquity)}</p>
            <p className="text-[10px] text-muted-foreground">
              Pico: {fmtUsd(peakEquity)}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="size-3" />
              P&L Total
            </p>
            <p
              className={`text-xl font-bold ${
                pnlPositive ? "text-green-500" : "text-red-500"
              }`}
            >
              {fmtUsd(totalPnlUsd)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Realizado: {fmtUsd(status.realizedPnlUsd)} • Aberto:{" "}
              <span
                className={
                  unrealizedPositive ? "text-green-500" : "text-red-500"
                }
              >
                {fmtUsd(unrealizedPnlUsd)}
              </span>
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Target className="size-3" />
              Win Rate
            </p>
            <p className="text-xl font-bold">{status.winRate.toFixed(1)}%</p>
            <p className="text-[10px] text-muted-foreground">
              {status.wins}W / {status.losses}L • Profit Factor:{" "}
              {profitFactor === 99 ? "∞" : profitFactor.toFixed(2)}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Activity className="size-3" />
              Capital Alocado
            </p>
            <p className="text-xl font-bold">{capitalUtilizationPct.toFixed(0)}%</p>
            <p className="text-[10px] text-muted-foreground">
              {fmtUsd(deployedCurrentValue)} em {positions.length} pos.
            </p>
          </div>
        </div>

        {/* Capital utilization bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Utilização de Capital</span>
            <span className="font-medium">
              {fmtUsd(deployedCapital)} deployed • {fmtUsd(status.tradingBalanceUsd)} livre •{" "}
              {fmtUsd(status.reserveBalanceUsd)} reserva
            </span>
          </div>
          <Progress value={capitalUtilizationPct} className="h-2" />
        </div>

        {/* Secondary metrics row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Coins className="size-3" />
              Rounds (5 últimos)
            </p>
            <p className="text-sm font-medium">
              {fmtUsd(recentRoundsPnl)}{" "}
              <span className={recentRoundsPnl >= 0 ? "text-green-500" : "text-red-500"}>
                ({fmtPct(roundWinRate)} win)
              </span>
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Activity className="size-3" />
              P&L médio por posição
            </p>
            <p className="text-sm font-medium">
              {status.totalPositionsClosed > 0
                ? fmtUsd(status.realizedPnlUsd / status.totalPositionsClosed)
                : "—"}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ShieldAlert className="size-3" />
              Vigilância
            </p>
            <p className="text-sm font-medium">
              {surveillanceCounts.total === 0 ? (
                <span className="text-green-500">Tudo sob controle</span>
              ) : (
                <span className="text-yellow-500">
                  {surveillanceCounts.total} alerta(s) ativos
                </span>
              )}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <PieChart className="size-3" />
              Plataformas aprovadas
            </p>
            <p className="text-sm font-medium">
              {platforms.approved}/{platforms.total}{" "}
              <span className="text-muted-foreground text-xs">
                ({totalPlatformApprovals.toFixed(0)}%)
              </span>
            </p>
          </div>
        </div>

        {/* P&L breakdown bar — visual ratio of realized vs unrealized */}
        {(Math.abs(status.realizedPnlUsd) > 0 || Math.abs(unrealizedPnlUsd) > 0) && (
          <div className="space-y-1.5 pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Composição do P&L Total ({fmtUsd(totalPnlUsd)})
            </p>
            <div className="flex h-3 rounded overflow-hidden bg-muted">
              {(() => {
                const totalAbs =
                  Math.abs(status.realizedPnlUsd) + Math.abs(unrealizedPnlUsd);
                if (totalAbs === 0) return null;
                const realizedPct =
                  (Math.abs(status.realizedPnlUsd) / totalAbs) * 100;
                const unrealizedPct =
                  (Math.abs(unrealizedPnlUsd) / totalAbs) * 100;
                return (
                  <>
                    <div
                      className={
                        status.realizedPnlUsd >= 0
                          ? "bg-green-500"
                          : "bg-red-500"
                      }
                      style={{ width: `${realizedPct}%` }}
                      title={`Realizado: ${fmtUsd(status.realizedPnlUsd)}`}
                    />
                    <div
                      className={
                        unrealizedPnlUsd >= 0
                          ? "bg-green-400"
                          : "bg-red-400"
                      }
                      style={{ width: `${unrealizedPct}%` }}
                      title={`Não-realizado: ${fmtUsd(unrealizedPnlUsd)}`}
                    />
                  </>
                );
              })()}
            </div>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-green-500" />
                Realizado (+)
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-green-400" />
                Não-realizado (+)
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-red-500" />
                Realizado (−)
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-red-400" />
                Não-realizado (−)
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
