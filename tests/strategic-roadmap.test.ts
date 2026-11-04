// tests/strategic-roadmap.test.ts — seed idempotente, leitura e stats (db mockado)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn();
const findMany = vi.fn();
const update = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    strategicCapability: {
      upsert: (...a: unknown[]) => upsert(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

import {
  ensureStrategicCapabilitiesSeeded,
  getRoadmapStats,
  listStrategicCapabilities,
  updateStrategicCapability,
} from '@/lib/trading/strategic-roadmap';

const NOW = new Date('2026-11-03T12:00:00Z');

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'fee-aware-execution',
    category: 'execution',
    title: 'Fee-Aware Execution',
    description: 'desc',
    status: 'shipped',
    completionPct: 100,
    notes: null,
    sortOrder: 10,
    updatedAt: NOW,
    ...over,
  };
}

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({});
  findMany.mockReset().mockResolvedValue([]);
  update.mockReset().mockResolvedValue({});
});

describe('ensureStrategicCapabilitiesSeeded', () => {
  it('faz upsert de TODAS as capabilities com update vazio (preserva edição do operador)', async () => {
    await ensureStrategicCapabilitiesSeeded();
    expect(upsert.mock.calls.length).toBeGreaterThanOrEqual(15);
    const first = upsert.mock.calls[0][0];
    expect(first).toMatchObject({ where: { id: 'fee-aware-execution' }, update: {} });
    expect(first.create).toMatchObject({ category: 'execution', status: 'shipped', completionPct: 100 });
  });

  it('ids do seed são únicos (sem colisão no upsert)', async () => {
    await ensureStrategicCapabilitiesSeeded();
    const ids = upsert.mock.calls.map((c) => c[0].where.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('erro de upsert individual (constraint concorrente) não derruba o seed', async () => {
    upsert.mockRejectedValueOnce(new Error('unique constraint'));
    await expect(ensureStrategicCapabilitiesSeeded()).resolves.toBeUndefined();
    expect(upsert.mock.calls.length).toBeGreaterThan(15); // continuou seedando
  });

  it('cada capability tem category/status/completionPct dentro dos domínios', async () => {
    await ensureStrategicCapabilitiesSeeded();
    const allowedCats = ['execution', 'strategy', 'risk', 'security', 'ops'];
    const allowedStatus = ['planned', 'in_progress', 'shipped', 'blocked'];
    for (const c of upsert.mock.calls) {
      const d = c[0].create;
      expect(allowedCats).toContain(d.category);
      expect(allowedStatus).toContain(d.status);
      expect(d.completionPct).toBeGreaterThanOrEqual(0);
      expect(d.completionPct).toBeLessThanOrEqual(100);
    }
  });
});

describe('listStrategicCapabilities', () => {
  it('semeia antes de listar e devolve linhas mapeadas com updatedAt ISO', async () => {
    findMany.mockResolvedValue([row(), row({ id: 'scalping', category: 'strategy', status: 'in_progress', completionPct: 90, sortOrder: 50 })]);
    const list = await listStrategicCapabilities();
    expect(upsert).toHaveBeenCalled();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: 'fee-aware-execution',
      category: 'execution',
      status: 'shipped',
      completionPct: 100,
      updatedAt: '2026-11-03T12:00:00.000Z',
    });
    expect(findMany).toHaveBeenCalledWith({ orderBy: { sortOrder: 'asc' } });
  });
});

describe('updateStrategicCapability', () => {
  it('atualiza só os campos presentes no patch', async () => {
    await updateStrategicCapability('scalping', { completionPct: 95 });
    expect(update).toHaveBeenCalledWith({ where: { id: 'scalping' }, data: { completionPct: 95 } });
  });

  it('patch vazio escreve data vazio (no-op) e não lança', async () => {
    await expect(updateStrategicCapability('x', {})).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'x' }, data: {} });
  });

  it('propaga erro do banco (operador precisa saber)', async () => {
    update.mockRejectedValue(new Error('not found'));
    await expect(updateStrategicCapability('nope', { status: 'blocked' })).rejects.toThrow('not found');
  });
});

describe('getRoadmapStats', () => {
  it('agrega totais/status e média de conclusão', async () => {
    findMany.mockResolvedValue([
      row({ id: 'a', category: 'execution', status: 'shipped', completionPct: 100 }),
      row({ id: 'b', category: 'execution', status: 'in_progress', completionPct: 50 }),
      row({ id: 'c', category: 'strategy', status: 'planned', completionPct: 0 }),
      row({ id: 'd', category: 'risk', status: 'blocked', completionPct: 20 }),
    ]);
    const stats = await getRoadmapStats();
    expect(stats).toMatchObject({ total: 4, shipped: 1, inProgress: 1, planned: 1, blocked: 1 });
    expect(stats.avgCompletion).toBeCloseTo((100 + 50 + 0 + 20) / 4, 6);
    expect(stats.byCategory.execution).toEqual({ total: 2, shipped: 1, avgCompletion: 75 });
    expect(stats.byCategory.strategy).toEqual({ total: 1, shipped: 0, avgCompletion: 0 });
  });

  it('roadmap vazio => tudo zero e byCategory vazio', async () => {
    findMany.mockResolvedValue([]);
    const stats = await getRoadmapStats();
    expect(stats).toMatchObject({ total: 0, shipped: 0, inProgress: 0, planned: 0, blocked: 0, avgCompletion: 0 });
    expect(stats.byCategory).toEqual({});
  });
});
