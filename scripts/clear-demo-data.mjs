#!/usr/bin/env node
// scripts/clear-demo-data.mjs — remove os dados DEMO criados por scripts/seed-demo.ts.
//
// DEFAULT É DRY-RUN: mostra o que seria apagado e não escreve nada. Para apagar de
// verdade use --yes. Nunca use em produção sem --allow-production.
//
// Uso:
//   node scripts/clear-demo-data.mjs                 # dry-run (só conta)
//   node scripts/clear-demo-data.mjs --yes           # apaga
//   node scripts/clear-demo-data.mjs --json          # saída para automação
//   NODE_ENV=production node scripts/clear-demo-data.mjs --yes --allow-production
//
// Regras de segurança:
//   - exige DATABASE_URL no ambiente (nunca default silencioso);
//   - NODE_ENV=production exige --allow-production explícito;
//   - imprime contagens antes/depois por tabela;
//   - os IDs vêm de scripts/lib/demo-ids.mjs (fonte: scripts/seed-demo.ts).
import "dotenv/config";
import { createRequire } from "node:module";
import { DEMO_RANGES, DEMO_TABLES, buildCountSql, buildDeleteSql, demoDeleteSpec, totalCounts } from "./lib/demo-ids.mjs";
import { requireBypassRls } from "./lib/require-bypass-rls.mjs";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const argv = process.argv.slice(2);
const YES = argv.includes("--yes");
const JSON_OUT = argv.includes("--json");
const ALLOW_PROD = argv.includes("--allow-production");

function fail(message) {
  console.error("[clear-demo-data] ERRO: " + message);
  process.exit(1);
}

if (!process.env.DATABASE_URL) fail("DATABASE_URL ausente — exporte a URL do banco (nunca use default).");
if (process.env.NODE_ENV === "production" && !ALLOW_PROD) {
  fail("NODE_ENV=production sem --allow-production. Abortado por segurança.");
}

const url = new URL(process.env.DATABASE_URL);
if (!/^postgres(ql)?:$/.test(url.protocol)) fail("provider nao suportado: " + url.protocol + " (esperado postgresql://)");
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
const target = url.hostname + ":" + (url.port || "5432") + "/" + database;

const spec = demoDeleteSpec();
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function countAll() {
  const out = {};
  for (const table of DEMO_TABLES) {
    const q = buildCountSql(table, spec[table]);
    const res = await client.query(q.text, q.values);
    out[table] = res.rows[0].n;
  }
  return out;
}

async function main() {
  // Guard: DELETE em Position (RLS strict) com app role (NOBYPASSRLS) apagaria 0
  // linhas silenciosamente — aborta com instrução antes de qualquer operação.
  await requireBypassRls({ context: "clear-demo-data" });
  await client.connect();
  const before = await countAll();

  if (JSON_OUT) {
    if (!YES) {
      console.log(JSON.stringify({ dryRun: true, target, before, total: totalCounts(before) }));
      return;
    }
  } else {
    console.log("[clear-demo-data] alvo: " + target + (url.password ? " (senha omitida)" : ""));
    console.log("[clear-demo-data] modo: " + (YES ? "APAGAR" : "DRY-RUN (use --yes para apagar)"));
    console.log("[clear-demo-data] faixas/prefixos (fonte: scripts/seed-demo.ts):");
    for (const table of DEMO_TABLES) {
      const s = spec[table];
      const desc = s.kind === "prefix" ? s.column + " LIKE '" + s.value + "%'" : s.column + " em [" + s.lo + ".." + s.hi + "]";
      console.log("  - " + table.padEnd(20) + desc);
    }
    console.log("[clear-demo-data] contagem ANTES:", JSON.stringify(before), "total=" + totalCounts(before));
  }

  if (!YES) {
    if (!JSON_OUT) console.log("[clear-demo-data] dry-run: nada foi apagado.");
    return;
  }

  const after = {};
  for (const table of DEMO_TABLES) {
    const q = buildDeleteSql(table, spec[table]);
    const res = await client.query(q.text, q.values);
    after[table] = { deleted: res.rowCount, remaining: (await client.query(buildCountSql(table, spec[table]))).rows[0].n };
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ dryRun: false, target, before, after, totalBefore: totalCounts(before) }));
  } else {
    console.log("[clear-demo-data] resultado:");
    for (const table of DEMO_TABLES) {
      console.log("  - " + table.padEnd(20) + " apagados=" + String(after[table].deleted).padStart(5) + "  restantes=" + after[table].remaining);
    }
    const remaining = DEMO_TABLES.reduce((acc, t) => acc + after[t].remaining, 0);
    console.log("[clear-demo-data] total apagado=" + DEMO_TABLES.reduce((acc, t) => acc + after[t].deleted, 0) + " | demo restante=" + remaining);
    if (remaining > 0) console.warn("[clear-demo-data] AVISO: sobrou linha demo (rode de novo ou investigue IDs fora do padrão).");
  }
}

main()
  .catch((err) => {
    fail((err && err.message) || String(err));
  })
  .finally(async () => {
    await client.end().catch(() => {});
  });

// NOTA: AIInsight/PositionAlert não são criados por scripts/seed-demo.ts (verificado
// no arquivo), então não há o que limpar lá; se um novo seed criar, adicione a faixa
// em DEMO_RANGES e a tabela em DEMO_TABLES.
