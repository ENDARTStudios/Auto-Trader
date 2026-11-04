#!/usr/bin/env node
// scripts/apply-rls-dev.mjs — aplica (idempotente) as policies de RLS nativas
// no Postgres de DEV, lendo o SQL da migration versionada.
//
// Por que existe: o agente/CI não pode rodar `prisma migrate deploy`. Em DEV, a
// migration prisma/migrations/20260102000000_rls_policies/migration.sql é
// aplicada por este script; em PROD o Lead aplica a migration no deploy.
//
// Uso: node scripts/apply-rls-dev.mjs
// - lê DATABASE_URL do ambiente (ou do .env local, sem imprimir o valor)
// - executa cada statement do SQL na ordem (DROP POLICY IF EXISTS + CREATE +
//   ENABLE/FORCE ROW LEVEL SECURITY são repetíveis)
// - nunca imprime a connection string

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const root = process.cwd();

function loadDatabaseUrlFromDotEnv() {
  if (process.env.DATABASE_URL) return;
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    process.env.DATABASE_URL = match[1].replace(/^["']|["']$/g, '').trim();
    return;
  }
}

function fail(message) {
  console.error('[apply-rls-dev] ERRO: ' + message);
  process.exit(1);
}

loadDatabaseUrlFromDotEnv();
if (!process.env.DATABASE_URL) {
  fail('DATABASE_URL não definido (ambiente nem .env).');
}
if (process.env.DATABASE_URL.startsWith('file:')) {
  fail('DATABASE_URL aponta para SQLite; RLS nativo exige Postgres.');
}

// Migrations de RLS são aplicadas EM ORDEM (fase 1 permissiva → fase 2 strict).
// Sem argumento: todas as migrations cujo diretório casa com /rls/i (ordem
// lexicográfica = ordem cronológica do timestamp). Com argumento: aplica apenas
// a migration com aquele nome de diretório.
const migrationsRoot = join(root, 'prisma', 'migrations');
if (!existsSync(migrationsRoot)) fail('pasta prisma/migrations ausente');

const requested = process.argv[2] ? String(process.argv[2]) : null;
const rlsMigrations = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => /rls/i.test(name))
  .sort();

const toApply = requested ? [requested] : rlsMigrations;
if (toApply.length === 0) fail('nenhuma migration de RLS encontrada em prisma/migrations');

function statementsForMigration(name) {
  const migrationPath = join(migrationsRoot, name, 'migration.sql');
  if (!existsSync(migrationPath)) fail('migration.sql ausente: ' + migrationPath);
  const rawSql = readFileSync(migrationPath, 'utf8');
  // Remove comentários PRIMEIRO (comentários podem conter ';' e confundir o
  // split). O SQL não tem strings literais com '--' nem dollar-quoted blocks.
  const withoutComments = rawSql.replace(/--[^\n]*/g, '');
  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let totalStatements = 0;
try {
  for (const name of toApply) {
    const statements = statementsForMigration(name);
    for (const statement of statements) {
      await client.query(statement);
    }
    totalStatements += statements.length;
    console.log('[apply-rls-dev] ok: ' + name + ' (' + statements.length + ' statements)');
  }
} finally {
  await client.end();
}

console.log(
  '[apply-rls-dev] ok: ' + toApply.length + ' migration(s) / ' + totalStatements + ' statements aplicados (idempotente). ' +
    'Fases 2/3 (rounds 6-7): WalletConnection + NotificationChannel + ExchangeConnection STRICT (sem contexto = 0 linhas); Position ainda fase 1.',
);
