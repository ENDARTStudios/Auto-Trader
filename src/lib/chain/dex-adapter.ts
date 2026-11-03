// src/lib/chain/dex-adapter.ts — execução DEX real via ethers v6 + Uniswap V3.
//
// Substitui o mock de live-trader.ts. Regras:
//   - FAIL-CLOSED: sem quoter disponível não há swap (nunca amountOutMinimum=0).
//   - Nunca inventa txHash/amountOut: tudo vem de receipt/evento Swap.
//   - Endereços de router/quoter por chain com override por env validados com
//     ethers.getAddress; override inválido = configuração inválida (não usa default).
//   - A chamada só é alcançável atrás de live-gating.
//
// Superfície:
//   - createDexWallet(creds)
//   - executeSwap({ wallet, chain, tokenIn, tokenOut, amountInWei, slippageBps,
//                   recipient, feeTier, minAmountOutWei? })
//   - helpers puros: resolveRouterAddress, resolveQuoterAddress,
//     usdcAddressForChain, applySlippage, buildSwapParams, parseSwapEventAmountOut

import { ethers } from "ethers";
import type { DexCredentials } from "@/lib/trading/live-credentials";

export type DexChain = "ethereum" | "arbitrum" | "optimism" | "base";

export const SUPPORTED_DEX_CHAINS: readonly DexChain[] = [
  "ethereum",
  "arbitrum",
  "optimism",
  "base",
];

export function isDexChain(chain: string): chain is DexChain {
  return (SUPPORTED_DEX_CHAINS as readonly string[]).includes(chain);
}

// Uniswap SwapRouter02 — mesmos endereços canônicos em Ethereum/Arbitrum/Optimism.
export const SWAP_ROUTER_02_ADDRESSES: Record<DexChain, string> = {
  ethereum: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  arbitrum: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  optimism: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  base: "0x2626664c2603336E57B271c5C0b26F421741e481",
};

// Uniswap QuoterV2.
export const QUOTER_V2_ADDRESSES: Record<DexChain, string> = {
  ethereum: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  arbitrum: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  optimism: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  base: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
};

