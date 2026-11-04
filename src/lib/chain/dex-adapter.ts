// src/lib/chain/dex-adapter.ts — execução DEX real via ethers v6 + Uniswap V3.
//
// Regras (rodada 3):
//   - FAIL-CLOSED: sem quoter não há swap; amountOutMinimum nunca é 0; sem
//     approve confirmado não há swap; decimals on-chain validados (0<d<=36).
//   - Assinatura: wallet local (ethers.Wallet) OU signer process (Unix socket,
//     a chave NUNCA entra no processo web). O signer recebe a tx EIP-1559
//     completa (chainId/nonce/gas/fees) e devolve rawSignedTx; o web só faz
//     broadcastTransaction do raw assinado.
//   - Nunca inventa txHash/amountOut: tudo vem do receipt/evento Swap.
//
// Superfície:
//   - createDexSigner(creds) / createDexWallet(creds)
//   - ensureErc20Allowance(ctx, token, spender, amountWei, opts?)
//   - readTokenDecimals(provider, token, chain?)
//   - executeSwap({ wallet, chain, tokenIn, tokenOut, amountInWei, ... })
//   - signTransactionWithSigner(signer, txReq, deps?) / buildSignerTransactionPayload()
//   - helpers puros: resolveRouterAddress, resolveQuoterAddress,
//     usdcAddressForChain, applySlippage, buildSwapParams, parseSwapEventAmountOut

import { createHash, randomUUID } from "node:crypto";
import { ethers } from "ethers";
import { SIGNER_PROTOCOL_VERSION } from "@/lib/signer-protocol";
import type { RpcResponse, SignerTransport } from "./signer-adapter";
import type { DexCredentials } from "@/lib/trading/live-credentials";

export type DexChain = "ethereum" | "arbitrum" | "optimism" | "base";

export const SUPPORTED_DEX_CHAINS: readonly DexChain[] = [
  "ethereum",
  "arbitrum",
  "optimism",
  "base",
];

export const DEX_CHAIN_IDS: Record<DexChain, number> = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
};

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
  | "DEX_SIGNER_SIGN_FAILED"
  | "DEX_BROADCAST_FAILED"
  | "DEX_DECIMALS_UNAVAILABLE"
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
const erc20Interface = new ethers.Interface(ERC20_ABI);
const swapRouterInterface = new ethers.Interface(SWAP_ROUTER_02_ABI);

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
// Decimals on-chain (cache por chain+token)
// ---------------------------------------------------------------------------
const decimalsCache = new Map<string, number>();

/** Limpa o cache — usado pelos testes. */
export function __resetTokenDecimalsCache(): void {
  decimalsCache.clear();
}

function decimalsCacheKey(token: string, chain?: string): string {
  return (chain ?? "unknown").toLowerCase() + ":" + token.toLowerCase();
}

/**
 * Lê ERC20.decimals() on-chain e valida 0 < decimals <= 36.
 * Lança DexAdapterError("DEX_DECIMALS_UNAVAILABLE") em qualquer falha.
 */
export async function readTokenDecimals(
  provider: ethers.Provider,
  token: string,
  chain?: string
): Promise<number> {
  const address = ethers.getAddress(token);
  const key = decimalsCacheKey(address, chain);
  const cached = decimalsCache.get(key);
  if (cached !== undefined) return cached;

  let raw: string;
  try {
    raw = await provider.call({
      to: address,
      data: erc20Interface.encodeFunctionData("decimals"),
    });
  } catch (err) {
    throw new DexAdapterError(
      "DEX_DECIMALS_UNAVAILABLE",
      "decimals() on-chain falhou para " + address + ": " + errorMessage(err)
    );
  }
  let decimals: number;
  try {
    const decoded = erc20Interface.decodeFunctionResult("decimals", raw);
    decimals = Number(decoded[0]);
  } catch {
    throw new DexAdapterError(
      "DEX_DECIMALS_UNAVAILABLE",
      "decimals() retornou dado inválido para " + address
    );
  }
  if (!Number.isInteger(decimals) || decimals <= 0 || decimals > 36) {
    throw new DexAdapterError(
      "DEX_DECIMALS_UNAVAILABLE",
      "decimals() fora do intervalo válido (0 < d <= 36): " + decimals
    );
  }
  decimalsCache.set(key, decimals);
  return decimals;
}

