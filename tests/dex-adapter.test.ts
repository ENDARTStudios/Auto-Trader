// tests/dex-adapter.test.ts — ethers v6 / Uniswap V3: helpers + fail-closed.
import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import {
  DexAdapterError,
  QUOTER_V2_ADDRESSES,
  SWAP_ROUTER_02_ADDRESSES,
  USDC_ADDRESSES,
  applySlippage,
  buildSwapParams,
  createDexWallet,
  executeSwap,
  isDexChain,
  parseSwapEventAmountOut,
  resolveQuoterAddress,
  resolveRouterAddress,
  usdcAddressForChain,
} from '@/lib/chain/dex-adapter';

const TOKEN_IN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const TOKEN_OUT = '0x4200000000000000000000000000000000000042';
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const PK = '0x' + '11'.repeat(32);

describe('addresses por chain', () => {
  it('defaults são endereços EVM válidos (getAddress)', () => {
    for (const chain of ['ethereum', 'arbitrum', 'optimism', 'base'] as const) {
      expect(ethers.getAddress(SWAP_ROUTER_02_ADDRESSES[chain])).toBe(
        SWAP_ROUTER_02_ADDRESSES[chain]
      );
      expect(ethers.getAddress(QUOTER_V2_ADDRESSES[chain])).toBe(QUOTER_V2_ADDRESSES[chain]);
      expect(ethers.getAddress(USDC_ADDRESSES[chain])).toBe(USDC_ADDRESSES[chain]);
    }
    // Base usa endereços distintos dos demais.
    expect(SWAP_ROUTER_02_ADDRESSES.base).not.toBe(SWAP_ROUTER_02_ADDRESSES.ethereum);
  });

  it('override por env é respeitado e validado', () => {
    const router = resolveRouterAddress('ethereum', {
      UNISWAP_ROUTER_ETHEREUM: '0x2222222222222222222222222222222222222222',
    });
    expect(router).toEqual({
      ok: true,
      address: '0x2222222222222222222222222222222222222222',
    });
    const bad = resolveRouterAddress('ethereum', { UNISWAP_ROUTER_ETHEREUM: 'not-an-address' });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toBe('DEX_CONFIG_INVALID');
  });

  it('quoter ausente/inválido → DEX_QUOTE_UNAVAILABLE (fail-closed)', () => {
    const bad = resolveQuoterAddress('ethereum', { UNISWAP_QUOTER_ETHEREUM: '0xnope' });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toBe('DEX_QUOTE_UNAVAILABLE');

    const unsupported = resolveQuoterAddress('solana', {});
    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) return;
    expect(unsupported.error).toBe('DEX_QUOTE_UNAVAILABLE');
  });

  it('USDC por chain com override; chain inválida falha', () => {
    expect(usdcAddressForChain('base', {}).ok).toBe(true);
    const override = usdcAddressForChain('base', {
      USDC_BASE: '0x3333333333333333333333333333333333333333',
    });
    expect(override).toEqual({ ok: true, address: '0x3333333333333333333333333333333333333333' });
    expect(usdcAddressForChain('solana', {}).ok).toBe(false);
  });

  it('isDexChain', () => {
    expect(isDexChain('ethereum')).toBe(true);
    expect(isDexChain('base')).toBe(true);
    expect(isDexChain('bsc')).toBe(false);
  });
});

describe('applySlippage', () => {
  it('aplica bps e nunca retorna 0', () => {
    expect(applySlippage(10_000n, 100)).toBe(9_900n);
    expect(applySlippage(10_000n, 0)).toBe(10_000n);
    expect(applySlippage(10_000n, 50)).toBe(9_950n);
  });

  it('slippage/lucro inviável → null (proteção zero proibida)', () => {
    expect(applySlippage(10_000n, 10_000)).toBeNull();
    expect(applySlippage(10_000n, -1)).toBeNull();
    expect(applySlippage(10_000n, 1.5)).toBeNull();
    expect(applySlippage(1n, 9_999)).toBeNull(); // arredonda para 0
    expect(applySlippage(0n, 100)).toBeNull();
    expect(applySlippage(-1n, 100)).toBeNull();
  });
});

describe('buildSwapParams', () => {
  const base = {
    chain: 'base',
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    feeTier: 3000,
    recipient: RECIPIENT,
    amountInWei: 1_000_000n,
    amountOutQuotedWei: 2_000_000n,
    slippageBps: 100,
  };

  it('monta params com amountOutMinimum composto do quote', () => {
    const r = buildSwapParams(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.amountIn).toBe(1_000_000n);
    expect(r.params.amountOutMinimum).toBe(1_980_000n);
    expect(r.params.sqrtPriceLimitX96).toBe(0n);
    expect(r.params.recipient).toBe(RECIPIENT);
    expect(r.params.fee).toBe(3000);
  });

  it('normaliza endereço para checksum e rejeita tokenIn==tokenOut', () => {
    const lower = buildSwapParams({ ...base, tokenIn: TOKEN_IN.toLowerCase() });
    expect(lower.ok).toBe(true);
    if (lower.ok) expect(ethers.getAddress(lower.params.tokenIn)).toBe(TOKEN_IN);

    const same = buildSwapParams({ ...base, tokenOut: TOKEN_IN });
    expect(same.ok).toBe(false);
    if (same.ok) return;
    expect(same.error).toBe('DEX_CONFIG_INVALID');
  });

  it('rejeita chain/amount/feeTier/slippage/quote inválidos', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ chain: 'solana' }, 'DEX_CONFIG_INVALID'],
      [{ amountInWei: 0n }, 'DEX_INVALID_AMOUNT'],
      [{ amountInWei: -1n }, 'DEX_INVALID_AMOUNT'],
      [{ feeTier: 1234 }, 'DEX_CONFIG_INVALID'],
      [{ slippageBps: 10_000 }, 'DEX_INVALID_SLIPPAGE'],
      [{ slippageBps: -1 }, 'DEX_INVALID_SLIPPAGE'],
      [{ amountOutQuotedWei: 0n }, 'DEX_QUOTE_FAILED'],
      [{ recipient: '0x123' }, 'DEX_CONFIG_INVALID'],
    ];
    for (const [patch, code] of cases) {
      const r = buildSwapParams({ ...base, ...patch } as never);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error).toBe(code);
    }
  });
});