// USDC nativo por chain (tokenIn dos buys / tokenOut dos sells).
export const USDC_ADDRESSES: Record<DexChain, string> = {
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export const DEX_QUOTE_UNAVAILABLE = "DEX_QUOTE_UNAVAILABLE" as const;
export type DexErrorCode =
  | "DEX_QUOTE_UNAVAILABLE"
  | "DEX_QUOTE_FAILED"
  | "DEX_EXECUTION_FAILED"
  | "DEX_INVALID_AMOUNT"
  | "DEX_INVALID_SLIPPAGE"
  | "DEX_CONFIG_INVALID"
  | "DEX_SIGNER_UNAVAILABLE"
  | "DEX_APPROVAL_FAILED";

export class DexAdapterError extends Error {
  readonly code: DexErrorCode;
  constructor(code: DexErrorCode, message: string) {
    super(message);
    this.name = "DexAdapterError";
    this.code = code;
  }
}

export type AddressResolution =
  | { ok: true; address: string }
  | { ok: false; error: DexErrorCode; reason: string };

function resolveFromEnvOrDefault(
  chain: string,
  env: Record<string, string | undefined>,
  envPrefix: string,
  defaults: Record<DexChain, string>,
  failCode: DexErrorCode
): AddressResolution {
  if (!isDexChain(chain)) {
    return { ok: false, error: failCode, reason: `chain '${chain}' não suportada (dex)` };
  }
  const key = `${envPrefix}_${chain.toUpperCase()}`;
  const override = env[key];
  const raw = override !== undefined && override.trim() !== "" ? override.trim() : defaults[chain];
  try {
    return { ok: true, address: ethers.getAddress(raw) };
  } catch {
    return {
      ok: false,
      error: failCode,
      reason: `endereço inválido para ${key}: config de ${chain} rejeitada (fail-closed)`,
    };
  }
}

export function resolveRouterAddress(
  chain: string,
  env: Record<string, string | undefined> = process.env
): AddressResolution {
  return resolveFromEnvOrDefault(
    chain,
    env,
    "UNISWAP_ROUTER",
    SWAP_ROUTER_02_ADDRESSES,
    "DEX_CONFIG_INVALID"
  );
}

export function resolveQuoterAddress(
  chain: string,
  env: Record<string, string | undefined> = process.env
): AddressResolution {
  return resolveFromEnvOrDefault(
    chain,
    env,
    "UNISWAP_QUOTER",
    QUOTER_V2_ADDRESSES,
    DEX_QUOTE_UNAVAILABLE
  );
}

export function usdcAddressForChain(
  chain: string,
  env: Record<string, string | undefined> = process.env
): AddressResolution {
  return resolveFromEnvOrDefault(
    chain,
    env,
    "USDC",
    USDC_ADDRESSES,
    "DEX_CONFIG_INVALID"
  );
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

/** amountOutMinimum a partir do quote com slippage. Retorna null para input
 *  inválido. amountOut > 0 nunca produz mínimo 0. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint | null {
  if (typeof amountOut !== "bigint" || amountOut <= 0n) return null;
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) return null;
  const min = (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
  return min > 0n ? min : null;
}

export interface SwapParamsInput {
  chain: string;
  tokenIn: string;
  tokenOut: string;
  feeTier: number;
  recipient: string;
  amountInWei: bigint;
  amountOutQuotedWei: bigint;
  slippageBps: number;
}

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  recipient: string;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96: bigint;
}

export type BuildSwapParamsResult =
  | { ok: true; params: SwapParams }
  | { ok: false; error: DexErrorCode; reason: string };

const ALLOWED_FEE_TIERS = new Set([100, 500, 3000, 10_000]);

export function buildSwapParams(input: SwapParamsInput): BuildSwapParamsResult {
  if (!isDexChain(input.chain)) {
    return { ok: false, error: "DEX_CONFIG_INVALID", reason: `chain inválida: ${input.chain}` };
  }
  if (typeof input.amountInWei !== "bigint" || input.amountInWei <= 0n) {
    return { ok: false, error: "DEX_INVALID_AMOUNT", reason: "amountInWei <= 0" };
  }
  if (!Number.isInteger(input.feeTier) || !ALLOWED_FEE_TIERS.has(input.feeTier)) {
    return { ok: false, error: "DEX_CONFIG_INVALID", reason: `feeTier inválido: ${input.feeTier}` };
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps >= 10_000) {
    return { ok: false, error: "DEX_INVALID_SLIPPAGE", reason: `slippageBps inválido: ${input.slippageBps}` };
  }
  let tokenIn: string;
  let tokenOut: string;
  let recipient: string;
  try {
    tokenIn = ethers.getAddress(input.tokenIn);
    tokenOut = ethers.getAddress(input.tokenOut);
    recipient = ethers.getAddress(input.recipient);
  } catch {
    return { ok: false, error: "DEX_CONFIG_INVALID", reason: "endereço token/recipient inválido" };
  }
  if (tokenIn === tokenOut) {
    return { ok: false, error: "DEX_CONFIG_INVALID", reason: "tokenIn === tokenOut" };
  }
  if (typeof input.amountOutQuotedWei !== "bigint" || input.amountOutQuotedWei <= 0n) {
    return { ok: false, error: "DEX_QUOTE_FAILED", reason: "quote sem amountOut" };
  }
  const amountOutMinimum = applySlippage(input.amountOutQuotedWei, input.slippageBps);
  if (amountOutMinimum === null || amountOutMinimum <= 0n) {
    // Regra dura: NUNCA swap com proteção zero.
    return {
      ok: false,
      error: "DEX_INVALID_SLIPPAGE",
      reason: "amountOutMinimum calculado = 0 (slippage inviável — recusado)",
    };
  }
  return {
    ok: true,
    params: {
      tokenIn,
      tokenOut,
      fee: input.feeTier,
      recipient,
      amountIn: input.amountInWei,
      amountOutMinimum,
      sqrtPriceLimitX96: 0n,
    },
  };
}

// ---------------------------------------------------------------------------
// ABIs mínimas
// ---------------------------------------------------------------------------
export const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

export const SWAP_ROUTER_02_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
];

export const SWAP_EVENT_ABI = [
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const swapEventInterface = new ethers.Interface(SWAP_EVENT_ABI);

/**
 * Extrai amountOut do evento Swap (Uniswap V3 pool): um delta é negativo
 * (entrada) e o outro positivo (saída) — independente da ordem token0/token1.
 * Retorna null se não houver evento legível.
 */
export function parseSwapEventAmountOut(
  logs: ReadonlyArray<{ topics: readonly string[]; data: string }>
): bigint | null {
  for (const log of logs) {
    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = swapEventInterface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.name !== "Swap") continue;
    const amount0 = parsed.args[2] as bigint;
    const amount1 = parsed.args[3] as bigint;
    if (amount0 > 0n) return amount0;
    if (amount1 > 0n) return amount1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wallet / swap
// ---------------------------------------------------------------------------
export async function createDexWallet(creds: DexCredentials): Promise<ethers.Wallet> {
  if (!creds.rpcUrl || creds.rpcUrl.trim() === "") {
    throw new DexAdapterError("DEX_CONFIG_INVALID", "rpcUrl ausente nas credenciais DEX");
  }
  if (!creds.privateKey) {
    // source=signer (vault/socket) não é suportado por este adaptador: falha
    // fechada em vez de cair para outra fonte.
    throw new DexAdapterError(
      "DEX_SIGNER_UNAVAILABLE",
      "signer remoto não suportado neste adaptador (privateKey ausente)"
    );
  }
  try {
    const provider = new ethers.JsonRpcProvider(creds.rpcUrl);
    return new ethers.Wallet(creds.privateKey, provider);
  } catch {
    throw new DexAdapterError("DEX_CONFIG_INVALID", "credenciais DEX inválidas (privateKey/rpcUrl)");
  }
}

export interface ExecuteSwapInput {
  wallet: ethers.Wallet;
  chain: string;
  tokenIn: string;
  tokenOut: string;
  amountInWei: bigint;
  /** Proteção de slippage (bps). Ignorada se minAmountOutWei for informado. */
  slippageBps?: number;
  /** Proteção explícita do caller. Precisa ser > 0 (nunca 0). */
  minAmountOutWei?: bigint;
  recipient?: string;
  feeTier?: number;
  /** Injetável em testes; default = provider do wallet. */
  provider?: ethers.Provider;
  env?: Record<string, string | undefined>;
}

export interface DexSwapSuccess {
  ok: true;
  txHash: string;
  amountOutWei: bigint;
  amountOutMinimumWei: bigint;
  amountOutSource: "event" | "quote";
  gasUsed: bigint;
  feeTier: number;
}

export interface DexSwapFailure {
  ok: false;
  error: DexErrorCode;
  reason: string;
  txHash?: string;
}

export type DexSwapResult = DexSwapSuccess | DexSwapFailure;

function dexFail(error: DexErrorCode, reason: string, txHash?: string): DexSwapFailure {
  return txHash ? { ok: false, error, reason, txHash } : { ok: false, error, reason };
}

export async function executeSwap(input: ExecuteSwapInput): Promise<DexSwapResult> {
  const env = input.env ?? process.env;
  const chain = input.chain;
  if (!isDexChain(chain)) {
    return dexFail("DEX_CONFIG_INVALID", `chain '${chain}' não suportada`);
  }
  if (typeof input.amountInWei !== "bigint" || input.amountInWei <= 0n) {
    return dexFail("DEX_INVALID_AMOUNT", "amountInWei <= 0");
  }

  // 1) Quoter — sem quote não há swap (fail-closed).
  const quoterResolution = resolveQuoterAddress(chain, env);
  if (!quoterResolution.ok) {
    return dexFail(DEX_QUOTE_UNAVAILABLE, quoterResolution.reason);
  }
  const routerResolution = resolveRouterAddress(chain, env);
  if (!routerResolution.ok) {
    return dexFail(routerResolution.error, routerResolution.reason);
  }
  const provider = input.provider ?? input.wallet.provider;
  if (!provider) {
    return dexFail("DEX_CONFIG_INVALID", "wallet sem provider RPC");
  }

  const feeTier = input.feeTier ?? 3000;
  let amountOutQuoted: bigint;
  try {
    const quoter = new ethers.Contract(quoterResolution.address, QUOTER_V2_ABI, provider);
    const quoted = (await quoter.quoteExactInputSingle({
      tokenIn: ethers.getAddress(input.tokenIn),
      tokenOut: ethers.getAddress(input.tokenOut),
      amountIn: input.amountInWei,
      fee: feeTier,
      sqrtPriceLimitX96: 0n,
    })) as unknown as [bigint, bigint, number, bigint];
    amountOutQuoted = quoted[0];
  } catch (err) {
    return dexFail(DEX_QUOTE_UNAVAILABLE, `quote falhou: ${errorMessage(err)}`);
  }
  if (typeof amountOutQuoted !== "bigint" || amountOutQuoted <= 0n) {
    return dexFail(DEX_QUOTE_UNAVAILABLE, "quoter retornou amountOut <= 0");
  }

  // 2) Parâmetros — amountOutMinimum nunca 0.
  let amountOutMinimum: bigint;
  if (input.minAmountOutWei !== undefined) {
    if (typeof input.minAmountOutWei !== "bigint" || input.minAmountOutWei <= 0n) {
      return dexFail("DEX_INVALID_SLIPPAGE", "amountOutMinimum explícito <= 0 (recusado)");
    }
    amountOutMinimum = input.minAmountOutWei;
  } else {
    const built = buildSwapParams({
      chain,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      feeTier,
      recipient: input.recipient ?? input.wallet.address,
      amountInWei: input.amountInWei,
      amountOutQuotedWei: amountOutQuoted,
      slippageBps: input.slippageBps ?? 50,
    });
    if (!built.ok) return dexFail(built.error, built.reason);
    amountOutMinimum = built.params.amountOutMinimum;
  }

  let recipient: string;
  try {
    recipient = ethers.getAddress(input.recipient ?? input.wallet.address);
  } catch {
    return dexFail("DEX_CONFIG_INVALID", "recipient inválido");
  }

  // 3) Execução real + receipt.
  let txHash: string | undefined;
  try {
    const router = new ethers.Contract(routerResolution.address, SWAP_ROUTER_02_ABI, input.wallet);
    const tx = (await router.exactInputSingle({
      tokenIn: ethers.getAddress(input.tokenIn),
      tokenOut: ethers.getAddress(input.tokenOut),
      fee: feeTier,
      recipient,
      amountIn: input.amountInWei,
      amountOutMinimum,
      sqrtPriceLimitX96: 0n,
    })) as ethers.ContractTransactionResponse;
    txHash = tx.hash;
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return dexFail("DEX_EXECUTION_FAILED", "transação revertida (status != 1)", txHash);
    }
    const parsedOut = parseSwapEventAmountOut(receipt.logs);
    return {
      ok: true,
      txHash,
      amountOutWei: parsedOut ?? amountOutQuoted,
      amountOutMinimumWei: amountOutMinimum,
      amountOutSource: parsedOut !== null ? "event" : "quote",
      gasUsed: receipt.gasUsed,
      feeTier,
    };
  } catch (err) {
    return dexFail("DEX_EXECUTION_FAILED", errorMessage(err), txHash);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
