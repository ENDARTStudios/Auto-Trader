// tests/scam-detector.test.ts — sub-scores, renormalização de unverified e pass/fail
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const scamCreate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: { scamReport: { create: (...a: unknown[]) => scamCreate(...a) } },
}));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

import { analyzeToken } from '@/lib/trading/scam-detector';
import type { EngineConfig } from '@/lib/trading/config';
import type { TokenCandidate } from '@/lib/trading/types';

const CFG = { scamScoreMin: 60 } as unknown as EngineConfig;

function dex(over: Partial<TokenCandidate> = {}): TokenCandidate {
  return {
    symbol: 'DEGEN/WETH',
    source: 'dex',
    chain: 'base',
    tokenId: '0xDegen',
    priceUsd: 1,
    volume24hUsd: 1_000_000,
    liquidityUsd: 500_000,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Etherscan (Base) devolvendo source verificado com flags controláveis. */
function mockEtherscan(opts: { status?: string; source?: string; abi?: string; proxy?: string; httpStatus?: number } = {}) {
  const fn = vi.fn(() => {
    if (opts.httpStatus && opts.httpStatus !== 200) return jsonResponse({}, opts.httpStatus);
    if (opts.status === '0') return jsonResponse({ status: '0', result: 'Contract source code not verified' });
    return jsonResponse({
      status: '1',
      result: [{
        SourceCode: opts.source ?? 'contract Safe { }',
        ABI: opts.abi ?? '[]',
        ContractName: 'DegenToken',
        CompilerVersion: 'v0.8.24',
        Proxy: opts.proxy ?? '0',
      }],
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function sub(report: Awaited<ReturnType<typeof analyzeToken>>, name: string) {
  return report.subscores.find((s) => s.name === name)!;
}

function expectedRenormalized(report: Awaited<ReturnType<typeof analyzeToken>>): number {
  const active = report.subscores.filter((s) => !s.unverified);
  const w = active.reduce((sum, s) => sum + s.score * s.weight, 0);
  const wt = active.reduce((sum, s) => sum + s.weight, 0);
  return wt > 0 ? Math.round(w / wt) : 0;
}

beforeEach(() => {
  scamCreate.mockReset();
  scamCreate.mockResolvedValue({ id: 1 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CEX bypass', () => {
  it('token CEX recebe 100/passed e não chama Etherscan', async () => {
    const fn = mockEtherscan();
    const report = await analyzeToken(CFG, {
      symbol: 'BTC/USDT', source: 'cex', priceUsd: 50000, volume24hUsd: 9e9, liquidityUsd: 9e9,
    });
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
    expect(report.subscores).toHaveLength(1);
    expect(report.subscores[0].name).toBe('cex_listed');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('tax — NÃO verificável (peso removido e renormalizado)', () => {
  it('marca unverified, score 0 e explica a remoção', async () => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex());
    const tax = sub(report, 'tax');
    expect(tax.unverified).toBe(true);
    expect(tax.score).toBe(0);
    expect(tax.findings.join(' ')).toMatch(/Tax não verificada/);
    expect(report.findings.unverified_subscores?.[0]).toMatch(/tax/);
  });

  it('score final == média ponderada SÓ dos sub-scores verificados', async () => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex());
    expect(report.score).toBe(expectedRenormalized(report));
  });

  it('unverified aparece em findings e o peso total relatado exclui o tax', async () => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex());
    expect(report.findings.unverified_subscores?.[0]).toMatch(/90%/);
  });
});

describe('contract — Etherscan/explorer', () => {
  it('código não verificado => score 10', async () => {
    mockEtherscan({ status: '0' });
    const report = await analyzeToken(CFG, dex());
    expect(sub(report, 'contract').score).toBe(10);
  });

  it('verificado COM mint + blacklist => penalidades aplicadas (70-25-20=25)', async () => {
    mockEtherscan({
      source: 'contract X { function mint() public {} modifier onlyXs { } function blacklist(address a) {} }',
      abi: '[{"name":"mint"},{"name":"blacklist"}]',
    });
    const report = await analyzeToken(CFG, dex());
    const c = sub(report, 'contract');
    expect(c.score).toBe(25);
    expect(c.findings.join(' ')).toMatch(/mint/i);
    expect(c.findings.join(' ')).toMatch(/blacklist/i);
  });

  it('proxy upgradeable => -20', async () => {
    mockEtherscan({ source: 'contract Safe { }', proxy: '1' });
    const report = await analyzeToken(CFG, dex());
    expect(sub(report, 'contract').score).toBe(50);
  });

  it('chain não suportada => neutro 50 sem fetch', async () => {
    const fn = mockEtherscan();
    const report = await analyzeToken(CFG, dex({ chain: 'ethereum' }));
    expect(sub(report, 'contract').score).toBe(50);
    expect(fn).not.toHaveBeenCalled();
  });

  it('HTTP não-ok => 30', async () => {
    mockEtherscan({ httpStatus: 500 });
    const report = await analyzeToken(CFG, dex());
    expect(sub(report, 'contract').score).toBe(30);
  });

  it('exceção de rede => 30 + finding de erro', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('ECONNRESET'); }));
    const report = await analyzeToken(CFG, dex());
    expect(sub(report, 'contract').score).toBe(30);
    expect(sub(report, 'contract').findings.join(' ')).toMatch(/Erro no audit/);
  });
});

describe('liquidity / age / holders', () => {
  it.each([
    [500_000, 100],
    [250_000, 80],
    [100_000, 60],
    [99_999, 20],
  ])('liquidez %i => %i', async (liquidityUsd, expected) => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex({ liquidityUsd }));
    expect(sub(report, 'liquidity').score).toBe(expected);
  });

  it.each([
    [30 * 24, 100],
    [7 * 24, 75],
    [48, 40],
    [12, 10],
  ])('idade %ih => %i', async (ageHours, expected) => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex({ ageHours, liquidityUsd: 500_000 }));
    expect(sub(report, 'age').score).toBe(expected);
  });

  it.each([
    [1000, 100],
    [500, 80],
    [100, 50],
    [50, 20],
  ])('holders %i => %i', async (holderCount, expected) => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex({ holderCount }));
    expect(sub(report, 'holder').score).toBe(expected);
  });

  it('holders desconhecido => neutro 60', async () => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex());
    expect(sub(report, 'holder').score).toBe(60);
  });
});