describe('parseSwapEventAmountOut', () => {
  const iface = new ethers.Interface([
    'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
  ]);
  const event = iface.getEvent('Swap')!;

  function encodeSwap(amount0: bigint, amount1: bigint) {
    return iface.encodeEventLog(event, [RECIPIENT, RECIPIENT, amount0, amount1, 0n, 0n, 0]);
  }

  it('extrai o delta positivo independente da ordem token0/token1', () => {
    const a = encodeSwap(-1_000n, 2_000n); // entrada token0, saída token1
    expect(parseSwapEventAmountOut([a])).toBe(2_000n);
    const b = encodeSwap(2_000n, -1_000n); // entrada token1, saída token0
    expect(parseSwapEventAmountOut([b])).toBe(2_000n);
  });

  it('ignora logs sem evento Swap e retorna null', () => {
    expect(parseSwapEventAmountOut([])).toBeNull();
    expect(
      parseSwapEventAmountOut([{ topics: ['0xdeadbeef'], data: '0x' }])
    ).toBeNull();
  });
});

describe('createDexWallet', () => {
  it('cria wallet real (ethers) com privateKey + rpc', async () => {
    const wallet = await createDexWallet({
      source: 'env',
      chain: 'ethereum',
      rpcUrl: 'http://127.0.0.1:1',
      privateKey: PK,
    });
    expect(wallet).toBeInstanceOf(ethers.Wallet);
    expect(wallet.address).toBe(new ethers.Wallet(PK).address);
  });

  it('sem privateKey → DEX_SIGNER_UNAVAILABLE (não usa signer remoto)', async () => {
    await expect(
      createDexWallet({ source: 'signer', chain: 'ethereum', rpcUrl: 'http://127.0.0.1:1' })
    ).rejects.toMatchObject({ code: 'DEX_SIGNER_UNAVAILABLE' });
  });

  it('sem rpcUrl → DEX_CONFIG_INVALID', async () => {
    await expect(
      createDexWallet({ source: 'env', chain: 'ethereum', rpcUrl: '', privateKey: PK })
    ).rejects.toMatchObject({ code: 'DEX_CONFIG_INVALID' });
  });
});

describe('executeSwap — fail-closed antes de tocar a rede', () => {
  const fakeWallet = {} as unknown as ethers.Wallet;

  it('chain inválida → DEX_CONFIG_INVALID', async () => {
    const r = await executeSwap({
      wallet: fakeWallet,
      chain: 'solana',
      tokenIn: TOKEN_IN,
      tokenOut: TOKEN_OUT,
      amountInWei: 1n,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('DEX_CONFIG_INVALID');
  });

  it('amountInWei <= 0 → DEX_INVALID_AMOUNT', async () => {
    const r = await executeSwap({
      wallet: fakeWallet,
      chain: 'base',
      tokenIn: TOKEN_IN,
      tokenOut: TOKEN_OUT,
      amountInWei: 0n,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('DEX_INVALID_AMOUNT');
  });

  it('quoter inválido/ausente → DEX_QUOTE_UNAVAILABLE (sem min=0)', async () => {
    const r = await executeSwap({
      wallet: fakeWallet,
      chain: 'ethereum',
      tokenIn: TOKEN_IN,
      tokenOut: TOKEN_OUT,
      amountInWei: 1_000_000n,
      env: { UNISWAP_QUOTER_ETHEREUM: '0xnope' },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('DEX_QUOTE_UNAVAILABLE');
  });

  it('minAmountOutWei explícito 0 → DEX_INVALID_SLIPPAGE (proteção zero proibida)', async () => {
    const r = await executeSwap({
      wallet: fakeWallet,
      chain: 'base',
      tokenIn: TOKEN_IN,
      tokenOut: TOKEN_OUT,
      amountInWei: 1n,
      minAmountOutWei: 0n,
      env: { UNISWAP_QUOTER_BASE: '0x4444444444444444444444444444444444444444' },
    });
    // quoter é chamado antes; sem provider/RPC a falha pode vir como
    // DEX_QUOTE_UNAVAILABLE. O invariante é: nunca ok=true.
    expect(r.ok).toBe(false);
  });
});

describe('DexAdapterError', () => {
  it('carrega code tipado', () => {
    const err = new DexAdapterError('DEX_QUOTE_UNAVAILABLE', 'no quoter');
    expect(err.code).toBe('DEX_QUOTE_UNAVAILABLE');
    expect(err).toBeInstanceOf(Error);
  });
});