// ---------------------------------------------------------------------------
// Signer (wallet local OU signer process via Unix socket)
// ---------------------------------------------------------------------------
/** Credenciais DEX + campo opcional do signer (não existe no módulo do owner). */
export type DexExecutionCredentials = DexCredentials & { signerWalletId?: string };

export interface DexSigner {
  kind: "signer";
  address: string;
  walletId: string;
  chain: DexChain;
  chainId: number;
  transport: SignerTransport;
  provider: ethers.Provider;
}

export type DexWalletLike = ethers.Wallet | DexSigner;

export function isDexSigner(value: DexWalletLike): value is DexSigner {
  return (value as DexSigner).kind === "signer";
}

export function addressOf(wallet: DexWalletLike): string {
  return isDexSigner(wallet) ? wallet.address : wallet.address;
}

export function providerOf(wallet: DexWalletLike): ethers.Provider | null {
  if (isDexSigner(wallet)) return wallet.provider;
  return wallet.provider ?? null;
}

export interface CreateDexSignerOptions {
  /** Injetável em testes (evita abrir socket). */
  transport?: SignerTransport;
  /** Injetável em testes / resolução externa do endereço do signer. */
  address?: string;
  /** Injetável em testes. */
  provider?: ethers.Provider;
  env?: Record<string, string | undefined>;
}

const SIGNER_RPC_TIMEOUT_MS = 5000;

async function resolveSignerAddress(
  walletId: string,
  env: Record<string, string | undefined>
): Promise<string | null> {
  const fromEnv = env.DEX_SIGNER_ADDRESS?.trim();
  if (fromEnv) {
    try {
      return ethers.getAddress(fromEnv);
    } catch {
      return null;
    }
  }
  try {
    // Endereço não é segredo; resolve pelo walletId no DB (web process).
    // STRICT (round 6): WalletConnection exige contexto; a resolução roda em
    // nome do sistema/signer → withSystemRls (bypass explícito).
    const { withSystemRls } = await import("@/lib/auth/rls-context");
    const row = await withSystemRls((tx) =>
      tx.walletConnection.findUnique({
        where: { id: walletId },
        select: { address: true },
      }),
    );
    if (!row?.address) return null;
    return ethers.getAddress(row.address);
  } catch {
    return null;
  }
}

/**
 * Cria o assinante DEX.
 *   - source "wallet"/"env" → ethers.Wallet local (privateKey).
 *   - source "signer"       → { kind:"signer", address, transport, walletId }
 * Sem chave/canal válidos → DEX_SIGNER_UNAVAILABLE (nunca cai para outra fonte).
 */
export async function createDexSigner(
  creds: DexExecutionCredentials,
  opts: CreateDexSignerOptions = {}
): Promise<DexWalletLike> {
  const env = opts.env ?? process.env;
  if (!isDexChain(creds.chain)) {
    throw new DexAdapterError("DEX_CONFIG_INVALID", "chain '" + creds.chain + "' não suportada");
  }
  if (!creds.rpcUrl || creds.rpcUrl.trim() === "") {
    throw new DexAdapterError("DEX_CONFIG_INVALID", "rpcUrl ausente nas credenciais DEX");
  }

  if (creds.source === "signer") {
    const walletId = (creds.signerWalletId ?? env.DEX_SIGNER_WALLET_ID)?.trim();
    if (!walletId) {
      throw new DexAdapterError(
        "DEX_SIGNER_UNAVAILABLE",
        "source=signer sem walletId (DEX_SIGNER_WALLET_ID ausente)"
      );
    }
    const socketPath = (creds.signerSocketPath ?? env.SIGNER_SOCKET_PATH)?.trim();
    if (!opts.transport && !socketPath) {
      throw new DexAdapterError(
        "DEX_SIGNER_UNAVAILABLE",
        "source=signer sem SIGNER_SOCKET_PATH/signerSocketPath"
      );
    }
    const address = opts.address ?? (await resolveSignerAddress(walletId, env));
    if (!address) {
      throw new DexAdapterError(
        "DEX_SIGNER_UNAVAILABLE",
        "não foi possível resolver o endereço do signer (walletId=" +
          walletId +
          "); defina DEX_SIGNER_ADDRESS"
      );
    }
    let transport = opts.transport;
    if (!transport) {
      const { UnixSocketSignerTransport } = await import("./signer-transport");
      transport = new UnixSocketSignerTransport({ socketPath: socketPath as string });
    }
    const provider = opts.provider ?? new ethers.JsonRpcProvider(creds.rpcUrl);
    return {
      kind: "signer",
      address,
      walletId,
      chain: creds.chain,
      chainId: DEX_CHAIN_IDS[creds.chain],
      transport,
      provider,
    };
  }

  if (!creds.privateKey) {
    throw new DexAdapterError(
      "DEX_SIGNER_UNAVAILABLE",
      "credenciais sem privateKey e source != 'signer'"
    );
  }
  try {
    const provider = opts.provider ?? new ethers.JsonRpcProvider(creds.rpcUrl);
    return new ethers.Wallet(creds.privateKey, provider);
  } catch {
    throw new DexAdapterError("DEX_CONFIG_INVALID", "credenciais DEX inválidas (privateKey/rpcUrl)");
  }
}

