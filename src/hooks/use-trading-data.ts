"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { WatchlistTokenRow } from "@/lib/trading/watchlist";
import type { AIInsightResult } from "@/lib/trading/ai-agent";

export interface EngineSnapshot {
  status: "stopped" | "running" | "killed" | "paused";
  mode: "paper" | "live";
  loopState: string;
  lastLoopAt: string | null;
  nextLoopAt: string | null;
  tradingBalanceUsd: number;
  reserveBalanceUsd: number;
  peakBalanceUsd: number;
  realizedPnlUsd: number;
  openPositionsCount: number;
  totalPositionsOpened: number;
  totalPositionsClosed: number;
  wins: number;
  losses: number;
  winRate: number;
  paperCyclesPassed: number;
  paperCyclesRequired: number;
  graduatedToLive: boolean;
  killSwitchActive: boolean;
  killSwitchReason: string | null;
  currentRoundId: number | null;
  loopIteration: number;
}

export function useEngineStatus() {
  return useQuery<EngineSnapshot>({
    queryKey: ["engine-status"],
    queryFn: async () => {
      const r = await fetch("/api/status");
      if (!r.ok) throw new Error("status failed");
      return r.json();
    },
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });
}

export interface PositionRow {
  id: string;
  symbol: string;
  source: "cex" | "dex";
  chain?: string | null;
  tokenId?: string | null;
  status: string;
  entryPriceUsd: number;
  entryAmountUsd: number;
  entryQty: number;
  entryAt: string;
  exitPriceUsd?: number | null;
  exitAmountUsd?: number | null;
  exitAt?: string | null;
  exitReason?: string | null;
  pnlUsd?: number | null;
  pnlPct?: number | null;
  takeProfitPrice: number;
  stopLossPrice: number;
  maxExitAt: string;
  scamScore: number;
  roundId: number;
  currentPriceUsd?: number;
  unrealizedPnlUsd?: number;
  unrealizedPnlPct?: number;
}

export function useOpenPositions() {
  return useQuery<PositionRow[]>({
    queryKey: ["open-positions"],
    queryFn: async () => {
      const r = await fetch("/api/positions");
      if (!r.ok) throw new Error("positions failed");
      return r.json();
    },
    refetchInterval: 5000,
  });
}

export function useHistory(limit = 50) {
  return useQuery<PositionRow[]>({
    queryKey: ["history", limit],
    queryFn: async () => {
      const r = await fetch(`/api/history?limit=${limit}`);
      if (!r.ok) throw new Error("history failed");
      return r.json();
    },
    refetchInterval: 10000,
  });
}

export interface LogRow {
  id: number;
  level: string;
  source: string;
  message: string;
  context?: string | null;
  createdAt: string;
}

export function useLogs(limit = 80) {
  return useQuery<LogRow[]>({
    queryKey: ["logs", limit],
    queryFn: async () => {
      const r = await fetch(`/api/logs?limit=${limit}`);
      if (!r.ok) throw new Error("logs failed");
      return r.json();
    },
    refetchInterval: 4000,
  });
}

export interface ScamReportRow {
  id: string;
  symbol: string;
  tokenId?: string | null;
  chain?: string | null;
  score: number;
  passed: boolean;
  honeypotScore: number;
  liquidityScore: number;
  contractScore: number;
  taxScore: number;
  holderScore: number;
  ageScore: number;
  findings: Record<string, string[]>;
  analyzedAt: string;
}

export function useScamReports(limit = 30) {
  return useQuery<ScamReportRow[]>({
    queryKey: ["scam-reports", limit],
    queryFn: async () => {
      const r = await fetch(`/api/scam-reports?limit=${limit}`);
      if (!r.ok) throw new Error("scam-reports failed");
      return r.json();
    },
    refetchInterval: 10000,
  });
}

export interface RoundRow {
  id: number;
  startedAt: string;
  endedAt?: string | null;
  tradingBalanceUsd: number;
  reserveBalanceUsd: number;
  tokensScanned: number;
  tokensPassedFilter: number;
  tokensRejectedScam: number;
  positionsOpened: number;
  positionsClosed: number;
  roundPnlUsd?: number | null;
  status: string;
  notes?: string | null;
}

