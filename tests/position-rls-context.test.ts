// tests/position-rls-context.test.ts — flip STRICT de Position (fase 4, round 8).
//
// (a) Testa o auditor scripts/audit-rls-context.mjs com fixtures (CLI real).
// (b) Prova, num Postgres real com role NÃO-superuser, que a tabela REAL
//     Position agora é STRICT (migration 20260105000000_rls_strict_position):
//     - cliente global SEM contexto → 0 linhas e INSERT negado;
//     - withSystemRls (engine/jobs) enxerga as posições;
//     - withUserRls(trader) só enxerga as próprias (WITH CHECK barra cross-owner);
//     - withUserRls(super_admin) faz bypass.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { createPrismaClient } from '@/lib/db';
import { withSystemRls, withUserRls, type RlsTransactionClient } from '@/lib/auth/rls-context';
import type { SessionUser } from '@/lib/auth/session';

const AUDIT_SCRIPT = join(process.cwd(), 'scripts', 'audit-rls-context.mjs');

// ---------------------------------------------------------------------------
// (a) Auditor com fixtures
// ---------------------------------------------------------------------------
describe('audit-rls-context (fixtures)', () => {
  let root = '';
  const run = (dir: string): { status: number; out: string } => {
    try {
      const out = execFileSync(process.execPath, [AUDIT_SCRIPT, dir], { encoding: 'utf8' });
      return { status: 0, out };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
    }
  };

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('detecta db.position fora de contexto como violação (exit 1)', () => {
    root = mkdtempSync(join(tmpdir(), 'rls-audit-bad-'));
    mkdirSync(join(root, 'sub'));
    writeFileSync(
      join(root, 'sub', 'leak.ts'),
      'export async function leak() {\n  return db.position.findMany({});\n}\n'
    );
    const { status, out } = run(root);
    expect(status).toBe(1);
    expect(out).toContain('VIOLAÇÕES');
    expect(out).toContain('leak.ts');
  });

  it('aceita db.position dentro de withSystemRls/withUserRls (sem falso positivo)', () => {
    root = mkdtempSync(join(tmpdir(), 'rls-audit-good-'));
    writeFileSync(
      join(root, 'ok.ts'),
      [
        'export async function a() {',
        '  return withSystemRls((tx) => tx.position.findMany({}));',
        '}',
        'export async function b(session) {',
        '  return withUserRls(session, (tx) => tx.position.count({}));',
        '}',
        'export async function c() {',
        '  return withSystemRls((tx) => db.position.findMany({}));', // aceito pela heurística
        '}',
        '',
      ].join('\n')
    );
    const { status, out } = run(root);
    expect(status).toBe(0);
    expect(out).toContain('OK');
    expect(out).not.toContain('VIOLAÇÕES');
  });

  it('tx.position fora de um helper (tx não recebido por parâmetro) → violação', () => {
    root = mkdtempSync(join(tmpdir(), 'rls-audit-tx-'));
    writeFileSync(
      join(root, 'noctx.ts'),
      [
        'const tx = {} as never;',
        'export async function noctx() {',
        '  return tx.position.findMany({});',
        '}',
        '',
      ].join('\n')
    );
    const { status, out } = run(root);
    expect(status).toBe(1);
    expect(out).toContain('tx.position fora de with*Rls');
  });

  it('repo real: src/ inteiro sem violação de contexto', () => {
    const { status, out } = run(join(process.cwd(), 'src'));
    expect(status).toBe(0);
    expect(out).toContain('OK — nenhum db.position');
  });
});

// ---------------------------------------------------------------------------
// (b) Integração Postgres com role NÃO-superuser
// ---------------------------------------------------------------------------
const TEST_ROLE = 'autotrader_position_ctx_test';
const PREFIX = 'RLS8-CTX-';

type RlsPrisma = ReturnType<typeof createPrismaClient>;
const dbAdmin: RlsPrisma = createPrismaClient();
let adminClient: pg.Client;
let rlsDb: RlsPrisma;
let admin: { id: string; email: string };
let traderA: { id: string; email: string };
let traderB: { id: string; email: string };
let posA = '';
let posB = '';

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith('file:')) {
    throw new Error('tests/position-rls-context.test.ts exige DATABASE_URL postgres://');
  }
  return url;
}

function roleConnectionUrl(): string {
  const url = new URL(requireDatabaseUrl());
  for (const key of [...url.searchParams.keys()]) {
    if (key !== 'sslmode') url.searchParams.delete(key);
  }
  url.searchParams.set('options', '-c role=' + TEST_ROLE);
  return url.toString();
}

function sessionOf(user: { id: string; email: string }, role: string): SessionUser {
  return { userId: user.id, email: user.email, role, isActive: true };
}
function sessionA(): SessionUser {
  return sessionOf(traderA, 'trader');
}
function sessionSuper(): SessionUser {
  return sessionOf(admin, 'super_admin');
}
function withSys<T>(fn: (tx: RlsTransactionClient) => Promise<T>): Promise<T> {
  return withSystemRls(fn, rlsDb);
}

