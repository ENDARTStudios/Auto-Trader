// src/lib/chain/live-trader.ts — execução LIVE real (CCXT CEX + ethers DEX).
//
// RODADA 2: este módulo deixou de ser mock. Nada de Math.random()/txHash fake:
// toda ordem passa por cex-adapter/dex-adapter e toda falha é um erro tipado.
//
// FAIL-CLOSED em camadas:
//   1. live-gating (mode=live + graduatedToLive + kill switch off + env
//      LIVE_TRADING_ENABLED=true + S14_APPROVED=true + feature flag);
//   2. credenciais reais via live-credentials (sem creds → LIVE_CREDS_UNAVAILABLE,
//      nunca fallback para paper/mock);
//   3. adaptador do venue (erro do exchange/RPC → CEX_EXECUTION_FAILED /
//      DEX_EXECUTION_FAILED / DEX_QUOTE_UNAVAILABLE).
//
// As funções antigas (S20) mantêm a assinatura pública, mas agora exigem um
// `LiveGateConfig` explícito como último argumento: sem ele o resultado é
// sempre LIVE_DISABLED (não há como provar o gate).

import { ethers } from "ethers";
import {
  CexAdapterError,
  createCexClient,
  fetchCexBalances,
  placeLimitOrder,
  placeMarketOrder,
  type CexBalanceRow,
} from "@/lib/chain/cex-adapter";
import {
  ERC20_ABI,
  createDexWallet,
  executeSwap,
  SWAP_ROUTER_02_ADDRESSES,
} from "@/lib/chain/dex-adapter";
import {
  checkLiveGate,
  type LiveGateConfig,
  type LiveGateResult,
} from "@/lib/trading/live-gating";
import {
  getCexCredentials,
  getDexCredentials,
} from "@/lib/trading/live-credentials";
import { logger } from "@/lib/trading/logger";

const LOG_SOURCE = "system" as const;

export interface LiveOrderRequest {
  symbol: string;       // "BTC/USDT" or "BTCUSDT"
  side: "buy" | "sell";
  amountUsd: number;
  type: "market" | "limit";
  limitPrice?: number;   // for limit orders
}

export interface LiveOrderResult {
  ok: boolean;
  orderId?: string;
  txHash?: string;
  filledPrice?: number;
  filledQty?: number;
  amountUsd?: number;
  feeUsd?: number;
  error?: string;
  exchange?: "cex" | "dex";
}

export interface DexSwapRequest {
  chain: "ethereum" | "arbitrum" | "optimism" | "base";
  tokenIn: string;       // 0xAddress
  tokenOut: string;      // 0xAddress
  amountInWei: bigint;
  amountOutMinWei: bigint; // slippage protection (> 0 obrigatório)
  to: string;             // recipient 0xAddress
  deadline?: number;      // unix seconds (informativo — SwapRouter02 usa deadline implícito? ver docs)
  feeTier?: number;       // 100 | 500 | 3000 | 10000
}

export interface DexSwapResult {
  ok: boolean;
  txHash?: string;
  amountInWei?: bigint;
  amountOutWei?: bigint;
  error?: string;
}

const LIVE_DISABLED = "LIVE_DISABLED";
const LIVE_CREDS_UNAVAILABLE = "LIVE_CREDS_UNAVAILABLE";
const CEX_EXECUTION_FAILED = "CEX_EXECUTION_FAILED";
const DEX_EXECUTION_FAILED = "DEX_EXECUTION_FAILED";

function liveError(code: string, reason: string): string {
  return `${code}: ${reason}`;
}

/** Sem cfg explícito não há como provar mode/graduation → fail-closed. */
async function requireGate(cfg?: LiveGateConfig): Promise<LiveGateResult> {
  if (!cfg) {
    return {
      allowed: false,
      code: "LIVE_DISABLED",
      reason: "LiveGateConfig não fornecido (fail-closed)",
    };
  }
  return checkLiveGate(cfg);
}