export function useRounds() {
  return useQuery<RoundRow[]>({
    queryKey: ["rounds"],
    queryFn: async () => {
      const r = await fetch("/api/rounds");
      if (!r.ok) throw new Error("rounds failed");
      return r.json();
    },
    refetchInterval: 10000,
  });
}

export interface ReserveData {
  asset: string;
  balanceUsd: number;
  totalDepositedUsd: number;
  totalWithdrawnUsd: number;
  updatedAt: string;
}

export function useReserve() {
  return useQuery<ReserveData>({
    queryKey: ["reserve"],
    queryFn: async () => {
      const r = await fetch("/api/reserve");
      if (!r.ok) throw new Error("reserve failed");
      return r.json();
    },
    refetchInterval: 5000,
  });
}

export interface EngineConfig {
  mode: "paper" | "live";
  loopIntervalSec: number;
  initialCapitalUsd: number;
  maxPositionsPerRound: number;
  capitalPctPerRound: number;
  reservePct: number;
  reinvestPct: number;
  reserveAsset: string;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldMinutes: number;
  maxDailyLossPct: number;
  maxLossPerTradePct: number;
  maxExposurePerTokenPct: number;
  maxDrawdownPct: number;
  scamScoreMin: number;
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  scanCex: boolean;
  scanDex: boolean;
  cexSymbols: string[];
  dexChains: string[];
  engineRunning: boolean;
  killSwitchActive: boolean;
  killSwitchReason: string | null;
  killSwitchAt: string | null;
  paperCyclesRequired: number;
  paperCyclesPassed: number;
  graduatedToLive: boolean;
}

export function useConfig() {
  return useQuery<EngineConfig>({
    queryKey: ["config"],
    queryFn: async () => {
      const r = await fetch("/api/config");
      if (!r.ok) throw new Error("config failed");
      return r.json();
    },
    refetchInterval: 15000,
  });
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------
export interface MarketSnapshotRow {
  id: number;
  symbol: string;
  source: string;
  chain?: string | null;
  tokenId?: string | null;
  priceUsd: number;
  rsi14: number | null;
  macdHist: number | null;
  ema20: number | null;
  ema50: number | null;
  bollUpper: number | null;
  bollLower: number | null;
  bollPercent: number | null;
  fearGreedIndex: number | null;
  fearGreedClass: string | null;
  trendingRank: number | null;
  signalScore: number;
  signalLabel: string;
  analyzedAt: string;
}

export interface FearGreedData {
  value: number;
  classification: string;
  timestamp: string;
}

export interface TrendingToken {
  id: string;
  symbol: string;
  rank: number;
}

export interface MarketData {
  snapshots: MarketSnapshotRow[];
  fearGreed: FearGreedData | null;
  trending: TrendingToken[];
}

export function useMarketData(limit = 30) {
  return useQuery<MarketData>({
    queryKey: ["market", limit],
    queryFn: async () => {
      const r = await fetch(`/api/market?limit=${limit}`);
      if (!r.ok) throw new Error("market failed");
      return r.json();
    },
    refetchInterval: 15000,
  });
}

// ---------------------------------------------------------------------------
// AI insights
// ---------------------------------------------------------------------------
export interface AIInsightRow {
  id: number;
  agentRole: string;
  symbol: string | null;
  tokenId: string | null;
  chain: string | null;
  promptSummary: string;
  modelOutput: string;
  recommendation: string;
  confidence: number;
  keySignals: string[];
  tokensUsed: number;
  durationMs: number;
  error: string | null;
  createdAt: string;
}

export function useAIInsights(limit = 50, role?: string) {
  return useQuery<AIInsightRow[]>({
    queryKey: ["ai-insights", limit, role],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (role) params.set("role", role);
      const r = await fetch(`/api/ai-insights?${params}`);
      if (!r.ok) throw new Error("ai-insights failed");
      return r.json();
    },
    refetchInterval: 10000,
  });
}

