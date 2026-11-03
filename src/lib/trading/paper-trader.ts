// Paper Trader — simulates order execution against real prices.
//
// In paper mode, no real orders are sent. We record the trade at the current
// market price with the CONFIGURED fee (feeBps) and slippage (slippageBps)
// applied on the price/qty, so the simulated ledger is net of costs:
//
//   BUY  (cash budget A):  executedPrice = mid * (1 + s)
//                          feeUsd       = A * f            (paid out of A)
//                          qty          = (A - feeUsd) / executedPrice
//   SELL (qty Q):          executedPrice = mid * (1 - s)
//                          grossProceeds = Q * executedPrice
//                          feeUsd        = grossProceeds * f
//                          cashReceived  = grossProceeds - feeUsd
//
// This is the "net" convention: fees are charged inside the fill, not added as
// a separate synthetic expense, so P&L (exit cash - entry cash) already
// includes fees + slippage on both legs. The returned breakdown is persisted
// as FeeAuditLog by portfolio.ts once the Position row (and its id) exists.
//
// In live mode (NOT enabled by default — requires graduation), this would
// route to the CEX adapter (CCXT createOrder) or DEX adapter (ethers
// Uniswap router). Live mode is intentionally a stub for now.

import { db } from "@/lib/db";
import { logger } from "./logger";
import {
  computeBuySpendBreakdown,
  type FeeBreakdown,
} from "./fee-model";
import type { TokenCandidate } from "./types";

// Fallbacks matching Config defaults. Callers (portfolio.ts) always pass
// cfg.feeBps / cfg.slippageBps; these only apply to ad-hoc calls.
export const DEFAULT_FEE_BPS = 10; // 0.10% per side
export const DEFAULT_SLIPPAGE_BPS = 30; // 0.30% per side

export interface ExecutionOptions {
  feeBps?: number;
  slippageBps?: number;
}

export interface ExecutionResult {
  ok: boolean;
  executedPriceUsd: number;
  qty: number;
  /** Cash actually moved: debited on buys, credited on sells (net of costs). */
  amountUsd: number;
  /** Market notional before costs (mid price x qty). */
  grossAmountUsd: number;
  feeUsd: number;
  slippageUsd: number;
  /** Full breakdown, to be persisted by portfolio.recordFeeAuditLog. */
  breakdown?: FeeBreakdown;
  error?: string;
}

export interface PaperFill {
  side: "buy" | "sell";
  executedPriceUsd: number;
  qty: number;
  /** Market notional at mid price (no costs). */
  grossAmountUsd: number;
  /** Cash debited (buy) or credited (sell), net of fee + slippage. */
  cashAmountUsd: number;
  feeUsd: number;
  slippageUsd: number;
  breakdown: FeeBreakdown;
}

function normalizeBps(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(value, 0);
}

/**
 * Pure BUY fill: spends `amountUsd` cash on the token at `midPriceUsd`.
 * Returns null for invalid inputs (caller reports a failed execution).
 */
export function computePaperBuyFill(
  midPriceUsd: number,
  amountUsd: number,
  feeBps: number,
  slippageBps: number
): PaperFill | null {
  const fee = normalizeBps(feeBps, DEFAULT_FEE_BPS);
  const slippage = normalizeBps(slippageBps, DEFAULT_SLIPPAGE_BPS);
  if (!Number.isFinite(midPriceUsd) || midPriceUsd <= 0) return null;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;

  const executedPrice = midPriceUsd * (1 + slippage / 10_000);
  const breakdown = computeBuySpendBreakdown(amountUsd, fee, slippage);
  const spendable = amountUsd - breakdown.feeUsd;
  if (executedPrice <= 0 || spendable <= 0) return null;
  const qty = spendable / executedPrice;
  if (!Number.isFinite(qty) || qty <= 0) return null;

  return {
    side: "buy",
    executedPriceUsd: executedPrice,
    qty,
    grossAmountUsd: qty * midPriceUsd,
    cashAmountUsd: amountUsd,
    feeUsd: breakdown.feeUsd,
    slippageUsd: breakdown.slippageUsd,
    breakdown,
  };
}

/**
 * Pure SELL fill: liquidates `qty` at `midPriceUsd`. Slippage hits the price,
 * fee is charged on the actual (post-slippage) proceeds.
 */