// ---------------------------------------------------------------------------
// CEX
// ---------------------------------------------------------------------------
export async function cexMarketOrder(
  req: LiveOrderRequest,
  cfg?: LiveGateConfig
): Promise<LiveOrderResult> {
  const gate = await requireGate(cfg);
  if (!gate.allowed) {
    return { ok: false, error: liveError(LIVE_DISABLED, gate.reason), exchange: "cex" };
  }
  const credsResult = await getCexCredentials();
  if (!credsResult.ok) {
    return {
      ok: false,
      error: liveError(LIVE_CREDS_UNAVAILABLE, credsResult.reason),
      exchange: "cex",
    };
  }
  try {
    const client = await createCexClient(credsResult.creds);
    const order = await placeMarketOrder(client, {
      symbol: req.symbol,
      side: req.side,
      amountUsd: req.amountUsd,
    });
    if (!order.ok) {
      return {
        ok: false,
        error: liveError(CEX_EXECUTION_FAILED, `${order.error}: ${order.reason}`),
        exchange: "cex",
      };
    }
    return {
      ok: true,
      orderId: order.orderId,
      filledPrice: order.filledPrice,
      filledQty: order.filledQty,
      amountUsd: order.amountUsd,
      feeUsd: order.feeUsd,
      exchange: "cex",
    };
  } catch (err) {
    return {
      ok: false,
      error: liveError(CEX_EXECUTION_FAILED, errorMessage(err)),
      exchange: "cex",
    };
  }
}

export async function cexLimitOrder(
  req: LiveOrderRequest,
  cfg?: LiveGateConfig
): Promise<LiveOrderResult> {
  if (!req.limitPrice) return { ok: false, error: "limit_price_required", exchange: "cex" };
  const gate = await requireGate(cfg);
  if (!gate.allowed) {
    return { ok: false, error: liveError(LIVE_DISABLED, gate.reason), exchange: "cex" };
  }
  const credsResult = await getCexCredentials();
  if (!credsResult.ok) {
    return {
      ok: false,
      error: liveError(LIVE_CREDS_UNAVAILABLE, credsResult.reason),
      exchange: "cex",
    };
  }
  try {
    const client = await createCexClient(credsResult.creds);
    const order = await placeLimitOrder(client, {
      symbol: req.symbol,
      side: req.side,
      amountUsd: req.amountUsd,
      limitPrice: req.limitPrice,
    });
    if (!order.ok) {
      return {
        ok: false,
        error: liveError(CEX_EXECUTION_FAILED, `${order.error}: ${order.reason}`),
        exchange: "cex",
      };
    }
    return {
      ok: true,
      orderId: order.orderId,
      filledPrice: order.filledPrice,
      filledQty: order.filledQty,
      amountUsd: order.amountUsd,
      feeUsd: order.feeUsd,
      exchange: "cex",
    };
  } catch (err) {
    return {
      ok: false,
      error: liveError(CEX_EXECUTION_FAILED, errorMessage(err)),
      exchange: "cex",
    };
  }
}

