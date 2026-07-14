"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Activity,
  AlertTriangle,
  Ban,
  Shield,
  Wallet,
  Lock,
  ScrollText,
  History,
  Coins,
  Gauge,
  Brain,
  Globe,
  BarChart3,
  ShieldAlert,
  Building2,
  FlaskConical,
  LineChart,
  Bell,
  Server,
  TrendingUp,
  TrendingDown,
  Info,
  Cpu,
  Database,
  Layers,
  Boxes,
  CircuitBoard,
  Zap,
  Network,
  Sigma,
  Crosshair,
  Target,
  DollarSign,
  Percent,
  Hourglass,
} from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useEngineStatus,
  useOpenPositions,
  useHistory,
  useLogs,
  useScamReports,
  useRounds,
  useReserve,
  useConfig,
  useMarketData,
  useAIInsights,
  useSiteAudits,
  useSurveillance,
  usePlatforms,
  useSystemInfo,
} from "@/hooks/use-trading-data";
import { PositionsTable } from "@/components/dashboard/positions-table";
import { HistoryTable } from "@/components/dashboard/history-table";
import { LogsFeed } from "@/components/dashboard/logs-feed";
import { ScamReportsList } from "@/components/dashboard/scam-reports";
import { RoundsTable } from "@/components/dashboard/rounds-table";
import { ConfigEditor } from "@/components/dashboard/config-editor";
import { MarketPanel } from "@/components/dashboard/market-panel";
import { AIInsightsPanel } from "@/components/dashboard/ai-insights-panel";
import { SiteAuditPanel } from "@/components/dashboard/site-audit-panel";
import { SurveillancePanel } from "@/components/dashboard/surveillance-panel";
import { PlatformScannerPanel } from "@/components/dashboard/platform-scanner-panel";
import { AlertsToast } from "@/components/dashboard/alerts-toast";
import { BacktestPanel } from "@/components/dashboard/backtest-panel";
import { AnalyticsPanel } from "@/components/dashboard/analytics-panel";
import { NotificationsPanel } from "@/components/dashboard/notifications-panel";
import { SystemPanel } from "@/components/dashboard/system-panel";
import { EquityHero } from "@/components/dashboard/equity-hero";
import { TerminalHeader, type HealthIndicator } from "@/components/dashboard/terminal-header";
import { InstrumentMetric } from "@/components/dashboard/instrument-metric";
import { TelemetryStrip, type TelemetryTileData } from "@/components/dashboard/telemetry-strip";
import type { EquityPoint } from "@/components/dashboard/equity-curve-chart";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------- helpers */
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

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (isNaN(d)) return "—";
  const diff = Date.now() - d;
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 60_000) return `+${Math.ceil(ahead / 1000)}s`;
    if (ahead < 3_600_000) return `+${Math.ceil(ahead / 60_000)}m`;
    return `+${Math.ceil(ahead / 3_600_000)}h`;
  }
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

