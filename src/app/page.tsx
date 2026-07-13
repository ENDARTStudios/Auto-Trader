"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Activity,
  AlertTriangle,
  Ban,
  Play,
  Square,
  Shield,
  Skull,
  TrendingUp,
  TrendingDown,
  Wallet,
  Lock,
  Settings,
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
import { PortfolioSummaryCard } from "@/components/dashboard/portfolio-summary-card";
import { AlertsToast } from "@/components/dashboard/alerts-toast";
import { BacktestPanel } from "@/components/dashboard/backtest-panel";
import { AnalyticsPanel } from "@/components/dashboard/analytics-panel";

function fmtUsd(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
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

  const [reserveWithdrawAmount, setReserveWithdrawAmount] = useState("");

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

  // Auto-init DB on first load
  const initDb = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/initialize", { method: "POST" });
      return r.json();
    },
  });

  if (status.isLoading || !status.data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="animate-pulse text-2xl">Carregando dashboard...</div>
          <Button onClick={() => initDb.mutate()}>Inicializar banco</Button>
        </div>
      </div>
    );
  }

  const s = status.data;
  const isRunning = s.status === "running";
  const isKilled = s.status === "killed";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AlertsToast />
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Coins className="size-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-none">Auto Trader</h1>
                <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                  Paper trading • Self-custody • Scam-resistente
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant={s.mode === "live" ? "destructive" : "secondary"}
              className="gap-1"
            >
              <Shield className="size-3" />
              {s.mode.toUpperCase()}
            </Badge>
            <Badge
              variant={
                s.status === "running"
                  ? "default"
                  : s.status === "killed"
                  ? "destructive"
                  : "outline"
              }
              className="gap-1"
            >
              <Activity className={`size-3 ${isRunning ? "animate-pulse" : ""}`} />
              {s.status.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Gauge className="size-3" />
              {s.loopState}
            </Badge>
            <Badge variant="outline" className="gap-1">
              iter #{s.loopIteration}
            </Badge>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Risk disclaimer — always visible */}
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Aviso de risco — leia antes de qualquer coisa</AlertTitle>
          <AlertDescription>
            Este sistema <strong>reduz</strong> risco de scam e perdas, mas <strong>não elimina</strong>.
            Rug pulls sofisticados, bugs de contrato e eventos de mercado podem causar perda total.
            Mode <strong>paper</strong> simula com preços reais sem capital. Live mode só libera
            após {s.paperCyclesRequired} ciclos paper lucrativos. Nunca invista mais do que pode perder.
          </AlertDescription>
        </Alert>

        {/* Kill switch banner if active */}
        {isKilled && (
          <Alert variant="destructive" className="border-red-500 bg-red-500/10">
            <Skull className="size-4" />
            <AlertTitle>KILL SWITCH ATIVO</AlertTitle>
            <AlertDescription className="flex items-center justify-between flex-wrap gap-3">
              <span>
                Engine parada. Razão: <strong>{s.killSwitchReason ?? "—"}</strong>.
                Posições abertas serão forçadas a fechar no próximo tick.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => deactivateKill.mutate()}
                disabled={deactivateKill.isPending}
              >
                Desativar kill switch
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Engine controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2">
                <Activity className="size-5" />
                Controle da Engine
              </span>
              <div className="flex gap-2">
                {!isRunning ? (
                  <Button
                    size="sm"
                    onClick={() => startEngine.mutate()}
                    disabled={startEngine.isPending || isKilled}
                    className="gap-1"
                  >
                    <Play className="size-4" />
                    Iniciar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => stopEngine.mutate()}
                    disabled={stopEngine.isPending}
                    className="gap-1"
                  >
                    <Square className="size-4" />
                    Parar
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => activateKill.mutate()}
                  disabled={activateKill.isPending || isKilled}
                  className="gap-1"
                >
                  <Ban className="size-4" />
                  KILL SWITCH
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Último tick</p>
                <p className="font-medium">{timeAgo(s.lastLoopAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Próximo tick</p>
                <p className="font-medium">{timeAgo(s.nextLoopAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Round atual</p>
                <p className="font-medium">#{s.currentRoundId ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Graduação paper</p>
                <p className="font-medium">
                  {s.paperCyclesPassed}/{s.paperCyclesRequired}
                  {s.graduatedToLive && <span className="text-green-500 ml-1">✓</span>}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Platform gate</p>
                <p className="font-medium">
                  <span className={(() => {
                    const ap = platforms.data?.approved ?? 0;
                    const tot = platforms.data?.total ?? 0;
                    if (tot === 0) return "text-muted-foreground";
                    if (ap === tot) return "text-emerald-500";
                    if (ap < tot / 2) return "text-red-500";
                    return "text-yellow-500";
                  })()}>
                    {platforms.data?.approved ?? "?"}/{platforms.data?.total ?? "?"}
                  </span>
                  <span className="text-muted-foreground text-xs ml-1">aprovadas</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Balance cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Wallet className="size-4" />
                Saldo Trading
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{fmtUsd(s.tradingBalanceUsd)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Pico: {fmtUsd(s.peakBalanceUsd)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Lock className="size-4" />
                Reserva USDC (cold)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">
                {fmtUsd(s.reserveBalanceUsd)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {reserve.data
                  ? `Total depositado: ${fmtUsd(reserve.data.totalDepositedUsd)}`
                  : "—"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                {s.realizedPnlUsd >= 0 ? (
                  <TrendingUp className="size-4 text-green-500" />
                ) : (
                  <TrendingDown className="size-4 text-red-500" />
                )}
                P&L Realizado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  s.realizedPnlUsd >= 0 ? "text-green-500" : "text-red-500"
                }`}
              >
                {fmtUsd(s.realizedPnlUsd)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Win rate: {s.winRate.toFixed(1)}% ({s.wins}W / {s.losses}L)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Activity className="size-4" />
                Posições Abertas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.openPositionsCount}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Total abertas: {s.totalPositionsOpened} • fechadas: {s.totalPositionsClosed}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Portfolio summary — consolidated view */}
        <PortfolioSummaryCard
          status={s}
          positions={positions.data ?? []}
          rounds={rounds.data ?? []}
          surveillanceCounts={
            surveillance.data?.counts ?? { critical: 0, warning: 0, info: 0, total: 0 }
          }
          platforms={{
            approved: platforms.data?.approved ?? 0,
            total: platforms.data?.total ?? 0,
            pending: platforms.data?.pending ?? 0,
          }}
        />

        {/* Main tabs */}
        <Tabs defaultValue="positions" className="space-y-4">
          <TabsList className="grid grid-cols-2 md:grid-cols-12 w-full">
            <TabsTrigger value="positions" className="gap-1">
              <Activity className="size-3" /> Posições
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1">
              <History className="size-3" /> Histórico
            </TabsTrigger>
            <TabsTrigger value="market" className="gap-1">
              <BarChart3 className="size-3" /> Mercado
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-1">
              <Brain className="size-3" /> AI Agents
            </TabsTrigger>
            <TabsTrigger value="scam" className="gap-1">
              <Shield className="size-3" /> Scam Audit
            </TabsTrigger>
            <TabsTrigger value="site" className="gap-1">
              <Globe className="size-3" /> Site Audit
            </TabsTrigger>
            <TabsTrigger value="platforms" className="gap-1 relative">
              <Building2 className="size-3" /> Plataformas
              {(platforms.data?.pending ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">
                  {platforms.data?.pending}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="surveillance" className="gap-1 relative">
              <ShieldAlert className="size-3" /> Vigilância
              {(surveillance.data?.counts.total ?? 0) > 0 && (
                <Badge variant="destructive" className="ml-1 h-4 px-1 text-[9px]">
                  {surveillance.data?.counts.total}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="backtest" className="gap-1">
              <FlaskConical className="size-3" /> Backtest
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1">
              <LineChart className="size-3" /> Analytics
            </TabsTrigger>
            <TabsTrigger value="rounds" className="gap-1">
              <Coins className="size-3" /> Rounds
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-1">
              <ScrollText className="size-3" /> Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="space-y-4">
            <PositionsTable
              positions={positions.data ?? []}
              isLoading={positions.isLoading}
            />
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <HistoryTable
              history={history.data ?? []}
              isLoading={history.isLoading}
            />
          </TabsContent>

          <TabsContent value="market" className="space-y-4">
            <MarketPanel data={market.data} isLoading={market.isLoading} />
          </TabsContent>

          <TabsContent value="ai" className="space-y-4">
            <AIInsightsPanel
              insights={aiInsights.data ?? []}
              isLoading={aiInsights.isLoading}
            />
          </TabsContent>

          <TabsContent value="scam" className="space-y-4">
            <ScamReportsList
              reports={scamReports.data ?? []}
              isLoading={scamReports.isLoading}
            />
          </TabsContent>

          <TabsContent value="site" className="space-y-4">
            <SiteAuditPanel
              audits={siteAudits.data ?? []}
              isLoading={siteAudits.isLoading}
            />
          </TabsContent>

          <TabsContent value="platforms" className="space-y-4">
            <PlatformScannerPanel />
          </TabsContent>

          <TabsContent value="surveillance" className="space-y-4">
            <SurveillancePanel
              alerts={surveillance.data?.alerts ?? []}
              counts={surveillance.data?.counts ?? { critical: 0, warning: 0, info: 0, total: 0 }}
              isLoading={surveillance.isLoading}
            />
          </TabsContent>

          <TabsContent value="backtest" className="space-y-4">
            <BacktestPanel />
          </TabsContent>

          <TabsContent value="analytics" className="space-y-4">
            <AnalyticsPanel />
          </TabsContent>

          <TabsContent value="rounds" className="space-y-4">
            <RoundsTable rounds={rounds.data ?? []} isLoading={rounds.isLoading} />
          </TabsContent>

          <TabsContent value="logs" className="space-y-4">
            <LogsFeed logs={logs.data ?? []} isLoading={logs.isLoading} />
          </TabsContent>
        </Tabs>

        {/* Config editor */}
        <ConfigEditor config={config.data} isLoading={config.isLoading} />

        {/* Reserve withdrawal */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="size-5" />
              Reserva Cold Storage — Saque Manual
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertDescription>
                A reserva só sai daqui. Esta é a única forma de mover fundos para fora do sistema.
                Em paper mode, este saque é apenas contábil — não há transferência on-chain.
              </AlertDescription>
            </Alert>
            <div className="flex gap-2 items-end flex-wrap">
              <div className="space-y-2">
                <Label htmlFor="withdraw">Valor (USD)</Label>
                <Input
                  id="withdraw"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={reserveWithdrawAmount}
                  onChange={(e) => setReserveWithdrawAmount(e.target.value)}
                  className="w-48"
                />
              </div>
              <Button
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
                className="gap-1"
              >
                <Lock className="size-4" />
                Sacar da reserva
              </Button>
              {reserve.data && (
                <p className="text-xs text-muted-foreground">
                  Saldo atual: {fmtUsd(reserve.data.balanceUsd)} • Total sacado lifetime:{" "}
                  {fmtUsd(reserve.data.totalWithdrawnUsd)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <footer className="text-xs text-muted-foreground text-center py-6 space-y-1">
          <p>
            Auto Trader — Paper trading MVP • Stack: Next.js 16 + Prisma/SQLite + Binance REST + DexScreener + GoPlus + z-ai-web-dev-sdk LLM
          </p>
          <p>
            ⚠️ Sistema reduz risco, não elimina. Operações em capital real apenas após graduação
            validada. Não é aconselhamento financeiro.
          </p>
        </footer>
      </main>
    </div>
  );
}
