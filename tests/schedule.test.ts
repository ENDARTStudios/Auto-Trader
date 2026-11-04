// tests/schedule.test.ts — janelas de trading determinísticas (now injetado + fake timers)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const scheduleFindUnique = vi.fn();
const scheduleUpsert = vi.fn();
const positionFindMany = vi.fn();
const closePosition = vi.fn();
const fetchPricesBatch = vi.fn();
const recordRiskEvent = vi.fn();
const getConfig = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    tradingSchedule: {
      findUnique: (...a: unknown[]) => scheduleFindUnique(...a),
      upsert: (...a: unknown[]) => scheduleUpsert(...a),
    },
    position: { findMany: (...a: unknown[]) => positionFindMany(...a) },
  },
}));
vi.mock('@/lib/trading/config', () => ({ getConfig: (...a: unknown[]) => getConfig(...a) }));
vi.mock('@/lib/trading/portfolio', () => ({ closePosition: (...a: unknown[]) => closePosition(...a) }));
vi.mock('@/lib/trading/price-feed', () => ({ fetchPricesBatch: (...a: unknown[]) => fetchPricesBatch(...a) }));
vi.mock('@/lib/trading/risk-manager', () => ({ recordRiskEvent: (...a: unknown[]) => recordRiskEvent(...a) }));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

import {
  canScoutNow,
  DEFAULT_SCHEDULE,
  forceCloseAllIfOutsideWindow,
  getSchedule,
  getScheduleStatus,
  updateSchedule,
  type TradingSchedule,
} from '@/lib/trading/schedule';

