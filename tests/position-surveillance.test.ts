// tests/position-surveillance.test.ts — alertas de risco com db/goplus/price mockados
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const alertFindFirst = vi.fn();
const alertCreate = vi.fn();
const alertUpdateMany = vi.fn();
const alertFindMany = vi.fn();
const scanTokenWithGoPlus = vi.fn();
const fetchPricesBatch = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    positionAlert: {
      findFirst: (...a: unknown[]) => alertFindFirst(...a),
      create: (...a: unknown[]) => alertCreate(...a),
      updateMany: (...a: unknown[]) => alertUpdateMany(...a),
      findMany: (...a: unknown[]) => alertFindMany(...a),
    },
  },
}));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});
vi.mock('@/lib/trading/goplus-scanner', () => ({
  scanTokenWithGoPlus: (...a: unknown[]) => scanTokenWithGoPlus(...a),
}));
vi.mock('@/lib/trading/price-feed', () => ({
  fetchPricesBatch: (...a: unknown[]) => fetchPricesBatch(...a),
}));

import {
  extractPercent,
  listRecentAlerts,
  resolveAlertsForPosition,
  runSurveillance,
} from '@/lib/trading/position-surveillance';

const NOW = Date.now();

function position(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    symbol: 'DEGEN/WETH',
    tokenId: '0xdeg',
    chain: 'base',
    source: 'dex',
    entryPriceUsd: 100,
    entryAmountUsd: 1000,
    entryAt: new Date(NOW - 60 * 60_000),
    takeProfitPrice: 120,
    stopLossPrice: 80,
    maxExitAt: new Date(NOW + 24 * 60 * 60_000),
    ...over,
  } as Parameters<typeof runSurveillance>[0][number];
}

function goplus(over: Record<string, unknown> = {}) {
  return { score: 90, criticalFlags: [], findings: [], ...over };
}

function createdAlert(input: Record<string, any>) {
  return {
    id: 1,
    positionId: input.data.positionId,
    symbol: input.data.symbol,
    type: input.data.type,
    severity: input.data.severity,
    message: input.data.message,
    detectedAt: new Date(),
    ...input.data,
  };
}

let created = 0;
beforeEach(() => {
  created = 0;
  alertFindFirst.mockReset().mockResolvedValue(null);
  alertCreate.mockReset().mockImplementation((input: any) => {
    created++;
    return Promise.resolve(createdAlert(input));
  });
  alertUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  alertFindMany.mockReset().mockResolvedValue([]);
  scanTokenWithGoPlus.mockReset().mockResolvedValue(goplus());
  fetchPricesBatch.mockReset().mockResolvedValue(new Map([['p1', 100]]));
  vi.stubGlobal('fetch', vi.fn(() => new Response(JSON.stringify({ pairs: [] }), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractPercent (parser dos findings)', () => {
  it.each([
    ['Sell tax 25% (predatória)', 25],
    ['sell tax 30%', 30],
    ['Sell tax 5.5% (excelente)', 5.5],
    ['Top 10 holders: 90.0% (perigosamente concentrada)', 90],
    ['Liquidez atual $20000 — abaixo de $50k', null],
    ['3694011 holders (excelente)', null],
  ])('%s => %s', (text, expected) => {
    expect(extractPercent(text)).toBe(expected);
  });
});

describe('runSurveillance — casos base', () => {
  it('sem posições => [] e não consulta preços', async () => {
    expect(await runSurveillance([])).toEqual([]);
    expect(fetchPricesBatch).not.toHaveBeenCalled();
  });

  it('posição saudável (CEX) => sem alertas e sem varredura DEX', async () => {
    const res = await runSurveillance([position({ source: 'cex', tokenId: null, chain: null })]);
    expect(res).toHaveLength(1);
    expect(res[0].alerts).toEqual([]);
    expect(scanTokenWithGoPlus).not.toHaveBeenCalled();
  });

  it('price dump velocity: queda >=12% acima do SL => warning', async () => {
    fetchPricesBatch.mockResolvedValue(new Map([['p1', 85]]));
    const res = await runSurveillance([position()]);
    const alert = res[0].alerts.find((a) => a.type === 'price_dump_velocity')!;
    expect(alert).toBeDefined();
    expect(alert.severity).toBe('warning');
    expect(alert.message).toContain('15.00%');
  });

  it('sem alerta de dump quando o preço já está abaixo do SL (já seria stop)', async () => {
    fetchPricesBatch.mockResolvedValue(new Map([['p1', 70]]));
    const res = await runSurveillance([position({ source: 'cex', tokenId: null, chain: null })]);
    expect(res[0].alerts.some((a) => a.type === 'price_dump_velocity')).toBe(false);
  });

  it('timeout approaching: <30min => info', async () => {
    const res = await runSurveillance([
      position({ source: 'cex', tokenId: null, chain: null, maxExitAt: new Date(Date.now() + 10 * 60_000) }),
    ]);
    const alert = res[0].alerts.find((a) => a.type === 'timeout_approaching')!;
    expect(alert.severity).toBe('info');
    expect(alert.message).toMatch(/Timeout em/);
  });

  it('dedupe: alerta não resolvido recente do mesmo tipo => não cria outro', async () => {
    alertFindFirst.mockResolvedValue({ id: 99 });
    const res = await runSurveillance([position({ source: 'cex', tokenId: null, chain: null, maxExitAt: new Date(Date.now() + 5 * 60_000) })]);
    expect(res[0].alerts).toEqual([]);
    expect(alertCreate).not.toHaveBeenCalled();
    expect(alertFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ positionId: 'p1', type: 'timeout_approaching' }) }));
  });
});

