import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CREATE_MIGRATIONS_TABLE_SQL,
  computeChecksum,
  countStatements,
  discoverMigrations,
  formatPlan,
  planRows,
  splitStatements,
  stripSqlComments,
} from '../scripts/bootstrap-prod-migrations.mjs';

// Contrato do bootstrap: checksum = sha256 hex do conteúdo normalizado (LF),
// applied_steps_count = nº de statements. O checksum é calculado do texto
// canônico (CRLF -> LF) para ser igual no Windows e no CI Linux.
import { createHash } from 'node:crypto';
const sha256Lf = (s: string) => createHash('sha256').update(s.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const baselineRaw = readFileSync('prisma/migrations/20260101000000_baseline/migration.sql', 'utf8');
const rlsRaw = readFileSync('prisma/migrations/20260102000000_rls_policies/migration.sql', 'utf8');
const rlsStrictRaw = readFileSync(
  'prisma/migrations/20260103000000_rls_strict_wallet_notification/migration.sql',
  'utf8',
);
const rlsExchangeStrictRaw = readFileSync(
  'prisma/migrations/20260104000000_rls_strict_exchange/migration.sql',
  'utf8',
);
const rlsPositionStrictRaw = readFileSync(
  'prisma/migrations/20260105000000_rls_strict_position/migration.sql',
  'utf8',
);
const BASELINE_SHA = sha256Lf(baselineRaw);
const RLS_SHA = sha256Lf(rlsRaw);
const RLS_STRICT_SHA = sha256Lf(rlsStrictRaw);
const RLS_EXCHANGE_STRICT_SHA = sha256Lf(rlsExchangeStrictRaw);
const RLS_POSITION_STRICT_SHA = sha256Lf(rlsPositionStrictRaw);

describe('bootstrap-prod-migrations — checksum', () => {
  it('sha256 hex do conteúdo (fixtures conhecidas)', () => {
    expect(computeChecksum('SELECT 1;\n')).toBe('b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd');
    expect(computeChecksum('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('checksums das migrations reais (baseline e rls_policies)', () => {
    expect(computeChecksum(baselineRaw)).toBe(BASELINE_SHA);
    expect(computeChecksum(rlsRaw)).toBe(RLS_SHA);
  });

  it('discoverMigrations lê as migrations em ordem', () => {
    const migrations = discoverMigrations();
    expect(migrations.map((m) => m.migration_name)).toEqual([
      '20260101000000_baseline',
      '20260102000000_rls_policies',
      '20260103000000_rls_strict_wallet_notification',
      '20260104000000_rls_strict_exchange',
      '20260105000000_rls_strict_position',
    ]);
    expect(migrations[0].checksum).toBe(BASELINE_SHA);
    expect(migrations[1].checksum).toBe(RLS_SHA);
    expect(migrations[2].checksum).toBe(RLS_STRICT_SHA);
    expect(migrations[3].checksum).toBe(RLS_EXCHANGE_STRICT_SHA);
    expect(migrations[4].checksum).toBe(RLS_POSITION_STRICT_SHA);
    expect(migrations[0].applied_steps_count).toBe(111);
    expect(migrations[1].applied_steps_count).toBe(16);
    expect(migrations[2].applied_steps_count).toBe(8);
    expect(migrations[3].applied_steps_count).toBe(4);
    expect(migrations[4].applied_steps_count).toBe(4);
  });
});

describe('bootstrap-prod-migrations — statements', () => {
  it('conta statements simples', () => {
    expect(countStatements('SELECT 1;\nSELECT 2;')).toBe(2);
    expect(countStatements('')).toBe(0);
    expect(countStatements('   \n\t  ')).toBe(0);
    expect(countStatements('SELECT 1')).toBe(1); // sem ';' final
  });

  it('ignora comentários de linha e de bloco', () => {
    const sql = '-- cabeçalho; com ponto e vírgula\nSELECT 1;\n/* bloco; interno */\nSELECT 2;\n-- fim';
    expect(countStatements(sql)).toBe(2);
    expect(stripSqlComments('SELECT 1; -- x')).not.toContain('--');
  });

  it('não quebra em ";" dentro de string ou de bloco $$', () => {
    expect(countStatements("INSERT INTO t VALUES ('a;b');")).toBe(1);
    expect(countStatements('CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END $$ LANGUAGE plpgsql;')).toBe(1);
    expect(splitStatements('CREATE FUNCTION f() AS $$ SELECT 1; $$ LANGUAGE sql;')[0]).toContain('SELECT 1;');
  });
});

describe('bootstrap-prod-migrations — plano (puro)', () => {
  const migrations = [
    { migration_name: 'm1', checksum: 'aaa', applied_steps_count: 3 },
    { migration_name: 'm2', checksum: 'bbb', applied_steps_count: 7 },
  ];
  let seq = 0;
  const makeId = () => 'id-' + ++seq;
  const now = () => '2026-11-04T00:00:00.000Z';

  it('tabela ausente -> action create com as 2 linhas', () => {
    seq = 0;
    const plan = planRows(migrations, [], { tableExists: false, makeId, now });
    expect(plan.action).toBe('create');
    expect(plan.toInsert).toHaveLength(2);
    expect(plan.toInsert[0]).toMatchObject({
      id: 'id-1',
      checksum: 'aaa',
      migration_name: 'm1',
      applied_steps_count: 3,
      started_at: '2026-11-04T00:00:00.000Z',
      finished_at: '2026-11-04T00:00:00.000Z',
      rolled_back_at: null,
    });
    expect(plan.conflicts).toEqual([]);
  });

  it('tabela existe e tudo bate -> noop (idempotente)', () => {
    const plan = planRows(migrations, [{ migration_name: 'm1', checksum: 'aaa' }, { migration_name: 'm2', checksum: 'bbb' }], { tableExists: true });
    expect(plan.action).toBe('noop');
    expect(plan.toInsert).toEqual([]);
    expect(plan.matched).toEqual(['m1', 'm2']);
  });

  it('tabela existe com registro faltando -> insert só do que falta', () => {
    const plan = planRows(migrations, [{ migration_name: 'm1', checksum: 'aaa' }], { tableExists: true, makeId, now });
    expect(plan.action).toBe('insert');
    expect(plan.toInsert.map((r) => r.migration_name)).toEqual(['m2']);
  });

  it('checksum divergente -> conflict (nada é inserido para aquele nome)', () => {
    const plan = planRows(migrations, [{ migration_name: 'm1', checksum: 'DIFERENTE' }], { tableExists: true, makeId, now });
    expect(plan.action).toBe('conflict');
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({ migration_name: 'm1', expected: 'aaa', found: 'DIFERENTE' });
    expect(plan.toInsert.map((r) => r.migration_name)).toEqual(['m2']);
  });

  it('formatPlan não imprime segredo e descreve o plano', () => {
    const text = formatPlan(planRows(migrations, [], { tableExists: false, makeId, now }));
    expect(text).toContain('AUSENTE');
    expect(text).toContain('registrar: m1');
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
    expect(text).not.toContain('password');
  });
});

describe('bootstrap-prod-migrations — DDL da tabela', () => {
  it('contém as colunas do Prisma Migrate', () => {
    for (const col of ['id', 'checksum', 'finished_at', 'migration_name', 'logs', 'rolled_back_at', 'started_at', 'applied_steps_count']) {
      expect(CREATE_MIGRATIONS_TABLE_SQL).toContain('"' + col + '"');
    }
    expect(CREATE_MIGRATIONS_TABLE_SQL).toContain('CREATE TABLE IF NOT EXISTS');
    expect(CREATE_MIGRATIONS_TABLE_SQL).toContain('VARCHAR(36)');
    expect(CREATE_MIGRATIONS_TABLE_SQL).toContain('VARCHAR(64)');
  });
});