/** Saldos reais. Sem gate/credenciais retorna [] (nunca saldos fake). */
export async function getCexBalances(
  cfg?: LiveGateConfig
): Promise<CexBalanceRow[]> {
  const gate = await requireGate(cfg);
  if (!gate.allowed) {
    logger.warn(LOG_SOURCE, `getCexBalances negado: ${gate.reason}`);
    return [];
  }
  const credsResult = await getCexCredentials();
  if (!credsResult.ok) {
    logger.warn(LOG_SOURCE, `getCexBalances sem credenciais: ${credsResult.reason}`);
    return [];
  }
  try {
    const client = await createCexClient(credsResult.creds);
    return await fetchCexBalances(client);
  } catch (err) {
    logger.warn(LOG_SOURCE, `getCexBalances falhou: ${errorMessage(err)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// DEX
// ---------------------------------------------------------------------------
export async function dexSwapExactTokensSingle(
  req: DexSwapRequest,
  cfg?: LiveGateConfig
): Promise<DexSwapResult> {
  const gate = await requireGate(cfg);
  if (!gate.allowed) {
    return { ok: false, error: liveError(LIVE_DISABLED, gate.reason) };
  }
  if (req.amountInWei <= 0n) return { ok: false, error: "invalid_amount" };
  const credsResult = getDexCredentials(req.chain);
  if (!credsResult.ok) {
    return { ok: false, error: liveError(LIVE_CREDS_UNAVAILABLE, credsResult.reason) };
  }
  try {
    const wallet = await createDexWallet(credsResult.creds);
    const swap = await executeSwap({
      wallet,
      chain: req.chain,
      tokenIn: req.tokenIn,
      tokenOut: req.tokenOut,
      amountInWei: req.amountInWei,
      minAmountOutWei: req.amountOutMinWei,
      recipient: req.to,
      feeTier: req.feeTier,
    });
    if (!swap.ok) {
      return {
        ok: false,
        txHash: swap.txHash,
        amountInWei: req.amountInWei,
        error: liveError(DEX_EXECUTION_FAILED, `${swap.error}: ${swap.reason}`),
      };
    }
    return {
      ok: true,
      txHash: swap.txHash,
      amountInWei: req.amountInWei,
      amountOutWei: swap.amountOutWei,
    };
  } catch (err) {
    const code = err instanceof CexAdapterError ? err.code : "DEX_CONFIG_INVALID";
    return {
      ok: false,
      amountInWei: req.amountInWei,
      error: liveError(DEX_EXECUTION_FAILED, `${code}: ${errorMessage(err)}`),
    };
  }
}

export async function dexApproveToken(
  token: string,
  amount: bigint,
  spender: string,
  chain?: "ethereum" | "arbitrum" | "optimism" | "base",
  cfg?: LiveGateConfig
): Promise<DexSwapResult> {
  const gate = await requireGate(cfg);
  if (!gate.allowed) {
    return { ok: false, error: liveError(LIVE_DISABLED, gate.reason) };
  }
  if (!chain) return { ok: false, error: "DEX_CONFIG_INVALID: chain obrigatória" };
  if (amount <= 0n) return { ok: false, error: "invalid_amount" };
  const credsResult = getDexCredentials(chain);
  if (!credsResult.ok) {
    return { ok: false, error: liveError(LIVE_CREDS_UNAVAILABLE, credsResult.reason) };
  }
  try {
    const wallet = await createDexWallet(credsResult.creds);
    const erc20 = new ethers.Contract(token, ERC20_ABI, wallet);
    const tx = (await erc20.approve(spender, amount)) as ethers.ContractTransactionResponse;
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return {
        ok: false,
        txHash: tx.hash,
        error: liveError(DEX_EXECUTION_FAILED, "approve revertido (status != 1)"),
      };
    }
    return { ok: true, txHash: tx.hash };
  } catch (err) {
    return {
      ok: false,
      error: liveError(DEX_EXECUTION_FAILED, errorMessage(err)),
    };
  }
}

// ---------------------------------------------------------------------------
// Config pública (compat S20) — sem failRate/mocks.
// ---------------------------------------------------------------------------
export const LIVE_TRADER_CONFIG = {
  testnet: process.env.CCXT_TESTNET !== "false", // default: sandbox
  failRate: 0, // removido: não existe mais falha simulada
  uniswapV3Router: SWAP_ROUTER_02_ADDRESSES.ethereum,
  uniswapV3RouterArbitrum: SWAP_ROUTER_02_ADDRESSES.arbitrum,
  uniswapV3RouterOptimism: SWAP_ROUTER_02_ADDRESSES.optimism,
  uniswapV3RouterBase: SWAP_ROUTER_02_ADDRESSES.base,
} as const;

function errorMessage(err: unknown): string {
  if (err instanceof CexAdapterError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}