/** Compat round-2: apenas o caminho wallet local. */
export async function createDexWallet(
  creds: DexExecutionCredentials,
  opts: CreateDexSignerOptions = {}
): Promise<ethers.Wallet> {
  const signer = await createDexSigner(creds, opts);
  if (isDexSigner(signer)) {
    throw new DexAdapterError(
      "DEX_SIGNER_UNAVAILABLE",
      "source='signer' — use createDexSigner (createDexWallet é só wallet local)"
    );
  }
  return signer;
}

// ---------------------------------------------------------------------------
// Envelope de assinatura + broadcast
// ---------------------------------------------------------------------------
export interface BuildSignerTxInput {
  from: string;
  to: string;
  data: string;
  valueWei?: bigint;
  chainId: number;
  nonce: number;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  approvedAmountWei?: bigint;
  slippageLimitBps?: number;
  sandwichScore?: number;
}

export interface SignerTxEnvelope {
  protocolVersion: string;
  requestId: string;
  operation: "signTransaction";
  payload: {
    tx: { from: string; to: string; value: string; data: string };
    expectedDiff: Record<string, unknown>;
    approvedAmount: string;
    slippageLimitBps: number;
    sandwichScore: number;
    chainId: number;
    nonce: number;
    gasLimit: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    type: number;
  };
  payloadHash: string;
}