// ---------------------------------------------------------------------------
// Site audits
// ---------------------------------------------------------------------------
export interface SiteAuditRow {
  id: number;
  url: string;
  symbol: string | null;
  tokenId: string | null;
  chain: string | null;
  score: number;
  passed: boolean;
  sslScore: number;
  domainAgeScore: number;
  headersScore: number;
  safeBrowsingScore: number;
  contentScore: number;
  sslValid: boolean;
  sslDaysToExpiry: number | null;
  domainAgeDays: number | null;
  hstsPresent: boolean;
  cspPresent: boolean;
  xfoPresent: boolean;
  safeBrowsingFlagged: boolean;
  redFlags: string[];
  findings: Record<string, string[]>;
  auditedAt: string;
}

export function useSiteAudits(limit = 30) {
  return useQuery<SiteAuditRow[]>({
    queryKey: ["site-audits", limit],
    queryFn: async () => {
      const r = await fetch(`/api/site-audit?limit=${limit}`);
      if (!r.ok) throw new Error("site-audit failed");
      return r.json();
    },
    refetchInterval: 15000,
  });
}

// ---------------------------------------------------------------------------
// Position surveillance alerts
// ---------------------------------------------------------------------------
export type AlertType =
  | "goplus_critical_flag"
  | "liquidity_drain"
  | "price_dump_velocity"
  | "holder_concentration"
  | "tax_spike"
  | "timeout_approaching"
  | "price_anomaly";

export type AlertSeverity = "info" | "warning" | "critical";

export interface SurveillanceAlertRow {
  id: number;
  positionId: string;
  symbol: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  context: Record<string, unknown>;
  detectedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface SurveillanceData {
  alerts: SurveillanceAlertRow[];
  counts: {
    critical: number;
    warning: number;
    info: number;
    total: number;
  };
}

export function useSurveillance(limit = 50, onlyOpen = false) {
  return useQuery<SurveillanceData>({
    queryKey: ["surveillance", limit, onlyOpen],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (onlyOpen) params.set("open", "1");
      const r = await fetch(`/api/surveillance?${params}`);
      if (!r.ok) throw new Error("surveillance failed");
      return r.json();
    },
    refetchInterval: 5000,
  });
}

// ---------------------------------------------------------------------------
// Platform scanner
// ---------------------------------------------------------------------------
export type PlatformKind = "cex" | "dex" | "aggregator" | "data";

export interface PlatformScanResult {
  id: string;
  name: string;
  url: string;
  kind: PlatformKind;
  chains?: string[];
  notes?: string;
  audit: {
    url: string;
    score: number;
    passed: boolean;
    sslScore: number;
    domainAgeScore: number;
    headersScore: number;
    safeBrowsingScore: number;
    contentScore: number;
    sslValid: boolean;
    sslDaysToExpiry: number | null;
    domainAgeDays: number | null;
    hstsPresent: boolean;
    cspPresent: boolean;
    xfoPresent: boolean;
    safeBrowsingFlagged: boolean;
    redFlags: string[];
    findings: Record<string, string[]>;
  } | null;
  approved: boolean;
  rejectionReason?: string;
  scannedAt: string | null;
}

export interface PlatformScanSummary {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  results: PlatformScanResult[];
}

export function usePlatforms() {
  return useQuery<PlatformScanSummary>({
    queryKey: ["platforms"],
    queryFn: async () => {
      const r = await fetch("/api/platforms");
      if (!r.ok) throw new Error("platforms failed");
      return r.json();
    },
    refetchInterval: 30000,
  });
}

// ---------------------------------------------------------------------------
// Backtest
// ---------------------------------------------------------------------------
export interface BacktestParams {
  symbols: string[];
  interval: string;
  periodDays: number;
  initialCapitalUsd: number;
  perTradeUsd: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldBars: number;
  rsiEntryMax: number;
  rsiExitMin: number;
}

export interface BacktestSummary {
  id: number;
  symbols: string[];
  interval: string;
  periodDays: number;
  initialCapitalUsd: number;
  perTradeUsd: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldBars: number;
  rsiEntryMax: number;
  rsiExitMin: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgTradePnlUsd: number;
  avgHoldBars: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: string;
  error: string | null;
}

