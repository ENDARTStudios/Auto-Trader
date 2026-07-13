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