/** SHA-256 do JSON canônico — MESMA forma do signer (sign-methods.ts). */
export function sha256Canonical(value: unknown): string {
  return "0x" + createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/** Monta o envelope EIP-1559 exato enviado ao signer. Exportado p/ teste. */
export function buildSignerTransactionPayload(input: BuildSignerTxInput): SignerTxEnvelope {
  const payload = {
    tx: {
      from: ethers.getAddress(input.from),
      to: ethers.getAddress(input.to),
      value: (input.valueWei ?? 0n).toString(),
      data: input.data,
    },
    // Campos exigidos pelo envelope do signer (contrato frozen do pipeline).
    expectedDiff: { ok: true, changes: [], source: "dex-adapter" },
    approvedAmount: (input.approvedAmountWei ?? 0n).toString(),
    slippageLimitBps: input.slippageLimitBps ?? 0,
    sandwichScore: input.sandwichScore ?? 0,
    chainId: input.chainId,
    nonce: input.nonce,
    gasLimit: input.gasLimit.toString(),
    maxFeePerGas: input.maxFeePerGas.toString(),
    maxPriorityFeePerGas: input.maxPriorityFeePerGas.toString(),
    type: 2,
  };
  return {
    protocolVersion: SIGNER_PROTOCOL_VERSION,
    requestId: randomUUID(),
    operation: "signTransaction",
    payload,
    payloadHash: sha256Canonical(payload),
  };
}

/** Leitor de chain usado pelo caminho signer; injetável em testes. */
export interface SignerChainReader {
  getTransactionCount(address: string, blockTag: "pending"): Promise<number>;
  getFeeData(): Promise<ethers.FeeData>;
  estimateGas(tx: Record<string, unknown>): Promise<bigint>;
  broadcastTransaction(raw: string): Promise<{
    hash: string;
    wait(): Promise<ethers.TransactionReceipt | null>;
  }>;
}

export function defaultSignerChainReader(provider: ethers.Provider): SignerChainReader {
  return {
    getTransactionCount: (address, blockTag) => provider.getTransactionCount(address, blockTag),
    getFeeData: () => provider.getFeeData(),
    estimateGas: (tx) => provider.estimateGas(tx),
    broadcastTransaction: (raw) => provider.broadcastTransaction(raw),
  };
}

export interface TxRequest {
  to: string;
  data: string;
  valueWei?: bigint;
}

export interface SentTx {
  txHash: string;
  receipt: ethers.TransactionReceipt;
}

function signError(reason: string): DexAdapterError {
  return new DexAdapterError("DEX_SIGNER_SIGN_FAILED", reason);
}

export interface SignerTxDeps {
  reader?: SignerChainReader;
  approvedAmountWei?: bigint;
  slippageLimitBps?: number;
}

/**
 * Assina via signer process (EIP-1559 completo) e faz broadcast do raw assinado.
 * O processo web nunca vê a private key: só o rawSignedTx devolvido pelo signer.
 */
export async function signTransactionWithSigner(
  signer: DexSigner,
  tx: TxRequest,
  deps: SignerTxDeps = {}
): Promise<SentTx> {
  const reader = deps.reader ?? defaultSignerChainReader(signer.provider);

  let nonce: number;
  let feeData: ethers.FeeData;
  let gasLimit: bigint;
  try {
    nonce = await reader.getTransactionCount(signer.address, "pending");
    feeData = await reader.getFeeData();
    gasLimit = await reader.estimateGas({
      from: signer.address,
      to: tx.to,
      data: tx.data,
      value: (tx.valueWei ?? 0n).toString(),
    });
  } catch (err) {
    throw signError("falha ao preparar tx (nonce/fees/gas): " + errorMessage(err));
  }

  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? null;
  if (maxFeePerGas === null) {
    throw signError("fee data indisponível (sem maxFeePerGas/gasPrice) — fail-closed");
  }
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;

  const envelope = buildSignerTransactionPayload({
    from: signer.address,
    to: tx.to,
    data: tx.data,
    valueWei: tx.valueWei,
    chainId: signer.chainId,
    nonce,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    approvedAmountWei: deps.approvedAmountWei,
    slippageLimitBps: deps.slippageLimitBps,
  });

  let resp: RpcResponse;
  try {
    resp = await signer.transport.rpc("signTransaction", envelope, SIGNER_RPC_TIMEOUT_MS);
  } catch (err) {
    throw new DexAdapterError(
      "DEX_SIGNER_UNAVAILABLE",
      "signer RPC indisponível: " + errorMessage(err)
    );
  }
  if (!resp.ok) {
    throw signError(
      "signer RPC error " +
        String(resp.error?.code ?? "?") +
        ": " +
        (resp.error?.message ?? "(sem mensagem)")
    );
  }

  const result = resp.result as
    | {
        ok?: unknown;
        rawSignedTx?: unknown;
        error?: unknown;
        requestId?: unknown;
        receivedPayloadHash?: unknown;
        signerVersion?: unknown;
      }
    | undefined;
  if (!result || typeof result !== "object") {
    throw signError("signer retornou result não-objeto");
  }
  if (result.requestId !== envelope.requestId) {
    throw signError("requestId do signer não confere (response confusion)");
  }
  if (result.receivedPayloadHash !== envelope.payloadHash) {
    throw signError("payloadHash do signer não confere (payload corrompido)");
  }
  if (result.signerVersion !== undefined && result.signerVersion !== SIGNER_PROTOCOL_VERSION) {
    throw signError("signer protocol mismatch: " + String(result.signerVersion));
  }
  if (result.ok !== true) {
    throw signError(
      "signer recusou a assinatura: " +
        (typeof result.error === "string" ? result.error : "(sem detalhe)")
    );
  }
  const rawSignedTx = result.rawSignedTx;
  if (typeof rawSignedTx !== "string" || !/^0x[0-9a-fA-F]+$/.test(rawSignedTx)) {
    throw signError("signer não retornou rawSignedTx válido");
  }

  let broadcast: Awaited<ReturnType<SignerChainReader["broadcastTransaction"]>>;
  try {
    broadcast = await reader.broadcastTransaction(rawSignedTx);
  } catch (err) {
    throw new DexAdapterError(
      "DEX_BROADCAST_FAILED",
      "broadcast do raw assinado falhou: " + errorMessage(err)
    );
  }
  let receipt: ethers.TransactionReceipt | null;
  try {
    receipt = await broadcast.wait();
  } catch (err) {
    throw new DexAdapterError("DEX_BROADCAST_FAILED", "wait() falhou: " + errorMessage(err));
  }
  if (!receipt || receipt.status !== 1) {
    throw new DexAdapterError("DEX_EXECUTION_FAILED", "transação revertida (status != 1)");
  }
  return { txHash: broadcast.hash, receipt };
}

async function sendTransaction(
  wallet: DexWalletLike,
  provider: ethers.Provider,
  tx: TxRequest,
  deps: { reader?: SignerChainReader } = {}
): Promise<SentTx> {
  if (isDexSigner(wallet)) {
    return signTransactionWithSigner(wallet, tx, { reader: deps.reader });
  }
  const response = await wallet.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.valueWei ?? 0n,
  });
  const receipt = await response.wait();
  if (!receipt || receipt.status !== 1) {
    throw new DexAdapterError("DEX_EXECUTION_FAILED", "transação revertida (status != 1)");
  }
  return { txHash: response.hash, receipt };
}

