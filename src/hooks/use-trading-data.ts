"use client";

import { useQuery } from "@tanstack/react-query";

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
