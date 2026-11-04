// tests/backtest.test.ts — runBacktest com candles sintéticos determinísticos (sem rede/DB reais)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const btCreate = vi.fn();
const btUpdate = vi.fn();
const btFindMany = vi.fn();
const btFindUnique = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    backtestResult: {
      create: (...a: unknown[]) => btCreate(...a),
      update: (...a: unknown[]) => btUpdate(...a),
      findMany: (...a: unknown[]) => btFindMany(...a),
      findUnique: (...a: unknown[]) => btFindUnique(...a),
    },
  },
}));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

import {
  getBacktestById,
  listRecentBacktests,
  runBacktest,
  type BacktestParams,
} from '@/lib/trading/backtest';

const BASE_PARAMS: BacktestParams = {
  symbols: ['BTC/USDT'],
  interval: '1h',
  periodDays: 1,
  initialCapitalUsd: 10_000,
  perTradeUsd: 1_000,
  takeProfitPct: 0.05,
  stopLossPct: 0.04,
  maxHoldBars: 5,
  rsiEntryMax: 50,  // entra só na fase de queda (RSI baixo) — evita reentrada
  rsiExitMin: 200,  // desativa a saída por RSI (impossível)
};

/** candles sintéticos [openTime, open, high, low, close, volume] */
function klines(closes: number[], highs?: number[], lows?: number[]): unknown[][] {
  return closes.map((close, i) => [
    1_700_000_000_000 + i * 3_600_000,
    String(close),
    String(highs?.[i] ?? close * 1.001),
    String(lows?.[i] ?? close * 0.999),
    String(close),
    '10',
  ]);
}

function fetchOk(candles: unknown[][]) {
  const fn = vi.fn(async (_input: unknown) =>
    new Response(JSON.stringify(candles), { status: 200, headers: { 'Content-Type': 'application/json' } })
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** 15 barras em queda (RSI ~0) + barras de saída controladas. */
const ENTRY_PRICE = 86; // close da barra 14
function entrySeries(tail: { highs?: number[]; lows?: number[]; closes: number[] }) {
  const head = Array.from({ length: 15 }, (_, i) => 100 - i); // 100..86
  return klines([...head, ...tail.closes], tail.highs ? [...Array(15).fill(101), ...tail.highs] : undefined, tail.lows ? [...Array(15).fill(79), ...tail.lows] : undefined);
}

beforeEach(() => {
  btCreate.mockReset().mockResolvedValue({ id: 42 });
  btUpdate.mockReset().mockResolvedValue({});
  btFindMany.mockReset();
  btFindUnique.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runBacktest — saídas da estratégia RSI', () => {
  it('take_profit: high cruza o alvo e a saída é no preço de TP', async () => {
    // barra 15 dispara TP (high 150 >= 90.3) e fecha alta -> RSI sobe e evita reentrada
    fetchOk(entrySeries({ closes: [150, 150, 150, 150, 150], highs: [150, 150, 150, 150, 150], lows: [85, 150, 150, 150, 150] }));
    const res = await runBacktest(BASE_PARAMS);

    expect(res.trades).toHaveLength(1);
    const t = res.trades[0];
    expect(t.reason).toBe('take_profit');
    expect(t.entryPrice).toBe(ENTRY_PRICE);
    expect(t.exitPrice).toBeCloseTo(ENTRY_PRICE * 1.05, 6);
    expect(t.pnlUsd).toBeGreaterThan(0);
    expect(res.metrics).toMatchObject({ totalTrades: 1, wins: 1, losses: 0, winRate: 100, profitFactor: 99 });
    expect(res.equityCurve).toHaveLength(2);
    expect(res.candlesLoaded).toBe(20);
    expect(btUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 }, data: expect.objectContaining({ status: 'completed' }) }));
  });

  it('stop_loss: low cruza o stop e a saída é no preço de SL', async () => {
    // TP longe (100%) para não disparar antes do SL; barra 15 tem low 70 <= 82.56
    fetchOk(entrySeries({ closes: [150, 150, 150, 150, 150], highs: [150, 150, 150, 150, 150], lows: [70, 150, 150, 150, 150] }));
    const res = await runBacktest({ ...BASE_PARAMS, takeProfitPct: 1.0 });

    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].reason).toBe('stop_loss');
    expect(res.trades[0].exitPrice).toBeCloseTo(ENTRY_PRICE * 0.96, 6);
    expect(res.trades[0].pnlUsd).toBeLessThan(0);
    expect(res.metrics).toMatchObject({ wins: 0, losses: 1, winRate: 0 });
  });

  it('timeout: sem TP/SL, sai pelo close após maxHoldBars', async () => {
    // barra 15 fica dentro do range; barra 16 estoura maxHoldBars=2 e fecha em 150 (RSI sobe -> sem reentrada)
    fetchOk(entrySeries({ closes: [86, 150, 150, 150, 150], highs: [86.01, 150, 150, 150, 150], lows: [85.99, 149, 149, 149, 149] }));
    // TP longe (100%) para o timeout não ser ofuscado por take_profit
    const res = await runBacktest({ ...BASE_PARAMS, maxHoldBars: 2, takeProfitPct: 1.0 });

    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].reason).toBe('timeout');
    expect(res.trades[0].holdBars).toBe(2);
    expect(res.trades[0].exitPrice).toBe(150);
  });

  it('rsi_exit: RSI estoura rsiExitMin sem tocar TP', async () => {
    fetchOk(entrySeries({ closes: [120, 120, 120, 120, 120], highs: [120.5, 120.5, 120.5, 120.5, 120.5], lows: [119.5, 119.5, 119.5, 119.5, 119.5] }));
    const res = await runBacktest({
      ...BASE_PARAMS,
      takeProfitPct: 1.0, // TP 100% — não é tocado
      stopLossPct: 0.5,
      rsiExitMin: 70,
    });

    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].reason).toBe('rsi_exit');
    expect(res.trades[0].exitPrice).toBe(120);
  });

  it('posição aberta no fim da série é fechada no último close (timeout)', async () => {
    fetchOk(entrySeries({ closes: [86, 86], highs: [86.01, 86.01], lows: [85.99, 85.99] }));
    const res = await runBacktest({ ...BASE_PARAMS, maxHoldBars: 999 });
    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].reason).toBe('timeout');
    expect(res.trades[0].exitBar).toBe(16);
  });
});