beforeAll(async () => {
  adminClient = new pg.Client({ connectionString: requireDatabaseUrl() });
  await adminClient.connect();

  // Aplica TODAS as migrations de RLS em ordem (fase 1 → strict Wallet/
  // Notification/Exchange/Position) — idempotente, mesmo padrão de
  // tests/rls-policies.test.ts.
  const migrationsRoot = join(process.cwd(), 'prisma', 'migrations');
  const names = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /rls/i.test(name))
    .sort();
  for (const name of names) {
    const sql = readFileSync(join(migrationsRoot, name, 'migration.sql'), 'utf8').replace(/--[^\n]*/g, '');
    for (const statement of sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
      await adminClient.query(statement);
    }
  }

  await adminClient.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '" + TEST_ROLE + "') THEN CREATE ROLE " + TEST_ROLE + ' NOLOGIN; END IF; END $$;'
  );
  await adminClient.query('GRANT USAGE ON SCHEMA public TO ' + TEST_ROLE);
  await adminClient.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ' + TEST_ROLE);
  await adminClient.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ' + TEST_ROLE);

  rlsDb = createPrismaClient(roleConnectionUrl());
  const who = (await rlsDb.$queryRawUnsafe('SELECT current_user AS who')) as Array<{ who: string }>;
  expect(who[0]?.who).toBe(TEST_ROLE);

  const now = Date.now();
  const fakeHash = '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTU';
  admin = await dbAdmin.user.create({
    data: { email: 'rls7-admin-' + now + '@local', passwordHash: fakeHash, role: 'super_admin', isActive: true },
  });
  traderA = await dbAdmin.user.create({
    data: { email: 'rls7-a-' + now + '@local', passwordHash: fakeHash, role: 'trader', isActive: true },
  });
  traderB = await dbAdmin.user.create({
    data: { email: 'rls7-b-' + now + '@local', passwordHash: fakeHash, role: 'trader', isActive: true },
  });

  const base = {
    source: 'cex',
    status: 'open',
    entryPriceUsd: 100,
    entryAmountUsd: 100,
    entryQty: 1,
    takeProfitPrice: 115,
    stopLossPrice: 92,
    maxExitAt: new Date(Date.now() + 3_600_000),
    scamScore: 80,
    roundId: 1,
  };
  posA = (
    await dbAdmin.position.create({ data: { ...base, ownerId: traderA.id, symbol: PREFIX + 'A' } })
  ).id;
  posB = (
    await dbAdmin.position.create({ data: { ...base, ownerId: traderB.id, symbol: PREFIX + 'B' } })
  ).id;

});

afterAll(async () => {
  try {
    await dbAdmin.position.deleteMany({ where: { symbol: { startsWith: PREFIX } } });
    await dbAdmin.user.deleteMany({ where: { email: { startsWith: 'rls7-' } } });
  } finally {
    await rlsDb.$disconnect();
    await adminClient.end();
    await dbAdmin.$disconnect();
  }
});

describe('Position — withSystemRls/withUserRls com role NÃO-superuser', () => {
  it('withSystemRls (engine/jobs) enxerga as posições do sistema', async () => {
    const rows = await withSys((tx) =>
      tx.position.findMany({ where: { symbol: { startsWith: PREFIX } } })
    );
    expect(rows.map((r) => r.id).sort()).toEqual([posA, posB].sort());
  });

  it('withUserRls(traderA) enxerga somente a própria posição', async () => {
    const rows = await withUserRls(
      sessionA(),
      (tx) => tx.position.findMany({ where: { symbol: { startsWith: PREFIX } } }),
      rlsDb
    );
    expect(rows.map((r) => r.id)).toEqual([posA]);
  });

  it('withUserRls(super_admin) enxerga tudo (bypass)', async () => {
    const rows = await withUserRls(
      sessionSuper(),
      (tx) => tx.position.findMany({ where: { symbol: { startsWith: PREFIX } } }),
      rlsDb
    );
    expect(rows.length).toBe(2);
  });
});

describe('Position STRICT de verdade (fase 4, round 8) — tabela REAL', () => {
  const positionData = (ownerId: string, symbol: string) => ({
    ownerId,
    symbol,
    source: 'cex',
    status: 'open',
    entryPriceUsd: 100,
    entryAmountUsd: 100,
    entryQty: 1,
    takeProfitPrice: 115,
    stopLossPrice: 92,
    maxExitAt: new Date(Date.now() + 3_600_000),
    scamScore: 80,
    roundId: 1,
  });

  it('cliente global SEM contexto → 0 linhas (fail-closed)', async () => {
    const rows = await rlsDb.position.findMany({ where: { symbol: { startsWith: PREFIX } } });
    expect(rows).toEqual([]);
  });

  it('INSERT sem contexto é negado pela policy (WITH CHECK)', async () => {
    await expect(
      rlsDb.position.create({
        data: positionData(traderA.id, PREFIX + 'NOCTX'),
      }),
    ).rejects.toBeTruthy();
    const leaked = await dbAdmin.position.findMany({ where: { symbol: PREFIX + 'NOCTX' } });
    expect(leaked.length).toBe(0);
  });

  it('withUserRls(traderA): vê só A e INSERT cross-owner (B) é negado', async () => {
    const rows = await withUserRls(
      sessionA(),
      (tx) => tx.position.findMany({ where: { symbol: { startsWith: PREFIX } } }),
      rlsDb
    );
    expect(rows.map((r) => r.id)).toEqual([posA]);

    await expect(
      withUserRls(
        sessionA(),
        (tx) =>
          tx.position.create({ data: positionData(traderB.id, PREFIX + 'CROSS') }),
        rlsDb
      ),
    ).rejects.toBeTruthy();
  });

  it('withUserRls(traderA): INSERT da própria posição funciona', async () => {
    const created = await withUserRls(
      sessionA(),
      (tx) => tx.position.create({ data: positionData(traderA.id, PREFIX + 'OWN') }),
      rlsDb
    );
    expect(created.ownerId).toBe(traderA.id);
    await dbAdmin.position.delete({ where: { id: created.id } });
  });
});
