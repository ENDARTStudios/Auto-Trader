import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { db, createPrismaClient } from '@/lib/db';
import { withUserRls, withSystemRls, type RlsTransactionClient } from '@/lib/auth/rls-context';
import type { SessionUser } from '@/lib/auth/session';

// Round 4 — RLS NATIVO de ponta a ponta (Postgres local, sem rede).
// O usuário do Postgres de DEV é SUPERUSER e superuser IGNORA RLS (nem FORCE
// se aplica). Para provar as policies de verdade, o teste cria a role
// NÃO-superuser autotrader_rls_test, conecta com ela via startup option
// '-c role=...' e roda o helper de produção withUserRls/withSystemRls.
// FORCE é verificado no catálogo (relforcerowsecurity) e pela isolação real.

const TEST_ROLE = 'autotrader_rls_test';
const PREFIX = 'RLS4-';
const MIGRATION = join(process.cwd(), 'prisma', 'migrations', '20260102000000_rls_policies', 'migration.sql');

type RlsPrisma = ReturnType<typeof createPrismaClient>;

let adminClient: pg.Client;
let rlsDb: RlsPrisma;
let roleAvailable = false;
let userA: { id: string; email: string };
let userB: { id: string; email: string };
let superAdmin: { id: string; email: string };
let positionA = '';
let positionB = '';
let walletA = '';
let walletB = '';
let channelA = '';
let channelB = '';

function sessionA(): SessionUser {
  return { userId: userA.id, email: userA.email, role: 'trader', isActive: true };
}
function sessionSuper(): SessionUser {
  return { userId: superAdmin.id, email: superAdmin.email, role: 'super_admin', isActive: true };
}

// IMPORTANTE: os helpers aceitam um client opcional; os testes DEVEM usar o
// client da role non-superuser (o `db` default conecta como superuser de DEV,
// e superuser ignora RLS — isso é exatamente o caveat documentado em RLS.md).
function withA<T>(fn: (tx: RlsTransactionClient) => Promise<T>): Promise<T> {
  return withUserRls(sessionA(), fn, rlsDb);
}
function withSuper<T>(fn: (tx: RlsTransactionClient) => Promise<T>): Promise<T> {
  return withUserRls(sessionSuper(), fn, rlsDb);
}
function withSys<T>(fn: (tx: RlsTransactionClient) => Promise<T>): Promise<T> {
  return withSystemRls(fn, rlsDb);
}
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith('file:')) {
    throw new Error('tests/rls-policies.test.ts exige DATABASE_URL postgres:// (RLS é nativo Postgres)');
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
async function applyRlsPolicies(client: pg.Client): Promise<void> {
  // TODAS as migrations de RLS em ordem (fase 1 permissiva → fase 2 strict do
  // round 6). Aplicar só a fase 1 reverteria WalletConnection/NotificationChannel
  // para permissivo e mascararia o strict.
  const migrationsRoot = join(process.cwd(), 'prisma', 'migrations');
  const names = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /rls/i.test(name))
    .sort();
  for (const name of names) {
    const sql = readFileSync(join(migrationsRoot, name, 'migration.sql'), 'utf8').replace(/--[^\n]*/g, '');
    const statements = sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    for (const statement of statements) await client.query(statement);
  }
}