// ---------------------------------------------------------------------------
// Approve ERC20
// ---------------------------------------------------------------------------
export interface AllowanceContext {
  provider: ethers.Provider;
  owner: string;
  signer: DexWalletLike;
  chain?: string;
}

export interface AllowanceResult {
  ok: boolean;
  alreadyApproved: boolean;
  txHash?: string;
  error?: string;
  code?: DexErrorCode;
}

/**
 * Garante allowance(token, spender) >= amountWei. Aprova o valor EXATO
 * (não max) se necessário e aguarda receipt status=1. Funciona com wallet
 * local e com o caminho signer (raw assinado + broadcast).
 *
 * O parâmetro opts.sendTx é injetável para testes (sem rede).
 */
export async function ensureErc20Allowance(
  ctx: AllowanceContext,
  token: string,
  spender: string,
  amountWei: bigint,
  opts: {
    sendTx?: (tx: TxRequest) => Promise<SentTx>;
    reader?: SignerChainReader;
  } = {}
): Promise<AllowanceResult> {
  if (typeof amountWei !== "bigint" || amountWei <= 0n) {
    return { ok: false, alreadyApproved: false, code: "DEX_INVALID_AMOUNT", error: "amountWei <= 0" };
  }
  let tokenAddr: string;
  let owner: string;
  let spenderAddr: string;
  try {
    tokenAddr = ethers.getAddress(token);
    owner = ethers.getAddress(ctx.owner);
    spenderAddr = ethers.getAddress(spender);
  } catch {
    return { ok: false, alreadyApproved: false, code: "DEX_CONFIG_INVALID", error: "endereço inválido" };
  }

  // 1) Ler allowance atual.
  let allowance: bigint;
  try {
    const raw = await ctx.provider.call({
      to: tokenAddr,
      data: erc20Interface.encodeFunctionData("allowance", [owner, spenderAddr]),
    });
    const decoded = erc20Interface.decodeFunctionResult("allowance", raw);
    allowance = BigInt(decoded[0]);
  } catch (err) {
    return {
      ok: false,
      alreadyApproved: false,
      code: "DEX_APPROVAL_FAILED",
      error: "não foi possível ler allowance: " + errorMessage(err),
    };
  }
  if (allowance >= amountWei) {
    return { ok: true, alreadyApproved: true };
  }

  // 2) Approve do valor exato.
  const data = erc20Interface.encodeFunctionData("approve", [spenderAddr, amountWei]);
  let sent: SentTx;
  try {
    sent = opts.sendTx
      ? await opts.sendTx({ to: tokenAddr, data })
      : await sendTransaction(
          ctx.signer,
          ctx.provider,
          { to: tokenAddr, data },
          { reader: opts.reader }
        );
  } catch (err) {
    const code = err instanceof DexAdapterError ? err.code : "DEX_APPROVAL_FAILED";
    return {
      ok: false,
      alreadyApproved: false,
      code,
      error: "approve falhou: " + errorMessage(err),
    };
  }
  if (!sent.receipt || sent.receipt.status !== 1) {
    return {
      ok: false,
      alreadyApproved: false,
      txHash: sent.txHash,
      code: "DEX_APPROVAL_FAILED",
      error: "approve revertido (status != 1)",
    };
  }
  return { ok: true, alreadyApproved: false, txHash: sent.txHash };
}

// ---------------------------------------------------------------------------
// Swap
// ---------------------------------------------------------------------------
export interface ExecuteSwapInput {
  wallet: DexWalletLike;
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
  /** Injetável em testes; default = provider do wallet/signer. */
  provider?: ethers.Provider;
  env?: Record<string, string | undefined>;
  /** Injetável em testes (allowance/send/signer reader). */
  deps?: {
    allowanceSendTx?: (tx: TxRequest) => Promise<SentTx>;
    reader?: SignerChainReader;
    skipAllowance?: boolean;
  };
}

