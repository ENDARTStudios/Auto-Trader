import { describe, it, expect } from 'vitest';
import {
  DEMO_POSITION_PREFIX,
  DEMO_RANGES,
  DEMO_TABLES,
  buildCountSql,
  buildDeleteSql,
  demoDeleteSpec,
  inDemoRange,
  isDemoOrderPositionId,
  isDemoPositionId,
  totalCounts,
} from '../scripts/lib/demo-ids.mjs';

// Contrato compartilhado com scripts/seed-demo.ts (ids fixos) e
// scripts/clear-demo-data.mjs. Se o seed mudar a numeração, estes testes falham.
describe('demo-ids — prefixos', () => {
  it('reconhece posições demo do seed (open/closed)', () => {
    expect(DEMO_POSITION_PREFIX).toBe('demo-pos-');
    expect(isDemoPositionId('demo-pos-open-1')).toBe(true);
    expect(isDemoPositionId('demo-pos-closed-6')).toBe(true);
    expect(isDemoPositionId('demo-pos-')).toBe(true);
  });

  it('NÃO classifica ids reais como demo', () => {
    expect(isDemoPositionId('cmw19onm40002y4esxymnu5q3')).toBe(false);
    expect(isDemoPositionId('demo-order-1')).toBe(false);
    expect(isDemoPositionId('')).toBe(false);
    expect(isDemoPositionId(undefined)).toBe(false);
    expect(isDemoPositionId(123)).toBe(false);
  });

  it('ordem demo é a que aponta para posição demo', () => {
    expect(isDemoOrderPositionId('demo-pos-open-2')).toBe(true);
    expect(isDemoOrderPositionId('cmw-real')).toBe(false);
  });
});

describe('demo-ids — faixas numéricas', () => {
  it('MarketSnapshot 7001..7010', () => {
    expect(inDemoRange('MarketSnapshot', 7001)).toBe(true);
    expect(inDemoRange('MarketSnapshot', 7010)).toBe(true);
    expect(inDemoRange('MarketSnapshot', 7000)).toBe(false);
    expect(inDemoRange('MarketSnapshot', 7011)).toBe(false);
  });

  it('PerformanceSnapshot 8001..8030', () => {
    expect(DEMO_RANGES.PerformanceSnapshot).toEqual({ lo: 8001, hi: 8030, label: 'curva de equity' });
    expect(inDemoRange('PerformanceSnapshot', 8001)).toBe(true);
    expect(inDemoRange('PerformanceSnapshot', 8030)).toBe(true);
    expect(inDemoRange('PerformanceSnapshot', 8000)).toBe(false);
    expect(inDemoRange('PerformanceSnapshot', 8031)).toBe(false);
  });

  it('Round 9001..9005 e AppLog 6001..6006', () => {
    expect(inDemoRange('Round', 9001)).toBe(true);
    expect(inDemoRange('Round', 9005)).toBe(true);
    expect(inDemoRange('Round', 9006)).toBe(false);
    expect(inDemoRange('AppLog', 6001)).toBe(true);
    expect(inDemoRange('AppLog', 6006)).toBe(true);
    expect(inDemoRange('AppLog', 6007)).toBe(false);
    expect(inDemoRange('AppLog', 5999)).toBe(false);
  });

  it('tabela sem faixa nunca casa (fail-safe)', () => {
    expect(inDemoRange('Position', 7001)).toBe(false);
    expect(inDemoRange('TabelaInexistente', 6001)).toBe(false);
  });
});

describe('demo-ids — SQL gerado', () => {
  it('spec cobre exatamente as 6 tabelas do seed, dependentes primeiro', () => {
    expect(DEMO_TABLES).toEqual(['PaperOrder', 'Position', 'MarketSnapshot', 'PerformanceSnapshot', 'Round', 'AppLog']);
    expect(Object.keys(demoDeleteSpec())).toEqual([...DEMO_TABLES]);
  });

  it('prefixo usa LIKE parametrizado (sem SQL injection)', () => {
    const spec = demoDeleteSpec();
    const del = buildDeleteSql('Position', spec.Position);
    expect(del.text).toBe('DELETE FROM "Position" WHERE "id" LIKE $1');
    expect(del.values).toEqual(['demo-pos-%']);
    const count = buildCountSql('Position', spec.Position);
    expect(count.values).toEqual(['demo-pos-%']);
    expect(count.text).toContain('COUNT(*)');
  });

  it('faixa usa BETWEEN parametrizado', () => {
    const spec = demoDeleteSpec();
    const del = buildDeleteSql('Round', spec.Round);
    expect(del.text).toBe('DELETE FROM "Round" WHERE "id" >= $1 AND "id" <= $2');
    expect(del.values).toEqual([9001, 9005]);
  });

  it('totalCounts soma apenas números e ignora lixo', () => {
    expect(totalCounts({ a: 3, b: 2, c: 0 })).toBe(5);
    expect(totalCounts({ a: 3, b: '2', c: null })).toBe(5);
    expect(totalCounts({})).toBe(0);
  });
});
