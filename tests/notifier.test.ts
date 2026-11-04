// tests/notifier.test.ts — canais, entrega HTTP mockada, throttle e redaction
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const channelFindMany = vi.fn();
const channelFindUnique = vi.fn();
const logCreate = vi.fn();
const logCount = vi.fn();
const logFindFirst = vi.fn();
const logDeleteMany = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    notificationChannel: {
      findMany: (...a: unknown[]) => channelFindMany(...a),
      findUnique: (...a: unknown[]) => channelFindUnique(...a),
    },
    notificationLog: {
      create: (...a: unknown[]) => logCreate(...a),
      count: (...a: unknown[]) => logCount(...a),
      findFirst: (...a: unknown[]) => logFindFirst(...a),
      deleteMany: (...a: unknown[]) => logDeleteMany(...a),
    },
  },
}));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});
// Round 6: notifier usa withSystemRls (RLS) para ler canais. O tx fake do mock
// delega para os mesmos vi.fn() de db.notificationChannel.
vi.mock('@/lib/auth/rls-context', () => ({
  withSystemRls: async (fn: (tx: unknown) => unknown) =>
    fn({
      notificationChannel: {
        findMany: (...a: unknown[]) => channelFindMany(...a),
        findUnique: (...a: unknown[]) => channelFindUnique(...a),
      },
    }),
}));

import {
  ALL_EVENT_TYPES,
  getChannel,
  listChannels,
  notifyEvent,
  type NotificationChannelRow,
} from '@/lib/trading/notifier';

const TELEGRAM_TOKEN = '123456:AAFakeBotTokenForTests';
let seq = 0;

