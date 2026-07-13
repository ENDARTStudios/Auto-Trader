// Shared types for the trading engine.

export type EngineMode = "paper" | "live";
export type EngineStatus = "stopped" | "running" | "killed" | "paused";

export type LoopState =
  | "scout"      // discovering candidate tokens
  | "analyze"    // running scam detection + risk analysis
  | "execute"    // opening new positions
  | "monitor"    // checking exit conditions on open positions
  | "exit"       // closing positions that hit TP/SL/timeout
  | "rebalance"; // splitting profit, moving reserve, deciding next round size

export type PositionStatus = "open" | "closed" | "liquidated" | "killed";
export type ExitReason =
  | "take_profit"
  | "stop_loss"
  | "timeout"
  | "kill_switch"
  | "manual";

export type TokenSource = "cex" | "dex";

export interface TokenCandidate {
  symbol: string;
  source: TokenSource;
  chain?: string;        // "base" | "arbitrum" | "optimism" | undefined for CEX
  tokenId?: string;      // contract address for DEX tokens
  priceUsd: number;
  volume24hUsd: number;
  liquidityUsd: number;
  // Optional extra metadata
  ageHours?: number;
  holderCount?: number;
}

export interface ScamSubScore {
  name: string;
  score: number;          // 0-100 (100 = safest)
  weight: number;         // 0-1
  findings: string[];
}

export interface ScamReportData {
  symbol: string;
  tokenId?: string;
  chain?: string;
  score: number;          // weighted final 0-100
  passed: boolean;
  subscores: ScamSubScore[];
  findings: Record<string, string[]>;
}

export interface RiskAssessment {
  allowed: boolean;
  reasons: string[];
  // Capital caps recommended by risk manager for this round
  maxRoundAllocationUsd: number;
  maxPerTokenUsd: number;
}

export interface EngineSnapshot {
  status: EngineStatus;
  mode: EngineMode;
  loopState: LoopState;
  lastLoopAt: string | null;
  nextLoopAt: string | null;
  // Balances
  tradingBalanceUsd: number;
  reserveBalanceUsd: number;
  peakBalanceUsd: number;
  // Stats
  realizedPnlUsd: number;
  openPositionsCount: number;
  totalPositionsOpened: number;
  totalPositionsClosed: number;
  wins: number;
  losses: number;
  winRate: number;
  // Graduation
  paperCyclesPassed: number;
  paperCyclesRequired: number;
  graduatedToLive: boolean;
  // Kill switch
  killSwitchActive: boolean;
  killSwitchReason: string | null;
  // Round
  currentRoundId: number | null;
  loopIteration: number;
}

export interface PositionRow {
  id: string;
  symbol: string;
  source: TokenSource;
  chain?: string | null;
  tokenId?: string | null;
  status: PositionStatus;
  entryPriceUsd: number;
  entryAmountUsd: number;
  entryQty: number;
  entryAt: string;
  exitPriceUsd?: number | null;
  exitAmountUsd?: number | null;
  exitAt?: string | null;
  exitReason?: ExitReason | null;
  pnlUsd?: number | null;
  pnlPct?: number | null;
  takeProfitPrice: number;
  stopLossPrice: number;
  maxExitAt: string;
  scamScore: number;
  scamBreakdown?: string | null;
  roundId: number;
  // Live (computed for open positions)
  currentPriceUsd?: number;
  unrealizedPnlUsd?: number;
  unrealizedPnlPct?: number;
}

export interface TradeRow {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  priceUsd: number;
  amountUsd: number;
  qty: number;
  executedAt: string;
  reason?: string;
}

export interface LogRow {
  id: number;
  level: string;
  source: string;
  message: string;
  context?: string | null;
  createdAt: string;
}
