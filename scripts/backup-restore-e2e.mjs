#!/usr/bin/env node
// scripts/backup-restore-e2e.mjs — prova PONTA-A-PONTA de backup/restore com Docker.
//
// Por que Docker: no Windows sem cliente PostgreSQL instalado não existe pg_dump/
// pg_restore nativos, e 'npm run test:ci:local' também não cobre restore. Este E2E
// usa a imagem oficial do Postgres como CLIENTE (pg_dump/pg_restore dentro do
// container), apontando para o Postgres do host via host.docker.internal.
//
// Fluxo (nada em produção é tocado — só o banco de dev como ORIGEM em leitura e um
// banco DESCARTÁVEL como destino):
//   1. lê DATABASE_URL do .env (dotenv) — a senha nunca é impressa;
//   2. cria o banco descartável autotrader_restore_e2e_<pid> no mesmo servidor;
//   3. docker run postgres:<v> pg_dump -Fc -f /dump/db.dump (volume temporário);
//   4. docker run postgres:<v> pg_restore --no-owner --exit-on-error -d <descartável>;
//   5. compara contagem de TODAS as tabelas entre origem e restaurado;
//   6. dropa o banco e remove o tmp (salvo --keep); exit 0 só se tudo bater.
//
// Uso:
//   node scripts/backup-restore-e2e.mjs              # roda e limpa
//   node scripts/backup-restore-e2e.mjs --keep       # mantém banco+tmp p/ depurar
//   node scripts/backup-restore-e2e.mjs --json       # saída para automação
//   node scripts/backup-restore-e2e.mjs --image postgres:16
//
// NUNCA imprime senha (só host/porta/banco/usuário).
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
const JSON_OUT = argv.includes('--json');
function value(name, fallback) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

function log(m) { if (!JSON_OUT) console.log('[backup-e2e] ' + m); }
function fail(m) { console.error('[backup-e2e] FALHOU: ' + m); process.exit(1); }

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) fail('DATABASE_URL ausente — carregue o .env (dotenv) ou exporte a URL.');
let parsed;
try { parsed = new URL(rawUrl); } catch { fail('DATABASE_URL inválida.'); }
if (!/^postgres(ql)?:$/.test(parsed.protocol)) fail('provider nao suportado: ' + parsed.protocol);

const host = parsed.hostname;
const port = parsed.port || '5432';
const user = decodeURIComponent(parsed.username) || 'postgres';
const password = decodeURIComponent(parsed.password);
const sourceDb = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (!sourceDb) fail('DATABASE_URL sem nome de banco.');

const targetDb = 'autotrader_restore_e2e_' + process.pid;
const tmpDir = join(tmpdir(), 'at-backup-e2e-' + process.pid);
const dumpName = 'db.dump';

function withDb(dbName) {
  const u = new URL(rawUrl);
  u.pathname = '/' + dbName;
  return new Client({ connectionString: u.toString() });
}

function docker(args, timeoutMs) {
  return spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs || 300000 });
}

// host.docker.internal aponta para o host no Docker Desktop; host-gateway cobre Linux.
const HOST_ALIAS = ['--add-host=host.docker.internal:host-gateway'];