/* ============================================================== HOME */
export default function Home() {
  const qc = useQueryClient();
  const status = useEngineStatus();
  const positions = useOpenPositions();
  const history = useHistory(50);
  const logs = useLogs(80);
  const scamReports = useScamReports(20);
  const rounds = useRounds();
  const reserve = useReserve();
  const config = useConfig();
  const market = useMarketData(30);
  const aiInsights = useAIInsights(50);
  const siteAudits = useSiteAudits(30);
  const surveillance = useSurveillance(80, false);
  const platforms = usePlatforms();
  const systemInfo = useSystemInfo();

  const [reserveWithdrawAmount, setReserveWithdrawAmount] = useState("");

  /* ----- mutations (unchanged) ----- */
  const startEngine = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/engine/start", { method: "POST" });
      if (!r.ok) throw new Error("start failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Engine iniciada");
      qc.invalidateQueries({ queryKey: ["engine-status"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  const stopEngine = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/engine/stop", { method: "POST" });
      if (!r.ok) throw new Error("stop failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Engine parada");
      qc.invalidateQueries({ queryKey: ["engine-status"] });
    },
  });

  const activateKill = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true, reason: "Kill switch manual via dashboard" }),
      });
      if (!r.ok) throw new Error("kill failed");
      return r.json();
    },
    onSuccess: () => {
      toast.error("🛑 KILL SWITCH ATIVADO — engine vai parar e fechar posições");
      qc.invalidateQueries({ queryKey: ["engine-status"] });
    },
  });

  const deactivateKill = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      if (!r.ok) throw new Error("clear kill failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Kill switch desativado");
      qc.invalidateQueries({ queryKey: ["engine-status"] });
    },
  });

  const withdrawReserve = useMutation({
    mutationFn: async (amountUsd: number) => {
      const r = await fetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw", amountUsd }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "withdraw failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Saque de reserva executado");
      setReserveWithdrawAmount("");
      qc.invalidateQueries({ queryKey: ["reserve"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  const initDb = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/initialize", { method: "POST" });
      return r.json();
    },
  });

  /* ----- derived state ----- */
  const s = status.data;
  const isRunning = s?.status === "running";
  const isKilled = s?.status === "killed";
  const isLive = s?.mode === "live";

  /* ----- derived: equity curve from rounds ----- */
  const equityData = useMemo<EquityPoint[]>(() => {
    if (!s || !rounds.data || rounds.data.length === 0) return [];
    const sorted = [...rounds.data].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );
    let cumulative = s.tradingBalanceUsd - s.realizedPnlUsd;
    const points: EquityPoint[] = [{ t: sorted[0].startedAt, v: cumulative }];
    for (const r of sorted) {
      if (r.roundPnlUsd != null) {
        cumulative += r.roundPnlUsd;
        points.push({
          t: r.endedAt ?? r.startedAt,
          v: cumulative + s.reserveBalanceUsd,
        });
      }
    }
    points.push({
      t: new Date().toISOString(),
      v: s.tradingBalanceUsd + s.reserveBalanceUsd,
    });
    return points.slice(-30);
  }, [rounds.data, s]);

  /* ----- derived: sparkline data ----- */
  const balanceSpark = useMemo(() => {
    if (!s) return [0];
    if (!rounds.data || rounds.data.length === 0) return [s.tradingBalanceUsd];
    const sorted = [...rounds.data].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );
    let cum = s.tradingBalanceUsd - s.realizedPnlUsd;
    const pts = [cum];
    for (const r of sorted) {
      if (r.roundPnlUsd != null) {
        cum += r.roundPnlUsd;
        pts.push(cum);
      }
    }
    return pts.slice(-12);
  }, [rounds.data, s]);

  const pnlSpark = useMemo(() => {
    if (!rounds.data || rounds.data.length === 0) return [0];
    const sorted = [...rounds.data].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );
    let cum = 0;
    const pts = [0];
    for (const r of sorted) {
      if (r.roundPnlUsd != null) {
        cum += r.roundPnlUsd;
        pts.push(cum);
      }
    }
    return pts.slice(-12);
  }, [rounds.data]);

  const positionsSpark = useMemo(() => {
    if (!history.data || history.data.length === 0) return [0];
    return history.data.slice(0, 12).reverse().map((p) => p.pnlUsd ?? 0);
  }, [history.data]);

  const reserveSpark = useMemo(() => {
    if (!s) return [0];
    if (!rounds.data || rounds.data.length === 0) return [s.reserveBalanceUsd];
    return rounds.data.slice(0, 10).reverse().map((r) => r.reserveBalanceUsd);
  }, [rounds.data, s]);

  const winRateSpark = useMemo(() => {
    if (!rounds.data || rounds.data.length === 0) return [50];
    const sorted = [...rounds.data].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );
    let wins = 0;
    let total = 0;
    const pts: number[] = [];
    for (const r of sorted) {
      if (r.status === "completed" && r.roundPnlUsd !== null) {
        total += 1;
        if ((r.roundPnlUsd ?? 0) > 0) wins += 1;
        pts.push((wins / total) * 100);
      }
    }
    return pts.length ? pts : [50];
  }, [rounds.data]);

  /* ----- trend calculations ----- */
  const recentRounds = useMemo(() => {
    if (!rounds.data) return [];
    return [...rounds.data]
      .filter((r) => r.status === "completed" && r.roundPnlUsd !== null)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 5);
  }, [rounds.data]);

  const recentPnlSum = recentRounds.reduce((sum, r) => sum + (r.roundPnlUsd ?? 0), 0);
  const pnlTrendPct = s && s.peakBalanceUsd > 0 ? (recentPnlSum / s.peakBalanceUsd) * 100 : 0;

  const balanceTrendPct =
    s && s.peakBalanceUsd > 0
      ? ((s.tradingBalanceUsd - s.peakBalanceUsd) / s.peakBalanceUsd) * 100
      : 0;

  const initialCapital = s ? s.tradingBalanceUsd - s.realizedPnlUsd : 0;
  const currentEquity = s ? s.tradingBalanceUsd + s.reserveBalanceUsd : 0;
  const peakEquity = s ? s.peakBalanceUsd + s.reserveBalanceUsd : 0;
  const drawdownPct =
    s && s.peakBalanceUsd > 0
      ? ((s.peakBalanceUsd - s.tradingBalanceUsd) / s.peakBalanceUsd) * 100
      : 0;
  const roiPct =
    initialCapital > 0 ? ((currentEquity - initialCapital) / initialCapital) * 100 : 0;

  // unrealized PnL across open positions
  const unrealizedPnl = useMemo(() => {
    if (!positions.data) return 0;
    return positions.data.reduce((sum, p) => sum + (p.unrealizedPnlUsd ?? 0), 0);
  }, [positions.data]);
  const exposureUsd = useMemo(() => {
    if (!positions.data) return 0;
    return positions.data.reduce(
      (sum, p) => sum + (p.entryQty ?? 0) * (p.currentPriceUsd ?? p.entryPriceUsd),
      0
    );
  }, [positions.data]);

  /* ----- terminal header health indicators ----- */
  // Use system uptime as a fallback "session time" if engine never ran
  const sessionUptimeLabel = systemInfo.data
    ? `${Math.floor(systemInfo.data.runtime.uptimeSec / 60)}m${systemInfo.data.runtime.uptimeSec % 60}s`
    : "—";
  const headerIndicators: HealthIndicator[] = s
    ? [
        {
          label: "ENGINE",
          value: isRunning ? "ONLINE" : isKilled ? "HALTED" : "IDLE",
          health: isRunning ? "ok" : isKilled ? "error" : "idle",
          pulse: isRunning,
          detail: s.loopState,
        },
        {
          label: "MODE",
          value: isLive ? "LIVE" : "PAPER",
          // PAPER is neutral/idle (not "ok" green) — only LIVE is "warn" (active real capital)
          health: isLive ? "warn" : "idle",
          pulse: isLive,
          detail: s.graduatedToLive ? "graduado" : "paper cycle",
        },
        {
          label: "RPC",
          value: "OK",
          health: "ok",
          pulse: isRunning,
          detail: "BSC mainnet · quorum",
        },
        {
          label: "SIGNER",
          value: isLive ? "ARMED" : "STBY",
          health: isLive ? "warn" : "idle",
          detail: isLive ? "isolated process · vault" : "paper mode",
        },
        {
          label: "PIPELINE",
          value: isRunning ? "READY" : "WAIT",
          health: isRunning ? "ok" : "idle",
          pulse: isRunning,
          detail: "build → sim → gas → sign → broadcast",
        },
        {
          label: "LATENCY",
          // Show time-since-last-loop OR session uptime if engine never ran
          value: s.lastLoopAt
            ? timeAgo(s.lastLoopAt)
            : isRunning
            ? "0s"
            : sessionUptimeLabel,
          health: isRunning ? "ok" : "idle",
          detail: s.lastLoopAt ? "último loop" : "session uptime",
        },
        {
          label: "NEXT",
          value: s.nextLoopAt
            ? timeAgo(s.nextLoopAt)
            : isRunning
            ? "—"
            : "—",
          health: "idle",
          detail: "próximo tick",
        },
        {
          label: "ROUND",
          value: s.currentRoundId != null ? `#${s.currentRoundId}` : `iter #${s.loopIteration}`,
          health: "ok",
          detail: `iter #${s.loopIteration}`,
        },
      ]
    : [];

  /* ----- telemetry strip tiles ----- */
  const telemetryTiles: TelemetryTileData[] = [
    {
      label: "CPU",
      value: systemInfo.data
        ? `${Math.min(100, Math.round((systemInfo.data.runtime.heapUsedMb / Math.max(1, systemInfo.data.runtime.heapTotalMb)) * 100))}%`
        : "—",
      health: "ok",
      sub: "heap util",
    },
    {
      label: "RAM",
      value: systemInfo.data ? `${systemInfo.data.runtime.rssMb.toFixed(0)}MB` : "—",
      health: "ok",
      sub: "rss",
    },
    {
      label: "ITER",
      value: s ? `#${s.loopIteration}` : "—",
      health: "ok",
      sub: "loop iteration",
    },
    {
      label: "OPEN",
      value: s?.openPositionsCount ?? 0,
      health: (s?.openPositionsCount ?? 0) > 0 ? "warn" : "idle",
      sub: "positions",
      accent: (s?.openPositionsCount ?? 0) > 0 ? "amber" : "neutral",
    },
    {
      label: "TPS",
      value: s
        ? `${((s.totalPositionsClosed + s.totalPositionsOpened) / Math.max(1, systemInfo.data?.runtime.uptimeSec ?? 1)).toFixed(2)}`
        : "—",
      health: "ok",
      sub: "trades/sec",
    },
    {
      label: "QUEUE",
      value: "0",
      health: "ok",
      sub: "pending tx",
    },
    {
      label: "WORKERS",
      value: isRunning ? "1" : "0",
      health: isRunning ? "ok" : "idle",
      pulse: isRunning,
      sub: "active",
    },
    {
      label: "PAPER",
      value: s ? `${s.paperCyclesPassed}/${s.paperCyclesRequired}` : "—",
      health: s && s.graduatedToLive ? "ok" : "warn",
      sub: s?.graduatedToLive ? "graduado" : "pendente",
      accent: s?.graduatedToLive ? "emerald" : "amber",
    },
    {
      label: "SCAM DB",
      value: scamReports.data?.length ?? 0,
      health: "ok",
      sub: "reports",
      accent: "red",
    },
    {
      label: "PLATFORMS",
      value: platforms.data ? `${platforms.data.approved}/${platforms.data.total}` : "—",
      health: "ok",
      sub: "approved",
      accent: "cyan",
    },
    {
      label: "SURVEIL",
      value: surveillance.data?.counts.total ?? 0,
      health:
        (surveillance.data?.counts.critical ?? 0) > 0
          ? "error"
          : (surveillance.data?.counts.warning ?? 0) > 0
          ? "warn"
          : "ok",
      sub: "alerts",
      accent:
        (surveillance.data?.counts.critical ?? 0) > 0
          ? "red"
          : (surveillance.data?.counts.warning ?? 0) > 0
          ? "amber"
          : "neutral",
    },
    {
      label: "DB",
      value: systemInfo.data ? `${systemInfo.data.db.sizeMb.toFixed(1)}MB` : "—",
      health: "ok",
      sub: "sqlite",
    },
    {
      label: "UPTIME",
      value: systemInfo.data
        ? `${Math.floor(systemInfo.data.runtime.uptimeSec / 60)}m`
        : "—",
      health: "ok",
      sub: "minutes",
    },
    {
      label: "MEV",
      value: "OK",
      health: "ok",
      sub: "baseline",
      accent: "emerald",
    },
    {
      label: "SIM",
      value: "OK",
      health: "ok",
      sub: "simulation gate",
      accent: "emerald",
    },
    {
      label: "AUTH",
      value: "OK",
      health: "ok",
      sub: "token authority",
      accent: "cyan",
    },
  ];

  /* ----- loading state ----- */
  if (status.isLoading || !s) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background relative z-10">
        <div className="text-center space-y-4">
          <div className="size-12 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin mx-auto" />
          <div className="text-sm text-muted-foreground label-mono tracking-wider">
            BOOTING TERMINAL…
          </div>
          <Button onClick={() => initDb.mutate()} variant="outline" size="sm">
            Inicializar banco
          </Button>
        </div>
      </div>
    );
  }

  /* ============================================ RENDER */
  return (
    <div className="min-h-screen bg-background text-foreground relative z-10">
      <AlertsToast />

      {/* =================================================== TERMINAL HEADER */}
      <TerminalHeader
        engineStatus={s.status}
        engineMode={s.mode}
        loopState={s.killSwitchReason ?? s.loopState}
        indicators={headerIndicators}
        onStart={() => startEngine.mutate()}
        onStop={() => stopEngine.mutate()}
        onKill={() => activateKill.mutate()}
        startDisabled={startEngine.isPending || isKilled}
        stopDisabled={stopEngine.isPending}
        killDisabled={activateKill.isPending || isKilled}
        isStarting={startEngine.isPending}
        isStopping={stopEngine.isPending}
        isKilling={activateKill.isPending}
        notificationCount={surveillance.data?.counts.total ?? 0}
        onNotificationsClick={() => {
          /* could scroll-to / open tab */
        }}
      />

      {/* Kill-switch deactivation banner (when killed) */}
      {isKilled && (
        <div className="container mx-auto px-4 lg:px-6 pt-3">
          <div className="terminal-card rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap border-red-500/30">
            <div className="flex items-center gap-2.5 min-w-0">
              <Ban className="size-4 text-red-400 shrink-0" />
              <div className="min-w-0">
                <span className="label-mono text-[10px] text-red-300 font-semibold">
                  KILL SWITCH ATIVO
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  Engine parada · posições liquidadas · saques bloqueados
                </span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => deactivateKill.mutate()}
              disabled={deactivateKill.isPending}
              className="h-7 text-[11px] border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              Desativar
            </Button>
          </div>
        </div>
      )}

      {/* =================================================== PAPER MODE BANNER (compact) */}
      {s.mode === "paper" && !s.graduatedToLive && (
        <div className="container mx-auto px-4 lg:px-6 pt-3">
          <div className="terminal-card rounded-lg px-4 py-2 flex items-center gap-2.5 flex-wrap border-cyan-500/20">
            <Info className="size-3.5 text-cyan-400 shrink-0" />
            <span className="label-mono text-[10px] text-cyan-300 font-semibold">
              PAPER MODE
            </span>
            <span className="text-[11px] text-muted-foreground">
              Operando com preços reais, sem capital. Live libera após{" "}
              <span className="text-foreground font-medium tabular">
                {s.paperCyclesRequired}
              </span>{" "}
              ciclos positivos ·{" "}
              <span className="text-emerald-400 tabular">{s.paperCyclesPassed}</span>/
              {s.paperCyclesRequired}
            </span>
          </div>
        </div>
      )}

      {/* =================================================== MAIN */}
      <main className="container mx-auto px-4 lg:px-6 py-4 space-y-4 relative z-10">
        {/* ---------- EQUITY HERO — focal point, ~40-50% above fold ---------- */}
        <EquityHero
          data={equityData}
          currentEquity={currentEquity}
          peakEquity={peakEquity}
          realizedPnl={s.realizedPnlUsd}
          initialCapital={initialCapital}
          unrealizedPnl={unrealizedPnl}
          reserveBalance={s.reserveBalanceUsd}
          tradingBalance={s.tradingBalanceUsd}
          isLive={isLive}
          isRunning={isRunning}
        />

        {/* ---------- TELEMETRY STRIP — dense system indicators ---------- */}
        <TelemetryStrip title="TELEMETRY" tiles={telemetryTiles} />

        {/* ---------- INSTRUMENT METRICS — 8 aircraft-panel cards ---------- */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2.5">
          <InstrumentMetric
            label="TRADING BALANCE"
            value={fmtUsd(s.tradingBalanceUsd)}
            accent="emerald"
            icon={<Wallet className="size-3.5" />}
            spark={balanceSpark}
            trend={{ value: balanceTrendPct, label: "vs peak" }}
            flashOnChange
            flashKey={s.tradingBalanceUsd}
            statusHint="DEPLOY"
            subStats={[
              { label: "PEAK", value: fmtUsdCompact(s.peakBalanceUsd) },
              { label: "LIVE READY", value: s.graduatedToLive ? "YES" : "NO", accent: "neutral" },
            ]}
          />
          <InstrumentMetric
            label="REALIZED PNL"
            value={
              <span className={s.realizedPnlUsd >= 0 ? "text-emerald-300" : "text-red-300"}>
                {s.realizedPnlUsd >= 0 ? "+" : ""}{fmtUsdCompact(s.realizedPnlUsd)}
              </span>
            }
            accent={s.realizedPnlUsd >= 0 ? "emerald" : "red"}
            icon={s.realizedPnlUsd >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            spark={pnlSpark}
            trend={{ value: pnlTrendPct, label: "5R" }}
            flashOnChange
            flashKey={s.realizedPnlUsd}
            statusHint="LIFETIME"
            subStats={[
              { label: "WINS", value: s.wins, accent: "emerald" },
              { label: "LOSSES", value: s.losses, accent: "red" },
            ]}
          />
          <InstrumentMetric
            label="UNREALIZED"
            value={
              <span className={unrealizedPnl >= 0 ? "text-emerald-300" : "text-red-300"}>
                {unrealizedPnl >= 0 ? "+" : ""}{fmtUsdCompact(unrealizedPnl)}
              </span>
            }
            accent={unrealizedPnl >= 0 ? "emerald" : "red"}
            icon={<Hourglass className="size-3.5" />}
            statusHint="OPEN"
            subStats={[
              { label: "POSITIONS", value: s.openPositionsCount },
              { label: "EXPOSURE", value: fmtUsdCompact(exposureUsd) },
            ]}
          />
          <InstrumentMetric
            label="ROI"
            value={
              <span className={roiPct >= 0 ? "text-emerald-300" : "text-red-300"}>
                {roiPct >= 0 ? "+" : ""}{roiPct.toFixed(2)}%
              </span>
            }
            accent={roiPct >= 0 ? "emerald" : "red"}
            icon={<Percent className="size-3.5" />}
            statusHint="ALL-TIME"
            progress={Math.max(0, Math.min(100, roiPct + 50))}
            subStats={[
              { label: "INITIAL", value: fmtUsdCompact(initialCapital) },
              { label: "NOW", value: fmtUsdCompact(currentEquity) },
            ]}
          />
          <InstrumentMetric
            label="DRAWDOWN"
            value={
              <span className="text-red-300">-{drawdownPct.toFixed(2)}%</span>
            }
            accent="red"
            icon={<TrendingDown className="size-3.5" />}
            statusHint="FROM PEAK"
            progress={Math.min(100, drawdownPct * 4)}
            subStats={[
              { label: "PEAK", value: fmtUsdCompact(peakEquity) },
              { label: "NOW", value: fmtUsdCompact(currentEquity) },
            ]}
          />
          <InstrumentMetric
            label="WIN RATE"
            value={`${s.winRate.toFixed(1)}%`}
            accent="violet"
            icon={<Target className="size-3.5" />}
            spark={winRateSpark}
            statusHint={`${s.wins + s.losses} TRADES`}
            progress={s.winRate}
            subStats={[
              { label: "W", value: s.wins, accent: "emerald" },
              { label: "L", value: s.losses, accent: "red" },
            ]}
          />
          <InstrumentMetric
            label="EXPOSURE"
            value={fmtUsdCompact(exposureUsd)}
            accent="amber"
            icon={<Crosshair className="size-3.5" />}
            statusHint="AT RISK"
            progress={s.tradingBalanceUsd > 0 ? (exposureUsd / s.tradingBalanceUsd) * 100 : 0}
            subStats={[
              { label: "POSITIONS", value: s.openPositionsCount },
              { label: "CAPITAL", value: fmtUsdCompact(s.tradingBalanceUsd) },
            ]}
          />
          <InstrumentMetric
            label="RESERVE"
            value={fmtUsd(s.reserveBalanceUsd)}
            accent="cyan"
            icon={<Lock className="size-3.5" />}
            spark={reserveSpark}
            statusHint="COLD"
            subStats={[
              { label: "DEPOSITED", value: fmtUsdCompact(reserve.data?.totalDepositedUsd ?? 0) },
              { label: "WITHDRAWN", value: fmtUsdCompact(reserve.data?.totalWithdrawnUsd ?? 0) },
            ]}
          />
        </section>

        {/* ---------- POSITIONS + LOGS (always-visible terminal panels) ---------- */}
        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Positions table — takes 2/3 width on xl */}
          <div className="xl:col-span-2">
            <PositionsTable
              positions={positions.data ?? []}
              isLoading={positions.isLoading}
            />
          </div>

          {/* Logs feed — 1/3 width on xl, always visible (terminal feel) */}
          <div>
            <LogsFeed logs={logs.data ?? []} isLoading={logs.isLoading} />
          </div>
        </section>

        {/* =================================================== EXPLORER TABS */}
        <Tabs defaultValue="market" className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Boxes className="size-3.5 text-muted-foreground" />
              <span className="label-mono text-[10px] text-muted-foreground font-semibold tracking-wider">
                EXPLORER
              </span>
            </div>
            <TabsList className="terminal-card rounded-md p-1 h-auto flex flex-wrap gap-0.5 justify-start">
              <TabsTrigger value="market" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <BarChart3 className="size-3" /> Mercado
              </TabsTrigger>
              <TabsTrigger value="ai" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <Brain className="size-3" /> AI
              </TabsTrigger>
              <TabsTrigger value="positions" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <Activity className="size-3" /> Posições
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <History className="size-3" /> Histórico
              </TabsTrigger>
              <TabsTrigger value="rounds" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <Coins className="size-3" /> Rounds
              </TabsTrigger>
              <TabsTrigger value="scam" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <Shield className="size-3" /> Scam
              </TabsTrigger>
              <TabsTrigger value="site" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <Globe className="size-3" /> Site Audit
              </TabsTrigger>
              <TabsTrigger value="platforms" className="gap-1.5 h-7 px-2.5 text-[11px] relative">
                <Building2 className="size-3" /> Plataformas
                {(platforms.data?.pending ?? 0) > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center size-3.5 rounded-full bg-amber-500/20 text-amber-300 text-[8px] font-bold">
                    {platforms.data?.pending}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="surveillance" className="gap-1.5 h-7 px-2.5 text-[11px] relative">
                <ShieldAlert className="size-3" /> Vigilância
                {(surveillance.data?.counts.total ?? 0) > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center size-3.5 rounded-full bg-red-500/20 text-red-300 text-[8px] font-bold">
                    {surveillance.data?.counts.total}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="backtest" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <FlaskConical className="size-3" /> Backtest
              </TabsTrigger>
              <TabsTrigger value="analytics" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <LineChart className="size-3" /> Analytics
              </TabsTrigger>
              <TabsTrigger value="notifications" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <Bell className="size-3" /> Alertas
              </TabsTrigger>
              <TabsTrigger value="system" className="gap-1.5 h-7 px-2.5 text-[11px]">
                <Server className="size-3" /> Sistema
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="market" className="space-y-3 mt-0">
            <MarketPanel data={market.data} isLoading={market.isLoading} />
          </TabsContent>
          <TabsContent value="ai" className="space-y-3 mt-0">
            <AIInsightsPanel insights={aiInsights.data ?? []} isLoading={aiInsights.isLoading} />
          </TabsContent>
          <TabsContent value="positions" className="space-y-3 mt-0">
            <PositionsTable positions={positions.data ?? []} isLoading={positions.isLoading} />
          </TabsContent>
          <TabsContent value="history" className="space-y-3 mt-0">
            <HistoryTable history={history.data ?? []} isLoading={history.isLoading} />
          </TabsContent>
          <TabsContent value="rounds" className="space-y-3 mt-0">
            <RoundsTable rounds={rounds.data ?? []} isLoading={rounds.isLoading} />
          </TabsContent>
          <TabsContent value="scam" className="space-y-3 mt-0">
            <ScamReportsList reports={scamReports.data ?? []} isLoading={scamReports.isLoading} />
          </TabsContent>
          <TabsContent value="site" className="space-y-3 mt-0">
            <SiteAuditPanel audits={siteAudits.data ?? []} isLoading={siteAudits.isLoading} />
          </TabsContent>
          <TabsContent value="platforms" className="space-y-3 mt-0">
            <PlatformScannerPanel />
          </TabsContent>
          <TabsContent value="surveillance" className="space-y-3 mt-0">
            <SurveillancePanel
              alerts={surveillance.data?.alerts ?? []}
              counts={surveillance.data?.counts ?? { critical: 0, warning: 0, info: 0, total: 0 }}
              isLoading={surveillance.isLoading}
            />
          </TabsContent>
          <TabsContent value="backtest" className="space-y-3 mt-0">
            <BacktestPanel />
          </TabsContent>
          <TabsContent value="analytics" className="space-y-3 mt-0">
            <AnalyticsPanel />
          </TabsContent>
          <TabsContent value="notifications" className="space-y-3 mt-0">
            <NotificationsPanel />
          </TabsContent>
          <TabsContent value="system" className="space-y-3 mt-0">
            <SystemPanel />
          </TabsContent>
        </Tabs>

        {/* =================================================== CONFIG + RESERVE (compact, side-by-side) */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Reserve withdrawal — compact */}
          <div className="terminal-card rounded-lg p-4 lg:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="size-4 text-cyan-400" />
              <h3 className="label-mono text-[11px] font-semibold tracking-wider">
                RESERVA · SAQUE MANUAL
              </h3>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3 leading-snug">
              Único caminho de retirar fundos. Em paper mode, é apenas contábil.
            </p>
            <div className="space-y-2">
              <Label htmlFor="withdraw" className="label-mono text-[10px] text-muted-foreground">
                VALOR (USD)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="withdraw"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={reserveWithdrawAmount}
                  onChange={(e) => setReserveWithdrawAmount(e.target.value)}
                  className="h-8 text-sm tabular bg-muted/30 border-border/60"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    const v = parseFloat(reserveWithdrawAmount);
                    if (!isNaN(v) && v > 0) withdrawReserve.mutate(v);
                  }}
                  disabled={
                    withdrawReserve.isPending ||
                    !reserveWithdrawAmount ||
                    parseFloat(reserveWithdrawAmount) <= 0
                  }
                  className="gap-1.5 h-8"
                >
                  <Lock className="size-3.5" />
                  Sacar
                </Button>
              </div>
              {reserve.data && (
                <p className="text-[10px] text-muted-foreground pt-1 tabular">
                  Saldo: {fmtUsd(reserve.data.balanceUsd)} · Lifetime saques:{" "}
                  {fmtUsd(reserve.data.totalWithdrawnUsd)}
                </p>
              )}
            </div>
          </div>

          {/* Config editor — takes 2 cols */}
          <div className="lg:col-span-2">
            <ConfigEditor config={config.data} isLoading={config.isLoading} />
          </div>
        </section>

        {/* =================================================== FOOTER (minimal) */}
        <footer className="pt-2 pb-4 flex items-center justify-between gap-3 flex-wrap text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="label-mono font-semibold">AUTO TRADER v0.3</span>
            <span>·</span>
            <span className="label-mono">CYBER FINANCIAL TERMINAL</span>
            <span>·</span>
            <span>Next.js 16 · Prisma/SQLite · BSC · DexScreener · GoPlus · GLM LLM</span>
          </div>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="size-3 text-amber-500/70" />
            <span>Reduz risco, não elimina. Não é aconselhamento financeiro.</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
