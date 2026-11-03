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
// In LIVE mode (requires graduation + explicit env/flag gate — see
// live-gating.ts) the same functions route to REAL execution:
//   - CEX via CCXT (src/lib/chain/cex-adapter.ts)
//   - DEX via ethers v6 + Uniswap V3 (src/lib/chain/dex-adapter.ts)
// Fail-closed: gate denied → LIVE_DISABLED; gate allowed but credentials
// missing → LIVE_CREDS_UNAVAILABLE (never falls back to paper, never fake fill).

import { ethers } from "ethers";
import { db } from "@/lib/db";
import { logger } from "./logger";
import {
  computeBuySpendBreakdown,
  type FeeBreakdown,
} from "./fee-model";
import type { TokenCandidate } from "./types";
import type { EngineConfig } from "./config";
import { checkLiveGate } from "./live-gating";
import {
  CexAdapterError,
  createCexClient,
  placeMarketOrder,
} from "@/lib/chain/cex-adapter";
import {
  DexAdapterError,
  addressOf,
  createDexSigner,
  executeSwap,
  isDexChain,
  providerOf,
  readTokenDecimals,
  usdcAddressForChain,
  type DexWalletLike,
} from "@/lib/chain/dex-adapter";
import { getCexCredentials, getDexCredentials } from "./live-credentials";

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
  /** Live execution identifiers (undefined in paper mode). */
  orderId?: string;
  txHash?: string;
  feeBps?: number;
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

// ---------------------------------------------------------------------------
// LIVE execution — real CEX (CCXT) / DEX (ethers) behind the fail-closed gate
// ---------------------------------------------------------------------------

export interface LiveSellPosition {
  symbol: string;
  source: "cex" | "dex";
  chain?: string | null;
  tokenId?: string | null;
  qty: number;
  /** DEX only: token decimals for wei conversion (default 18). */
  tokenDecimals?: number;
}

const DEX_FEE_TIER_DEFAULT = 3000; // 0.30% — pool mais comum p/ tokens voláteis
const DEX_SLIPPAGE_BPS_DEFAULT = 100; // 1%

