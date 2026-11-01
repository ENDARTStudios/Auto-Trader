export interface PositionRow {
  id: string;
  symbol: string;
  source: string;
  chain: string | null;
  entryPriceUsd: number;
  entryAmountUsd: number;
  entryQty: number;
  entryAt: string;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  currentPriceUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  roundId: number | null;
  scamScore: number | null;
}

export interface EquityPoint {
  timestamp: string;
  totalEquityUsd: number;
  peakBalanceUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  openPositionsCount: number;
  drawdownPct: number;
}

export interface AnalyticsResponse {
  range: string;
  equityCurve: EquityPoint[];
  summary: {
    startEquityUsd: number;
    endEquityUsd: number;
    absChangeUsd: number;
    pctChange: number;
    maxEquityUsd: number;
    minEquityUsd: number;
    maxDrawdownPct: number;
    snapshotCount: number;
    rangeStart: string;
    rangeEnd: string;
  };
  bySymbol: { symbol: string; trades: number; wins: number; losses: number; winRate: number; totalPnlUsd: number; avgPnlUsd: number }[];
  byDayOfWeek: { dow: number; trades: number; wins: number; losses: number; totalPnlUsd: number }[];
  byHour: { hour: number; trades: number; wins: number; losses: number; totalPnlUsd: number }[];
  streaks: { currentWinStreak: number; currentLossStreak: number; longestWinStreak: number; longestLossStreak: number };
  bestTrade: { symbol: string; pnlUsd: number; pnlPct: number; exitAt: string } | null;
  worstTrade: { symbol: string; pnlUsd: number; pnlPct: number; exitAt: string } | null;
}

export interface RoundRow {
  id: number;
  startedAt: string;
  endedAt: string | null;
  tradingBalanceUsd: number;
  reserveBalanceUsd: number;
  tokensScanned: number;
  tokensPassedFilter: number;
  tokensRejectedScam: number;
  positionsOpened: number;
  positionsClosed: number;
  roundPnlUsd: number;
  status: string;
  notes: string | null;
}

export interface RuntimeStatus {
  runtime: "RUNNING" | "STOPPED" | "DEGRADED" | string;
  uptime: number;
  rounds: { started: number; ok: number; failed: number };
  latency: { pipelineP95: number; signerP95: number; broadcasterP95: number };
  lease: { active: boolean; renews: number; failures: number };
  rpc: { quorumHealthy: number; unhealthy: number; errors: number };
  gateRejects: Record<string, number>;
  errors: { rpc: number; signer: number; broadcast: number };
  ts: number;
}

export interface GraduationState {
  passed?: boolean;
  cyclesPassed?: number;
  cyclesRequired?: number;
  progressPct?: number;
  paperCycles?: number;
  requiredCycles?: number;
  [key: string]: unknown;
}

export interface InsightRow {
  id: string;
  agentRole: string;
  symbol: string | null;
  summary: string | null;
  createdAt: string;
  keySignals?: unknown;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include", headers: { accept: "application/json" } });
  if (res.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (typeof window !== "undefined") window.location.assign("/login");
    throw new ApiError("unauthorized", 401);
  }
  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`, res.status);
  return (await res.json()) as T;
}

let csrfPromise: Promise<string> | null = null;

async function csrfToken(): Promise<string> {
  if (!csrfPromise) {
    csrfPromise = fetch("/api/auth/csrf", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { token: "" }))
      .then((j: { token?: string }) => j.token ?? "")
      .catch(() => "");
  }
  return csrfPromise;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const token = await csrfToken();
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...(token ? { "x-csrf-token": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (typeof window !== "undefined") window.location.assign("/login");
    throw new ApiError("unauthorized", 401);
  }
  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`, res.status);
  return (await res.json().catch(() => ({}))) as T;
}

export interface EngineConfig {
  mode: "paper" | "live";
  loopIntervalSec: number;
  initialCapitalUsd: number;
  maxPositionsPerRound: number;
  capitalPctPerRound: number;
  reservePct: number;
  reinvestPct: number;
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
  enabledStrategies: string[];
  engineRunning: boolean;
  killSwitchActive: boolean;
  killSwitchReason?: string | null;
  killSwitchAt?: string | null;
  paperCyclesRequired: number;
  paperCyclesPassed: number;
  graduatedToLive: boolean;
}

export interface RiskScaleResponse {
  assessment: {
    winRate: number;
    tradesClosed: number;
    band: { label: string; description: string; multiplier: number; minWinRate: number; maxWinRate: number };
    multiplier: number;
    scaledAmountUsd: number;
    baseAmountUsd: number;
    applied: boolean;
    reason?: string;
  };
  bands: { minWinRate: number; maxWinRate: number; multiplier: number; label: string; description: string }[];
}

export interface SurveillanceAlert {
  id: string;
  severity?: string;
  title?: string;
  message?: string;
  symbol?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
}