export interface DexSwapSuccess {
  ok: true;
  txHash: string;
  amountOutWei: bigint;
  amountOutMinimumWei: bigint;
  amountOutSource: "event" | "quote";
  gasUsed: bigint;
  feeTier: number;
  approveTxHash?: string;
  alreadyApproved: boolean;
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
    return dexFail("DEX_CONFIG_INVALID", "chain '" + chain + "' não suportada");
  }
  if (typeof input.amountInWei !== "bigint" || input.amountInWei <= 0n) {
    return dexFail("DEX_INVALID_AMOUNT", "amountInWei <= 0");
  }
  if (input.minAmountOutWei !== undefined && input.minAmountOutWei <= 0n) {
    // Nunca aceitar proteção zero, mesmo antes de qualquer chamada externa.
    return dexFail("DEX_INVALID_SLIPPAGE", "amountOutMinimum explícito <= 0 (recusado)");
  }

  // 1) Endereços (quoter obrigatório — fail-closed).
  const quoterResolution = resolveQuoterAddress(chain, env);
  if (!quoterResolution.ok) {
    return dexFail(DEX_QUOTE_UNAVAILABLE, quoterResolution.reason);
  }
  const routerResolution = resolveRouterAddress(chain, env);
  if (!routerResolution.ok) {
    return dexFail(routerResolution.error, routerResolution.reason);
  }
  const provider = input.provider ?? providerOf(input.wallet);
  if (!provider) {
    return dexFail("DEX_CONFIG_INVALID", "wallet sem provider RPC");
  }
  const owner = addressOf(input.wallet);

  // 2) Approve do tokenIn para o router (sem approve ok não há swap).
  let approveTxHash: string | undefined;
  let alreadyApproved = false;
  if (!input.deps?.skipAllowance) {
    const allowance = await ensureErc20Allowance(
      { provider, owner, signer: input.wallet, chain },
      input.tokenIn,
      routerResolution.address,
      input.amountInWei,
      { sendTx: input.deps?.allowanceSendTx, reader: input.deps?.reader }
    );
    if (!allowance.ok) {
      return dexFail(
        allowance.code ?? "DEX_APPROVAL_FAILED",
        allowance.error ?? "approve não confirmado"
      );
    }
    approveTxHash = allowance.txHash;
    alreadyApproved = allowance.alreadyApproved;
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
    return dexFail(DEX_QUOTE_UNAVAILABLE, "quote falhou: " + errorMessage(err));
  }
  if (typeof amountOutQuoted !== "bigint" || amountOutQuoted <= 0n) {
    return dexFail(DEX_QUOTE_UNAVAILABLE, "quoter retornou amountOut <= 0");
  }

  // 3) Parâmetros — amountOutMinimum nunca 0.
  let amountOutMinimum: bigint;
  if (input.minAmountOutWei !== undefined) {
    amountOutMinimum = input.minAmountOutWei;
  } else {
    const built = buildSwapParams({
      chain,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      feeTier,
      recipient: input.recipient ?? owner,
      amountInWei: input.amountInWei,
      amountOutQuotedWei: amountOutQuoted,
      slippageBps: input.slippageBps ?? 50,
    });
    if (!built.ok) return dexFail(built.error, built.reason);
    amountOutMinimum = built.params.amountOutMinimum;
  }

  let recipient: string;
  try {
    recipient = ethers.getAddress(input.recipient ?? owner);
  } catch {
    return dexFail("DEX_CONFIG_INVALID", "recipient inválido");
  }

  // 4) Swap + receipt (wallet local OU signer raw+broadcast).
  let txHash: string | undefined;
  try {
    const calldata = swapRouterInterface.encodeFunctionData("exactInputSingle", [
      {
        tokenIn: ethers.getAddress(input.tokenIn),
        tokenOut: ethers.getAddress(input.tokenOut),
        fee: feeTier,
        recipient,
        amountIn: input.amountInWei,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ]);
    const sent = await sendTransaction(
      input.wallet,
      provider,
      { to: routerResolution.address, data: calldata },
      { reader: input.deps?.reader }
    );
    txHash = sent.txHash;
    const receipt = sent.receipt;
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
      approveTxHash,
      alreadyApproved,
    };
  } catch (err) {
    const code = err instanceof DexAdapterError ? err.code : "DEX_EXECUTION_FAILED";
    return dexFail(code, errorMessage(err), txHash);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
