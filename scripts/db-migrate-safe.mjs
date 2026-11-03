#!/usr/bin/env node
// scripts/db-migrate-safe.mjs
//
// Aplica migracoes Prisma em um banco que pode ja existir e estar populado —
// o caso real de producao depois de meses de prisma db push (nenhuma linha em
// _prisma_migrations). Algoritmo (nunca destrutivo, nunca chuta):
//
//   1. Banco vazio  -> prisma migrate deploy (aplica o baseline do zero).
//   2. Banco cheio e ja migrado (status OK) -> nada a fazer.
//   3. Banco cheio, sem migrations aplicadas, mas schema == schema.prisma
//      (diff exit 0) -> prisma migrate resolve --applied <baseline> e depois
//      migrate deploy para as migracoes posteriores ao baseline.
//   4. Banco cheio e divergente -> ABORTA. Baselinear um banco divergente
//      esconderia drift; a correcao e humana.
//
// Uso:
//   node scripts/db-migrate-safe.mjs            # executa
//   node scripts/db-migrate-safe.mjs --dry-run  # so imprime o plano
//
// Requer DATABASE_URL no ambiente (nunca e impressa).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE = '20260101000000_baseline';
const DRY_RUN = process.argv.includes('--dry-run');

function log(msg) {
  console.log('[db-migrate-safe] ' + msg);
}
function fail(msg) {
  console.error('[db-migrate-safe] ABORTADO: ' + msg);
  process.exit(1);
}

// Resolve o CLI do próprio projeto e chama via node (sem shell => sem DEP0190
// e sem risco de escape de argumentos).
const LOCAL_PRISMA_CLI = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

function prisma(args, opts) {
  const allowFailure = opts && opts.allowFailure;
  const res = existsSync(LOCAL_PRISMA_CLI)
    ? spawnSync(process.execPath, [LOCAL_PRISMA_CLI].concat(args), { encoding: 'utf8' })
    : spawnSync('npx', ['prisma'].concat(args), {
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
  const out = String(res.stdout || '') + String(res.stderr || '');
  if (!allowFailure && res.status !== 0) {
    console.error(out.trim());
    fail('prisma ' + args.join(' ') + ' falhou (exit ' + res.status + ')');
  }
  return { status: res.status === null ? 1 : res.status, out: out };
}

if (!process.env.DATABASE_URL) {
  fail('DATABASE_URL ausente no ambiente (este script nunca usa default silencioso).');
}
const scheme = process.env.DATABASE_URL.split(':')[0];
if (scheme.indexOf('postgres') !== 0) {
  fail('provider nao suportado: ' + scheme + '://... (esperado postgresql://)');
}

// --- 1. O banco tem algum objeto de schema? -------------------------------
// --to-empty: exit 0 = banco vazio; exit 2 = banco com objetos; 1 = erro.
const emptiness = prisma(
  ['migrate', 'diff', '--from-config-datasource', '--to-empty', '--exit-code'],
  { allowFailure: true },
);
let dbHasObjects;
if (emptiness.status === 0) dbHasObjects = false;
else if (emptiness.status === 2) dbHasObjects = true;
else {
  console.error(emptiness.out.trim().slice(-2000));
  fail('nao foi possivel inspecionar o banco (exit inesperado do migrate diff)');
}
log('banco ' + (dbHasObjects ? 'JA TEM objetos (provavel banco populado)' : 'esta vazio'));

if (!dbHasObjects) {
  log(DRY_RUN ? 'planejado: prisma migrate deploy' : 'aplicando: prisma migrate deploy');
  if (!DRY_RUN) prisma(['migrate', 'deploy']);
  log('concluido: banco criado a partir das migracoes');
  process.exit(0);
}

// --- 2. Banco cheio: as migracoes ja estao aplicadas? ---------------------
const status = prisma(['migrate', 'status'], { allowFailure: true });
const upToDate = /Database schema is up to date/i.test(status.out);
const notApplied = /not yet been applied/i.test(status.out);

if (upToDate) {
  log('banco cheio e migracoes ja aplicadas — nada a fazer');
  process.exit(0);
}
if (!notApplied) {
  console.error(status.out.trim());
  fail('prisma migrate status retornou estado nao reconhecido — inspecao manual necessaria');
}

// --- 3. Banco cheio sem baseline: so baselinar se NAO houver drift --------
const drift = prisma(
  ['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'],
  { allowFailure: true },
);
if (drift.status !== 0) {
  console.error(drift.out.trim().slice(-2000));
  fail(
    'banco populado DIVERGE de prisma/schema.prisma. Baselinear agora esconderia drift. ' +
      'Inspecione o diff acima e decida (migracao manual / restore) antes de rodar este script.',
  );
}

log('banco cheio, sem drift, sem migrations registradas — marcando ' + BASELINE + ' como aplicada');
if (!DRY_RUN) {
  prisma(['migrate', 'resolve', '--applied', BASELINE]);
  // Aplica qualquer migracao posterior ao baseline (idempotente).
  prisma(['migrate', 'deploy']);
}
log('concluido: baseline registrado e migracoes pendentes aplicadas');
