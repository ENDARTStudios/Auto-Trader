#!/usr/bin/env node
// scripts/backup-full.mjs
//
// Backup REAL do Postgres: pg_dump --format=custom (comprimido, restaurável com
// pg_restore, permite restore seletivo) + retenção por dias + checksum SHA-256.
//
// Diferenças em relação ao antigo scripts/backup-db.sh (SQLite .dump):
//   - funciona no provider atual (postgresql);
//   - a senha NUNCA aparece na linha de comando (vai via PGPASSWORD), então não
//     vaza em `ps`/histórico de shell/log de CI;
//   - falha alto se pg_dump não existir / dump sair vazio;
//   - retenção nunca apaga o último backup íntegro.
//
// Uso:
//   node scripts/backup-full.mjs --check          # valida binário+config, sem dump
//   node scripts/backup-full.mjs --dry-run        # imprime o plano
//   node scripts/backup-full.mjs                  # executa (BACKUP_DIR, BACKUP_RETENTION_DAYS)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const DRY_RUN = args.includes('--dry-run');
const DIR = resolve(process.env.BACKUP_DIR || 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 7);
const PREFIX = 'auto-trader-';

function log(m) { console.log('[backup-full] ' + m); }
function fail(m) { console.error('[backup-full] ERRO: ' + m); process.exit(1); }

// --- conexão: parse sem jamais imprimir a senha ---------------------------
function parseDbUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { fail('DATABASE_URL inválida (não é uma URL)'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) fail('provider nao suportado: ' + u.protocol + ' (esperado postgresql://)');
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!db) fail('DATABASE_URL sem nome de banco');
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username) || process.env.PGUSER || 'postgres',
    password: decodeURIComponent(u.password),
    database: db,
  };
}

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) fail('DATABASE_URL ausente — passe via ambiente (nunca hardcode).');
const conn = parseDbUrl(rawUrl);
const pgEnv = Object.assign({}, process.env, {
  PGHOST: conn.host,
  PGPORT: conn.port,
  PGUSER: conn.user,
  PGDATABASE: conn.database,
});
if (conn.password) pgEnv.PGPASSWORD = conn.password;

if (CHECK) {
  const which = spawnSync('pg_dump', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const ok = which.status === 0;
  log('host=' + conn.host + ' port=' + conn.port + ' db=' + conn.database + ' user=' + conn.user + ' (senha omitida)');
  log('pg_dump: ' + (ok ? String(which.stdout).trim() : 'NAO ENCONTRADO no PATH'));
  log('destino=' + DIR + ' retencao=' + RETENTION_DAYS + 'd');
  if (!ok) fail('instale o cliente PostgreSQL (pg_dump) para habilitar backup real.');
  log('check ok');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', 'Z');
const file = join(DIR, PREFIX + stamp + '.dump');

if (DRY_RUN) {
  log('dry-run: pg_dump --format=custom --file=' + file + ' (host=' + conn.host + ' port=' + conn.port + ' db=' + conn.database + ')');
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });
log('dump de ' + conn.database + '@' + conn.host + ':' + conn.port + ' -> ' + file);
const dump = spawnSync(
  'pg_dump',
  ['--format=custom', '--no-password', '--file=' + file],
  { env: pgEnv, encoding: 'utf8', shell: process.platform === 'win32' },
);
if (dump.status !== 0) {
  console.error(String(dump.stderr || '').trim().slice(-2000));
  fail('pg_dump falhou com exit ' + dump.status);
}
if (!existsSync(file) || statSync(file).size === 0) fail('dump gerado está vazio: ' + file);

const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(file + '.sha256', sha + '  ' + file + '\n');
log('ok: ' + statSync(file).size + ' bytes, sha256=' + sha.slice(0, 16) + '…');

// --- retenção (nunca remove o backup mais recente) -----------------------
const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
const dumps = readdirSync(DIR)
  .filter((f) => f.indexOf(PREFIX) === 0 && f.endsWith('.dump'))
  .map((f) => ({ f: f, t: statSync(join(DIR, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
let removed = 0;
for (let i = 1; i < dumps.length; i++) {
  if (dumps[i].t < cutoff) {
    unlinkSync(join(DIR, dumps[i].f));
    const shaFile = join(DIR, dumps[i].f + '.sha256');
    if (existsSync(shaFile)) unlinkSync(shaFile);
    removed++;
  }
}
log('retenção: ' + removed + ' backup(s) removido(s); ' + Math.max(0, dumps.length - removed) + ' mantido(s)');
