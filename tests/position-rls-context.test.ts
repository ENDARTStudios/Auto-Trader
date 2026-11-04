// tests/position-rls-context.test.ts — preparação do flip STRICT de Position.
//
// (a) Testa o auditor scripts/audit-rls-context.mjs com fixtures (CLI real).
// (b) Prova, num Postgres real com role NÃO-superuser, que:
//     - withSystemRls (engine/jobs) enxerga as posições;
//     - withUserRls(trader) só enxerga as próprias;
//     - um cliente global SEM contexto veria 0 linhas num cenário STRICT
//       (simulado numa tabela-espelho com a policy planejada da round 8 —
//       a policy real de Position continua permissiva nesta rodada).
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
const SIM_TABLE = 'PositionStrictSim';
const PREFIX = 'RLS7-CTX-';

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

const STRICT_POLICY_SQL =
  'CREATE POLICY "' + SIM_TABLE + '_rls" ON "' + SIM_TABLE + '" ' +
  "USING (current_setting('app.rls_bypass', true) = 'on' OR \"ownerId\" = current_setting('app.user_id', true)) " +
  "WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR \"ownerId\" = current_setting('app.user_id', true))";

beforeAll(async () => {
  adminClient = new pg.Client({ connectionString: requireDatabaseUrl() });
  await adminClient.connect();

  // Aplica TODAS as migrations de RLS (fase 1 permissiva + fase 2 strict de
  // Wallet/Notification) — idempotente, mesmo padrão de tests/rls-policies.test.ts.
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

  // Tabela-espelho com a policy STRICT planejada para Position na round 8
  // (sem a cláusula permissiva "sem contexto"). Não toca na policy real.
  await adminClient.query('DROP TABLE IF EXISTS "' + SIM_TABLE + '"');
  await adminClient.query(
    'CREATE TABLE "' + SIM_TABLE + '" ("id" text PRIMARY KEY, "ownerId" text NOT NULL)'
  );
  await adminClient.query('ALTER TABLE "' + SIM_TABLE + '" ENABLE ROW LEVEL SECURITY');
  await adminClient.query('ALTER TABLE "' + SIM_TABLE + '" FORCE ROW LEVEL SECURITY');
  await adminClient.query(STRICT_POLICY_SQL);
  await adminClient.query('GRANT SELECT, INSERT, UPDATE, DELETE ON "' + SIM_TABLE + '" TO ' + TEST_ROLE);
  await adminClient.query(
    'INSERT INTO "' + SIM_TABLE + '" VALUES (\'sim-a\', \'' + traderA.id + '\'), (\'sim-b\', \'' + traderB.id + '\')'
  );
});

afterAll(async () => {
  try {
    await adminClient.query('DROP TABLE IF EXISTS "' + SIM_TABLE + '"');
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

describe('Cenário STRICT simulado (tabela-espelho com a policy da round 8)', () => {
  it('cliente global SEM contexto veria 0 linhas (por isso migramos tudo)', async () => {
    const rows = (await rlsDb.$queryRawUnsafe(
      'SELECT count(*)::int AS n FROM "' + SIM_TABLE + '"'
    )) as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(0);
  });

  it('withSystemRls vê as 2 linhas no cenário strict', async () => {
    const rows = await withSys(
      (tx) =>
        tx.$queryRawUnsafe(
          'SELECT count(*)::int AS n FROM "' + SIM_TABLE + '"'
        ) as Promise<Array<{ n: number }>>
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('withUserRls(traderA) vê só 1 linha no cenário strict', async () => {
    const rows = await withUserRls(
      sessionA(),
      (tx) =>
        tx.$queryRawUnsafe(
          'SELECT "ownerId" FROM "' + SIM_TABLE + '"'
        ) as Promise<Array<{ ownerId: string }>>,
      rlsDb
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerId).toBe(traderA.id);
  });
});