function channel(over: Record<string, unknown> = {}) {
  seq++;
  return {
    id: `ch${seq}`,
    name: 'Canal de teste',
    type: 'telegram',
    config: JSON.stringify({ botToken: TELEGRAM_TOKEN, chatId: '-100123' }),
    events: JSON.stringify(['kill_switch_on', 'position_closed']),
    enabled: true,
    throttleSec: 0,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response = () => new Response('{}', { status: 200 })) {
  const fn = vi.fn((input: unknown, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function jsonOk(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  channelFindMany.mockReset().mockResolvedValue([]);
  channelFindUnique.mockReset().mockResolvedValue(null);
  logCreate.mockReset().mockResolvedValue({ id: 1 });
  logCount.mockReset().mockResolvedValue(0);
  logFindFirst.mockReset().mockResolvedValue(null);
  logDeleteMany.mockReset().mockResolvedValue({ count: 0 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listChannels / getChannel', () => {
  it('parseia config e events JSON', async () => {
    channelFindMany.mockResolvedValue([channel()]);
    const list = await listChannels();
    expect(list).toHaveLength(1);
    expect(list[0].config).toMatchObject({ chatId: '-100123' });
    expect(list[0].events).toContain('kill_switch_on');
  });

  it('descarta canal com config/events malformados (não derruba a lista)', async () => {
    channelFindMany.mockResolvedValue([
      channel({ config: 'não-json' }),
      channel(),
    ]);
    const list = await listChannels();
    expect(list).toHaveLength(1);
  });

  it('getChannel: null quando não existe e parseado quando existe', async () => {
    expect(await getChannel('nope')).toBeNull();
    channelFindUnique.mockResolvedValue(channel({ id: 'ch-x' }));
    const ch = await getChannel('ch-x');
    expect(ch?.id).toBe('ch-x');
  });
});

describe('notifyEvent — roteamento', () => {
  it('sem canais => não faz fetch nem log', async () => {
    const fn = mockFetch();
    await notifyEvent({ eventType: 'kill_switch_on', title: 'Kill', message: 'acionado' });
    expect(fn).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it('evento não assinado pelo canal => ignora', async () => {
    channelFindMany.mockResolvedValue([channel({ events: JSON.stringify(['position_closed']) })]);
    const fn = mockFetch();
    await notifyEvent({ eventType: 'kill_switch_on', title: 'Kill', message: 'x' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('canal desabilitado => ignora', async () => {
    channelFindMany.mockResolvedValue([channel({ enabled: false })]);
    const fn = mockFetch();
    await notifyEvent({ eventType: 'kill_switch_on', title: 'Kill', message: 'x' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('tipo de canal desconhecido => log failed, sem fetch', async () => {
    channelFindMany.mockResolvedValue([channel({ type: 'carrier-pigeon' })]);
    const fn = mockFetch();
    await notifyEvent({ eventType: 'kill_switch_on', title: 'Kill', message: 'x' });
    expect(fn).not.toHaveBeenCalled();
    expect(logCreate.mock.calls[0][0].data.status).toBe('failed');
    expect(logCreate.mock.calls[0][0].data.error).toMatch(/Unknown channel type/);
  });

  it('erro ao CARREGAR canais => retorna sem lançar', async () => {
    channelFindMany.mockRejectedValue(new Error('db down'));
    await expect(notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'm' })).resolves.toBeUndefined();
  });
});

describe('notifyEvent — Telegram', () => {
  it('envia POST para a API com chat_id e texto formatado, loga sent', async () => {
    channelFindMany.mockResolvedValue([channel()]);
    const fn = mockFetch(() => jsonOk());

    await notifyEvent({ eventType: 'kill_switch_on', title: 'Kill switch', message: 'acionado pelo operador', context: { reason: 'manual' } });

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0];
    expect(String(url)).toBe(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`);
    const body = JSON.parse(String(init!.body));
    expect(body.chat_id).toBe('-100123');
    expect(body.text).toContain('Kill switch');
    expect(body.text).toContain('acionado pelo operador');
    expect(body.text).toContain('reason: manual');
    expect(logCreate.mock.calls[0][0].data.status).toBe('sent');
  });

  it('REDACTION: o token do bot NÃO aparece no log persistido', async () => {
    channelFindMany.mockResolvedValue([channel()]);
    mockFetch(() => jsonOk());
    await notifyEvent({ eventType: 'kill_switch_on', title: 'Kill', message: 'm' });
    const logged = JSON.stringify(logCreate.mock.calls[0][0]);
    expect(logged).not.toContain(TELEGRAM_TOKEN);
  });

  it('HTTP 500 => log failed e notifyEvent NÃO lança (fire-and-forget)', async () => {
    channelFindMany.mockResolvedValue([channel()]);
    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'm' })).resolves.toBeUndefined();
    const data = logCreate.mock.calls[0][0].data;
    expect(data.status).toBe('failed');
    expect(data.error).toContain('500');
  });

  it('Telegram ok=false => failed com a description', async () => {
    channelFindMany.mockResolvedValue([channel()]);
    mockFetch(() => jsonOk({ ok: false, description: 'chat not found' }));
    await notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'm' });
    expect(logCreate.mock.calls[0][0].data.error).toContain('chat not found');
  });

  it('config sem botToken => failed sem fetch', async () => {
    channelFindMany.mockResolvedValue([channel({ config: JSON.stringify({ chatId: '1' }) })]);
    const fn = mockFetch();
    await notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'm' });
    expect(fn).not.toHaveBeenCalled();
    expect(logCreate.mock.calls[0][0].data.error).toMatch(/Missing botToken/);
  });

  it('erro de rede => failed e não lança', async () => {
    channelFindMany.mockResolvedValue([channel()]);
    mockFetch(() => { throw new Error('ECONNRESET'); });
    await expect(notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'm' })).resolves.toBeUndefined();
    expect(logCreate.mock.calls[0][0].data.status).toBe('failed');
  });
});

describe('notifyEvent — Discord e webhook', () => {
  it('Discord truncado em ~1990 chars', async () => {
    channelFindMany.mockResolvedValue([
      channel({ type: 'discord', config: JSON.stringify({ webhookUrl: 'https://discord.com/api/webhooks/x' }), events: JSON.stringify(['kill_switch_on']) }),
    ]);
    const fn = mockFetch(() => new Response('{}', { status: 200 }));
    await notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'x'.repeat(5000) });
    const body = JSON.parse(String(fn.mock.calls[0][1]!.body));
    expect(body.content.length).toBeLessThanOrEqual(1991);
    expect(body.content.endsWith('…')).toBe(true);
    expect(logCreate.mock.calls[0][0].data.status).toBe('sent');
  });

  it('webhook envia JSON com eventType/title/context e headers customizados', async () => {
    channelFindMany.mockResolvedValue([
      channel({
        type: 'webhook',
        config: JSON.stringify({ url: 'https://example.com/hook', method: 'PUT', headers: { 'x-custom': 'sim' } }),
        events: JSON.stringify(['kill_switch_on']),
      }),
    ]);
    const fn = mockFetch(() => new Response('', { status: 200 }));
    await notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'm', context: { a: 1 } });

    const [url, init] = fn.mock.calls[0];
    expect(String(url)).toBe('https://example.com/hook');
    expect(init!.method).toBe('PUT');
    expect((init!.headers as Record<string, string>)['x-custom']).toBe('sim');
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ eventType: 'kill_switch_on', title: 'K', message: 'm', context: { a: 1 } });
  });

  it('webhook HTTP 500 => failed e não lança', async () => {
    channelFindMany.mockResolvedValue([
      channel({ type: 'webhook', config: JSON.stringify({ url: 'https://example.com/hook' }), events: JSON.stringify(['kill_switch_on']) }),
    ]);
    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'm' })).resolves.toBeUndefined();
    expect(logCreate.mock.calls[0][0].data.status).toBe('failed');
  });
});

describe('notifyEvent — throttle e retenção de logs', () => {
  it('throttle: segundo evento dentro da janela é descartado com log [throttled]', async () => {
    channelFindMany.mockResolvedValue([channel({ throttleSec: 60, events: JSON.stringify(['kill_switch_on']) })]);
    const fn = mockFetch(() => jsonOk());

    await notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'primeiro' });
    await notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'segundo' });

    expect(fn).toHaveBeenCalledTimes(1);
    const throttled = logCreate.mock.calls[1][0].data;
    expect(throttled.status).toBe('failed');
    expect(throttled.message).toContain('[throttled]');
    expect(throttled.error).toMatch(/Throttled/);
  });

  it('trim: com >5000 logs apaga os excedentes mais antigos', async () => {
    channelFindMany.mockResolvedValue([channel()]);
    mockFetch(() => jsonOk());
    logCount.mockResolvedValue(6001);
    logFindFirst.mockResolvedValue({ id: 501 });

    await notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'm' });
    expect(logDeleteMany).toHaveBeenCalledWith({ where: { id: { lt: 501 } } });
  });

  it('falha do trim não derruba o notify', async () => {
    channelFindMany.mockResolvedValue([channel()]);
    mockFetch(() => jsonOk());
    logCount.mockRejectedValue(new Error('db down'));
    await expect(notifyEvent({ eventType: 'kill_switch_on', title: 'K', message: 'm' })).resolves.toBeUndefined();
  });

  it('ALL_EVENT_TYPES expõe os eventos suportados', () => {
    expect(Array.isArray(ALL_EVENT_TYPES)).toBe(true);
    expect(ALL_EVENT_TYPES.length).toBeGreaterThan(0);
  });
});