export function useBacktests(limit = 20) {
  return useQuery<{ backtests: BacktestSummary[] }>({
    queryKey: ["backtests", limit],
    queryFn: async () => {
      const r = await fetch(`/api/backtest?limit=${limit}`);
      if (!r.ok) throw new Error("backtests failed");
      return r.json();
    },
    refetchInterval: 5000,
  });
}

export interface BacktestTrade {
  symbol: string;
  entryBar: number;
  exitBar: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnlUsd: number;
  pnlPct: number;
  holdBars: number;
  reason: "take_profit" | "stop_loss" | "timeout" | "rsi_exit";
}

export interface BacktestEquityPoint {
  bar: number;
  equityUsd: number;
  cashUsd: number;
  openTradeUnrealizedUsd: number;
}

export interface BacktestDetail extends BacktestSummary {
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
}

export function useBacktest(id: number | null) {
  return useQuery<BacktestDetail>({
    queryKey: ["backtest", id],
    queryFn: async () => {
      if (id === null) throw new Error("no id");
      const r = await fetch(`/api/backtest?id=${id}`);
      if (!r.ok) throw new Error("backtest failed");
      return r.json();
    },
    enabled: id !== null,
    refetchInterval: 3000,
  });
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
export type AnalyticsRange = "24h" | "7d" | "30d" | "all";

export interface EquityPoint {
  timestamp: string;
  tradingBalanceUsd: number;
  reserveBalanceUsd: number;
  peakBalanceUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalEquityUsd: number;
  openPositionsCount: number;
  drawdownPct: number;
}

export interface AnalyticsSummary {
  startEquityUsd: number;
  endEquityUsd: number;
  absChangeUsd: number;
  pctChange: number;
  maxEquityUsd: number;
  minEquityUsd: number;
  maxDrawdownPct: number;
  snapshotCount: number;
  rangeStart: string | null;
  rangeEnd: string | null;
}

export interface BySymbolRow {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlUsd: number;
  avgPnlUsd: number;
}

export interface ByDowRow {
  dow: number;
  trades: number;
  wins: number;
  losses: number;
  totalPnlUsd: number;
}

export interface ByHourRow {
  hour: number;
  trades: number;
  wins: number;
  losses: number;
  totalPnlUsd: number;
}

export interface AnalyticsData {
  range: AnalyticsRange;
  equityCurve: EquityPoint[];
  summary: AnalyticsSummary | null;
  bySymbol: BySymbolRow[];
  byDayOfWeek: ByDowRow[];
  byHour: ByHourRow[];
  streaks: {
    currentWinStreak: number;
    currentLossStreak: number;
    longestWinStreak: number;
    longestLossStreak: number;
  };
  bestTrade: {
    symbol: string;
    pnlUsd: number;
    pnlPct: number;
    exitAt: string;
  } | null;
  worstTrade: {
    symbol: string;
    pnlUsd: number;
    pnlPct: number;
    exitAt: string;
  } | null;
  closedPositionsCount: number;
}

export function useAnalytics(range: AnalyticsRange = "24h") {
  return useQuery<AnalyticsData>({
    queryKey: ["analytics", range],
    queryFn: async () => {
      const r = await fetch(`/api/analytics?range=${range}`);
      if (!r.ok) throw new Error("analytics failed");
      return r.json();
    },
    refetchInterval: 10000,
  });
}

// ---------------------------------------------------------------------------
// Notifications — external channels (Telegram/Discord/Webhook) + dispatch logs
// ---------------------------------------------------------------------------

export type NotificationEventType =
  | "kill_switch_on"
  | "kill_switch_off"
  | "position_opened"
  | "position_closed"
  | "drawdown_breach"
  | "daily_loss_breach"
  | "graduation"
  | "engine_started"
  | "engine_stopped";

export type ChannelType = "telegram" | "discord" | "webhook";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}
export interface DiscordConfig {
  webhookUrl: string;
}
export interface WebhookConfig {
  url: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
}

export interface NotificationChannelRow {
  id: string;
  name: string;
  type: ChannelType;
  config: TelegramConfig | DiscordConfig | WebhookConfig;
  events: NotificationEventType[];
  enabled: boolean;
  throttleSec: number;
}

export interface NotificationEventTypeMeta {
  value: NotificationEventType;
  label: string;
  description: string;
}

