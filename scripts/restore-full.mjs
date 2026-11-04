#!/usr/bin/env node
// scripts/restore-full.mjs
//
// Restore de um dump pg_dump --format=custom gerado por scripts/backup-full.mjs.
// É DESTRUTIVO por natureza: por isso exige --yes e recusa bancos que pareçam
// produção sem --allow-production.
//
// Uso:
//   node scripts/restore-full.mjs --check --file backups/x.dump
//   node scripts/restore-full.mjs --file backups/x.dump --yes [--allow-production]
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
function flag(name) { return argv.includes('--' + name); }
function value(name) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}
function log(m) { console.log('[restore-full] ' + m); }
function fail(m) { console.error('[restore-full] ERRO: ' + m); process.exit(1); }

// Binário configurável (ver backup-full.mjs). No Windows sem cliente PostgreSQL,
// use PG_RESTORE_BIN ou o E2E via Docker: node scripts/backup-restore-e2e.mjs.
const PG_RESTORE_BIN = process.env.PG_RESTORE_BIN || 'pg_restore';
const USING_CUSTOM_BIN = Boolean(process.env.PG_RESTORE_BIN);
const MISSING_BIN_HINT =
  'pg_restore não encontrado. Opções: (a) instale o cliente PostgreSQL e/ou defina ' +
  'PG_RESTORE_BIN=/caminho/pg_restore(.exe); (b) no Windows sem cliente, use o E2E via ' +
  'Docker: node scripts/backup-restore-e2e.mjs.';

const file = value('file');
if (!file) fail('informe --file <dump> (gerado por scripts/backup-full.mjs)');
const dumpPath = resolve(file);
if (!existsSync(dumpPath)) fail('dump não encontrado: ' + dumpPath);
const size = statSync(dumpPath).size;
if (size === 0) fail('dump está vazio: ' + dumpPath);

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) fail('DATABASE_URL ausente — passe via ambiente.');
let u;
try { u = new URL(rawUrl); } catch { fail('DATABASE_URL inválida'); }
if (!/^postgres(ql)?:$/.test(u.protocol)) fail('provider nao suportado: ' + u.protocol);
const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
const looksProduction =
  /\b(prod|production)\b/i.test(database) ||
  /railway\.internal|neon\.tech|supabase|rds\.amazonaws/i.test(u.hostname) ||
  process.env.NODE_ENV === 'production';

log('alvo: ' + u.hostname + ':' + (u.port || '5432') + '/' + database + ' (senha omitida)');
log('dump: ' + dumpPath + ' (' + size + ' bytes)');
log('alvo parece PRODUCAO: ' + (looksProduction ? 'SIM' : 'nao'));

if (flag('check')) {
  const which = spawnSync(PG_RESTORE_BIN, ['--version'], {
    encoding: 'utf8',
    shell: USING_CUSTOM_BIN ? false : process.platform === 'win32',
  });
  log('pg_restore: ' + PG_RESTORE_BIN + ' -> ' + (which.status === 0 ? String(which.stdout).trim() : 'NAO ENCONTRADO/executável'));
  if (which.status !== 0) fail(MISSING_BIN_HINT);
  log('check ok — nada foi escrito');
  process.exit(0);
}

if (!flag('yes')) fail('restore é destrutivo: repita com --yes após conferir o alvo acima.');
if (looksProduction && !flag('allow-production')) {
  fail(
    'o alvo parece producao. Confirme explicitamente com --allow-production ' +
      'e garanta que um backup atual existe antes de sobrescrever.',
  );
}

const env = Object.assign({}, process.env);
delete env.PGPASSWORD;
if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
env.PGHOST = u.hostname;
env.PGPORT = u.port || '5432';
env.PGUSER = decodeURIComponent(u.username) || process.env.PGUSER || 'postgres';
env.PGDATABASE = database;

log('iniciando pg_restore...');
const res = spawnSync(
  PG_RESTORE_BIN,
  ['--no-password', '--no-owner', '--exit-on-error', '--dbname=' + database, dumpPath],
  { env: env, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'], shell: USING_CUSTOM_BIN ? false : process.platform === 'win32' },
);
if (res.error && res.error.code === 'ENOENT') fail(MISSING_BIN_HINT);
if (res.status !== 0) fail('pg_restore (' + PG_RESTORE_BIN + ') falhou com exit ' + res.status);
log('restore concluído. Valide com: curl -fsS <base>/api/health/ready');