function liveBreakdown(
  side: "buy" | "sell",
  notionalUsd: number,
  feeUsd: number,
  feeBps: number,
  slippageUsd = 0
): FeeBreakdown {
  const gross = Number.isFinite(notionalUsd) && notionalUsd > 0 ? notionalUsd : 0;
  const fee = Number.isFinite(feeUsd) && feeUsd > 0 ? feeUsd : 0;
  const slip = Number.isFinite(slippageUsd) && slippageUsd > 0 ? slippageUsd : 0;
  return {
    grossAmountUsd: gross,
    feeBps: Number.isFinite(feeBps) ? feeBps : 0,
    slippageBps: 0,
    side,
    feeUsd: fee,
    slippageUsd: slip,
    totalCostUsd: fee + slip,
    netAmountUsd: Math.max(gross - fee - slip, 0),
  };
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function typedError(err: unknown): string {
  if (err instanceof CexAdapterError || err instanceof DexAdapterError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * LIVE buy. Signature changed in round 2: receives cfg so the gate can be
 * evaluated (mode/graduation/kill switch). Never falls back to paper.
 */
export async function liveBuy(
  cfg: EngineConfig,
  candidate: TokenCandidate,
  amountUsd: number
): Promise<ExecutionResult> {
  const gate = await checkLiveGate(cfg);
  if (!gate.allowed) {
    logger.warn("portfolio", `liveBuy bloqueado (${candidate.symbol}): ${gate.reason}`);
    return FAILED(amountUsd, `LIVE_DISABLED: ${gate.reason}`);
  }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return FAILED(amountUsd, "LIVE_INVALID_AMOUNT: amountUsd <= 0");
  }
  if (candidate.source === "cex") return liveCexBuy(candidate, amountUsd);
  if (candidate.source === "dex") return liveDexBuy(candidate, amountUsd);
  return FAILED(amountUsd, `LIVE_UNKNOWN_SOURCE: '${String(candidate.source)}'`);
}

/**
 * LIVE sell. Receives the position (symbol/source/chain/tokenId/qty) and cfg.
 */
export async function liveSell(
  cfg: EngineConfig,
  pos: LiveSellPosition,
  currentPriceUsd: number
): Promise<ExecutionResult> {
  const gate = await checkLiveGate(cfg);
  if (!gate.allowed) {
    logger.warn("portfolio", `liveSell bloqueado (${pos.symbol}): ${gate.reason}`);
    return FAILED(0, `LIVE_DISABLED: ${gate.reason}`);
  }
  if (!Number.isFinite(pos.qty) || pos.qty <= 0) {
    return FAILED(0, "LIVE_INVALID_AMOUNT: qty <= 0");
  }
  if (pos.source === "cex") return liveCexSell(pos);
  if (pos.source === "dex") return liveDexSell(pos, currentPriceUsd);
  return FAILED(0, `LIVE_UNKNOWN_SOURCE: '${String(pos.source)}'`);
}

async function liveCexBuy(
  candidate: TokenCandidate,
  amountUsd: number
): Promise<ExecutionResult> {
  const creds = await getCexCredentials();
  if (!creds.ok) {
    return FAILED(amountUsd, `LIVE_CREDS_UNAVAILABLE: ${creds.reason}`);
  }
  let client;
  try {
    client = await createCexClient(creds.creds);
  } catch (err) {
    return FAILED(amountUsd, `CEX_EXECUTION_FAILED: ${typedError(err)}`);
  }
  const order = await placeMarketOrder(client, {
    symbol: candidate.symbol,
    side: "buy",
    amountUsd,
  });
  if (!order.ok) {
    return FAILED(amountUsd, `${order.error}: ${order.reason}`);
  }
  const notional = order.amountUsd > 0 ? order.amountUsd : order.filledPrice * order.filledQty;
  const feeBps = notional > 0 ? (order.feeUsd / notional) * 10_000 : 0;
  // CEX: fee normalmente é debitada em quote por cima do notional do fill.
  const cashOut = notional + order.feeUsd;
  const breakdown = liveBreakdown("buy", notional, order.feeUsd, feeBps);
  logger.info("portfolio", `[LIVE BUY CEX] ${candidate.symbol}`, {
    orderId: order.orderId,
    filledPrice: order.filledPrice,
    filledQty: order.filledQty,
    feeUsd: order.feeUsd,
  });
  return {
    ok: true,
    executedPriceUsd: order.filledPrice,
    qty: order.filledQty,
    amountUsd: cashOut,
    grossAmountUsd: notional,
    feeUsd: order.feeUsd,
    slippageUsd: 0,
    feeBps,
    breakdown,
    orderId: order.orderId,
  };
}

async function liveCexSell(pos: LiveSellPosition): Promise<ExecutionResult> {
  const creds = await getCexCredentials();
  if (!creds.ok) {
    return FAILED(0, `LIVE_CREDS_UNAVAILABLE: ${creds.reason}`);
  }
  let client;
  try {
    client = await createCexClient(creds.creds);
  } catch (err) {
    return FAILED(0, `CEX_EXECUTION_FAILED: ${typedError(err)}`);
  }
  const order = await placeMarketOrder(client, {
    symbol: pos.symbol,
    side: "sell",
    amountUsd: 0,
    amount: pos.qty,
  });
  if (!order.ok) {
    return FAILED(0, `${order.error}: ${order.reason}`);
  }
  const notional = order.amountUsd > 0 ? order.amountUsd : order.filledPrice * order.filledQty;
  const feeBps = notional > 0 ? (order.feeUsd / notional) * 10_000 : 0;
  const cashIn = Math.max(notional - order.feeUsd, 0);
  const breakdown = liveBreakdown("sell", notional, order.feeUsd, feeBps);
  logger.info("portfolio", `[LIVE SELL CEX] ${pos.symbol}`, {
    orderId: order.orderId,
    filledPrice: order.filledPrice,
    filledQty: order.filledQty,
    feeUsd: order.feeUsd,
  });
  return {
    ok: true,
    executedPriceUsd: order.filledPrice,
    qty: order.filledQty,
    amountUsd: cashIn,
    grossAmountUsd: notional,
    feeUsd: order.feeUsd,
    slippageUsd: 0,
    feeBps,
    breakdown,
    orderId: order.orderId,
  };
}

async function liveDexBuy(
  candidate: TokenCandidate,
  amountUsd: number
): Promise<ExecutionResult> {
  const chain = candidate.chain ?? "";
  if (!isDexChain(chain)) {
    return FAILED(amountUsd, `DEX_CONFIG_INVALID: chain '${chain}' não suportada`);
  }
  if (!candidate.tokenId) {
    return FAILED(amountUsd, "DEX_CONFIG_INVALID: tokenId ausente");
  }
  if (!Number.isFinite(candidate.priceUsd) || candidate.priceUsd <= 0) {
    return FAILED(amountUsd, "DEX_PRICE_UNAVAILABLE: priceUsd inválido");
  }
  const usdc = usdcAddressForChain(chain);
  if (!usdc.ok) return FAILED(amountUsd, `${usdc.error}: ${usdc.reason}`);
  const creds = getDexCredentials(chain);
  if (!creds.ok) {
    return FAILED(amountUsd, `LIVE_CREDS_UNAVAILABLE: ${creds.reason}`);
  }
  let wallet: DexWalletLike;
  try {
    wallet = await createDexSigner(creds.creds);
  } catch (err) {
    return FAILED(amountUsd, `DEX_EXECUTION_FAILED: ${typedError(err)}`);
  }
  const provider = providerOf(wallet);
  if (!provider) return FAILED(amountUsd, "DEX_CONFIG_INVALID: wallet/signer sem provider RPC");
  // Decimals do USDC lidos ON-CHAIN (não hardcode 6) + cache por chain/token.
  let usdcDecimals: number;
  let amountInWei: bigint;
  try {
    usdcDecimals = await readTokenDecimals(provider, usdc.address, chain);
    amountInWei = ethers.parseUnits(amountUsd.toFixed(6), usdcDecimals);
  } catch (err) {
    return FAILED(amountUsd, `DEX_DECIMALS_UNAVAILABLE: ${typedError(err)}`);
  }
  const feeTier = envInt("DEX_FEE_TIER", DEX_FEE_TIER_DEFAULT);
  const swap = await executeSwap({
    wallet,
    chain,
    tokenIn: usdc.address,
    tokenOut: candidate.tokenId,
    amountInWei,
    slippageBps: envInt("DEX_SLIPPAGE_BPS", DEX_SLIPPAGE_BPS_DEFAULT),
    recipient: addressOf(wallet),
    feeTier,
  });
  if (!swap.ok) {
    return FAILED(amountUsd, `${swap.error}: ${swap.reason}`);
  }
  // Decimals do token de saída são desconhecidos aqui; a contabilidade usa o
  // preço verificado do candidato (mesmo feed da entrada) para qty em USD.
  const qty = amountUsd / candidate.priceUsd;
  const feeBps = feeTier / 100; // 3000 → 30 bps
  const feeUsd = (amountUsd * feeBps) / 10_000;
  const breakdown = liveBreakdown("buy", amountUsd, feeUsd, feeBps);
  logger.info("portfolio", `[LIVE BUY DEX] ${candidate.symbol}`, {
    txHash: swap.txHash,
    amountOutWei: swap.amountOutWei.toString(),
    amountOutSource: swap.amountOutSource,
    gasUsed: swap.gasUsed.toString(),
  });
  return {
    ok: true,
    executedPriceUsd: candidate.priceUsd,
    qty,
    amountUsd,
    grossAmountUsd: amountUsd,
    feeUsd,
    slippageUsd: 0,
    feeBps,
    breakdown,
    txHash: swap.txHash,
  };
}

async function liveDexSell(
  pos: LiveSellPosition,
  currentPriceUsd: number
): Promise<ExecutionResult> {
  const chain = pos.chain ?? "";
  if (!isDexChain(chain)) {
    return FAILED(0, `DEX_CONFIG_INVALID: chain '${chain}' não suportada`);
  }
  if (!pos.tokenId) {
    return FAILED(0, "DEX_CONFIG_INVALID: tokenId ausente");
  }
  const usdc = usdcAddressForChain(chain);
  if (!usdc.ok) return FAILED(0, `${usdc.error}: ${usdc.reason}`);
  const creds = getDexCredentials(chain);
  if (!creds.ok) {
    return FAILED(0, `LIVE_CREDS_UNAVAILABLE: ${creds.reason}`);
  }
  let wallet: DexWalletLike;
  try {
    wallet = await createDexSigner(creds.creds);
  } catch (err) {
    return FAILED(0, `DEX_EXECUTION_FAILED: ${typedError(err)}`);
  }
  const provider = providerOf(wallet);
  if (!provider) return FAILED(0, "DEX_CONFIG_INVALID: wallet/signer sem provider RPC");
  // Decimals do TOKEN da posição lidos ON-CHAIN (fim do hardcode 18). O campo
  // tokenDecimals da posição é apenas preferência explícita do caller.
  let tokenDecimals: number;
  let usdcDecimals: number;
  let amountInWei: bigint;
  try {
    tokenDecimals = pos.tokenDecimals ?? (await readTokenDecimals(provider, pos.tokenId, chain));
    usdcDecimals = await readTokenDecimals(provider, usdc.address, chain);
    amountInWei = ethers.parseUnits(pos.qty.toString(), tokenDecimals);
  } catch (err) {
    return FAILED(0, `DEX_DECIMALS_UNAVAILABLE: ${typedError(err)}`);
  }
  const feeTier = envInt("DEX_FEE_TIER", DEX_FEE_TIER_DEFAULT);
  const swap = await executeSwap({
    wallet,
    chain,
    tokenIn: pos.tokenId,
    tokenOut: usdc.address,
    amountInWei,
    slippageBps: envInt("DEX_SLIPPAGE_BPS", DEX_SLIPPAGE_BPS_DEFAULT),
    recipient: addressOf(wallet),
    feeTier,
  });
  if (!swap.ok) {
    return FAILED(0, `${swap.error}: ${swap.reason}`);
  }
  // Saída é USDC: cash-in real (decimals lidos on-chain).
  const cashIn = Number(swap.amountOutWei) / 10 ** usdcDecimals;
  const qty = pos.qty;
  const executedPrice = qty > 0 ? cashIn / qty : currentPriceUsd;
  const feeBps = feeTier / 100;
  const feeUsd = (cashIn * feeBps) / 10_000;
  const breakdown = liveBreakdown("sell", cashIn, feeUsd, feeBps);
  logger.info("portfolio", `[LIVE SELL DEX] ${pos.symbol}`, {
    txHash: swap.txHash,
    amountOutWei: swap.amountOutWei.toString(),
    amountOutSource: swap.amountOutSource,
    gasUsed: swap.gasUsed.toString(),
  });
  return {
    ok: true,
    executedPriceUsd: executedPrice,
    qty,
    amountUsd: cashIn - feeUsd,
    grossAmountUsd: cashIn,
    feeUsd,
    slippageUsd: 0,
    feeBps,
    breakdown,
    txHash: swap.txHash,
  };
}