beforeAll(async () => {
  adminClient = new pg.Client({ connectionString: requireDatabaseUrl() });
  await adminClient.connect();
  await applyRlsPolicies(adminClient);

  await adminClient.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '" + TEST_ROLE + "') THEN CREATE ROLE " + TEST_ROLE + ' NOLOGIN; END IF; END $$;',
  );
  await adminClient.query('GRANT USAGE ON SCHEMA public TO ' + TEST_ROLE);
  await adminClient.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ' + TEST_ROLE);
  await adminClient.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ' + TEST_ROLE);

  rlsDb = createPrismaClient(roleConnectionUrl());
  const roleRows = (await rlsDb.$queryRawUnsafe('SELECT current_user AS who')) as Array<{ who: string }>;
  roleAvailable = roleRows[0]?.who === TEST_ROLE;
  if (!roleAvailable) {
    throw new Error('não foi possível conectar como role de teste ' + TEST_ROLE + ' (current_user=' + String(roleRows[0]?.who) + ')');
  }

  const now = Date.now();
  userA = await db.user.create({ data: { email: 'rls4-a-' + now + '@local', passwordHash: 'x', role: 'trader', isActive: true } });
  userB = await db.user.create({ data: { email: 'rls4-b-' + now + '@local', passwordHash: 'x', role: 'trader', isActive: true } });
  superAdmin = await db.user.create({ data: { email: 'rls4-admin-' + now + '@local', passwordHash: 'x', role: 'super_admin', isActive: true } });

  const posCommon = {
    source: 'cex', status: 'open', entryPriceUsd: 100, entryAmountUsd: 100, entryQty: 1,
    takeProfitPrice: 115, stopLossPrice: 92, maxExitAt: new Date(Date.now() + 3_600_000), scamScore: 80, roundId: 1,
  };
  positionA = (await db.position.create({ data: { ...posCommon, ownerId: userA.id, symbol: PREFIX + 'POS-A' } })).id;
  positionB = (await db.position.create({ data: { ...posCommon, ownerId: userB.id, symbol: PREFIX + 'POS-B' } })).id;
  walletA = (await db.walletConnection.create({ data: { ownerId: userA.id, label: PREFIX + 'WALLET-A', type: 'evm', address: '0x' + 'a'.repeat(40) } })).id;
  walletB = (await db.walletConnection.create({ data: { ownerId: userB.id, label: PREFIX + 'WALLET-B', type: 'evm', address: '0x' + 'b'.repeat(40) } })).id;
  const chan = { type: 'telegram', config: JSON.stringify({ botToken: 'x', chatId: 'y' }), events: JSON.stringify([]) };
  channelA = (await db.notificationChannel.create({ data: { ...chan, ownerId: userA.id, name: PREFIX + 'CHAN-A' } })).id;
  channelB = (await db.notificationChannel.create({ data: { ...chan, ownerId: userB.id, name: PREFIX + 'CHAN-B' } })).id;
}, 60_000);

afterAll(async () => {
  try {
    await db.position.deleteMany({ where: { symbol: { startsWith: PREFIX } } });
    await db.walletConnection.deleteMany({ where: { label: { startsWith: PREFIX } } });
    await db.notificationChannel.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await db.user.deleteMany({ where: { id: { in: [userA?.id, userB?.id, superAdmin?.id].filter(Boolean) as string[] } } });
  } catch {
    /* cleanup best-effort */
  }
  if (rlsDb) await rlsDb.$disconnect().catch(() => {});
  if (adminClient) {
    try {
      await adminClient.query('DROP OWNED BY ' + TEST_ROLE);
      await adminClient.query('DROP ROLE IF EXISTS ' + TEST_ROLE);
    } catch {
      /* ignore */
    }
    await adminClient.end().catch(() => {});
  }
});

describe('RLS nativo — catálogo', () => {
  it('ENABLE + FORCE RLS ativos nas 4 tabelas', async () => {
    const rows = (await db.$queryRawUnsafe(
      "SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('Position','WalletConnection','ExchangeConnection','NotificationChannel') ORDER BY c.relname",
    )) as Array<{ table_name: string; enabled: boolean; forced: boolean }>;
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.enabled, row.table_name + ' ENABLE RLS').toBe(true);
      expect(row.forced, row.table_name + ' FORCE RLS').toBe(true);
    }
  });

  it('conexão de teste é NON-superuser (superuser ignoraria RLS)', async () => {
    const rows = (await rlsDb.$queryRawUnsafe('SELECT current_user AS who')) as Array<{ who: string }>;
    expect(roleAvailable).toBe(true);
    expect(rows[0]?.who).toBe(TEST_ROLE);
  });
});

