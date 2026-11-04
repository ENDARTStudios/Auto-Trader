// tests/watchlist.test.ts — CRUD, refresh de preços e análise (db/price-feed/ai mockados)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { wl, fetchPriceUsd, synthesizeNewsSentiment } = vi.hoisted(() => ({
  wl: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  fetchPriceUsd: vi.fn(),
  synthesizeNewsSentiment: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { watchlistToken: wl } }));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});
vi.mock('@/lib/trading/price-feed', () => ({ fetchPriceUsd: (...a: unknown[]) => fetchPriceUsd(...a) }));
vi.mock('@/lib/trading/ai-agent', () => ({
  synthesizeNewsSentiment: (...a: unknown[]) => synthesizeNewsSentiment(...a),
}));

import {
  addWatchlist,
  analyzeWatchlistToken,
  listWatchlist,
  refreshWatchlistPrices,
  removeWatchlist,
  resetAlert,
  updateWatchlist,
} from '@/lib/trading/watchlist';

let seq = 0;
function row(over: Record<string, unknown> = {}) {
  seq++;
  return {
    id: `w${seq}`,
    symbol: 'BTC/USDT',
    source: 'cex',
    chain: null,
    tokenId: null,
    notes: null,
    alertThresholdPct: 10,
    enabled: true,
    addedPriceUsd: 100,
    lastPriceUsd: 100,
    lastCheckedAt: new Date('2026-11-03T10:00:00Z'),
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-03T10:00:00Z'),
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(wl)) fn.mockReset();
  fetchPriceUsd.mockReset();
  synthesizeNewsSentiment.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listWatchlist', () => {
  it('mapeia linhas e calcula changePct/alertTriggered', async () => {
    wl.findMany.mockResolvedValue([
      row({ addedPriceUsd: 100, lastPriceUsd: 115, alertThresholdPct: 10 }),
      row({ addedPriceUsd: 100, lastPriceUsd: 101, alertThresholdPct: 10 }),
      row({ addedPriceUsd: null, lastPriceUsd: null }),
    ]);
    const list = await listWatchlist();
    expect(list).toHaveLength(3);
    expect(list[0].changePct).toBeCloseTo(15, 6);
    expect(list[0].alertTriggered).toBe(true);
    expect(list[1].alertTriggered).toBe(false);
    expect(list[2].changePct).toBeNull();
    expect(list[2].alertTriggered).toBe(false);
  });

  it('lista vazia => []', async () => {
    wl.findMany.mockResolvedValue([]);
    expect(await listWatchlist()).toEqual([]);
  });
});

describe('addWatchlist', () => {
  it('normaliza symbol, ignora chain/tokenId em CEX e busca preço inicial', async () => {
    wl.create.mockResolvedValue(row({ id: 'new', symbol: 'BTC/USDT' }));
    fetchPriceUsd.mockResolvedValue(101.5);
    wl.findUnique.mockResolvedValue(row({ id: 'new', addedPriceUsd: 101.5, lastPriceUsd: 101.5 }));

    const created = await addWatchlist({ symbol: ' btc/usdt ', source: 'cex', chain: 'base', tokenId: '0xabc' });
    expect(wl.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ symbol: 'BTC/USDT', chain: null, tokenId: null, alertThresholdPct: 10, enabled: true }),
    });
    expect(fetchPriceUsd).toHaveBeenCalledWith('BTC/USDT', 'cex', null, null);
    expect(wl.update).toHaveBeenCalledWith({ where: { id: 'new' }, data: expect.objectContaining({ addedPriceUsd: 101.5 }) });
    expect(created.addedPriceUsd).toBe(101.5);
  });

  it('clampa alertThresholdPct em [0,100] e preserva DEX chain/tokenId', async () => {
    wl.create.mockResolvedValue(row({ id: 'dex1', source: 'dex', chain: 'base', tokenId: '0xtok' }));
    fetchPriceUsd.mockResolvedValue(0); // sem preço => não atualiza
    wl.findUnique.mockResolvedValue(row({ id: 'dex1', source: 'dex', chain: 'base', tokenId: '0xtok' }));

    await addWatchlist({ symbol: 'degen', source: 'dex', chain: 'base', tokenId: '0xtok', alertThresholdPct: 500 });
    const data = wl.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ symbol: 'DEGEN', chain: 'base', tokenId: '0xtok', alertThresholdPct: 100 });
    expect(wl.update).not.toHaveBeenCalled();
  });

  it('falha ao buscar preço inicial não derruba o add (log + segue)', async () => {
    wl.create.mockResolvedValue(row({ id: 'x' }));
    fetchPriceUsd.mockRejectedValue(new Error('rede'));
    wl.findUnique.mockResolvedValue(row({ id: 'x' }));
    const created = await addWatchlist({ symbol: 'ETH/USDT', source: 'cex' });
    expect(created.id).toBe('x');
  });
});

