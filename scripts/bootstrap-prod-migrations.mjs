#!/usr/bin/env node
// scripts/bootstrap-prod-migrations.mjs — cria/registra o histórico do Prisma
// Migrate em um banco cujo SCHEMA já existe (produção Neon/Railway que nasceu com
// `prisma db push` antes do baseline versionado).
//
// Por que existe: `prisma migrate deploy`/`status` falha em produção com P3005
// ('The database schema is not empty') porque `_prisma_migrations` não existe.
// Este script registra as migrations locais como JÁ APLICADAS — não executa o SQL
// delas (o schema já está no banco, validado pelo gate de drift abaixo).
//
// Segurança:
//   - DRY-RUN por padrão (não escreve nada); só grava com --yes;
//   - antes de escrever roda `prisma migrate diff --from-config-datasource
//     --to-schema prisma/schema.prisma --exit-code` e ABORTA se houver drift (exit 2);
//   - se `_prisma_migrations` já existe, apenas COMPARA (idempotente: nunca altera
//     registro existente; checksum divergente é conflito e aborta);
//   - nunca imprime DATABASE_URL/credenciais.
//
// Uso:
//   node scripts/bootstrap-prod-migrations.mjs            # dry-run (mostra plano)
//   node scripts/bootstrap-prod-migrations.mjs --yes      # grava o histórico
//   node scripts/bootstrap-prod-migrations.mjs --json     # saída para automação
// `import 'dotenv/config'`: carrega .env local quando existir (dotenv NUNCA
// sobrescreve variável já presente no ambiente, então em produção os secrets do
// runtime prevalecem).
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const MIGRATIONS_DIR = 'prisma/migrations';
export const MIGRATIONS_TABLE = '_prisma_migrations';

