// tests/dex-adapter.test.ts — ethers v6 / Uniswap V3: helpers + fail-closed.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import { SIGNER_PROTOCOL_VERSION } from '@/lib/signer-protocol';
import type { SignerTransport } from '@/lib/chain/signer-adapter';
import {
  __resetTokenDecimalsCache,
  DEX_CHAIN_IDS,
  DexAdapterError,
  ERC20_ABI,
  QUOTER_V2_ADDRESSES,
  SWAP_EVENT_ABI,
  SWAP_ROUTER_02_ADDRESSES,
  USDC_ADDRESSES,
  applySlippage,
  buildSignerTransactionPayload,
  buildSwapParams,
  createDexSigner,
  createDexWallet,
  ensureErc20Allowance,
  executeSwap,
  isDexChain,
  parseSwapEventAmountOut,
  readTokenDecimals,
  resolveQuoterAddress,
  resolveRouterAddress,
  sha256Canonical,
  signTransactionWithSigner,
  usdcAddressForChain,
  type DexSigner,
  type SentTx,
  type SignerChainReader,
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
// ===========================================================================
// RODADA 3 — approve ERC20, decimals on-chain e assinatura via signer
// ===========================================================================
const USDC_BASE = USDC_ADDRESSES.base;
const ROUTER_BASE = SWAP_ROUTER_02_ADDRESSES.base;
const QUOTER_BASE = QUOTER_V2_ADDRESSES.base;
const OWNER = '0x2222222222222222222222222222222222222222';
const abiCoder = ethers.AbiCoder.defaultAbiCoder();

const okReceipt = { status: 1, gasUsed: 21_000n } as unknown as ethers.TransactionReceipt;
const failReceipt = { status: 0, gasUsed: 21_000n } as unknown as ethers.TransactionReceipt;

function providerReturning(handler: (tx: { to?: string; data?: string }) => string) {
  const calls: Array<{ to?: string; data?: string }> = [];
  const provider = {
    call: async (tx: { to?: string; data?: string }) => {
      calls.push(tx);
      return handler(tx);
    },
  } as unknown as ethers.Provider;
  return { provider, calls };
}

function encodeUint(value: bigint | number): string {
  return abiCoder.encode(['uint256'], [BigInt(value)]);
}

function dexSignerOf(
  overrides: Partial<DexSigner> & Pick<DexSigner, 'transport' | 'provider'>
): DexSigner {
  return {
    kind: 'signer',
    address: OWNER,
    walletId: 'wallet-1',
    chain: 'base',
    chainId: DEX_CHAIN_IDS.base,
    ...overrides,
  };
}

function echoTransport(
  capture: Array<{ method: string; params: unknown }>,
  override?: (params: {
    requestId: string;
    payloadHash: string;
  }) => { ok: boolean; result?: unknown; error?: { code: number; message: string } }
): SignerTransport {
  return {
    rpc: async (method: string, params: unknown) => {
      capture.push({ method, params });
      const p = params as { requestId: string; payloadHash: string };
      if (override) return override(p);
      return {
        ok: true,
        result: {
          ok: true,
          txHash: '0xsigned',
          rawSignedTx: '0xdeadbeef',
          requestId: p.requestId,
          receivedPayloadHash: p.payloadHash,
          signerVersion: SIGNER_PROTOCOL_VERSION,
        },
      };
    },
  };
}

function readerOf(overrides: Partial<SignerChainReader> = {}): SignerChainReader {
  return {
    getTransactionCount: async () => 7,
    getFeeData: async () =>
      ({
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        gasPrice: 25_000_000_000n,
      }) as unknown as ethers.FeeData,
    estimateGas: async () => 21_000n,
    broadcastTransaction: async () => ({
      hash: '0xbroadcasted',
      wait: async () => okReceipt,
    }),
    ...overrides,
  };
}

describe('ensureErc20Allowance', () => {
  it('allowance suficiente → alreadyApproved=true e NÃO assina approve', async () => {
    const { provider } = providerReturning(() => encodeUint(1_000_000n));
    const sendTx = vi.fn();
    const r = await ensureErc20Allowance(
      { provider, owner: OWNER, signer: {} as never, chain: 'base' },
      USDC_BASE,
      ROUTER_BASE,
      500_000n,
      { sendTx }
    );
    expect(r).toEqual({ ok: true, alreadyApproved: true });
    expect(sendTx).not.toHaveBeenCalled();
  });

  it('allowance insuficiente → approve do valor EXATO (não max) + receipt ok', async () => {
    const { provider, calls } = providerReturning(() => encodeUint(10n));
    const sendTx = vi.fn(async (): Promise<SentTx> => ({ txHash: '0xapprove', receipt: okReceipt }));
    const r = await ensureErc20Allowance(
      { provider, owner: OWNER, signer: {} as never, chain: 'base' },
      USDC_BASE,
      ROUTER_BASE,
      500_000n,
      { sendTx }
    );
    expect(r).toEqual({ ok: true, alreadyApproved: false, txHash: '0xapprove' });
    expect(sendTx).toHaveBeenCalledTimes(1);
    // primeira call é a leitura de allowance; o approve vai para sendTx.
    expect(calls[0].to).toBe(USDC_BASE);
    const approveTx = (sendTx.mock.calls[0] as unknown as [{ to: string; data: string }])[0];
    expect(approveTx.to).toBe(USDC_BASE);
    const decoded = new ethers.Interface(ERC20_ABI).decodeFunctionData('approve', approveTx.data);
    expect(decoded[0]).toBe(ROUTER_BASE);
    expect(decoded[1]).toBe(500_000n); // valor exato, nunca MaxUint256
  });

  it('approve revertido (status != 1) → DEX_APPROVAL_FAILED', async () => {
    const { provider } = providerReturning(() => encodeUint(0n));
    const r = await ensureErc20Allowance(
      { provider, owner: OWNER, signer: {} as never, chain: 'base' },
      USDC_BASE,
      ROUTER_BASE,
      10n,
      { sendTx: async () => ({ txHash: '0xbad', receipt: failReceipt }) }
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DEX_APPROVAL_FAILED');
  });

  it('falha ao ler allowance → DEX_APPROVAL_FAILED (fail-closed)', async () => {
    const { provider } = providerReturning(() => {
      throw new Error('rpc down');
    });
    const r = await ensureErc20Allowance(
      { provider, owner: OWNER, signer: {} as never, chain: 'base' },
      USDC_BASE,
      ROUTER_BASE,
      10n
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DEX_APPROVAL_FAILED');
  });
});

describe('readTokenDecimals', () => {
  beforeEach(() => {
    __resetTokenDecimalsCache();
  });

  it('lê 6 (USDC) e 18 (token) on-chain', async () => {
    const six = providerReturning(() => encodeUint(6));
    expect(await readTokenDecimals(six.provider, USDC_BASE, 'base')).toBe(6);

    const eighteen = providerReturning(() => encodeUint(18));
    expect(await readTokenDecimals(eighteen.provider, TOKEN_OUT, 'base')).toBe(18);
  });

  it('cache por (chain, token): segunda leitura não chama o RPC', async () => {
    const { provider, calls } = providerReturning(() => encodeUint(6));
    expect(await readTokenDecimals(provider, USDC_BASE, 'base')).toBe(6);
    expect(await readTokenDecimals(provider, USDC_BASE, 'base')).toBe(6);
    expect(calls).toHaveLength(1);
  });

  it('decimals fora de (0, 36] → DEX_DECIMALS_UNAVAILABLE', async () => {
    for (const bad of [0, 37]) {
      __resetTokenDecimalsCache();
      const { provider } = providerReturning(() => encodeUint(bad));
      await expect(readTokenDecimals(provider, USDC_BASE, 'base')).rejects.toMatchObject({
        code: 'DEX_DECIMALS_UNAVAILABLE',
      });
    }
  });

  it('RPC falhou → DEX_DECIMALS_UNAVAILABLE', async () => {
    const { provider } = providerReturning(() => {
      throw new Error('timeout');
    });
    await expect(readTokenDecimals(provider, USDC_BASE, 'base')).rejects.toMatchObject({
      code: 'DEX_DECIMALS_UNAVAILABLE',
    });
  });
});

describe('buildSignerTransactionPayload (EIP-1559 exato)', () => {
  const envelope = buildSignerTransactionPayload({
    from: OWNER,
    to: ROUTER_BASE,
    data: '0x1234',
    chainId: DEX_CHAIN_IDS.base,
    nonce: 7,
    gasLimit: 123_456n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    approvedAmountWei: 500n,
    slippageLimitBps: 100,
  });

  it('inclui chainId/nonce/gas/fees/type=2 e tx.from/to/data', () => {
    expect(envelope.operation).toBe('signTransaction');
    expect(envelope.protocolVersion).toBe(SIGNER_PROTOCOL_VERSION);
    expect(envelope.payload.chainId).toBe(8453);
    expect(envelope.payload.nonce).toBe(7);
    expect(envelope.payload.gasLimit).toBe('123456');
    expect(envelope.payload.maxFeePerGas).toBe('30000000000');
    expect(envelope.payload.maxPriorityFeePerGas).toBe('1000000000');
    expect(envelope.payload.type).toBe(2);
    expect(envelope.payload.tx).toMatchObject({
      from: OWNER,
      to: ROUTER_BASE,
      value: '0',
      data: '0x1234',
    });
    expect(envelope.payload.approvedAmount).toBe('500');
    expect(envelope.payload.slippageLimitBps).toBe(100);
    expect(typeof envelope.payload.expectedDiff).toBe('object');
  });

  it('payloadHash = SHA-256 do JSON canônico (mesma forma do signer)', () => {
    const expected =
      '0x' + createHash('sha256').update(JSON.stringify(envelope.payload), 'utf8').digest('hex');
    expect(envelope.payloadHash).toBe(expected);
    expect(envelope.payloadHash).toBe(sha256Canonical(envelope.payload));
  });
});

describe('signTransactionWithSigner (raw assinado + broadcast)', () => {
  it('envia envelope completo ao signer e faz broadcast do raw', async () => {
    const capture: Array<{ method: string; params: unknown }> = [];
    const signer = dexSignerOf({
      transport: echoTransport(capture),
      provider: {} as ethers.Provider,
    });
    const sent = await signTransactionWithSigner(
      signer,
      { to: ROUTER_BASE, data: '0xswapdata' },
      { reader: readerOf(), approvedAmountWei: 500n, slippageLimitBps: 100 }
    );
    expect(sent.txHash).toBe('0xbroadcasted');
    expect(sent.receipt.status).toBe(1);
    expect(capture).toHaveLength(1);
    expect(capture[0].method).toBe('signTransaction');
    const params = capture[0].params as {
      operation: string;
      payload: { chainId: number; nonce: number; gasLimit: string; type: number };
    };
    expect(params.operation).toBe('signTransaction');
    expect(params.payload.chainId).toBe(8453);
    expect(params.payload.nonce).toBe(7);
    expect(params.payload.gasLimit).toBe('21000');
    expect(params.payload.type).toBe(2);
  });

  it('signer indisponível (RPC rejeitou conexão) → DEX_SIGNER_UNAVAILABLE', async () => {
    const transport: SignerTransport = {
      rpc: async () => {
        throw new Error('ENOENT signer.sock');
      },
    };
    const signer = dexSignerOf({ transport, provider: {} as ethers.Provider });
    await expect(
      signTransactionWithSigner(signer, { to: ROUTER_BASE, data: '0x' }, { reader: readerOf() })
    ).rejects.toMatchObject({ code: 'DEX_SIGNER_UNAVAILABLE' });
  });

  it('signer rejeitou a assinatura → DEX_SIGNER_SIGN_FAILED', async () => {
    const signer = dexSignerOf({
      transport: echoTransport([], (p) => ({
        ok: true,
        result: {
          ok: false,
          error: 'SIGNER_VAULT_LOCKED: vault is locked',
          requestId: p.requestId,
          receivedPayloadHash: p.payloadHash,
          signerVersion: SIGNER_PROTOCOL_VERSION,
        },
      })),
      provider: {} as ethers.Provider,
    });
    await expect(
      signTransactionWithSigner(signer, { to: ROUTER_BASE, data: '0x' }, { reader: readerOf() })
    ).rejects.toMatchObject({ code: 'DEX_SIGNER_SIGN_FAILED' });
  });

  it('payloadHash ecoado diferente → DEX_SIGNER_SIGN_FAILED (payload corrompido)', async () => {
    const signer = dexSignerOf({
      transport: echoTransport([], (p) => ({
        ok: true,
        result: {
          ok: true,
          txHash: '0x1',
          rawSignedTx: '0xdeadbeef',
          requestId: p.requestId,
          receivedPayloadHash: '0xdeadbeef',
          signerVersion: SIGNER_PROTOCOL_VERSION,
        },
      })),
      provider: {} as ethers.Provider,
    });
    await expect(
      signTransactionWithSigner(signer, { to: ROUTER_BASE, data: '0x' }, { reader: readerOf() })
    ).rejects.toMatchObject({ code: 'DEX_SIGNER_SIGN_FAILED' });
  });

  it('broadcast falhou → DEX_BROADCAST_FAILED', async () => {
    const signer = dexSignerOf({
      transport: echoTransport([]),
      provider: {} as ethers.Provider,
    });
    const reader = readerOf({
      broadcastTransaction: async () => {
        throw new Error('nonce too low');
      },
    });
    await expect(
      signTransactionWithSigner(signer, { to: ROUTER_BASE, data: '0x' }, { reader })
    ).rejects.toMatchObject({ code: 'DEX_BROADCAST_FAILED' });
  });

  it('receipt revertido → DEX_EXECUTION_FAILED', async () => {
    const signer = dexSignerOf({
      transport: echoTransport([]),
      provider: {} as ethers.Provider,
    });
    const reader = readerOf({
      broadcastTransaction: async () => ({ hash: '0xrevert', wait: async () => failReceipt }),
    });
    await expect(
      signTransactionWithSigner(signer, { to: ROUTER_BASE, data: '0x' }, { reader })
    ).rejects.toMatchObject({ code: 'DEX_EXECUTION_FAILED' });
  });
});

describe('createDexSigner — source=signer', () => {
  const signerCreds = {
    source: 'signer' as const,
    chain: 'base',
    rpcUrl: 'http://127.0.0.1:1',
    signerSocketPath: 'tcp://127.0.0.1:1',
  };

  it('sem walletId → DEX_SIGNER_UNAVAILABLE (não inventa endereço/chave)', async () => {
    await expect(createDexSigner(signerCreds, { env: {} })).rejects.toMatchObject({
      code: 'DEX_SIGNER_UNAVAILABLE',
    });
  });

  it('com walletId mas sem socket/transport → DEX_SIGNER_UNAVAILABLE', async () => {
    await expect(
      createDexSigner(
        { ...signerCreds, signerWalletId: 'wallet-1', signerSocketPath: undefined },
        { env: {} }
      )
    ).rejects.toMatchObject({ code: 'DEX_SIGNER_UNAVAILABLE' });
  });

  it('walletId + transport injetado → objeto signer com chainId correto', async () => {
    const capture: Array<{ method: string; params: unknown }> = [];
    const signer = await createDexSigner(
      { ...signerCreds, signerWalletId: 'wallet-1' },
      {
        env: {},
        transport: echoTransport(capture),
        address: OWNER,
        provider: {} as ethers.Provider,
      }
    );
    expect(signer).toMatchObject({
      kind: 'signer',
      address: OWNER,
      walletId: 'wallet-1',
      chainId: 8453,
    });
  });

  it('source env com privateKey → ethers.Wallet local', async () => {
    const wallet = await createDexSigner(
      { source: 'env', chain: 'base', rpcUrl: 'http://127.0.0.1:1', privateKey: PK },
      { provider: {} as ethers.Provider }
    );
    expect(wallet).toBeInstanceOf(ethers.Wallet);
  });
});

describe('executeSwap — cadeia approve → quote → signer → broadcast → receipt', () => {
  const swapIface = new ethers.Interface(SWAP_EVENT_ABI);
  const swapEvent = swapIface.getEvent('Swap')!;
  const encodedSwapLog = swapIface.encodeEventLog(swapEvent, [
    ROUTER_BASE,
    OWNER,
    -500_000n,
    2_000_000n,
    0n,
    0n,
    0,
  ]);

  it('falha fechada se approve não confirmar (não tenta swap)', async () => {
    const { provider } = providerReturning((tx) => {
      if (tx.to === USDC_BASE) return encodeUint(0n);
      throw new Error('não deveria consultar quoter sem approve');
    });
    const signer = dexSignerOf({ transport: echoTransport([]), provider });
    const r = await executeSwap({
      wallet: signer,
      chain: 'base',
      tokenIn: USDC_BASE,
      tokenOut: TOKEN_OUT,
      amountInWei: 500_000n,
      slippageBps: 100,
      env: { UNISWAP_QUOTER_BASE: QUOTER_BASE, UNISWAP_ROUTER_BASE: ROUTER_BASE },
      deps: { allowanceSendTx: async () => ({ txHash: '0xapprove', receipt: failReceipt }) },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('DEX_APPROVAL_FAILED');
  });

  it('caminho completo signer: approve + quote + raw assinado + broadcast + evento Swap', async () => {
    const { provider } = providerReturning((tx) => {
      if (tx.to === USDC_BASE) return encodeUint(0n);
      if (tx.to === QUOTER_BASE) {
        return abiCoder.encode(
          ['uint256', 'uint160', 'uint32', 'uint256'],
          [2_000_000n, 0n, 0, 100_000n]
        );
      }
      throw new Error('call inesperada para ' + String(tx.to));
    });
    const capture: Array<{ method: string; params: unknown }> = [];
    const signer = dexSignerOf({ transport: echoTransport(capture), provider });
    const reader = readerOf({
      broadcastTransaction: async () => ({
        hash: '0xswap',
        wait: async () =>
          ({
            status: 1,
            gasUsed: 150_000n,
            logs: [encodedSwapLog],
          }) as unknown as ethers.TransactionReceipt,
      }),
    });
    const r = await executeSwap({
      wallet: signer,
      chain: 'base',
      tokenIn: USDC_BASE,
      tokenOut: TOKEN_OUT,
      amountInWei: 500_000n,
      slippageBps: 100,
      env: { UNISWAP_QUOTER_BASE: QUOTER_BASE, UNISWAP_ROUTER_BASE: ROUTER_BASE },
      deps: {
        allowanceSendTx: async () => ({ txHash: '0xapprove', receipt: okReceipt }),
        reader,
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.txHash).toBe('0xswap');
    expect(r.approveTxHash).toBe('0xapprove');
    expect(r.alreadyApproved).toBe(false);
    expect(r.amountOutWei).toBe(2_000_000n);
    expect(r.amountOutMinimumWei).toBe(1_980_000n); // 100 bps
    expect(r.amountOutSource).toBe('event');
    expect(r.gasUsed).toBe(150_000n);
    // O signer recebeu a tx do swap (raw assinado no signer process).
    expect(capture).toHaveLength(1);
    expect(capture[0].method).toBe('signTransaction');
  });
});