describe('runBacktest — bordas de dados', () => {
  it('série curta (<15 candles) => nenhum trade, métricas zeradas', async () => {
    fetchOk(klines([100, 99, 98]));
    const res = await runBacktest(BASE_PARAMS);
    expect(res.trades).toEqual([]);
    expect(res.metrics).toMatchObject({ totalTrades: 0, winRate: 0, profitFactor: 0, totalPnlUsd: 0 });
    expect(res.candlesLoaded).toBe(3);
  });

  it('capital insuficiente para 1 trade => não entra', async () => {
    fetchOk(entrySeries({ closes: [150, 150, 150, 150, 150], highs: [150, 150, 150, 150, 150] }));
    const res = await runBacktest({ ...BASE_PARAMS, initialCapitalUsd: 500, perTradeUsd: 1000 });
    expect(res.trades).toEqual([]);
    expect(res.metrics.totalPnlUsd).toBe(0);
  });

  it('todas as fontes falham => erro reportado + DB marcado failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const res = await runBacktest(BASE_PARAMS);
    expect(res.error).toMatch(/Nenhum candle carregado/);
    expect(res.candlesLoaded).toBe(0);
    expect(res.trades).toEqual([]);
    expect(btUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
  });

  it('falha parcial de símbolo: um carrega, outro falha => segue com o que tem', async () => {
    const fn = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('symbol=ETHUSDT')) return new Response('{}', { status: 500 });
      return new Response(JSON.stringify(entrySeries({ closes: [85, 84, 83, 82, 81], highs: [95, 84, 83, 82, 81] })), { status: 200 });
    });
    vi.stubGlobal('fetch', fn);

    const res = await runBacktest({ ...BASE_PARAMS, symbols: ['BTC/USDT', 'ETH/USDT'] });
    expect(res.error).toBeUndefined();
    expect(res.candlesLoaded).toBe(20);
    expect(res.perSymbol).toHaveLength(2);
    expect(res.perSymbol.find((s) => s.symbol === 'ETH/USDT')?.trades).toBe(0);
  });
});

