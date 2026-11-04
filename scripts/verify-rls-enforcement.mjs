#!/usr/bin/env node
// scripts/verify-rls-enforcement.mjs — prova (ou refuta) que as policies de RLS
// estão REALMENTE em vigor para o role de aplicação. Existe porque criar policy
// não basta: role com SUPERUSER ou BYPASSRLS ignora RLS — was o caso do
// neondb_owner em produção antes da rodada 5. FORCE RLS também é obrigatório,
// senão o OWNER das tabelas continua bypassando.
//
// O que mede (nas tabelas multi-tenant Position e WalletConnection):
//   - current_user / rolsuper / rolbypassrls;
//   - policies existentes e relrowsecurity/relforcerowsecurity;
//   - count(*) em três modos, sempre em transação com ROLLBACK no fim:
//       1. SEM contexto (GUCs ausentes)  -> comportamento legado/permissivo;
//       2. COM app.user_id=<admin>        -> deve ver SÓ linhas do owner;
//       3. COM app.rls_bypass='on'        -> deve ver TUDO (super_admin/engine).
//     O esperado do modo 2 é comparado com o count de ownerId=<admin> medido
//     com bypass ligado (fonte da verdade).
//
// Uso:
//   node scripts/verify-rls-enforcement.mjs                 # relatório; exit 0
//   node scripts/verify-rls-enforcement.mjs --expect-enforced  # exit 0 só se ativo
//   node scripts/verify-rls-enforcement.mjs --json
//
// NUNCA imprime credenciais (só host/db/role).
import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const argv = process.argv.slice(2);
const EXPECT = argv.includes('--expect-enforced');
const JSON_OUT = argv.includes('--json');
const TABLES = ['Position', 'WalletConnection'];
const RLS_TABLES = ['Position', 'WalletConnection', 'ExchangeConnection', 'NotificationChannel'];

function fail(message) {
  console.error('[verify-rls] ERRO: ' + message);
  process.exit(1);
}

function log(msg) {
  if (!JSON_OUT) console.log('[verify-rls] ' + msg);
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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL ausente no ambiente.');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail('DATABASE_URL invalida.');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) fail('provider nao suportado: ' + parsed.protocol);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const identity = (
      await client.query(
        'SELECT current_user AS u, current_database() AS d, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass',
      )
    ).rows[0];
    const policies = (
      await client.query("SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename")
    ).rows;
    const flags = (
      await client.query(
        'SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) ORDER BY relname',
        [RLS_TABLES],
      )
    ).rows;

    const admin = (
      await client.query('SELECT id, email FROM "User" WHERE role = \'super_admin\' ORDER BY "createdAt" ASC LIMIT 1')
    ).rows[0];

    const report = {
      db: parsed.hostname + ':' + (parsed.port || '5432') + '/' + decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      currentUser: identity.u,
      rolsuper: identity.super,
      rolbypassrls: identity.bypass,
      policies: policies.map((p) => p.tablename + ':' + p.policyname),
      rlsFlags: flags.map((f) => ({ table: f.relname, enabled: f.relrowsecurity, forced: f.relforcerowsecurity })),
      adminUser: admin ? { id: admin.id, email: admin.email } : null,
      counts: {},
      verdict: 'UNKNOWN',
      reasons: [],
    };

    log('banco: ' + report.db);
    log('role: ' + identity.u + ' (superuser=' + identity.super + ', bypassrls=' + identity.bypass + ')');
    log('policies: ' + (policies.length ? policies.map((p) => p.tablename + '/' + p.policyname).join(', ') : 'NENHUMA'));
    log('flags: ' + flags.map((f) => f.relname + '[rls=' + f.relrowsecurity + ',force=' + f.relforcerowsecurity + ']').join(' '));

    if (!admin) {
      fail('nenhum usuário super_admin encontrado para medir o isolamento.');
    }
    log('usuário de referência (super_admin): ' + admin.email);

    for (const table of TABLES) {
      const noCtx = await countFor(client, table, 'nocx', admin.id);
      const ctx = await countFor(client, table, 'ctx', admin.id);
      const bypass = await countFor(client, table, 'bypass', admin.id);
      const owners = await ownerCount(client, table, admin.id);
      report.counts[table] = { noContext: noCtx, withUserId: ctx, withBypass: bypass, ownerRows: owners.mine, otherRows: owners.others };
      log(
        table + ': sem-contexto=' + noCtx + ' | app.user_id=' + ctx + ' | bypass=on=' + bypass + ' | linhas do admin=' + owners.mine + ' | linhas de outros=' + owners.others,
      );
    }

    // --- veredito ---------------------------------------------------------
    if (identity.super === true) report.reasons.push('role atual e SUPERUSER — RLS ignorado por definição');
    if (identity.bypass === true) report.reasons.push('role atual tem BYPASSRLS — RLS ignorado por definição');
    if (policies.length < RLS_TABLES.length) report.reasons.push('policies ausentes (' + policies.length + '/' + RLS_TABLES.length + ')');
    for (const f of flags) {
      if (!f.relrowsecurity) report.reasons.push('RLS desabilitado em ' + f.relname);
      if (!f.relforcerowsecurity) report.reasons.push('FORCE RLS desligado em ' + f.relname + ' (owner bypassa)');
    }
    for (const table of TABLES) {
      const c = report.counts[table];
      if (c.withUserId !== c.ownerRows) {
        report.reasons.push(table + ': app.user_id viu ' + c.withUserId + ' linhas, esperado ' + c.ownerRows + ' (ownerId=admin)');
      }
      if (c.withBypass < c.withUserId) report.reasons.push(table + ': bypass=on viu MENOS que app.user_id (incoerente)');
    }

    const isolationVisible = TABLES.some((t) => report.counts[t].otherRows > 0);
    if (!isolationVisible) report.reasons.push('aviso: nao ha linhas de outros usuarios no banco — isolamento nao e distinguivel por contagem (teste fraco neste ambiente)');
    if (identity.super === true || identity.bypass === true) report.reasons.push('counts ficam todos iguais (inerte) — ver role acima');

    const hardBlockers = report.reasons.filter((r) => !r.startsWith('aviso:'));
    report.verdict = hardBlockers.length === 0 ? 'ENFORCED' : 'INERTE';
    report.isolationVisible = isolationVisible;

    log('VEREDITO: ' + report.verdict + (hardBlockers.length ? ' — ' + hardBlockers.join('; ') : ' — policies ativas e coerentes'));
    if (report.verdict === 'INERTE') {
      log('para ativar de verdade: role de app SEM rolsuper e SEM rolbypassrls + FORCE RLS (a troca de role/DATABASE_URL e decisao do operador).');
    }

    if (JSON_OUT) console.log(JSON.stringify(report));

    if (!EXPECT) return 0;
    return report.verdict === 'ENFORCED' ? 0 : 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => fail((err && err.message) || String(err)));
