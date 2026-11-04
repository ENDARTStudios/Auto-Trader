// tests/live-trader.test.ts — execução LIVE: FAIL-CLOSED, sem mock/random.
//
// Nenhum teste toca rede/exchange: credenciais são mockadas como indisponíveis
// e a feature flag é controlada em memória. O que se prova aqui é o contrato de
// recusa (LIVE_DISABLED / LIVE_CREDS_UNAVAILABLE) e a ausência de dados fake.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { SIGNER_PROTOCOL_VERSION } from '@/lib/signer-protocol';
import type { SignerTransport } from '@/lib/chain/signer-adapter';
import {
  QUOTER_V2_ADDRESSES,
  SWAP_EVENT_ABI,
  SWAP_ROUTER_02_ADDRESSES,
  USDC_ADDRESSES,
  type SignerChainReader,
} from '@/lib/chain/dex-adapter';

const hoisted = vi.hoisted(() => ({
  flagEnabled: false,
  // Permite trocar a resposta de getDexCredentials por teste (signer source).
  dexResult: null as null | Record<string, unknown>,
}));

vi.mock('@/lib/trading/feature-flags', () => ({
  isEnabled: async () => hoisted.flagEnabled,
}));

vi.mock('@/lib/trading/live-credentials', () => ({
  getCexCredentials: async () => ({
    ok: false,
    code: 'LIVE_CREDS_NOT_CONFIGURED',
    reason: 'test: sem credenciais',
  }),
  getDexCredentials: () =>
    hoisted.dexResult ?? {
      ok: false,
      code: 'LIVE_CREDS_NOT_CONFIGURED',
      reason: 'test: sem credenciais',
    },
}));

import {
  cexLimitOrder,
  cexMarketOrder,
  dexApproveToken,
  dexSwapExactTokensSingle,
  getCexBalances,
  LIVE_TRADER_CONFIG,
} from '@/lib/chain/live-trader';

const LIVE_CFG = { mode: 'live', graduatedToLive: true, killSwitchActive: false };
const FLAG_ON = () => {
  hoisted.flagEnabled = true;
};
const FLAG_OFF = () => {
  hoisted.flagEnabled = false;
};

const ENV_KEYS = ['LIVE_TRADING_ENABLED', 'S14_APPROVED'] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  FLAG_OFF();
  hoisted.dexResult = null;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  FLAG_OFF();
});

function enableAllFlags() {
  process.env.LIVE_TRADING_ENABLED = 'true';
  process.env.S14_APPROVED = 'true';
  FLAG_ON();
}

const MARKET_REQ = { symbol: 'BTC/USDT', side: 'buy' as const, amountUsd: 100, type: 'market' as const };
const SWAP_REQ = {
  chain: 'base' as const,
  tokenIn: '0x' + '11'.repeat(20),
  tokenOut: '0x' + '22'.repeat(20),
  amountInWei: 1_000_000n,
  amountOutMinWei: 990_000n,
  to: '0x' + '33'.repeat(20),
  deadline: Math.floor(Date.now() / 1000) + 600,
};