async function tableCounts(client) {
  const tables = (
    await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1")
  ).rows.map((r) => r.relname);
  const counts = {};
  for (const t of tables) {
    const q = 'SELECT count(*)::int AS n FROM "' + t.replace(/"/g, '""') + '"';
    counts[t] = (await client.query(q)).rows[0].n;
  }
  return counts;
}

async function main() {
  log('origem (leitura): ' + host + ':' + port + '/' + sourceDb + ' user=' + user + ' (senha omitida)');
  const dv = docker(['version', '--format', '{{.Server.Version}}'], 30000);
  if (dv.status !== 0) {
    fail('Docker não está disponível/ligado (' + String(dv.stderr || dv.error || '').trim().slice(0, 200) + '). Ligue o Docker Desktop ou instale pg_dump (PG_DUMP_BIN).');
  }
  log('docker server: ' + String(dv.stdout).trim());

  const admin = withDb('postgres');
  await admin.connect();
  let created = false;
  try {
    await admin.query('DROP DATABASE IF EXISTS "' + targetDb + '" WITH (FORCE)');
    await admin.query('CREATE DATABASE "' + targetDb + '"');
    created = true;
    log('banco descartável criado: ' + targetDb);

    // pgvector: se a origem tem a extensão, a imagem precisa tê-la para o restore.
    const ext = (await admin.query("SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1")).rows.map((r) => r.extname);
    let image = value('image', 'postgres:16');
    if (ext.indexOf('vector') >= 0 && image === 'postgres:16') {
      image = 'pgvector/pgvector:pg16';
      log('origem tem extensão vector — usando imagem ' + image + ' (a postgres:16 não traz pgvector)');
    }
    log('imagem cliente: ' + image + (ext.length ? ' | extensões da origem: ' + ext.join(',') : ''));

    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const volume = tmpDir + ':/dump';

    const commonEnv = [
      '-e', 'PGHOST=host.docker.internal',
      '-e', 'PGPORT=' + port,
      '-e', 'PGUSER=' + user,
      '-e', 'PGPASSWORD=' + password,
    ];

    // Snapshot da origem ANTES do dump. Se o app/engine gravar durante o teste,
    // a tabela muda entre o dump e a comparação — detectamos isso como
    // "volátil" e não fingimos que o restore falhou por causa de escrita concorrente.
    const srcBefore = withDb(sourceDb);
    await srcBefore.connect();
    let countsBefore = {};
    try {
      countsBefore = await tableCounts(srcBefore);
    } finally {
      await srcBefore.end().catch(() => {});
    }

    // --- dump -------------------------------------------------------------
    log('docker pg_dump (Fc) -> ' + dumpName);
    const dump = docker(
      ['run', '--rm', '-v', volume].concat(HOST_ALIAS, commonEnv, [
        '-e', 'PGDATABASE=' + sourceDb,
        // --no-acl: o dump não emite GRANTs para roles de teste que já foram
        // dropadas (ex.: roles efêmeras de testes de RLS), o que faria o restore
        // falhar num cluster onde elas não existem. Ownership/ACL de produção
        // devem ser provisionados pelo runbook (role autotrader_app + grants).
        image, 'pg_dump', '-Fc', '--no-owner', '--no-acl', '--no-password', '-f', '/dump/' + dumpName,
      ]),
    );
    if (dump.status !== 0) {
      console.error((String(dump.stderr || '') + String(dump.stdout || '')).trim().slice(-2500));
      fail('pg_dump (docker) falhou com exit ' + dump.status);
    }
    const dumpPath = join(tmpDir, dumpName);
    if (!existsSync(dumpPath) || statSync(dumpPath).size === 0) fail('dump não foi criado ou está vazio.');
    log('dump ok: ' + statSync(dumpPath).size + ' bytes');

    // --- restore ----------------------------------------------------------
    log('docker pg_restore -> ' + targetDb);
    const restore = docker(
      ['run', '--rm', '-v', volume].concat(HOST_ALIAS, commonEnv, [
        '-e', 'PGDATABASE=' + targetDb,
        image, 'pg_restore', '--no-owner', '--no-password', '--exit-on-error', '--dbname=' + targetDb, '/dump/' + dumpName,
      ]),
    );
    if (restore.status !== 0) {
      console.error((String(restore.stderr || '') + String(restore.stdout || '')).trim().slice(-2500));
      fail('pg_restore (docker) falhou com exit ' + restore.status);
    }
    log('restore ok');

    // --- comparação -------------------------------------------------------
    // Fonte pode estar viva (app/engine): comparamos contra o snapshot pós-dump e
    // tratamos como VOLÁTIL a tabela que mudou entre antes/depois do dump.
    const src = withDb(sourceDb);
    const dst = withDb(targetDb);
    await src.connect();
    await dst.connect();
    let srcCounts;
    let dstCounts;
    try {
      srcCounts = await tableCounts(src);
      dstCounts = await tableCounts(dst);
    } finally {
      await src.end().catch(() => {});
      await dst.end().catch(() => {});
    }
    const srcTables = Object.keys(srcCounts).sort();
    const dstTables = Object.keys(dstCounts).sort();
    const volatileTables = srcTables.filter((t) => countsBefore[t] !== undefined && countsBefore[t] !== srcCounts[t]);
    const missing = srcTables.filter((t) => !(t in dstCounts));
    const extra = dstTables.filter((t) => !(t in srcCounts));
    const mismatched = srcTables.filter(
      (t) => t in dstCounts && srcCounts[t] !== dstCounts[t] && volatileTables.indexOf(t) < 0,
    );
    const volatileMismatched = srcTables.filter(
      (t) => t in dstCounts && srcCounts[t] !== dstCounts[t] && volatileTables.indexOf(t) >= 0,
    );
    const totalSrc = srcTables.reduce((a, t) => a + srcCounts[t], 0);
    const totalDst = dstTables.reduce((a, t) => a + dstCounts[t], 0);

    log('tabelas: origem=' + srcTables.length + ' restaurado=' + dstTables.length);
    log('linhas: origem=' + totalSrc + ' restaurado=' + totalDst + (KEEP ? ' (tabelas comparadas individualmente abaixo)' : ''));
    if (!JSON_OUT) {
      const focus = ['User', 'Config', 'Position', 'Round', 'WalletConnection', 'NotificationChannel', 'TradingBalance', 'PaperOrder'];
      for (const t of focus) if (t in srcCounts || t in dstCounts) log('  ' + t.padEnd(22) + 'origem=' + (srcCounts[t] ?? '-') + ' restaurado=' + (dstCounts[t] ?? '-'));
    }

    const ok = missing.length === 0 && extra.length === 0 && mismatched.length === 0;
    if (volatileTables.length) {
      log('aviso: ' + volatileTables.length + ' tabela(s) mudaram durante o teste (fonte viva) e foram tratadas como VOLÁTEIS: ' + volatileTables.join(', '));
    }
    const report = {
      ok,
      sourceDb,
      targetDb,
      image,
      tables: { source: srcTables.length, restored: dstTables.length },
      rows: { source: totalSrc, restored: totalDst },
      volatile: volatileTables,
      volatileMismatched: volatileMismatched.map((t) => ({ table: t, source: srcCounts[t], restored: dstCounts[t] })),
      missing,
      extra,
      mismatched: mismatched.map((t) => ({ table: t, source: srcCounts[t], restored: dstCounts[t] })),
    };
    if (JSON_OUT) console.log(JSON.stringify(report));
    else if (!ok) {
      if (missing.length) log('  FALTANDO no restaurado: ' + missing.join(', '));
      if (extra.length) log('  SOBRANDO no restaurado: ' + extra.join(', '));
      if (mismatched.length) log('  CONTAGEM DIVERGENTE: ' + report.mismatched.map((m) => m.table + ' ' + m.source + '≠' + m.restored).join(', '));
    }

    if (!ok) {
      if (!KEEP) fail('restore NÃO reproduziu a origem (ver diff acima). Use --keep para investigar.');
      console.error('[backup-e2e] FALHOU mas --keep: banco ' + targetDb + ' e tmp ' + tmpDir + ' preservados.');
      process.exit(1);
    }
    log('PASS: restore íntegro — ' + srcTables.length + ' tabelas / ' + totalSrc + ' linhas idênticas');
    return report;
  } finally {
    if (created && !KEEP) {
      await admin.query('DROP DATABASE IF EXISTS "' + targetDb + '" WITH (FORCE)').catch(() => {});
      log('banco descartável dropado');
    } else if (created && KEEP) {
      log('--keep: banco ' + targetDb + ' preservado');
    }
    await admin.end().catch(() => {});
    if (existsSync(tmpDir) && !KEEP) {
      rmSync(tmpDir, { recursive: true, force: true });
      log('tmp removido');
    } else if (KEEP) {
      log('--keep: tmp preservado em ' + tmpDir + (existsSync(tmpDir) ? ' (' + readdirSync(tmpDir).join(', ') + ')' : ''));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => fail((err && err.message) || String(err)));
