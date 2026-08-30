// src/lib/chain/live-trader.ts — S20: Live trading stubs (CCXT testnet + ethers Uniswap V3)
// PROD: import ccxt and ethers; these stubs are the dev/mock interface so the
// pipeline can be exercised without requiring real exchange keys.
// The interface matches the S20 frozen-base contract (HARDENING-ROADMAP.md M3.4).

export interface LiveOrderRequest {
  symbol: string;       // "BTC/USDT" or "ETH/USDC"
  side: 'buy' | 'sell';
  amountUsd: number;
  type: 'market' | 'limit';
  limitPrice?: number;   // for limit orders
}

export interface LiveOrderResult {
  ok: boolean;
  orderId?: string;
  txHash?: string;
  filledPrice?: number;
  filledQty?: number;
  error?: string;
  exchange?: 'cex' | 'dex';
}

export interface DexSwapRequest {
  chain: 'ethereum' | 'arbitrum' | 'optimism' | 'base';
  tokenIn: string;       // 0xAddress
  tokenOut: string;      // 0xAddress
  amountInWei: bigint;
  amountOutMinWei: bigint; // slippage protection
  to: string;             // recipient 0xAddress
  deadline: number;       // unix seconds
}

export interface DexSwapResult {
  ok: boolean;
  txHash?: string;
  amountInWei?: bigint;
  amountOutWei?: bigint;
  error?: string;
}

const TESTNET = process.env.CCXT_TESTNET !== 'false'; // default true
const FAIL_RATE = Number(process.env.LIVE_STUB_FAIL_RATE ?? '0');

function shouldFail(): boolean {
  return Math.random() < FAIL_RATE;
}

// Mock CCXT CEX order
export async function cexMarketOrder(req: LiveOrderRequest): Promise<LiveOrderResult> {
  if (!TESTNET) return { ok: false, error: 'ccxt_live_disabled' };
  if (shouldFail()) return { ok: false, error: 'mock_ccxt_failure' };
  return {
    ok: true,
    orderId: `mock-ccxt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    filledPrice: 50000 + Math.random() * 1000,
    filledQty: req.amountUsd / 50000,
    exchange: 'cex',
  };
}

export async function cexLimitOrder(req: LiveOrderRequest): Promise<LiveOrderResult> {
  if (!TESTNET) return { ok: false, error: 'ccxt_live_disabled' };
  if (!req.limitPrice) return { ok: false, error: 'limit_price_required' };
  if (shouldFail()) return { ok: false, error: 'mock_ccxt_failure' };
  return {
    ok: true,
    orderId: `mock-ccxt-limit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    filledPrice: req.limitPrice,
    filledQty: req.amountUsd / req.limitPrice,
    exchange: 'cex',
  };
}

export async function getCexBalances(): Promise<{ asset: string; free: number; locked: number }[]> {
  return [
    { asset: 'BTC', free: 0.5, locked: 0 },
    { asset: 'ETH', free: 2.5, locked: 0 },
    { asset: 'USDT', free: 1000, locked: 0 },
  ];
}

// Mock ethers Uniswap V3 DEX swap
export async function dexSwapExactTokensSingle(req: DexSwapRequest): Promise<DexSwapResult> {
  if (shouldFail()) return { ok: false, error: 'mock_dex_failure' };
  if (req.amountInWei <= 0n) return { ok: false, error: 'invalid_amount' };
  if (req.deadline < Math.floor(Date.now() / 1000)) {
    return { ok: false, error: 'deadline_passed' };
  }
  // Mock 1:1 swap with 0.3% fee (Uniswap V3 default)
  const feeBps = 30; // 0.3%
  const amountInAfterFee = req.amountInWei * BigInt(10000 - feeBps) / 10000n;
  return {
    ok: true,
    txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
    amountInWei: req.amountInWei,
    amountOutWei: amountInAfterFee,
  };
}

export async function dexApproveToken(_token: string, _amount: bigint, _spender: string): Promise<DexSwapResult> {
  if (shouldFail()) return { ok: false, error: 'mock_approve_failure' };
  return {
    ok: true,
    txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
  };
}

export const LIVE_TRADER_CONFIG = {
  testnet: TESTNET,
  failRate: FAIL_RATE,
  uniswapV3Router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Ethereum mainnet (mock)
  uniswapV3RouterArbitrum: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  uniswapV3RouterOptimism: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  uniswapV3RouterBase: '0x2626664c660D2490b6B4878911D909221B5048a1', // 40 hex chars (valid EVM address)
} as const;