describe('live-trader — sem gate explícito tudo é recusado', () => {
  it('cexMarketOrder sem LiveGateConfig → LIVE_DISABLED', async () => {
    const r = await cexMarketOrder(MARKET_REQ);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_DISABLED');
    expect(r.orderId).toBeUndefined();
    expect(r.filledPrice).toBeUndefined();
  });

  it('cexLimitOrder sem gate → LIVE_DISABLED (e exige limitPrice antes)', async () => {
    const noPrice = await cexLimitOrder({ ...MARKET_REQ, type: 'limit' });
    expect(noPrice.ok).toBe(false);
    expect(noPrice.error).toBe('limit_price_required');

    const r = await cexLimitOrder({ ...MARKET_REQ, type: 'limit', limitPrice: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_DISABLED');
  });

  it('getCexBalances sem gate → [] (nunca saldos fake)', async () => {
    expect(await getCexBalances()).toEqual([]);
  });

  it('dexSwap sem gate → LIVE_DISABLED', async () => {
    const r = await dexSwapExactTokensSingle(SWAP_REQ);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_DISABLED');
    expect(r.txHash).toBeUndefined();
  });

  it('dexApproveToken sem gate → LIVE_DISABLED', async () => {
    const r = await dexApproveToken('0x' + '11'.repeat(20), 1n, '0x' + '22'.repeat(20), 'base');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_DISABLED');
  });
});

describe('live-trader — gate parcial continua negando', () => {
  it('cfg live+graduated mas sem env flags → LIVE_DISABLED', async () => {
    hoisted.flagEnabled = true; // flag ligada, mas env ausente
    const r = await cexMarketOrder(MARKET_REQ, LIVE_CFG);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_DISABLED');
    expect(r.error).toContain('LIVE_TRADING_ENABLED');
  });

  it('env flags ok mas feature flag off → LIVE_DISABLED', async () => {
    process.env.LIVE_TRADING_ENABLED = 'true';
    process.env.S14_APPROVED = 'true';
    const r = await cexMarketOrder(MARKET_REQ, LIVE_CFG);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_DISABLED');
    expect(r.error).toContain('enable_live_trading');
  });

  it('kill switch ativo → LIVE_DISABLED mesmo com tudo ligado', async () => {
    enableAllFlags();
    const r = await cexMarketOrder(MARKET_REQ, { ...LIVE_CFG, killSwitchActive: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('killSwitchActive');
  });

  it('mode paper → LIVE_DISABLED mesmo com env/flags ligadas', async () => {
    enableAllFlags();
    const r = await cexMarketOrder(MARKET_REQ, { mode: 'paper', graduatedToLive: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_DISABLED');
  });
});

describe('live-trader — gate ok mas credenciais ausentes → fail-closed', () => {
  it('CEX: LIVE_CREDS_UNAVAILABLE, sem cair para paper', async () => {
    enableAllFlags();
    const r = await cexMarketOrder(MARKET_REQ, LIVE_CFG);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_CREDS_UNAVAILABLE');
    expect(r.orderId).toBeUndefined();
  });

  it('CEX limite: LIVE_CREDS_UNAVAILABLE', async () => {
    enableAllFlags();
    const r = await cexLimitOrder({ ...MARKET_REQ, type: 'limit', limitPrice: 100 }, LIVE_CFG);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_CREDS_UNAVAILABLE');
  });

  it('saldos: [] quando credenciais ausentes', async () => {
    enableAllFlags();
    expect(await getCexBalances(LIVE_CFG)).toEqual([]);
  });

  it('DEX swap: LIVE_CREDS_UNAVAILABLE, sem txHash fake', async () => {
    enableAllFlags();
    const r = await dexSwapExactTokensSingle(SWAP_REQ, LIVE_CFG);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_CREDS_UNAVAILABLE');
    expect(r.txHash).toBeUndefined();
    expect(r.amountOutWei).toBeUndefined();
  });

  it('DEX approve: LIVE_CREDS_UNAVAILABLE; sem chain → DEX_CONFIG_INVALID', async () => {
    enableAllFlags();
    const r = await dexApproveToken('0x' + '11'.repeat(20), 1n, '0x' + '22'.repeat(20), 'base', LIVE_CFG);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LIVE_CREDS_UNAVAILABLE');

    const noChain = await dexApproveToken(
      '0x' + '11'.repeat(20),
      1n,
      '0x' + '22'.repeat(20),
      undefined,
      LIVE_CFG
    );
    expect(noChain.ok).toBe(false);
    expect(noChain.error).toContain('DEX_CONFIG_INVALID');
  });
});

describe('live-trader — nenhum dado fake', () => {
  it('resultados nunca contêm mocks, random ids ou txHash fabricado', async () => {
    enableAllFlags();
    const results = [
      await cexMarketOrder(MARKET_REQ, LIVE_CFG),
      await dexSwapExactTokensSingle(SWAP_REQ, LIVE_CFG),
    ];
    const serialized = JSON.stringify(results, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v
    );
    expect(serialized).not.toContain('mock-');
    expect(serialized).not.toMatch(/0x[0-9a-fA-F]{64}/); // nenhum txHash fake
    for (const r of results) expect(r.ok).toBe(false);
  });

  it('LIVE_TRADER_CONFIG expõe routers válidos e testnet default true', () => {
    const addr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
    expect(addr(LIVE_TRADER_CONFIG.uniswapV3Router)).toBe(true);
    expect(addr(LIVE_TRADER_CONFIG.uniswapV3RouterArbitrum)).toBe(true);
    expect(addr(LIVE_TRADER_CONFIG.uniswapV3RouterOptimism)).toBe(true);
    expect(addr(LIVE_TRADER_CONFIG.uniswapV3RouterBase)).toBe(true);
    expect(LIVE_TRADER_CONFIG.testnet).toBe(true);
    expect(LIVE_TRADER_CONFIG.failRate).toBe(0);
  });
});
// ===========================================================================
// RODADA 3 — DEX via signer process (sem privateKey no processo web)
// ===========================================================================
describe('live-trader — DEX source=signer', () => {
  const OWNER = '0x' + 'aa'.repeat(20);
  const ROUTER = SWAP_ROUTER_02_ADDRESSES.base;
  const QUOTER = QUOTER_V2_ADDRESSES.base;
  const USDC = USDC_ADDRESSES.base;
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const okReceipt = { status: 1, gasUsed: 21_000n } as unknown as ethers.TransactionReceipt;
  const swapIface = new ethers.Interface(SWAP_EVENT_ABI);

  const signerCreds = {
    ok: true,
    creds: {
      source: 'signer',
      chain: 'base',
      rpcUrl: 'http://127.0.0.1:1',
      signerSocketPath: 'tcp://127.0.0.1:1',
      signerWalletId: 'wallet-1',
    },
  };

  function providerFor(allowance: bigint) {
    return {
      call: async (tx: { to?: string; data?: string }) => {
        if (tx.to === QUOTER) {
          return abiCoder.encode(
            ['uint256', 'uint160', 'uint32', 'uint256'],
            [2_000_000n, 0n, 0, 100_000n]
          );
        }
        return abiCoder.encode(['uint256'], [allowance]);
      },
    } as unknown as ethers.Provider;
  }

  function transportEcho(capture: Array<{ method: string; params: unknown }>): SignerTransport {
    return {
      rpc: async (method: string, params: unknown) => {
        capture.push({ method, params });
        const p = params as { requestId: string; payloadHash: string };
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

  function readerWith(spy: { broadcast: Array<string> }): SignerChainReader {
    return {
      getTransactionCount: async () => 3,
      getFeeData: async () =>
        ({
          maxFeePerGas: 30_000_000_000n,
          maxPriorityFeePerGas: 1_000_000_000n,
          gasPrice: 25_000_000_000n,
        }) as unknown as ethers.FeeData,
      estimateGas: async () => 21_000n,
      broadcastTransaction: async (raw: string) => {
        spy.broadcast.push(raw);
        return {
          hash: '0xswap',
          wait: async () =>
            ({
              status: 1,
              gasUsed: 120_000n,
              logs: [
                swapIface.encodeEventLog(swapIface.getEvent('Swap')!, [
                  ROUTER,
                  OWNER,
                  -1_000_000n,
                  2_000_000n,
                  0n,
                  0n,
                  0,
                ]),
              ],
            }) as unknown as ethers.TransactionReceipt,
        };
      },
    };
  }

  it('source=signer sem walletId → DEX_SIGNER_UNAVAILABLE (fail-closed)', async () => {
    enableAllFlags();
    delete process.env.DEX_SIGNER_WALLET_ID;
    hoisted.dexResult = {
      ok: true,
      creds: { source: 'signer', chain: 'base', rpcUrl: 'http://127.0.0.1:1', signerSocketPath: 'tcp://127.0.0.1:1' },
    };
    const r = await dexSwapExactTokensSingle(SWAP_REQ, LIVE_CFG);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('DEX_SIGNER_UNAVAILABLE');
    expect(r.txHash).toBeUndefined();
  });

  it('com transport mockado: chama RPC signTransaction e faz broadcast', async () => {
    enableAllFlags();
    hoisted.dexResult = signerCreds;
    const capture: Array<{ method: string; params: unknown }> = [];
    const spy = { broadcast: [] as string[] };
    const r = await dexSwapExactTokensSingle(SWAP_REQ, LIVE_CFG, {
      transport: transportEcho(capture),
      address: ethers.getAddress(OWNER),
      provider: providerFor(2n ** 255n), // allowance já suficiente
      reader: readerWith(spy),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.txHash).toBe('0xswap');
    expect(r.amountOutWei).toBe(2_000_000n);
    expect(r.amountInWei).toBe(SWAP_REQ.amountInWei);
    expect(capture.map((c) => c.method)).toEqual(['signTransaction']);
    expect(spy.broadcast).toEqual(['0xdeadbeef']);
    const params = capture[0].params as {
      payload: { tx: { from: string; to: string }; chainId: number; type: number };
    };
    expect(params.payload.chainId).toBe(8453);
    expect(params.payload.type).toBe(2);
    expect(params.payload.tx.to).toBe(ROUTER);
    expect(params.payload.tx.from).toBe(ethers.getAddress(OWNER));
  });

  it('dexApproveToken via signer: allowance insuficiente → approve assinado + broadcast', async () => {
    enableAllFlags();
    hoisted.dexResult = signerCreds;
    const capture: Array<{ method: string; params: unknown }> = [];
    const spy = { broadcast: [] as string[] };
    const r = await dexApproveToken(
      USDC,
      500_000n,
      ROUTER,
      'base',
      LIVE_CFG,
      {
        transport: transportEcho(capture),
        address: ethers.getAddress(OWNER),
        provider: providerFor(0n),
        reader: readerWith(spy),
      }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(capture.map((c) => c.method)).toEqual(['signTransaction']);
    expect(spy.broadcast).toEqual(['0xdeadbeef']);
    expect(r.txHash).toBe('0xswap');
  });

  it('dexApproveToken via signer: allowance já suficiente → não assina', async () => {
    enableAllFlags();
    hoisted.dexResult = signerCreds;
    const capture: Array<{ method: string; params: unknown }> = [];
    const r = await dexApproveToken(USDC, 10n, ROUTER, 'base', LIVE_CFG, {
      transport: transportEcho(capture),
      address: ethers.getAddress(OWNER),
      provider: providerFor(10n),
    });
    expect(r).toEqual({ ok: true, txHash: undefined });
    expect(capture).toHaveLength(0);
  });
});
