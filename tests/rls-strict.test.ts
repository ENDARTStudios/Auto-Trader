import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { db, createPrismaClient } from '@/lib/db';
import { withUserRls, withSystemRls, type RlsTransactionClient } from '@/lib/auth/rls-context';
import type { SessionUser } from '@/lib/auth/session';
import { listWallets, createWallet } from '@/lib/trading/wallet-manager';
import { listChannels } from '@/lib/trading/notifier';

// Round 6 — RLS STRICT fase 2: WalletConnection + NotificationChannel SEM a
// cláusula permissiva 'sem contexto'. Com role NON-superuser: SELECT sem GUC =
// 0 linhas; INSERT sem GUC = negado. Rotas/helpers precisam de contexto
// explícito (withUserRls nas rotas; withSystemRls no engine/signer/boot).

const TEST_ROLE = 'autotrader_rls_test';
const PREFIX = 'RLS6-';
const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');

type RlsPrisma = ReturnType<typeof createPrismaClient>;

let adminClient: pg.Client;
let rlsDb: RlsPrisma;
let userA: { id: string; email: string };
let userB: { id: string; email: string };
let walletA = '';
let walletB = '';
let channelA = '';
let channelB = '';

function sessionFor(user: { id: string; email: string }, role: string): SessionUser {
  return { userId: user.id, email: user.email, role, isActive: true };
}
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith('file:')) throw new Error('teste exige DATABASE_URL postgres://');
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
function rlsMigrationStatements(): string[] {
  const out: string[] = [];
  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /rls/i.test(name))
    .sort();
  for (const name of names) {
    const sql = readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8').replace(/--[^\n]*/g, '');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) out.push(statement);
  }
  return out;
}

beforeAll(async () => {
  adminClient = new pg.Client({ connectionString: requireDatabaseUrl() });
  await adminClient.connect();
  // Aplica TODAS as migrations de RLS em ordem (fase 1 → fase 2 strict).
  for (const statement of rlsMigrationStatements()) await adminClient.query(statement);

  await adminClient.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '" + TEST_ROLE + "') THEN CREATE ROLE " + TEST_ROLE + ' NOLOGIN; END IF; END $$;',
  );
  await adminClient.query('GRANT USAGE ON SCHEMA public TO ' + TEST_ROLE);
  await adminClient.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ' + TEST_ROLE);
  await adminClient.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ' + TEST_ROLE);

  rlsDb = createPrismaClient(roleConnectionUrl());
  const who = (await rlsDb.$queryRawUnsafe('SELECT current_user AS who')) as Array<{ who: string }>;
  if (who[0]?.who !== TEST_ROLE) {
    throw new Error('não foi possível conectar como role ' + TEST_ROLE + ' (current_user=' + String(who[0]?.who) + ')');
  }

  const now = Date.now();
  userA = await db.user.create({ data: { email: 'rls6-a-' + now + '@local', passwordHash: 'x', role: 'trader', isActive: true } });
  userB = await db.user.create({ data: { email: 'rls6-b-' + now + '@local', passwordHash: 'x', role: 'trader', isActive: true } });
  walletA = (await db.walletConnection.create({ data: { ownerId: userA.id, label: PREFIX + 'WALLET-A', type: 'evm', address: '0x' + '1'.repeat(40) } })).id;
  walletB = (await db.walletConnection.create({ data: { ownerId: userB.id, label: PREFIX + 'WALLET-B', type: 'evm', address: '0x' + '2'.repeat(40) } })).id;
  const chan = { type: 'telegram', config: JSON.stringify({ botToken: 'x', chatId: 'y' }), events: JSON.stringify([]) };
  channelA = (await db.notificationChannel.create({ data: { ...chan, ownerId: userA.id, name: PREFIX + 'CHAN-A' } })).id;
  channelB = (await db.notificationChannel.create({ data: { ...chan, ownerId: userB.id, name: PREFIX + 'CHAN-B' } })).id;
}, 60_000);