export interface NotificationLogRow {
  id: number;
  channelId: string;
  channelName: string;
  channelType: string;
  eventType: string;
  message: string;
  status: string;
  error: string | null;
  durationMs: number;
  sentAt: string;
}

export function useNotificationChannels() {
  return useQuery<{
    channels: NotificationChannelRow[];
    eventTypes: NotificationEventTypeMeta[];
  }>({
    queryKey: ["notif-channels"],
    queryFn: async () => {
      const r = await fetch("/api/notifications/channels");
      if (!r.ok) throw new Error("channels failed");
      return r.json();
    },
    refetchInterval: 15000,
  });
}

export function useNotificationLogs(limit = 100) {
  return useQuery<{ logs: NotificationLogRow[]; total: number }>({
    queryKey: ["notif-logs", limit],
    queryFn: async () => {
      const r = await fetch(`/api/notifications/logs?limit=${limit}`);
      if (!r.ok) throw new Error("logs failed");
      return r.json();
    },
    refetchInterval: 5000,
  });
}

// ---------------------------------------------------------------------------
// Trading Schedule + System (backup/info/maintenance)
// ---------------------------------------------------------------------------

export interface TradingScheduleData {
  enabled: boolean;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  forceCloseAtEnd: boolean;
  updatedAt: string;
}

export interface ScheduleStatusData {
  enabled: boolean;
  within: boolean;
  weekday: number;
  localTime: string;
  startTime: string;
  endTime: string;
  nextChange: "open" | "close" | null;
  reason: string;
}

export function useSchedule() {
  return useQuery<{ schedule: TradingScheduleData; status: ScheduleStatusData }>({
    queryKey: ["schedule"],
    queryFn: async () => {
      const r = await fetch("/api/schedule");
      if (!r.ok) throw new Error("schedule failed");
      return r.json();
    },
    refetchInterval: 10000,
  });
}

export interface SystemInfoData {
  tables: Record<string, number>;
  db: { path: string; sizeBytes: number; sizeMb: number };
  runtime: {
    uptimeSec: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    nodeVersion: string;
    platform: string;
    pid: number;
  };
  schema: { prismaModels: number };
  timestamp: string;
}

export function useSystemInfo() {
  return useQuery<SystemInfoData>({
    queryKey: ["system-info"],
    queryFn: async () => {
      const r = await fetch("/api/system/info");
      if (!r.ok) throw new Error("system info failed");
      return r.json();
    },
    refetchInterval: 15000,
  });
}

// ---------------------------------------------------------------------------
// Source health — external API reliability tracking
// ---------------------------------------------------------------------------
export interface SourceHealthRow {
  source: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMsg: string | null;
  successCount24h: number;
  errorCount24h: number;
  rateLimited: boolean;
  rateLimitUntil: string | null;
  windowStartedAt: string;
  windowSuccessCount: number;
  windowErrorCount: number;
  windowErrorRate: number;
  status: "healthy" | "degraded" | "down";
  isCritical: boolean;
}

export function useSourceHealth() {
  return useQuery<{ sources: SourceHealthRow[] }>({
    queryKey: ["source-health"],
    queryFn: async () => {
      const r = await fetch("/api/source-health");
      if (!r.ok) throw new Error("source-health failed");
      return r.json();
    },
    refetchInterval: 10000,
  });
}

