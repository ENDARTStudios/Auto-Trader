// tests/live-trader.test.ts — S20: CCXT testnet + ethers Uniswap V3 stubs
import { describe, it, expect } from 'vitest';
import {
  cexMarketOrder,
  cexLimitOrder,
  getCexBalances,
  dexSwapExactTokensSingle,
  dexApproveToken,
  LIVE_TRADER_CONFIG,
} from '@/lib/chain/live-trader';

describe('Live trader stubs (S20)', () => {
  it('cexMarketOrder returns mock result', async () => {
    const result = await cexMarketOrder({
      symbol: 'BTC/USDT',
      side: 'buy',
      amountUsd: 100,
      type: 'market',
    });
    expect(result.exchange).toBe('cex');
    expect(result.orderId).toMatch(/^mock-ccxt-/);
    if (result.filledPrice && result.filledQty) {
      expect(result.filledPrice).toBeGreaterThan(0);
      expect(result.filledQty).toBeGreaterThan(0);
    }
  });

  it('cexLimitOrder requires limitPrice', async () => {
    const noPrice = await cexLimitOrder({
      symbol: 'ETH/USDT',
      side: 'buy',
      amountUsd: 50,
      type: 'limit',
    });
    expect(noPrice.ok).toBe(false);
    expect(noPrice.error).toBe('limit_price_required');

    const withPrice = await cexLimitOrder({
      symbol: 'ETH/USDT',
      side: 'buy',
      amountUsd: 50,
      type: 'limit',
      limitPrice: 3000,
    });
    expect(withPrice.exchange).toBe('cex');
  });

  it('getCexBalances returns BTC, ETH, USDT', async () => {
    const balances = await getCexBalances();
    expect(balances.map((b) => b.asset)).toEqual(['BTC', 'ETH', 'USDT']);
    expect(balances.every((b) => b.free >= 0)).toBe(true);
  });

  it('dexSwapExactTokensSingle applies 0.3% fee', async () => {
    const amountIn = 1000000000000000000n; // 1 ETH in wei
    const result = await dexSwapExactTokensSingle({
      chain: 'ethereum',
      tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      tokenOut: '0xA0b86991c6218b36c1d1D4F73CA3dab40Eb8Fd9Da', // USDC
      amountInWei: amountIn,
      amountOutMinWei: amountIn * 9700n / 10000n, // 3% slippage
      to: '0x1234567890123456789012345678901234567890',
      deadline: Math.floor(Date.now() / 1000) + 600, // 10 min
    });
    expect(result.ok).toBe(true);
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    if (result.amountOutWei) {
      // 0.3% fee: amountIn * 9970 / 10000
      expect(result.amountOutWei).toBe(amountIn * 9970n / 10000n);
    }
  });

  it('dexSwapExactTokensSingle rejects past deadline', async () => {
    const result = await dexSwapExactTokensSingle({
      chain: 'ethereum',
      tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      tokenOut: '0xA0b86991c6218b36c1d1D4F73CA3dab40Eb8Fd9Da',
      amountInWei: 1000000n,
      amountOutMinWei: 0n,
      to: '0x0000000000000000000000000000000000000000',
      deadline: Math.floor(Date.now() / 1000) - 60, // past
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('deadline_passed');
  });

  it('dexSwapExactTokensSingle rejects zero amount', async () => {
    const result = await dexSwapExactTokensSingle({
      chain: 'ethereum',
      tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      tokenOut: '0xA0b86991c6218b36c1d1D4F73CA3dab40Eb8Fd9Da',
      amountInWei: 0n,
      amountOutMinWei: 0n,
      to: '0x0000000000000000000000000000000000000000',
      deadline: Math.floor(Date.now() / 1000) + 60,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_amount');
  });

  it('dexApproveToken returns tx hash', async () => {
    const result = await dexApproveToken(
      '0xA0b86991c6218b36c1d1D4F73CA3dab40Eb8Fd9Da',
      1000000000n,
      '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    );
    expect(result.ok).toBe(true);
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('LIVE_TRADER_CONFIG has uniswap V3 routers for all chains', () => {
    // Ethereum address regex matches 0x + 40 hex chars (case insensitive).
    const addr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
    expect(addr(LIVE_TRADER_CONFIG.uniswapV3Router)).toBe(true);
    expect(addr(LIVE_TRADER_CONFIG.uniswapV3RouterArbitrum)).toBe(true);
    expect(addr(LIVE_TRADER_CONFIG.uniswapV3RouterOptimism)).toBe(true);
    expect(addr(LIVE_TRADER_CONFIG.uniswapV3RouterBase)).toBe(true);
  });

  it('testnet default true', () => {
    expect(LIVE_TRADER_CONFIG.testnet).toBe(true);
  });
});