// DDL equivalente à tabela que o Prisma Migrate cria (VARCHAR(36) pk, checksum
// VARCHAR(64), timestamps com timezone). IF NOT EXISTS garante idempotência.
export const CREATE_MIGRATIONS_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS "' + MIGRATIONS_TABLE + '" (' +
  '"id" VARCHAR(36) PRIMARY KEY NOT NULL, ' +
  '"checksum" VARCHAR(64) NOT NULL, ' +
  '"finished_at" TIMESTAMPTZ, ' +
  '"migration_name" VARCHAR(255) NOT NULL, ' +
  '"logs" TEXT, ' +
  '"rolled_back_at" TIMESTAMPTZ, ' +
  '"started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), ' +
  '"applied_steps_count" INTEGER NOT NULL DEFAULT 0' +
  ')';

/** Prisma usa sha256 hex do CONTEÚDO exato do migration.sql. */
export function computeChecksum(sqlContent) {
  return createHash('sha256').update(sqlContent, 'utf8').digest('hex');
}

export function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

// Split por ';' respeitando aspas simples/duplas e blocos $$...$$ (funções).
export function splitStatements(sql) {
  const clean = stripSqlComments(sql);
  const out = [];
  let cur = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inDollar = false;
  while (i < clean.length) {
    const ch = clean[i];
    if (!inSingle && !inDouble && !inDollar && ch === '$' && clean[i + 1] === '$') {
      inDollar = true;
      cur += '$$';
      i += 2;
      continue;
    }
    if (inDollar && ch === '$' && clean[i + 1] === '$') {
      inDollar = false;
      cur += '$$';
      i += 2;
      continue;
    }
    if (!inDollar && !inDouble && ch === "'") inSingle = !inSingle;
    else if (!inDollar && !inSingle && ch === '"') inDouble = !inDouble;
    if (ch === ';' && !inSingle && !inDouble && !inDollar) {
      const stmt = cur.trim();
      if (stmt) out.push(stmt);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

/** applied_steps_count: quantos statements a migration contém. */
export function countStatements(sqlContent) {
  return splitStatements(sqlContent).length;
}

/** Lê prisma/migrations/<nome>/migration.sql em ordem de nome. */
export function discoverMigrations(baseDir = MIGRATIONS_DIR) {
  const dir = resolve(baseDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => {
      const sql = join(dir, name, 'migration.sql');
      return existsSync(sql);
    })
    .sort()
    .map((name) => {
      const content = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
      return {
        migration_name: name,
        checksum: computeChecksum(content),
        applied_steps_count: countStatements(content),
      };
    });
}

/**
 * Plano puro (testável): compara migrations locais com registros existentes.
 * Retorna { tableExists, action, toInsert, matched, conflicts }.
 *   - tabela ausente            -> action 'create' (insere tudo)
 *   - tudo já registrado igual  -> action 'noop'
 *   - migration local sem linha -> action 'insert' (pendente de registro)
 *   - mesmo nome, checksum diff -> conflict (aborta; nada é alterado)
 */
export function planRows(migrations, existingRows, options = {}) {
  const tableExists = Boolean(options.tableExists);
  const makeId = options.makeId || (() => randomUUID());
  const now = options.now || (() => new Date().toISOString());
  const existing = new Map((existingRows || []).map((r) => [r.migration_name, r]));
  const toInsert = [];
  const matched = [];
  const conflicts = [];
  for (const m of migrations) {
    const row = existing.get(m.migration_name);
    if (row) {
      if (row.checksum !== m.checksum) {
        conflicts.push({ migration_name: m.migration_name, expected: m.checksum, found: row.checksum });
      } else {
        matched.push(m.migration_name);
      }
      continue;
    }
    toInsert.push({
      id: makeId(),
      checksum: m.checksum,
      migration_name: m.migration_name,
      applied_steps_count: m.applied_steps_count,
      started_at: now(),
      finished_at: now(),
      logs: null,
      rolled_back_at: null,
    });
  }
  let action = 'noop';
  if (conflicts.length) action = 'conflict';
  else if (!tableExists && toInsert.length) action = 'create';
  else if (toInsert.length) action = 'insert';
  return { tableExists, action, toInsert, matched, conflicts };
}

export function formatPlan(plan) {
  const lines = [];
  lines.push('[bootstrap-prod-migrations] tabela ' + MIGRATIONS_TABLE + ': ' + (plan.tableExists ? 'JÁ EXISTE' : 'AUSENTE'));
  lines.push('[bootstrap-prod-migrations] acao planejada: ' + plan.action);
  for (const name of plan.matched) lines.push('  = já registrada (checksum ok): ' + name);
  for (const row of plan.toInsert) {
    lines.push('  + registrar: ' + row.migration_name + ' (' + row.applied_steps_count + ' statements, checksum ' + row.checksum.slice(0, 12) + '…)');
  }
  for (const c of plan.conflicts) {
    lines.push('  ! CONFLITO ' + c.migration_name + ': banco=' + String(c.found).slice(0, 12) + '… local=' + String(c.expected).slice(0, 12) + '…');
  }
  return lines.join('\n');
}

function fail(message) {
  console.error('[bootstrap-prod-migrations] ABORTADO: ' + message);
  process.exit(1);
}

async function main(argv) {
  const YES = argv.includes('--yes');
  const JSON_OUT = argv.includes('--json');

  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL ausente no ambiente.');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail('DATABASE_URL inválida (nao e URL).');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) fail('provider nao suportado: ' + parsed.protocol);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  const migrations = discoverMigrations();
  if (!migrations.length) fail('nenhuma migration encontrada em ' + MIGRATIONS_DIR);

  const prismaCli = resolve('node_modules/prisma/build/index.js');
  if (!existsSync(prismaCli)) fail('prisma CLI nao encontrado (npm ci).');

  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const tableExists = (
      await client.query("SELECT to_regclass('public.' || $1) AS reg", [MIGRATIONS_TABLE])
    ).rows[0].reg !== null;

    let existingRows = [];
    if (tableExists) {
      existingRows = (
        await client.query('SELECT migration_name, checksum FROM "' + MIGRATIONS_TABLE + '" ORDER BY migration_name')
      ).rows;
    }

    const plan = planRows(migrations, existingRows, { tableExists });

    if (!JSON_OUT) {
      console.log('[bootstrap-prod-migrations] banco: ' + parsed.hostname + ':' + (parsed.port || '5432') + '/' + dbName + ' (credenciais omitidas)');
      console.log('[bootstrap-prod-migrations] migrations locais: ' + migrations.map((m) => m.migration_name).join(', '));
      console.log(formatPlan(plan));
    }

    if (plan.action === 'conflict') {
      if (JSON_OUT) console.log(JSON.stringify({ ok: false, action: plan.action, conflicts: plan.conflicts }));
      fail('checksum divergente entre banco e repositorio — NADA foi alterado. Investigue antes (banco pode ter migration editada).');
    }

    if (plan.action === 'noop') {
      if (JSON_OUT) console.log(JSON.stringify({ ok: true, action: 'noop', matches: plan.matched }));
      else console.log('[bootstrap-prod-migrations] idempotente: historico ja registrado, nada a fazer.');
      return 0;
    }

    // --- gate de drift: schema real x schema.prisma -----------------------
    const diff = spawnSync(process.execPath, [prismaCli, 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'], { encoding: 'utf8' });
    const diffOut = (String(diff.stdout || '') + String(diff.stderr || '')).trim();
    if (diff.status === 2) {
      if (JSON_OUT) console.log(JSON.stringify({ ok: false, action: 'drift', detail: diffOut.slice(-1500) }));
      console.error(diffOut.split('\n').slice(-25).join('\n'));
      fail('DRIFT detectado (schema do banco != prisma/schema.prisma). Registrar migrations sem aplicar o schema esconderia divergencia — aborte e resolva o schema primeiro.');
    }
    if (diff.status !== 0) {
      console.error(diffOut.split('\n').slice(-15).join('\n'));
      fail('nao foi possivel avaliar drift (exit ' + diff.status + ').');
    }
    if (!JSON_OUT) console.log('[bootstrap-prod-migrations] gate de drift: OK (schema bate com prisma/schema.prisma)');

    if (!YES) {
      if (JSON_OUT) console.log(JSON.stringify({ ok: true, dryRun: true, action: plan.action, wouldInsert: plan.toInsert.map((r) => r.migration_name) }));
      else console.log('[bootstrap-prod-migrations] DRY-RUN: nada foi escrito. Adicione --yes para gravar o historico.');
      return 0;
    }

    // --- escrita (transacional) -------------------------------------------
    await client.query('BEGIN');
    try {
      await client.query(CREATE_MIGRATIONS_TABLE_SQL);
      for (const row of plan.toInsert) {
        await client.query(
          'INSERT INTO "' + MIGRATIONS_TABLE + '" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [row.id, row.checksum, row.finished_at, row.migration_name, row.logs, row.rolled_back_at, row.started_at, row.applied_steps_count],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      fail('falha ao gravar historico: ' + ((err && err.message) || err));
    }

    const count = (await client.query('SELECT COUNT(*)::int AS n FROM "' + MIGRATIONS_TABLE + '"')).rows[0].n;
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, inserted: plan.toInsert.map((r) => r.migration_name), totalRows: count }));
    else console.log('[bootstrap-prod-migrations] OK: ' + plan.toInsert.length + ' migration(s) registrada(s); total na tabela: ' + count);
    return 0;
  } finally {
    await client.end().catch(() => {});
  }
}

// Só executa quando chamado direto (os helpers acima são importados pelo teste).
const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((err) => fail((err && err.message) || String(err)));
}