// ---------------------------------------------------------------------------
// Position detail (for drawer)
// ---------------------------------------------------------------------------
export interface PositionDetailData {
  position: {
    id: string;
    symbol: string;
    source: "cex" | "dex";
    chain?: string | null;
    tokenId?: string | null;
    status: string;
    entryPriceUsd: number;
    entryAmountUsd: number;
    entryQty: number;
    entryAt: string;
    exitPriceUsd?: number | null;
    exitAmountUsd?: number | null;
    exitAt?: string | null;
    exitReason?: string | null;
    pnlUsd?: number | null;
    pnlPct?: number | null;
    takeProfitPrice: number;
    stopLossPrice: number;
    maxExitAt: string;
    scamScore: number;
    scamBreakdown?: Record<string, unknown> | null;
    roundId: number;
    currentPriceUsd?: number;
    unrealizedPnlUsd?: number;
    unrealizedPnlPct?: number;
  };
  scamReport?: {
    honeypotScore: number;
    liquidityScore: number;
    contractScore: number;
    taxScore: number;
    holderScore: number;
    ageScore: number;
    analyzedAt: string;
  } | null;
  surveillanceAlerts: Array<{
    id: number;
    severity: string;
    type: string;
    message: string;
    detectedAt: string;
    resolvedAt: string | null;
    resolution: string | null;
  }>;
  aiInsights: Array<{
    id: number;
    agentRole: string;
    recommendation: string;
    confidence: number;
    promptSummary: string;
    error: string | null;
    createdAt: string;
  }>;
  marketChart: Array<{
    t: string;
    p: number;
    rsi: number | null;
    signal: string;
  }>;
  round?: {
    id: number;
    startedAt: string;
    endedAt?: string | null;
    tokensScanned: number;
    tokensPassedFilter: number;
    positionsOpened: number;
    positionsClosed: number;
    roundPnlUsd?: number | null;
  } | null;
}

export function usePositionDetail(id: string | null) {
  return useQuery<PositionDetailData>({
    queryKey: ["position-detail", id],
    queryFn: async () => {
      if (id === null) throw new Error("no id");
      const r = await fetch(`/api/positions/${id}`);
      if (!r.ok) throw new Error("position detail failed");
      return r.json();
    },
    enabled: id !== null,
    refetchInterval: 5000,
  });
}

// ---------------------------------------------------------------------------
// Watchlist (operator-curated tokens — no auto-trading).
// Shapes mirror src/lib/trading/watchlist.ts (WatchlistTokenRow) and the
// /api/watchlist routes (GET/POST / PATCH/DELETE / POST reset_alert /
// POST [id]/analyze). Mutations invalidate ["watchlist"].
// ---------------------------------------------------------------------------
export type WatchlistToken = WatchlistTokenRow;
export type WatchlistInsight = AIInsightResult;

async function parseWatchlistError(r: Response, fallback: string): Promise<never> {
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? fallback);
}

export function useWatchlist() {
  return useQuery<WatchlistToken[]>({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const r = await fetch("/api/watchlist");
      if (!r.ok) await parseWatchlistError(r, "watchlist failed");
      const j = (await r.json()) as { tokens: WatchlistToken[] };
      return j.tokens;
    },
    refetchInterval: 15000,
  });
}

export interface AddWatchlistTokenInput {
  symbol: string;
  source: "cex" | "dex";
  chain?: string;
  tokenId?: string;
  notes?: string;
  alertThresholdPct?: number;
}

export function useAddWatchlistToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddWatchlistTokenInput): Promise<WatchlistToken> => {
      const r = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) await parseWatchlistError(r, "add watchlist token failed");
      const j = (await r.json()) as { token: WatchlistToken };
      return j.token;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });
}

export interface UpdateWatchlistTokenInput {
  id: string;
  patch: { notes?: string | null; alertThresholdPct?: number; enabled?: boolean };
}

export function useUpdateWatchlistToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateWatchlistTokenInput): Promise<WatchlistToken> => {
      const r = await fetch(`/api/watchlist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) await parseWatchlistError(r, "update watchlist token failed");
      const j = (await r.json()) as { token: WatchlistToken };
      return j.token;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });
}

export function useRemoveWatchlistToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
      if (!r.ok) await parseWatchlistError(r, "remove watchlist token failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });
}

export interface AnalyzeWatchlistTokenResult {
  insight: WatchlistInsight;
  durationMs: number;
}

export function useAnalyzeWatchlistToken() {
  return useMutation({
    mutationFn: async (id: string): Promise<AnalyzeWatchlistTokenResult> => {
      const r = await fetch(`/api/watchlist/${id}/analyze`, { method: "POST" });
      if (!r.ok) await parseWatchlistError(r, "analyze watchlist token failed");
      return (await r.json()) as AnalyzeWatchlistTokenResult;
    },
  });
}

export function useResetWatchlistAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await fetch(`/api/watchlist/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_alert" }),
      });
      if (!r.ok) await parseWatchlistError(r, "reset watchlist alert failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });
}
