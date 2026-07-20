// Paper Trader — simulates order execution against real prices.
//
// In paper mode, no real orders are sent. We just record the trade at the
// current market price (with a configurable slippage assumption) and update
// the in-DB balance & position.
//
// In live mode (NOT enabled by default — requires graduation), this would
// route to the CEX adapter (CCXT createOrder) or DEX adapter (ethers
// Uniswap router). Live mode is intentionally a stub for now.

import { db } from "@/lib/db";
import { logger } from "./logger";
import type { TokenCandidate } from "./types";

const PAPER_SLIPPAGE_BPS = 30; // 0.3% assumed slippage on entry/exit

export interface ExecutionResult {
  ok: boolean;
  executedPriceUsd: number;
  qty: number;
  amountUsd: number;
  error?: string;
}

// Buy: allocate `amountUsd` worth of token at current price.
export async function paperBuy(
  candidate: TokenCandidate,
  amountUsd: number
): Promise<ExecutionResult> {
  const slippageMult = 1 + PAPER_SLIPPAGE_BPS / 10_000;
  const executedPrice = candidate.priceUsd * slippageMult;
  const qty = amountUsd / executedPrice;

  if (amountUsd <= 0 || executedPrice <= 0) {
    return {
      ok: false,
      executedPriceUsd: executedPrice,
      qty: 0,
      amountUsd,
      error: "Parâmetros inválidos",
    };
  }

  // Debit trading balance
  await db.tradingBalance.update({
    where: { id: "singleton" },
    data: { balanceUsd: { decrement: amountUsd } },
  });

  logger.info("portfolio", `[PAPER BUY] ${candidate.symbol}`, {
    amountUsd,
    executedPrice,
    qty,
    source: candidate.source,
    chain: candidate.chain,
  });

  return { ok: true, executedPriceUsd: executedPrice, qty, amountUsd };
}

// Sell: liquidate `qty` of token at current price.
export async function paperSell(
  symbol: string,
  qty: number,
  currentPriceUsd: number
): Promise<ExecutionResult> {
  const slippageMult = 1 - PAPER_SLIPPAGE_BPS / 10_000;
  const executedPrice = currentPriceUsd * slippageMult;
  const amountUsd = qty * executedPrice;

  if (qty <= 0 || executedPrice <= 0) {
    return {
      ok: false,
      executedPriceUsd: executedPrice,
      qty,
      amountUsd: 0,
      error: "Parâmetros inválidos",
    };
  }

  // Credit trading balance
  await db.tradingBalance.update({
    where: { id: "singleton" },
    data: { balanceUsd: { increment: amountUsd } },
  });

  logger.info("portfolio", `[PAPER SELL] ${symbol}`, {
    qty,
    executedPrice,
    amountUsd,
  });

  return { ok: true, executedPriceUsd: executedPrice, qty, amountUsd };
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
    ok: false,
    executedPriceUsd: 0,
    qty: 0,
    amountUsd,
    error: "Live trading não implementado — graduation required first",
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
    ok: false,
    executedPriceUsd: currentPriceUsd,
    qty,
    amountUsd: 0,
    error: "Live trading não implementado",
  };
}