afterAll(async () => {
  try {
    await db.walletConnection.deleteMany({ where: { label: { startsWith: PREFIX } } });
    await db.notificationChannel.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await db.user.deleteMany({ where: { id: { in: [userA?.id, userB?.id].filter(Boolean) as string[] } } });
  } catch {
    /* best-effort */
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

describe('RLS strict — WalletConnection + NotificationChannel', () => {
  it('sem contexto: SELECT retorna 0 linhas (fase 2 strict)', async () => {
    const wallets = await rlsDb.walletConnection.findMany({ where: { label: { startsWith: PREFIX } } });
    const channels = await rlsDb.notificationChannel.findMany({ where: { name: { startsWith: PREFIX } } });
    expect(wallets).toEqual([]);
    expect(channels).toEqual([]);
  });

  it('sem contexto: INSERT é negado pela policy (WITH CHECK)', async () => {
    await expect(
      rlsDb.walletConnection.create({ data: { ownerId: userA.id, label: PREFIX + 'NOCTX', type: 'evm', address: '0x' + '3'.repeat(40) } }),
    ).rejects.toBeTruthy();
    const leaked = await db.walletConnection.findMany({ where: { label: PREFIX + 'NOCTX' } });
    expect(leaked.length).toBe(0);
  });

  it('contexto de user A: vê só A; INSERT cross-owner negado; INSERT próprio ok', async () => {
    const wallets = await withUserRls(sessionFor(userA, 'trader'), (tx) => tx.walletConnection.findMany({ where: { label: { startsWith: PREFIX } } }), rlsDb);
    expect(wallets.map((w) => w.id)).toEqual([walletA]);
    const channels = await withUserRls(sessionFor(userA, 'trader'), (tx) => tx.notificationChannel.findMany({ where: { name: { startsWith: PREFIX } } }), rlsDb);
    expect(channels.map((c) => c.id)).toEqual([channelA]);

    await expect(
      withUserRls(sessionFor(userA, 'trader'), (tx) => tx.walletConnection.create({ data: { ownerId: userB.id, label: PREFIX + 'CROSS', type: 'evm', address: '0x' + '4'.repeat(40) } }), rlsDb),
    ).rejects.toBeTruthy();

    const created = await withUserRls(sessionFor(userA, 'trader'), (tx) => tx.walletConnection.create({ data: { ownerId: userA.id, label: PREFIX + 'OWN', type: 'evm', address: '0x' + '5'.repeat(40) } }), rlsDb);
    expect(created.ownerId).toBe(userA.id);
    await db.walletConnection.delete({ where: { id: created.id } });
  });

  it('withSystemRls (engine/signer/boot) vê tudo; withUserRls super_admin também', async () => {
    const systemWallets = await withSystemRls((tx) => tx.walletConnection.findMany({ where: { label: { startsWith: PREFIX } } }), rlsDb);
    expect(systemWallets.length).toBe(2);
    const adminUser = { id: userA.id, email: userA.email };
    const superWallets = await withUserRls({ ...sessionFor(adminUser, 'super_admin') }, (tx) => tx.walletConnection.findMany({ where: { label: { startsWith: PREFIX } } }), rlsDb);
    expect(superWallets.length).toBe(2);
  });
});

describe('RLS strict — helpers da aplicação continuam funcionando', () => {
  it('wallet-manager.listWallets funciona com contexto de user (vê só o owner)', async () => {
    const session = sessionFor(userA, 'trader');
    const wallets = await withUserRls(session, (tx) => listWallets(session.userId, false, tx), rlsDb);
    expect(wallets.map((w) => w.id)).toEqual([walletA]);
  });

  it('wallet-manager.listWallets funciona com contexto de sistema (vê todos)', async () => {
    const wallets = await withSystemRls((tx) => listWallets(undefined, true, tx), rlsDb);
    const ids = wallets.map((w) => w.id);
    expect(ids).toContain(walletA);
    expect(ids).toContain(walletB);
  });

  it('wallet-manager.createWallet SEM contexto é negado (prova de que o helper é obrigatório)', async () => {
    await expect(
      rlsDb.$transaction((tx: RlsTransactionClient) =>
        createWallet({ label: PREFIX + 'NOCREATE', type: 'evm', address: '0x' + '6'.repeat(40), ownerId: userA.id }, tx),
      ),
    ).rejects.toBeTruthy();
  });

  it('wallet-manager.createWallet COM contexto de sistema funciona', async () => {
    const created = await withSystemRls(
      (tx) => createWallet({ label: PREFIX + 'SYSCREATE', type: 'evm', address: '0x' + '7'.repeat(40), ownerId: userA.id }, tx),
      rlsDb,
    );
    expect(created.label).toBe(PREFIX + 'SYSCREATE');
    await db.walletConnection.delete({ where: { id: created.id } });
  });

  it('notifier.listChannels continua funcionando (call site com withSystemRls)', async () => {
    const channels = await listChannels();
    const names = channels.map((c) => c.name);
    expect(names).toContain(PREFIX + 'CHAN-A');
    expect(names).toContain(PREFIX + 'CHAN-B');
  });
});