describe('updateWatchlist / removeWatchlist', () => {
  it('clampa threshold no update e retorna linha fresca', async () => {
    wl.update.mockResolvedValue({});
    wl.findUnique.mockResolvedValue(row({ alertThresholdPct: 100 }));
    const r = await updateWatchlist('w1', { alertThresholdPct: 250 });
    expect(wl.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { alertThresholdPct: 100 } });
    expect(r?.alertThresholdPct).toBe(100);
  });

  it('patch vazio => não escreve, só lê', async () => {
    wl.findUnique.mockResolvedValue(row());
    await updateWatchlist('w1', {});
    expect(wl.update).not.toHaveBeenCalled();
    expect(wl.findUnique).toHaveBeenCalledWith({ where: { id: 'w1' } });
  });

  it('remove devolve true/false conforme o banco', async () => {
    wl.delete.mockResolvedValue({});
    expect(await removeWatchlist('w1')).toBe(true);
    wl.delete.mockRejectedValue(new Error('not found'));
    expect(await removeWatchlist('w2')).toBe(false);
  });
});

describe('refreshWatchlistPrices', () => {
  it('sem tokens habilitados => não faz nada', async () => {
    wl.findMany.mockResolvedValue([]);
    await refreshWatchlistPrices();
    expect(fetchPriceUsd).not.toHaveBeenCalled();
  });

  it('popula addedPriceUsd na primeira leitura e atualiza lastPrice', async () => {
    wl.findMany.mockResolvedValue([row({ id: 'r1', addedPriceUsd: null, lastPriceUsd: null })]);
    fetchPriceUsd.mockResolvedValue(200);
    await refreshWatchlistPrices();
    expect(wl.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: expect.objectContaining({ addedPriceUsd: 200, lastPriceUsd: 200 }),
    });
  });

  it('preço 0 é ignorado (sem update)', async () => {
    wl.findMany.mockResolvedValue([row({ id: 'r2' })]);
    fetchPriceUsd.mockResolvedValue(0);
    await refreshWatchlistPrices();
    expect(wl.update).not.toHaveBeenCalled();
  });

  it('erro de preço num token não impede os demais', async () => {
    wl.findMany.mockResolvedValue([row({ id: 'bad' }), row({ id: 'ok' })]);
    fetchPriceUsd.mockRejectedValueOnce(new Error('rede')).mockResolvedValueOnce(150);
    await refreshWatchlistPrices();
    expect(wl.update).toHaveBeenCalledTimes(1);
    expect(wl.update).toHaveBeenCalledWith({ where: { id: 'ok' }, data: expect.anything() });
  });

  it('lotes de 6 (processa todos os tokens)', async () => {
    wl.findMany.mockResolvedValue(Array.from({ length: 8 }, (_, i) => row({ id: `b${i}` })));
    fetchPriceUsd.mockResolvedValue(120);
    await refreshWatchlistPrices();
    expect(wl.update).toHaveBeenCalledTimes(8);
  });
});

describe('analyzeWatchlistToken / resetAlert', () => {
  it('token inexistente => erro', async () => {
    wl.findUnique.mockResolvedValue(null);
    await expect(analyzeWatchlistToken('nope')).rejects.toThrow(/não encontrado/);
  });

  it('atualiza preço e envia candidato correto ao agente de IA', async () => {
    wl.findUnique.mockResolvedValue(row({ id: 'a1', symbol: 'DEGEN', source: 'dex', chain: 'base', tokenId: '0xdeg' }));
    fetchPriceUsd.mockResolvedValue(0.5);
    synthesizeNewsSentiment.mockResolvedValue({ agentRole: 'news_sentiment', recommendation: 'hold' });

    const res = await analyzeWatchlistToken('a1');
    expect(res.recommendation).toBe('hold');
    expect(synthesizeNewsSentiment).toHaveBeenCalledWith({
      symbol: 'DEGEN', source: 'dex', chain: 'base', tokenId: '0xdeg', priceUsd: 0.5, volume24hUsd: 0, liquidityUsd: 0,
    });
    expect(wl.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: expect.objectContaining({ lastPriceUsd: 0.5 }) });
  });

  it('falha no preço fresco mantém lastPriceUsd anterior', async () => {
    wl.findUnique.mockResolvedValue(row({ id: 'a2', lastPriceUsd: 42 }));
    fetchPriceUsd.mockRejectedValue(new Error('rede'));
    synthesizeNewsSentiment.mockResolvedValue({ recommendation: 'hold' });
    await analyzeWatchlistToken('a2');
    expect(synthesizeNewsSentiment).toHaveBeenCalledWith(expect.objectContaining({ priceUsd: 42 }));
    expect(wl.update).not.toHaveBeenCalled();
  });

  it('resetAlert realinha addedPriceUsd ao lastPrice', async () => {
    wl.findUnique.mockResolvedValue(row({ id: 'res', lastPriceUsd: 333 }));
    await resetAlert('res');
    expect(wl.update).toHaveBeenCalledWith({ where: { id: 'res' }, data: { addedPriceUsd: 333 } });
  });

  it('resetAlert sem lastPrice não escreve', async () => {
    wl.findUnique.mockResolvedValue(row({ id: 'res2', lastPriceUsd: null }));
    await resetAlert('res2');
    expect(wl.update).not.toHaveBeenCalled();
  });
});
