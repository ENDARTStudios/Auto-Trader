#!/usr/bin/env node
// scripts/verify-rls-enforcement.mjs — prova (ou refuta) que as policies de RLS
// estão REALMENTE em vigor e classifica cada uma como STRICT ou PERMISSIVE.
//
// Contexto (rodada 8): o app roda com role `autotrader_app` (NOBYPASSRLS) e as
// policies foram endurecidas por migrations (rls_strict_*). "Ser strict" = a
// policy NÃO tem a cláusula permissiva legada `NULLIF(current_setting('app.user_id',
// true), '') IS NULL` (que libera tudo quando não há contexto). Classificamos
// pelo catálogo (pg_policies.qual), sem depender de ler a migration.
//
// Mede nas 4 tabelas multi-tenant (Position, WalletConnection, ExchangeConnection,
// NotificationChannel):
//   - current_user / rolsuper / rolbypassrls;
//   - policy + STRICT/PERMISSIVE + relrowsecurity/relforcerowsecurity;
//   - counts em transação: sem contexto / app.user_id=<admin> / app.rls_bypass=on,
//     comparados com o count real de ownerId=<admin>;
//   - role com SUPERUSER/BYPASSRLS ignora RLS por definição → INERTE.
//
// Uso (flags antigas preservadas):
//   node scripts/verify-rls-enforcement.mjs                    # relatório; exit 0
//   node scripts/verify-rls-enforcement.mjs --expect-enforced  # exit 0 só se ENFORCED
//   node scripts/verify-rls-enforcement.mjs --expect-all-strict # exit 0 só se as 4 strict
//   node scripts/verify-rls-enforcement.mjs --json
//
// NUNCA imprime credenciais (só host/db/role).
import 'dotenv/config';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

