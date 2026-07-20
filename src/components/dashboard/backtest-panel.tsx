"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  Play,
  TrendingUp,
  TrendingDown,
  Target,
  Gauge,
  BarChart3,
  Trophy,
  AlertTriangle,
  History,
  ArrowRight,
} from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useBacktests,
  useBacktest,
  type BacktestSummary,
  type BacktestParams,
} from "@/hooks/use-trading-data";

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

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s atrás`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min atrás`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h atrás`;
  return `${Math.floor(diff / 86_400_000)}d atrás`;
}

const DEFAULT_SYMBOLS = "BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT,XRP/USDT,ARB/USDT";

export function BacktestPanel() {
  const qc = useQueryClient();
  const backtests = useBacktests(20);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = useBacktest(selectedId);

  // Form state
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [interval, setInterval_] = useState("1h");
  const [periodDays, setPeriodDays] = useState(30);
  const [initialCapitalUsd, setInitialCapitalUsd] = useState(1000);
  const [perTradeUsd, setPerTradeUsd] = useState(150);
  const [takeProfitPct, setTakeProfitPct] = useState(5); // user enters %, we send 0.05
  const [stopLossPct, setStopLossPct] = useState(4);
  const [maxHoldBars, setMaxHoldBars] = useState(48);
  const [rsiEntryMax, setRsiEntryMax] = useState(70);
  const [rsiExitMin, setRsiExitMin] = useState(75);

  const runMutation = useMutation({
    mutationFn: async () => {
      const params: BacktestParams = {
        symbols: symbols
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
        interval,
        periodDays,
        initialCapitalUsd,
        perTradeUsd,
        takeProfitPct: takeProfitPct / 100,
        stopLossPct: stopLossPct / 100,
        maxHoldBars,
        rsiEntryMax,
        rsiExitMin,
      };
      const r = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "backtest failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      toast.success(
        `Backtest concluído: ${data.metrics.totalTrades} trades, P&L ${fmtUsd(
          data.metrics.totalPnlUsd
        )}`
      );
      qc.invalidateQueries({ queryKey: ["backtests"] });
      if (data?.id) setSelectedId(data.id);
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  return (
    <div className="space-y-4">
      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-5" />
            Configurar Backtest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertDescription>
              Backtest simula a estratégia (RSI entry + TP/SL/timeout + RSI exit) sobre
              candles históricos do Binance. Útil para validar thresholds antes de live trading.
              Não modela fees/slippage/scam-filter.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="symbols">Símbolos (separados por vírgula)</Label>
              <Input
                id="symbols"
                value={symbols}
                onChange={(e) => setSymbols(e.target.value)}
                placeholder="BTC/USDT,ETH/USDT"
              />
              <p className="text-xs text-muted-foreground">
                Máx 20 símbolos. Formato BASE/QUOTE (ex: BTC/USDT).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="interval">Intervalo</Label>
              <Select value={interval} onValueChange={setInterval_}>
                <SelectTrigger id="interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15m">15 minutos</SelectItem>
                  <SelectItem value="1h">1 hora</SelectItem>
                  <SelectItem value="4h">4 horas</SelectItem>
                  <SelectItem value="1d">1 dia</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="periodDays">Período (dias)</Label>
              <Input
                id="periodDays"
                type="number"
                min={1}
                max={365}
                value={periodDays}
                onChange={(e) => setPeriodDays(parseInt(e.target.value) || 30)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="initialCapital">Capital inicial (USD)</Label>
              <Input
                id="initialCapital"
                type="number"
                min={100}
                value={initialCapitalUsd}
                onChange={(e) =>
                  setInitialCapitalUsd(parseFloat(e.target.value) || 1000)
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="perTrade">$ por trade</Label>
              <Input
                id="perTrade"
                type="number"
                min={10}
                value={perTradeUsd}
                onChange={(e) =>
                  setPerTradeUsd(parseFloat(e.target.value) || 150)
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tp">Take Profit (%)</Label>
              <Input
                id="tp"
                type="number"
                step="0.1"
                min={0.1}
                max={50}
                value={takeProfitPct}
                onChange={(e) =>
                  setTakeProfitPct(parseFloat(e.target.value) || 5)
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sl">Stop Loss (%)</Label>
              <Input
                id="sl"
                type="number"
                step="0.1"
                min={0.1}
                max={50}
                value={stopLossPct}
                onChange={(e) =>
                  setStopLossPct(parseFloat(e.target.value) || 4)
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxHold">Max hold (barras)</Label>
              <Input
                id="maxHold"
                type="number"
                min={1}
                max={5000}
                value={maxHoldBars}
                onChange={(e) =>
                  setMaxHoldBars(parseInt(e.target.value) || 48)
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rsiEntry">RSI entrada (máx)</Label>
              <Input
                id="rsiEntry"
                type="number"
                min={0}
                max={100}
                value={rsiEntryMax}
                onChange={(e) =>
                  setRsiEntryMax(parseFloat(e.target.value) || 70)
                }
              />
              <p className="text-xs text-muted-foreground">
                Entra se RSI(14) &lt; este valor
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rsiExit">RSI saída (min)</Label>
              <Input
                id="rsiExit"
                type="number"
                min={0}
                max={100}
                value={rsiExitMin}
                onChange={(e) =>
                  setRsiExitMin(parseFloat(e.target.value) || 75)
                }
              />
              <p className="text-xs text-muted-foreground">
                Sai se RSI(14) ≥ este valor (overbought)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="gap-1"
            >
              <Play className="size-4" />
              {runMutation.isPending ? "Executando..." : "Executar Backtest"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {symbols.split(",").filter(Boolean).length} símbolo(s) •{" "}
              {periodDays} dias • {interval}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Recent backtests list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5" />
            Backtests Recentes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {backtests.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (backtests.data?.backtests ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum backtest executado ainda. Configure os parâmetros acima e clique em "Executar".
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(backtests.data?.backtests ?? []).map((bt) => (
                <BacktestRow
                  key={bt.id}
                  bt={bt}
                  isSelected={selectedId === bt.id}
                  onSelect={() => setSelectedId(bt.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected backtest detail */}
      {selectedId !== null && detail.data && (
        <BacktestDetailCard data={detail.data} />
      )}
    </div>
  );
}

function BacktestRow({
  bt,
  isSelected,
  onSelect,
}: {
  bt: BacktestSummary;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const pnlPositive = bt.totalPnlUsd >= 0;
  const isRunning = bt.status === "running";
  const isFailed = bt.status === "failed";

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-muted-foreground">#{bt.id}</span>
          <span className="text-sm font-medium truncate">
            {bt.symbols.slice(0, 3).join(", ")}
            {bt.symbols.length > 3 && ` +${bt.symbols.length - 3}`}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {bt.interval} · {bt.periodDays}d
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Badge variant="secondary" className="gap-1">
              <Activity className="size-3 animate-pulse" />
              executando
            </Badge>
          )}
          {isFailed && <Badge variant="destructive">falhou</Badge>}
          {!isRunning && !isFailed && (
            <Badge
              variant={pnlPositive ? "default" : "destructive"}
              className="gap-1"
            >
              {pnlPositive ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              {fmtUsd(bt.totalPnlUsd)}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {timeAgo(bt.startedAt)}
          </span>
        </div>
      </div>
      {!isRunning && !isFailed && (
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
          <span>
            <Trophy className="size-3 inline mr-1" />
            {bt.totalTrades} trades · {bt.winRate.toFixed(1)}% win
          </span>
          <span>
            <Target className="size-3 inline mr-1" />
            PF {bt.profitFactor === 99 ? "∞" : bt.profitFactor.toFixed(2)}
          </span>
          <span>
            <TrendingDown className="size-3 inline mr-1" />
            DD {bt.maxDrawdownPct.toFixed(1)}%
          </span>
          <span>
            <Gauge className="size-3 inline mr-1" />
            Sharpe {bt.sharpeRatio.toFixed(2)}
          </span>
        </div>
      )}
      {isFailed && (
        <p className="text-xs text-red-500 mt-1 truncate">{bt.error}</p>
      )}
    </button>
  );
}

function BacktestDetailCard({
  data,
}: {
  data: import("@/hooks/use-trading-data").BacktestDetail;
}) {
  const pnlPositive = data.totalPnlUsd >= 0;
  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <BarChart3 className="size-5" />
            Backtest #{data.id} — Detalhe
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{data.interval} · {data.periodDays}d</Badge>
            <Badge
              variant={pnlPositive ? "default" : "destructive"}
              className="gap-1"
            >
              {pnlPositive ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              {fmtUsd(data.totalPnlUsd)} ({fmtPct(data.totalPnlPct)})
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Trophy className="size-3" />
              Win Rate
            </p>
            <p className="text-xl font-bold">{data.winRate.toFixed(1)}%</p>
            <p className="text-[10px] text-muted-foreground">
              {data.wins}W / {data.losses}L · {data.totalTrades} total
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Target className="size-3" />
              Profit Factor
            </p>
            <p className="text-xl font-bold">
              {data.profitFactor === 99 ? "∞" : data.profitFactor.toFixed(2)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Sharpe: {data.sharpeRatio.toFixed(2)} por trade
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingDown className="size-3" />
              Max Drawdown
            </p>
            <p className="text-xl font-bold text-red-500">
              -{data.maxDrawdownPct.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground">
              Melhor: {fmtUsd(data.bestTradeUsd)} · Pior: {fmtUsd(data.worstTradeUsd)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Activity className="size-3" />
              Trade médio
            </p>
            <p className="text-xl font-bold">
              {fmtUsd(data.avgTradePnlUsd)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Hold médio: {data.avgHoldBars.toFixed(1)} barras
            </p>
          </div>
        </div>

        {/* Equity curve */}
        {data.equityCurve.length > 1 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Equity Curve ({data.equityCurve.length} pontos)
            </p>
            <EquityCurveSVG
              points={data.equityCurve}
              initialCapital={data.initialCapitalUsd}
              pnlPositive={pnlPositive}
            />
          </div>
        )}

        {/* Per-symbol breakdown */}
        {data.trades.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Trades por símbolo ({data.trades.length} exibidos dos {data.totalTrades} totais)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1 pr-3">Símbolo</th>
                    <th className="py-1 pr-3">Entry bar</th>
                    <th className="py-1 pr-3">Exit bar</th>
                    <th className="py-1 pr-3">Entry $</th>
                    <th className="py-1 pr-3">Exit $</th>
                    <th className="py-1 pr-3">Hold</th>
                    <th className="py-1 pr-3">P&L</th>
                    <th className="py-1 pr-3">P&L %</th>
                    <th className="py-1">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trades.slice(-50).reverse().map((t, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1 pr-3 font-medium">{t.symbol}</td>
                      <td className="py-1 pr-3 font-mono text-muted-foreground">{t.entryBar}</td>
                      <td className="py-1 pr-3 font-mono text-muted-foreground">{t.exitBar}</td>
                      <td className="py-1 pr-3 font-mono">${t.entryPrice.toFixed(4)}</td>
                      <td className="py-1 pr-3 font-mono">${t.exitPrice.toFixed(4)}</td>
                      <td className="py-1 pr-3 font-mono">{t.holdBars}</td>
                      <td
                        className={`py-1 pr-3 font-mono ${
                          t.pnlUsd >= 0 ? "text-green-500" : "text-red-500"
                        }`}
                      >
                        {fmtUsd(t.pnlUsd)}
                      </td>
                      <td
                        className={`py-1 pr-3 font-mono ${
                          t.pnlPct >= 0 ? "text-green-500" : "text-red-500"
                        }`}
                      >
                        {fmtPct(t.pnlPct)}
                      </td>
                      <td className="py-1">
                        <Badge
                          variant="outline"
                          className={
                            t.reason === "take_profit"
                              ? "text-green-500 border-green-500/30"
                              : t.reason === "stop_loss"
                              ? "text-red-500 border-red-500/30"
                              : "text-muted-foreground"
                          }
                        >
                          {t.reason === "take_profit"
                            ? "TP"
                            : t.reason === "stop_loss"
                            ? "SL"
                            : t.reason === "timeout"
                            ? "timeout"
                            : "RSI"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// SVG equity curve — simple line chart, no chart library needed
function EquityCurveSVG({
  points,
  initialCapital,
  pnlPositive,
}: {
  points: import("@/hooks/use-trading-data").BacktestEquityPoint[];
  initialCapital: number;
  pnlPositive: boolean;
}) {
  if (points.length < 2) return null;
  const W = 800;
  const H = 200;
  const PAD = 30;

  const equities = points.map((p) => p.equityUsd);
  const min = Math.min(...equities, initialCapital);
  const max = Math.max(...equities, initialCapital);
  const range = max - min || 1;

  // Map bar index → x, equity → y
  const xFor = (i: number) =>
    PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const yFor = (eq: number) =>
    PAD + (1 - (eq - min) / range) * (H - 2 * PAD);

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.equityUsd).toFixed(1)}`)
    .join(" ");

  // Initial capital horizontal line
  const yInitial = yFor(initialCapital);
  const color = pnlPositive ? "#22c55e" : "#ef4444";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto border rounded bg-card"
      preserveAspectRatio="none"
    >
      {/* Y-axis labels */}
      <text x={4} y={PAD + 4} fontSize={10} fill="currentColor" className="text-muted-foreground">
        {fmtUsd(max, 0)}
      </text>
      <text x={4} y={H - PAD + 4} fontSize={10} fill="currentColor" className="text-muted-foreground">
        {fmtUsd(min, 0)}
      </text>

      {/* Initial capital line (dashed) */}
      <line
        x1={PAD}
        y1={yInitial}
        x2={W - PAD}
        y2={yInitial}
        stroke="currentColor"
        strokeOpacity={0.3}
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <text
        x={W - PAD}
        y={yInitial - 4}
        fontSize={10}
        fill="currentColor"
        className="text-muted-foreground"
        textAnchor="end"
      >
        inicial {fmtUsd(initialCapital, 0)}
      </text>

      {/* Equity curve */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} />

      {/* Final point */}
      <circle
        cx={xFor(points.length - 1)}
        cy={yFor(points[points.length - 1].equityUsd)}
        r={4}
        fill={color}
      />
    </svg>
  );
}