describe('honeypot_turnover — heurística explícita', () => {
  it.each([
    [2_500_000, 500_000, 90],  // 5x
    [750_000, 500_000, 80],    // 1.5x
    [200_000, 500_000, 60],    // 0.4x
    [50_000, 500_000, 35],     // 0.1x
  ])('volume %i / liq %i => %i', async (volume24hUsd, liquidityUsd, expected) => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex({ volume24hUsd, liquidityUsd }));
    expect(sub(report, 'honeypot_turnover').score).toBe(expected);
    expect(sub(report, 'honeypot_turnover').findings[0]).toMatch(/não é honeypot verificado/);
  });

  it('volume zero + liquidez alta => score 10 (compatível, não confirma)', async () => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex({ volume24hUsd: 0, liquidityUsd: 500_000 }));
    const h = sub(report, 'honeypot_turnover');
    expect(h.score).toBe(10);
    expect(h.unverified).toBeUndefined();
  });

  it('sem volume E sem liquidez => unverified (peso removido)', async () => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex({ volume24hUsd: 0, liquidityUsd: 0 }));
    const h = sub(report, 'honeypot_turnover');
    expect(h.unverified).toBe(true);
    expect(h.findings.join(' ')).toMatch(/Honeypot REAL não verificado/);
  });

  it('bônus token maduro + liquidez saudável (+10)', async () => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex({ volume24hUsd: 2_500_000, liquidityUsd: 500_000, ageHours: 240 }));
    expect(sub(report, 'honeypot_turnover').score).toBe(100);
  });
});

describe('pass/fail e persistência', () => {
  it('passed=true quando score >= cfg.scamScoreMin', async () => {
    mockEtherscan({ source: 'contract Safe { }' });
    const report = await analyzeToken(CFG, dex({ liquidityUsd: 1_000_000, volume24hUsd: 3_000_000, ageHours: 720, holderCount: 5000 }));
    expect(report.score).toBeGreaterThanOrEqual(60);
    expect(report.passed).toBe(true);
  });

  it('passed=false com threshold impossível', async () => {
    mockEtherscan();
    const report = await analyzeToken({ scamScoreMin: 101 } as unknown as EngineConfig, dex());
    expect(report.passed).toBe(false);
  });

  it('persiste ScamReport com sub-scores e findings JSON', async () => {
    mockEtherscan();
    const report = await analyzeToken(CFG, dex({ liquidityUsd: 1_000_000 }));
    expect(scamCreate).toHaveBeenCalledTimes(1);
    const data = scamCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      symbol: 'DEGEN/WETH',
      tokenId: '0xDegen',
      chain: 'base',
      score: report.score,
      passed: report.passed,
    });
    expect(typeof data.honeypotScore).toBe('number');
    expect(JSON.parse(data.findings).unverified_subscores).toBeDefined();
  });
});