describe('runBacktest — contrato de dados e ausência de fees', () => {
  it('chama Binance com símbolo normalizado e limite derivado de periodDays/interval', async () => {
    const fn = fetchOk(klines(Array.from({ length: 30 }, (_, i) => 100 - i)));
    await runBacktest({ ...BASE_PARAMS, interval: '1h', periodDays: 2 });
    const url = String(fn.mock.calls[0][0]);
    expect(url).toContain('symbol=BTCUSDT');
    expect(url).toContain('interval=1h');
    expect(url).toContain('limit=48'); // 2 dias * 24 barras
  });

  it('NÃO modela fees/slippage: pnl == (exit-entry)*qty exatamente (limitação documentada)', async () => {
    fetchOk(entrySeries({ closes: [150, 150, 150, 150, 150], highs: [150, 150, 150, 150, 150] }));
    const res = await runBacktest(BASE_PARAMS);
    const t = res.trades[0];
    expect(t.pnlUsd).toBeCloseTo((t.exitPrice - t.entryPrice) * t.qty, 9);
    expect(res.metrics.totalPnlUsd).toBeCloseTo(t.pnlUsd, 9);
  });

  it('métricas derivadas: bestTrade/worstTrade/avgHoldBars/sharpe finitos', async () => {
    fetchOk(entrySeries({ closes: [150, 150, 150, 150, 150], highs: [150, 150, 150, 150, 150] }));
    const res = await runBacktest(BASE_PARAMS);
    const m = res.metrics;
    expect(m.bestTradeUsd).toBeGreaterThan(0);
    // com um único trade vencedor, best == worst == pnl (Math.min de 1 positivo)
    expect(m.worstTradeUsd).toBeCloseTo(m.bestTradeUsd, 9);
    expect(m.losses).toBe(0);
    expect(Number.isFinite(m.sharpeRatio)).toBe(true);
    expect(m.avgHoldBars).toBeGreaterThan(0);
    expect(m.avgTradePnlUsd).toBeCloseTo(m.totalPnlUsd / m.totalTrades, 9);
  });
});

describe('listRecentBacktests / getBacktestById', () => {
  const row = {
    id: 7,
    symbols: '["BTC/USDT"]',
    interval: '1h',
    periodDays: 1,
    initialCapitalUsd: 10000,
    perTradeUsd: 1000,
    takeProfitPct: 0.05,
    stopLossPct: 0.04,
    maxHoldBars: 5,
    rsiEntryMax: 70,
    rsiExitMin: 75,
    totalTrades: 2,
    wins: 1,
    losses: 1,
    winRate: 50,
    profitFactor: 1.5,
    totalPnlUsd: 25,
    totalPnlPct: 0.25,
    maxDrawdownPct: 1.1,
    sharpeRatio: 0.3,
    avgTradePnlUsd: 12.5,
    avgHoldBars: 3,
    bestTradeUsd: 40,
    worstTradeUsd: -15,
    equityCurve: '[]',
    tradesJson: '[]',
    startedAt: new Date('2026-11-03T10:00:00Z'),
    finishedAt: new Date('2026-11-03T10:00:05Z'),
    durationMs: 5000,
    status: 'completed',
    error: null,
  };

  it('lista recentes com símbolos parseados e datas ISO', async () => {
    btFindMany.mockResolvedValue([row]);
    const list = await listRecentBacktests(5);
    expect(list).toHaveLength(1);
    expect(list[0].symbols).toEqual(['BTC/USDT']);
    expect(list[0].startedAt).toBe('2026-11-03T10:00:00.000Z');
    expect(list[0].status).toBe('completed');
  });

  it('getBacktestById devolve null quando não existe', async () => {
    btFindUnique.mockResolvedValue(null);
    expect(await getBacktestById(999)).toBeNull();
  });

  it('getBacktestById parseia equityCurve/tradesJson', async () => {
    btFindUnique.mockResolvedValue({ ...row, equityCurve: '[{"bar":0,"equityUsd":10000,"cashUsd":10000,"openTradeUnrealizedUsd":0}]', tradesJson: '[]' });
    const res = await getBacktestById(7);
    expect(res?.equityCurve).toHaveLength(1);
    expect(res?.trades).toEqual([]);
    expect(res?.finishedAt).toBe('2026-11-03T10:00:05.000Z');
  });
});