export const RLS_TABLES = ['Position', 'WalletConnection', 'ExchangeConnection', 'NotificationChannel'];
// Marcador da cláusula permissiva legada (round 4). Sua presença => PERMISSIVE.
export const PERMISSIVE_MARKER = /NULLIF\s*\(\s*current_setting\s*\(\s*'app\.user_id'/i;

/** Classifica uma policy como STRICT/PERMISSIVE pelo texto do USING/qual. */
export function classifyPolicy(policy) {
  const qual = String((policy && (policy.qual ?? policy.qualification)) || '');
  const permissive = PERMISSIVE_MARKER.test(qual) || /NULLIF\s*\(\s*current_setting/i.test(qual);
  return { mode: permissive ? 'PERMISSIVE' : 'STRICT', hasContextClause: /app\.rls_bypass/.test(qual), qual };
}

/** Agrega as 4 tabelas: ALL_STRICT / PARTIAL_STRICT / NONE_STRICT. */
export function evaluateStrictness(tables) {
  const byTable = {};
  for (const table of RLS_TABLES) {
    const list = (tables && tables[table]) || [];
    byTable[table] = list.length ? list.map((p) => classifyPolicy(p).mode) : ['MISSING'];
  }
  const permissive = RLS_TABLES.filter((t) => byTable[t].some((m) => m !== 'STRICT'));
  const verdict = permissive.length === 0 ? 'ALL_STRICT' : permissive.length === RLS_TABLES.length ? 'NONE_STRICT' : 'PARTIAL_STRICT';
  return { verdict, permissiveTables: permissive, byTable };
}

function fail(message) {
  console.error('[verify-rls] ERRO: ' + message);
  process.exit(1);
}

async function withTx(client, fn) {
  await client.query('BEGIN');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
}

async function countFor(client, table, mode, adminId) {
  return withTx(client, async () => {
    if (mode === 'ctx') {
      await client.query("SELECT set_config('app.user_id', $1, true)", [adminId]);
    } else if (mode === 'bypass') {
      await client.query("SELECT set_config('app.user_id', $1, true)", [adminId]);
      await client.query("SELECT set_config('app.rls_bypass', 'on', true)");
    }
    const res = await client.query('SELECT count(*)::int AS n FROM "' + table + '"');
    return res.rows[0].n;
  });
}

async function ownerCount(client, table, adminId) {
  return withTx(client, async () => {
    await client.query("SELECT set_config('app.rls_bypass', 'on', true)");
    const mine = (await client.query('SELECT count(*)::int AS n FROM "' + table + '" WHERE "ownerId" = $1', [adminId])).rows[0].n;
    const all = (await client.query('SELECT count(*)::int AS n FROM "' + table + '"')).rows[0].n;
    return { mine, all, others: all - mine };
  });
}

export async function main(argv = []) {
  const EXPECT = argv.includes('--expect-enforced');
  const EXPECT_ALL_STRICT = argv.includes('--expect-all-strict');
  const JSON_OUT = argv.includes('--json');
  const log = (msg) => { if (!JSON_OUT) console.log('[verify-rls] ' + msg); };

  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL ausente no ambiente.');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail('DATABASE_URL invalida.');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) fail('provider nao suportado: ' + parsed.protocol);

  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_user AS u, current_database() AS d, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass',
      )
    ).rows[0];
    const policyRows = (
      await client.query("SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename")
    ).rows;
    const flags = (
      await client.query('SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) ORDER BY relname', [RLS_TABLES])
    ).rows;

    const byTable = {};
    for (const p of policyRows) {
      byTable[p.tablename] = byTable[p.tablename] || [];
      byTable[p.tablename].push(p);
    }
    const strictness = evaluateStrictness(byTable);

    const admin = (
      await client.query('SELECT id, email FROM "User" WHERE role = \'super_admin\' ORDER BY "createdAt" ASC LIMIT 1')
    ).rows[0];

    const report = {
      db: parsed.hostname + ':' + (parsed.port || '5432') + '/' + decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      currentUser: identity.u,
      rolsuper: identity.super,
      rolbypassrls: identity.bypass,
      policies: policyRows.map((p) => p.tablename + ':' + p.policyname + ':' + classifyPolicy(p).mode),
      rlsFlags: flags.map((f) => ({ table: f.relname, enabled: f.relrowsecurity, forced: f.relforcerowsecurity })),
      strictness: { verdict: strictness.verdict, permissiveTables: strictness.permissiveTables, byTable: strictness.byTable },
      adminUser: admin ? { id: admin.id, email: admin.email } : null,
      counts: {},
      verdict: 'UNKNOWN',
      reasons: [],
    };

    log('banco: ' + report.db);
    log('role: ' + identity.u + ' (superuser=' + identity.super + ', bypassrls=' + identity.bypass + ')');
    log('strictness: ' + strictness.verdict + (strictness.permissiveTables.length ? ' — permissivas: ' + strictness.permissiveTables.join(', ') : ''));
    for (const t of RLS_TABLES) log('  ' + t.padEnd(22) + (byTable[t] ? byTable[t].map((p) => classifyPolicy(p).mode).join(',') : 'MISSING'));
    log('flags: ' + flags.map((f) => f.relname + '[rls=' + f.relrowsecurity + ',force=' + f.relforcerowsecurity + ']').join(' '));

    if (!admin) fail('nenhum usuário super_admin encontrado para medir o isolamento.');
    log('usuário de referência (super_admin): ' + admin.email);

    for (const table of RLS_TABLES) {
      const noCtx = await countFor(client, table, 'nocx', admin.id);
      const ctx = await countFor(client, table, 'ctx', admin.id);
      const bypass = await countFor(client, table, 'bypass', admin.id);
      const owners = await ownerCount(client, table, admin.id);
      report.counts[table] = { noContext: noCtx, withUserId: ctx, withBypass: bypass, ownerRows: owners.mine, otherRows: owners.others };
      log(table + ': sem-contexto=' + noCtx + ' | app.user_id=' + ctx + ' | bypass=on=' + bypass + ' | linhas do admin=' + owners.mine + ' | de outros=' + owners.others);
    }

    // --- veredito de ENFORCEMENT (role + policies + coerência) ------------
    if (identity.super === true) report.reasons.push('role atual e SUPERUSER — RLS ignorado por definição');
    if (identity.bypass === true) report.reasons.push('role atual tem BYPASSRLS — RLS ignorado por definição');
    for (const f of flags) {
      if (!f.relrowsecurity) report.reasons.push('RLS desabilitado em ' + f.relname);
      if (!f.relforcerowsecurity) report.reasons.push('FORCE RLS desligado em ' + f.relname + ' (owner bypassa)');
    }
    for (const table of RLS_TABLES) {
      const c = report.counts[table];
      if (c.withUserId !== c.ownerRows) report.reasons.push(table + ': app.user_id viu ' + c.withUserId + ' linhas, esperado ' + c.ownerRows + ' (ownerId=admin)');
      if (c.withBypass < c.withUserId) report.reasons.push(table + ': bypass=on viu MENOS que app.user_id (incoerente)');
    }
    const isolationVisible = RLS_TABLES.some((t) => report.counts[t].otherRows > 0);
    if (!isolationVisible) report.reasons.push('aviso: nao ha linhas de outros usuarios no banco — isolamento nao e distinguivel por contagem (teste fraco neste ambiente)');

    const hardBlockers = report.reasons.filter((r) => !r.startsWith('aviso:'));
    report.verdict = hardBlockers.length === 0 ? 'ENFORCED' : 'INERTE';
    report.isolationVisible = isolationVisible;

    log('VEREDITO enforcement: ' + report.verdict + (hardBlockers.length ? ' — ' + hardBlockers.join('; ') : ' — policies ativas e coerentes'));
    if (report.verdict === 'INERTE') {
      log('role de app precisa ser NOSUPERUSER NOBYPASSRLS; ver docs/05-security-compliance/RLS.md §9.');
    }

    if (JSON_OUT) console.log(JSON.stringify(report));

    const enforcementExit = !EXPECT || report.verdict === 'ENFORCED' ? 0 : 1;
    const strictExit = !EXPECT_ALL_STRICT || strictness.verdict === 'ALL_STRICT' ? 0 : 1;
    if (EXPECT_ALL_STRICT && strictness.verdict !== 'ALL_STRICT') {
      if (!JSON_OUT) {
        console.error('[verify-rls] FALHOU --expect-all-strict: ' + strictness.verdict + ' (permissivas: ' + (strictness.permissiveTables.join(', ') || 'n/a') + ')');
        console.error('[verify-rls] endurecer exige migration nova (rls_strict_*) e rollout, nao UPDATE manual de policy.');
      }
    }
    return enforcementExit !== 0 ? enforcementExit : strictExit;
  } finally {
    await client.end().catch(() => {});
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => fail((err && err.message) || String(err)));
}