describe('RLS nativo — isolamento por owner', () => {
  it('sem contexto: TODAS as 4 tabelas são STRICT (fase 4, round 8) — 0 linhas', async () => {
    const positions = await rlsDb.position.findMany({ where: { symbol: { startsWith: PREFIX } } });
    const wallets = await rlsDb.walletConnection.findMany({ where: { label: { startsWith: PREFIX } } });
    const channels = await rlsDb.notificationChannel.findMany({ where: { name: { startsWith: PREFIX } } });
    const exchanges = await rlsDb.exchangeConnection.findMany({ where: { label: { startsWith: PREFIX } } });
    // Fase 4 (round 8): Position também strict — sem contexto = deny.
    expect(positions.length).toBe(0);
    expect(wallets.length).toBe(0);
    expect(channels.length).toBe(0);
    expect(exchanges.length).toBe(0);
  });

  it('withUserRls(user A) vê só as linhas de A', async () => {
    const positions = await withA( (tx) => tx.position.findMany({ where: { symbol: { startsWith: PREFIX } } }));
    expect(positions.map((p) => p.id)).toEqual([positionA]);
    const wallets = await withA( (tx) => tx.walletConnection.findMany({ where: { label: { startsWith: PREFIX } } }));
    expect(wallets.map((w) => w.id)).toEqual([walletA]);
    const channels = await withA( (tx) => tx.notificationChannel.findMany({ where: { name: { startsWith: PREFIX } } }));
    expect(channels.map((c) => c.id)).toEqual([channelA]);
  });

  it('update/delete de linha de B por A falham (USING bloqueia)', async () => {
    await expect(
      withA( (tx) => tx.walletConnection.update({ where: { id: walletB }, data: { label: PREFIX + 'HACK' } })),
    ).rejects.toBeTruthy();
    await expect(
      withA( (tx) => tx.walletConnection.delete({ where: { id: walletB } })),
    ).rejects.toBeTruthy();
    const wallet = await db.walletConnection.findUnique({ where: { id: walletB } });
    expect(wallet?.label).toBe(PREFIX + 'WALLET-B');
  });

  it('INSERT com ownerId de outro usuário falha no WITH CHECK', async () => {
    await expect(
      withA( (tx) => tx.walletConnection.create({ data: { ownerId: userB.id, label: PREFIX + 'CROSS', type: 'evm', address: '0x' + 'c'.repeat(40) } })),
    ).rejects.toBeTruthy();
    const crossed = await db.walletConnection.findMany({ where: { label: PREFIX + 'CROSS' } });
    expect(crossed.length).toBe(0);
  });

  it('INSERT do próprio owner funciona', async () => {
    const created = await withA( (tx) => tx.walletConnection.create({ data: { ownerId: userA.id, label: PREFIX + 'OWN', type: 'evm', address: '0x' + 'd'.repeat(40) } }));
    expect(created.ownerId).toBe(userA.id);
    await db.walletConnection.delete({ where: { id: created.id } });
  });

  it('super_admin (withUserRls) vê tudo via app.rls_bypass=on', async () => {
    const positions = await withSuper( (tx) => tx.position.findMany({ where: { symbol: { startsWith: PREFIX } } }));
    expect(positions.length).toBe(2);
  });

  it('withSystemRls (engine/jobs) vê tudo', async () => {
    const wallets = await withSys((tx) => tx.walletConnection.findMany({ where: { label: { startsWith: PREFIX } } }));
    expect(wallets.length).toBe(2);
  });

  it('contexto é transaction-local: não vaza para a próxima query', async () => {
    await withA( async (tx) => {
      const inside = await tx.position.findMany({ where: { symbol: { startsWith: PREFIX } } });
      expect(inside.length).toBe(1);
    });
    const outside = await rlsDb.position.findMany({ where: { symbol: { startsWith: PREFIX } } });
    // Fase 4 (round 8): Position também é STRICT — sem contexto = 0. Prova que o
    // GUC é transaction-local (o contexto não "vazou" para a query seguinte) e
    // que a policy fail-closed está ativa.
    expect(outside.length).toBe(0);
  });
});