function sched(over: Partial<TradingSchedule> = {}): TradingSchedule {
  return {
    enabled: true,
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '09:00',
    endTime: '21:00',
    timezone: 'UTC',
    forceCloseAtEnd: false,
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

function mockScheduleRow(over: Partial<TradingSchedule> = {}) {
  const s = sched(over);
  scheduleFindUnique.mockResolvedValue({
    ...s,
    daysOfWeek: JSON.stringify(s.daysOfWeek),
    id: 'singleton',
    startTime: s.startTime,
  });
}

// 2026-11-03 é TERÇA-FEIRA. Instantes UTC usados para evitar dependência do relógio real.
const TUE_1200Z = new Date('2026-11-03T12:00:00Z');
const TUE_0900Z = new Date('2026-11-03T09:00:00Z');
const TUE_2100Z = new Date('2026-11-03T21:00:00Z');
const TUE_0859Z = new Date('2026-11-03T08:59:00Z');
const SAT_1200Z = new Date('2026-11-07T12:00:00Z');

beforeEach(() => {
  scheduleFindUnique.mockReset();
  scheduleUpsert.mockReset().mockResolvedValue({});
  positionFindMany.mockReset().mockResolvedValue([]);
  closePosition.mockReset();
  fetchPricesBatch.mockReset();
  recordRiskEvent.mockReset().mockResolvedValue(undefined);
  getConfig.mockReset().mockResolvedValue({ mode: 'paper' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('getSchedule', () => {
  it('sem linha => DEFAULT_SCHEDULE (desativado)', async () => {
    scheduleFindUnique.mockResolvedValue(null);
    const s = await getSchedule();
    expect(s.enabled).toBe(false);
    expect(s.daysOfWeek).toEqual(DEFAULT_SCHEDULE.daysOfWeek);
  });

  it('faz parse de daysOfWeek JSON e preserva timezone/tempos', async () => {
    mockScheduleRow({ daysOfWeek: [0, 6], startTime: '22:00', endTime: '04:00', timezone: 'America/Sao_Paulo' });
    const s = await getSchedule();
    expect(s.daysOfWeek).toEqual([0, 6]);
    expect(s.startTime).toBe('22:00');
    expect(s.timezone).toBe('America/Sao_Paulo');
  });

  it('daysOfWeek inválido => fallback seg-sex', async () => {
    scheduleFindUnique.mockResolvedValue({ id: 'singleton', enabled: true, daysOfWeek: 'not-json', startTime: '09:00', endTime: '21:00', timezone: 'UTC', forceCloseAtEnd: false, updatedAt: new Date() });
    const s = await getSchedule();
    expect(s.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('getScheduleStatus — janela diurna', () => {
  it('desativada => within true 24/7', async () => {
    mockScheduleRow({ enabled: false });
    const st = await getScheduleStatus(TUE_1200Z);
    expect(st.within).toBe(true);
    expect(st.enabled).toBe(false);
    expect(st.nextChange).toBeNull();
    expect(st.reason).toMatch(/24\/7/);
  });

  it('dentro da janela => within true + nextChange close', async () => {
    mockScheduleRow();
    const st = await getScheduleStatus(TUE_1200Z);
    expect(st).toMatchObject({ within: true, weekday: 2, localTime: '12:00', nextChange: 'close' });
    expect(st.reason).toMatch(/Dentro da janela/);
  });

  it('borda de INÍCIO é inclusiva (09:00)', async () => {
    mockScheduleRow();
    expect((await getScheduleStatus(TUE_0900Z)).within).toBe(true);
  });

  it('borda de FIM é exclusiva (21:00)', async () => {
    mockScheduleRow();
    const st = await getScheduleStatus(TUE_2100Z);
    expect(st.within).toBe(false);
    expect(st.nextChange).toBe('open');
  });

  it('antes do início (08:59) => fora, motivo de horário', async () => {
    mockScheduleRow();
    const st = await getScheduleStatus(TUE_0859Z);
    expect(st.within).toBe(false);
    expect(st.reason).toMatch(/horário/);
  });

  it('dia não permitido (sábado) => fora, motivo de dia', async () => {
    mockScheduleRow();
    const st = await getScheduleStatus(SAT_1200Z);
    expect(st.within).toBe(false);
    expect(st.weekday).toBe(6);
    expect(st.reason).toMatch(/dia da semana/);
  });

  it('daysOfWeek vazio => qualquer dia permitido', async () => {
    mockScheduleRow({ daysOfWeek: [] });
    expect((await getScheduleStatus(SAT_1200Z)).within).toBe(true);
  });

  it('respeita timezone (America/Sao_Paulo = UTC-3)', async () => {
    mockScheduleRow({ timezone: 'America/Sao_Paulo' });
    const st = await getScheduleStatus(TUE_1200Z);
    expect(st.localTime).toBe('09:00');
    expect(st.within).toBe(true); // 09:00 local, borda inclusiva
  });
});

describe('getScheduleStatus — janela overnight (22:00-04:00)', () => {
  it.each([
    ['2026-11-03T23:00:00Z', true],  // 23:00 dentro
    ['2026-11-03T03:00:00Z', true],  // 03:00 dentro
    ['2026-11-03T12:00:00Z', false], // 12:00 fora
    ['2026-11-03T04:00:00Z', false], // 04:00 exclusivo
  ])('%s => within=%s', async (iso, expected) => {
    mockScheduleRow({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '22:00', endTime: '04:00' });
    const st = await getScheduleStatus(new Date(iso));
    expect(st.within).toBe(expected);
  });
});

describe('updateSchedule', () => {
  it('valida formato HH:MM do início e do fim', async () => {
    scheduleFindUnique.mockResolvedValue(null);
    await expect(updateSchedule({ startTime: '9:00' })).rejects.toThrow(/HH:MM/);
    await expect(updateSchedule({ endTime: 'abc' })).rejects.toThrow(/HH:MM/);
  });

  it('GAP conhecido documentado: regex aceita hora 25:99 (só valida formato)', async () => {
    mockScheduleRow();
    await expect(updateSchedule({ endTime: '25:99' })).resolves.toBeDefined();
    expect(scheduleUpsert).toHaveBeenCalled();
  });

  it('valida timezone IANA', async () => {
    await expect(updateSchedule({ timezone: 'Marte/Olympus' })).rejects.toThrow(/Timezone inválido/);
  });

  it('filtra dias inválidos e faz upsert do singleton', async () => {
    mockScheduleRow();
    await updateSchedule({ daysOfWeek: [1, 9, -1, 3, 2.5], enabled: true });
    expect(scheduleUpsert).toHaveBeenCalledTimes(1);
    const arg = scheduleUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'singleton' });
    expect(JSON.parse(arg.create.daysOfWeek)).toEqual([1, 3]);
    expect(arg.create.enabled).toBe(true);
  });
});

describe('canScoutNow (usa o relógio do sistema)', () => {
  it('true dentro da janela e false fora dela', async () => {
    mockScheduleRow({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '17:00', timezone: 'UTC' });
    vi.useFakeTimers();
    vi.setSystemTime(TUE_1200Z);
    expect(await canScoutNow()).toBe(true);
    vi.setSystemTime(new Date('2026-11-03T18:00:00Z'));
    expect(await canScoutNow()).toBe(false);
  });
});

describe('forceCloseAllIfOutsideWindow', () => {
  it('desativada => 0 sem consultar posições', async () => {
    mockScheduleRow({ enabled: false, forceCloseAtEnd: true });
    expect(await forceCloseAllIfOutsideWindow()).toBe(0);
    expect(positionFindMany).not.toHaveBeenCalled();
  });

  it('forceCloseAtEnd=false => 0', async () => {
    mockScheduleRow({ forceCloseAtEnd: false });
    expect(await forceCloseAllIfOutsideWindow()).toBe(0);
    expect(positionFindMany).not.toHaveBeenCalled();
  });

  it('dentro da janela => 0', async () => {
    mockScheduleRow({ forceCloseAtEnd: true });
    vi.useFakeTimers();
    vi.setSystemTime(TUE_1200Z);
    expect(await forceCloseAllIfOutsideWindow()).toBe(0);
    expect(positionFindMany).not.toHaveBeenCalled();
  });

  it('fora da janela => fecha com PREÇO DE MERCADO (não entry)', async () => {
    mockScheduleRow({ forceCloseAtEnd: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T23:00:00Z'));
    positionFindMany.mockResolvedValue([
      { id: 'p1', symbol: 'BTC/USDT', source: 'cex', chain: null, tokenId: null, entryPriceUsd: 100 },
    ]);
    fetchPricesBatch.mockResolvedValue(new Map([['p1', 110]]));
    closePosition.mockResolvedValue({ id: 'p1' });

    expect(await forceCloseAllIfOutsideWindow()).toBe(1);
    expect(closePosition).toHaveBeenCalledWith(expect.anything(), 'p1', 110, 'schedule_force_close');
    expect(recordRiskEvent).not.toHaveBeenCalled();
  });

  it('sem preço => usa entryPrice como fallback + registra risk event', async () => {
    mockScheduleRow({ forceCloseAtEnd: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T23:00:00Z'));
    positionFindMany.mockResolvedValue([
      { id: 'p2', symbol: 'ABC/WETH', source: 'dex', chain: 'base', tokenId: '0xabc', entryPriceUsd: 0.5 },
    ]);
    fetchPricesBatch.mockResolvedValue(new Map([['p2', 0]]));
    closePosition.mockResolvedValue({ id: 'p2' });

    expect(await forceCloseAllIfOutsideWindow()).toBe(1);
    expect(recordRiskEvent).toHaveBeenCalledWith(
      'unpriced_exit', 'warning', expect.stringContaining('ABC/WETH'), expect.objectContaining({ positionId: 'p2', fallback: 'entry_price' })
    );
    expect(closePosition).toHaveBeenCalledWith(expect.anything(), 'p2', 0.5, 'schedule_force_close');
  });

  it('erro no closePosition não interrompe os demais', async () => {
    mockScheduleRow({ forceCloseAtEnd: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T23:00:00Z'));
    positionFindMany.mockResolvedValue([
      { id: 'p1', symbol: 'A/USDT', source: 'cex', chain: null, tokenId: null, entryPriceUsd: 1 },
      { id: 'p2', symbol: 'B/USDT', source: 'cex', chain: null, tokenId: null, entryPriceUsd: 1 },
    ]);
    fetchPricesBatch.mockResolvedValue(new Map([['p1', 2], ['p2', 2]]));
    closePosition.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ id: 'p2' });

    expect(await forceCloseAllIfOutsideWindow()).toBe(1);
  });

  it('sem posições abertas => 0', async () => {
    mockScheduleRow({ forceCloseAtEnd: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T23:00:00Z'));
    positionFindMany.mockResolvedValue([]);
    expect(await forceCloseAllIfOutsideWindow()).toBe(0);
  });
});