describe('runSurveillance — DEX (GoPlus + DexScreener)', () => {
  it('GoPlus com criticalFlags => alerta critical', async () => {
    scanTokenWithGoPlus.mockResolvedValue(goplus({ criticalFlags: ['HONEYPOT'], score: 5 }));
    const res = await runSurveillance([position()]);
    const alert = res[0].alerts.find((a) => a.type === 'goplus_critical_flag')!;
    expect(alert.severity).toBe('critical');
    expect(alert.message).toContain('HONEYPOT');
    expect(res[0].currentGoPlusScore).toBe(5);
  });

  // Regressão round 6: estes dois caminhos estavam MORTOS (regex com "%\b" e
  // comparação textual de holder). Agora comparam o percentual extraído.
  it.each([
    ['Top 10 holders: 90.0% (perigosamente concentrada)', true],
    ['Top 10 holders: 55.0% (concentrada)', true],
    ['Top 10 holders: 20.0% (ótima distribuição)', false],
    ['3694011 holders (excelente)', false], // contagem sem percentual => sem dado
  ])('holder_concentration: %s => alerta=%s', async (finding, shouldAlert) => {
    scanTokenWithGoPlus.mockResolvedValue(goplus({ findings: [finding] }));
    const res = await runSurveillance([position()]);
    expect(res[0].alerts.some((a) => a.type === 'holder_concentration')).toBe(shouldAlert);
  });

  it('holder_concentration sem finding de holders => sem alerta (ausência de dado)', async () => {
    scanTokenWithGoPlus.mockResolvedValue(goplus({ findings: ['✓ Source code verificado', '✓ Sem função mint'] }));
    const res = await runSurveillance([position()]);
    expect(res[0].alerts).toEqual([]);
  });

  it.each([
    ['⚠️ Sell tax 25% (predatória)', true],
    ['Sell tax 30% (predatória)', true],
    ['Sell tax 10.0% (alta)', true],
    ['Sell tax 5.5% (excelente)', false],
    ['Buy tax 30% (predatória)', false], // só sell tax interessa
  ])('tax_spike: %s => alerta=%s', async (finding, shouldAlert) => {
    scanTokenWithGoPlus.mockResolvedValue(goplus({ findings: [finding] }));
    const res = await runSurveillance([position()]);
    expect(res[0].alerts.some((a) => a.type === 'tax_spike')).toBe(shouldAlert);
  });

  it('falha do GoPlus é engolida (não derruba a vigilância)', async () => {
    scanTokenWithGoPlus.mockRejectedValue(new Error('goplus down'));
    const res = await runSurveillance([position()]);
    expect(res).toHaveLength(1);
    expect(res[0].alerts).toEqual([]);
  });

  it('liquidez < $50k => alerta critical de liquidity_drain', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Response(JSON.stringify({ pairs: [
      { chainId: 'base', baseToken: { address: '0xdeg' }, liquidity: { usd: 20_000 } },
    ] }), { status: 200 })));
    const res = await runSurveillance([position()]);
    const alert = res[0].alerts.find((a) => a.type === 'liquidity_drain')!;
    expect(alert.severity).toBe('critical');
    expect(res[0].currentLiquidityUsd).toBe(20_000);
  });

  it('queda de 15% em 1h no DexScreener => price_anomaly critical', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Response(JSON.stringify({ pairs: [
      { chainId: 'base', baseToken: { address: '0xdeg' }, liquidity: { usd: 500_000 }, priceChange: { h1: -15 } },
    ] }), { status: 200 })));
    const res = await runSurveillance([position()]);
    expect(res[0].alerts.some((a) => a.type === 'price_anomaly' && a.severity === 'critical')).toBe(true);
  });

  it('pressão vendedora (>=80% sells) => price_anomaly warning', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Response(JSON.stringify({ pairs: [
      { chainId: 'base', baseToken: { address: '0xdeg' }, liquidity: { usd: 500_000 }, txns: { h1: { buys: 2, sells: 20 } } },
    ] }), { status: 200 })));
    const res = await runSurveillance([position()]);
    expect(res[0].alerts.some((a) => a.type === 'price_anomaly' && a.severity === 'warning')).toBe(true);
  });

  it('DexScreener não-ok / sem pairs => sem alertas de par', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Response('{}', { status: 500 })));
    const res = await runSurveillance([position()]);
    expect(res[0].alerts).toEqual([]);
    expect(res[0].currentLiquidityUsd).toBeUndefined();
  });

  it('escolhe o par de MAIOR liquidez para a chain correta', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Response(JSON.stringify({ pairs: [
      { chainId: 'ethereum', baseToken: { address: '0xx' }, liquidity: { usd: 1 } },
      { chainId: 'base', baseToken: { address: '0xdeg' }, liquidity: { usd: 20_000 } },
      { chainId: 'base', baseToken: { address: '0xdeg' }, liquidity: { usd: 900_000 } },
    ] }), { status: 200 })));
    const res = await runSurveillance([position()]);
    expect(res[0].currentLiquidityUsd).toBe(900_000);
    expect(res[0].alerts.some((a) => a.type === 'liquidity_drain')).toBe(false);
  });
});

describe('resolveAlertsForPosition / listRecentAlerts', () => {
  it('resolve todos os alertas abertos da posição', async () => {
    await resolveAlertsForPosition('p1', 'position_closed');
    expect(alertUpdateMany).toHaveBeenCalledWith({
      where: { positionId: 'p1', resolvedAt: null },
      data: { resolvedAt: expect.any(Date), resolution: 'position_closed' },
    });
  });

  it('listRecentAlerts mapeia context JSON e datas', async () => {
    alertFindMany.mockResolvedValue([
      { id: 1, positionId: 'p1', symbol: 'X', type: 'tax_spike', severity: 'warning', message: 'm', context: '{"a":1}', detectedAt: new Date('2026-11-03T10:00:00Z'), resolvedAt: null, resolution: null },
    ]);
    const list = await listRecentAlerts(10);
    expect(list[0].context).toEqual({ a: 1 });
    expect(list[0].detectedAt).toBe('2026-11-03T10:00:00.000Z');
    expect(alertFindMany).toHaveBeenCalledWith({ orderBy: { detectedAt: 'desc' }, take: 10 });
  });
});
