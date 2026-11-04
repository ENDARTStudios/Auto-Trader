#!/usr/bin/env node
// scripts/lib/require-bypass-rls.mjs — guard para SCRIPTS DE MANUTENÇÃO sob RLS.
//
// Contexto (rodada 8): o app roda com role `autotrader_app` (NOBYPASSRLS) e as
// tabelas Position/WalletConnection/ExchangeConnection/NotificationChannel estão
// STRICT. Um script de manutenção (seed, limpeza, backfill, reset) rodando com
// esse role vê ZERO linhas e os DELETEs/UPDATEs silenciosamente não fazem nada
// (ou falham por policy) — falha silenciosa é o pior desfecho possível.
//
// Regra: script de manutenção que toca tabela com RLS exige um role com
// BYPASSRLS (owner do banco ou role dedicada de operação). No RUNTIME do app,
// a alternativa correta é `withSystemRls` (GUC app.rls_bypass='on'), nunca
// rodar como app role.
//
// Uso como biblioteca:
//   import { requireBypassRls } from './lib/require-bypass-rls.mjs';
//   await requireBypassRls({ context: 'seed-demo' });   // aborta (exit 1) se não tiver bypass
//
// Uso como CLI:
//   node scripts/lib/require-bypass-rls.mjs            # exit 0 = pode rodar
//   node scripts/lib/require-bypass-rls.mjs --json     # saída para automação
//   node scripts/lib/require-bypass-rls.mjs --check    # idem (alias semântico)
//
// NUNCA imprime DATABASE_URL/credenciais (só host/db/role).
import 'dotenv/config';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

export const BRIDGE_HINT =
  'Use DATABASE_URL do OWNER do banco (ou de um role com BYPASSRLS) para scripts de manutenção. ' +
  'No runtime do app, o caminho correto é withSystemRls (src/lib/auth/rls-context.ts) — ' +
  'nunca dependa do app role (NOBYPASSRLS) para seed/limpeza/backfill.';

export function isPostgresUrl(url) {
  return typeof url === 'string' && /^postgres(ql)?:\/\//.test(url);
}

/**
 * Decisão pura (testável): pode rodar manutenção que toca tabela com RLS?
 * Exige Postgres + role que NÃO seja... na verdade exige bypass: rolsuper OU
 * rolbypassrls. As duas propriedades fazem o Postgres ignorar policies.
 */
export function evaluateBypassRole(attrs) {
  const user = attrs && attrs.currentUser ? String(attrs.currentUser) : null;
  const isSuper = Boolean(attrs && attrs.rolsuper);
  const bypass = Boolean(attrs && attrs.rolbypassrls);
  const allowed = isSuper || bypass;
  return {
    allowed,
    currentUser: user,
    rolsuper: isSuper,
    rolbypassrls: bypass,
    code: allowed ? 'OK' : 'RLS_BYPASS_REQUIRED',
    reason: allowed
      ? 'role tem ' + (isSuper ? 'SUPERUSER' : 'BYPASSRLS') + ' — policies de RLS não se aplicam (mantenção pode operar)'
      : 'role ' + (user || '(desconhecido)') + ' NÃO tem SUPERUSER nem BYPASSRLS — RLS strict faria o script ver 0 linhas e falhar silenciosamente',
  };
}

/** Lê o role real do banco (sem imprimir segredo). Lança em erro de conexão. */
export async function checkBypassRls(databaseUrl) {
  const url = databaseUrl || process.env.DATABASE_URL;
  if (!url) {
    return { allowed: false, code: 'DATABASE_URL_MISSING', reason: 'DATABASE_URL ausente no ambiente', currentUser: null, rolsuper: false, rolbypassrls: false };
  }
  if (!isPostgresUrl(url)) {
    // SQLite legado (file:...) não tem RLS — permitido, mas avisado. Qualquer
    // outro scheme é recusado (não sabemos checar bypass).
    const scheme = String(url).split(':')[0];
    if (scheme === 'file') {
      return {
        allowed: true,
        code: 'SQLITE_NO_RLS',
        reason: 'banco SQLite legado (file:) — não existe RLS; guard não se aplica',
        warning: 'rodando contra SQLite legado: ok para dev, NUNCA use para dados de produção',
        currentUser: null,
        rolsuper: false,
        rolbypassrls: false,
      };
    }
    return {
      allowed: false,
      code: 'NOT_POSTGRES',
      reason: 'DATABASE_URL nao e Postgres (' + scheme + '://…)',
      currentUser: null,
      rolsuper: false,
      rolbypassrls: false,
    };
  }
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const row = (
      await client.query(
        'SELECT current_user AS u, current_database() AS d, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass',
      )
    ).rows[0];
    const parsed = new URL(url);
    return {
      ...evaluateBypassRole({ currentUser: row.u, rolsuper: row.super, rolbypassrls: row.bypass }),
      database: parsed.hostname + ':' + (parsed.port || '5432') + '/' + decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      dbUser: row.u,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Guard para scripts de manutenção. Aborta o processo (exit 1) com mensagem
 * acionável quando o role atual não pode operar sob RLS strict.
 * `context` entra na mensagem (ex.: 'seed-demo').
 */
export async function requireBypassRls(options = {}) {
  const context = options.context || 'manutencao';
  const quiet = Boolean(options.quiet);
  let result;
  try {
    result = await checkBypassRls(options.databaseUrl);
  } catch (err) {
    console.error('[rls-guard:' + context + '] FALHA ao verificar role: ' + ((err && err.message) || err));
    console.error('[rls-guard:' + context + '] ' + BRIDGE_HINT);
    process.exit(1);
  }
  if (result.allowed) {
    if (!quiet) {
      console.log(
        '[rls-guard:' + context + '] OK — role ' + result.currentUser + ' (' + (result.rolsuper ? 'SUPERUSER' : 'BYPASSRLS') + ') pode operar em tabelas com RLS',
      );
    }
    return result;
  }
  console.error('[rls-guard:' + context + '] ABORTADO: ' + result.reason);
  if (result.code === 'RLS_BYPASS_REQUIRED') {
    console.error('[rls-guard:' + context + '] ' + BRIDGE_HINT);
    console.error('[rls-guard:' + context + '] tabelas com RLS: Position, WalletConnection, ExchangeConnection, NotificationChannel');
  }
  process.exit(1);
}

async function main(argv) {
  const JSON_OUT = argv.includes('--json');
  const result = await checkBypassRls();
  if (JSON_OUT) {
    console.log(JSON.stringify({ ...result, checkedAt: new Date().toISOString() }));
  } else {
    console.log('[rls-guard] banco: ' + (result.database || '(nao conectado)'));
    console.log('[rls-guard] role: ' + (result.currentUser || '(desconhecido)') + ' (superuser=' + result.rolsuper + ', bypassrls=' + result.rolbypassrls + ')');
    console.log('[rls-guard] ' + (result.allowed ? 'OK — pode rodar scripts de manutenção' : 'ABORTADO: ' + result.reason));
    if (!result.allowed && result.code === 'RLS_BYPASS_REQUIRED') console.log('[rls-guard] ' + BRIDGE_HINT);
  }
  return result.allowed ? 0 : 1;
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[rls-guard] ERRO: ' + ((err && err.message) || err));
      process.exit(1);
    });
}