export function computePaperSellFill(
  midPriceUsd: number,
  qty: number,
  feeBps: number,
  slippageBps: number
): PaperFill | null {
  const fee = normalizeBps(feeBps, DEFAULT_FEE_BPS);
  const slippage = normalizeBps(slippageBps, DEFAULT_SLIPPAGE_BPS);
  if (!Number.isFinite(midPriceUsd) || midPriceUsd <= 0) return null;
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const executedPrice = midPriceUsd * (1 - slippage / 10_000);
  if (executedPrice <= 0) return null;
  const grossProceeds = qty * executedPrice;
  const midNotional = qty * midPriceUsd;
  const feeUsd = (grossProceeds * fee) / 10_000;
  const slippageUsd = midNotional - grossProceeds;
  const cashReceived = grossProceeds - feeUsd;

  return {
    side: "sell",
    executedPriceUsd: executedPrice,
    qty,
    grossAmountUsd: midNotional,
    cashAmountUsd: cashReceived,
    feeUsd,
    slippageUsd,
    breakdown: {
      grossAmountUsd: midNotional,
      feeBps: fee,
      slippageBps: slippage,
      side: "sell",
      feeUsd,
      slippageUsd,
      totalCostUsd: feeUsd + slippageUsd,
      netAmountUsd: cashReceived,
    },
  };
}

const FAILED = (amountUsd: number, error: string): ExecutionResult => ({
  ok: false,
  executedPriceUsd: 0,
  qty: 0,
  amountUsd,
  grossAmountUsd: 0,
  feeUsd: 0,
  slippageUsd: 0,
  error,
});

// Buy: allocate `amountUsd` worth of token at current price.
export async function paperBuy(
  candidate: TokenCandidate,
  amountUsd: number,
  opts?: ExecutionOptions
): Promise<ExecutionResult> {
  const fill = computePaperBuyFill(
    candidate.priceUsd,
    amountUsd,
    opts?.feeBps ?? DEFAULT_FEE_BPS,
    opts?.slippageBps ?? DEFAULT_SLIPPAGE_BPS
  );
  if (!fill) return FAILED(amountUsd, "Parâmetros inválidos");

  // Never debit a balance that cannot cover the order (ledger honesty).
  const balance = await db.tradingBalance.findUnique({ where: { id: "singleton" } });
  if (!balance || balance.balanceUsd < amountUsd) {
    return FAILED(amountUsd, "Saldo insuficiente");
  }

  await db.tradingBalance.update({
    where: { id: "singleton" },
    data: { balanceUsd: { decrement: amountUsd } },
  });

  logger.info("portfolio", `[PAPER BUY] ${candidate.symbol}`, {
    amountUsd,
    executedPrice: fill.executedPriceUsd,
    qty: fill.qty,
    feeBps: opts?.feeBps ?? DEFAULT_FEE_BPS,
    feeUsd: fill.feeUsd,
    slippageUsd: fill.slippageUsd,
    source: candidate.source,
    chain: candidate.chain,
  });

  return {
    ok: true,
    executedPriceUsd: fill.executedPriceUsd,
    qty: fill.qty,
    amountUsd,
    grossAmountUsd: fill.grossAmountUsd,
    feeUsd: fill.feeUsd,
    slippageUsd: fill.slippageUsd,
    breakdown: fill.breakdown,
  };
}

// Sell: liquidate `qty` of token at current price.
export async function paperSell(
  symbol: string,
  qty: number,
  currentPriceUsd: number,
  opts?: ExecutionOptions
): Promise<ExecutionResult> {
  const fill = computePaperSellFill(
    currentPriceUsd,
    qty,
    opts?.feeBps ?? DEFAULT_FEE_BPS,
    opts?.slippageBps ?? DEFAULT_SLIPPAGE_BPS
  );
  if (!fill) {
    return {
      ...FAILED(0, "Parâmetros inválidos"),
      executedPriceUsd: currentPriceUsd,
      qty,
    };
  }

  await db.tradingBalance.update({
    where: { id: "singleton" },
    data: { balanceUsd: { increment: fill.cashAmountUsd } },
  });

  logger.info("portfolio", `[PAPER SELL] ${symbol}`, {
    qty,
    executedPrice: fill.executedPriceUsd,
    amountUsd: fill.cashAmountUsd,
    feeUsd: fill.feeUsd,
    slippageUsd: fill.slippageUsd,
  });

  return {
    ok: true,
    executedPriceUsd: fill.executedPriceUsd,
    qty,
    amountUsd: fill.cashAmountUsd,
    grossAmountUsd: fill.grossAmountUsd,
    feeUsd: fill.feeUsd,
    slippageUsd: fill.slippageUsd,
    breakdown: fill.breakdown,
  };
}

// Live mode stub — to be implemented after graduation logic is exercised.
export async function liveBuy(
  candidate: TokenCandidate,
  amountUsd: number
): Promise<ExecutionResult> {
  logger.error("portfolio", "liveBuy chamado mas live mode não implementado", {
    symbol: candidate.symbol,
  });
  return {
    ...FAILED(amountUsd, "Live trading não implementado — graduation required first"),
    amountUsd,
  };
}

export async function liveSell(
  symbol: string,
  qty: number,
  currentPriceUsd: number
): Promise<ExecutionResult> {
  logger.error("portfolio", "liveSell chamado mas live mode não implementado", {
    symbol,
  });
  return {
    ...FAILED(0, "Live trading não implementado"),
    executedPriceUsd: currentPriceUsd,
    qty,
  };
}
