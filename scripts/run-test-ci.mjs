#!/usr/bin/env node
// scripts/run-test-ci.mjs — roda o gate `npm run test:ci` (22 scripts tsx) de forma
// REPRODUTÍVEL e SEM TOCAR no banco de dev.
//
// Problema que resolve: os scripts do gate fazem escritas destrutivas (o
// test-vault.ts trunca WalletConnection/ExchangeConnection; outros criam usuários,
// wallets e posições). Rodar `npm run test:ci` contra o banco de dev apaga dados.
// Aqui criamos um banco DESCARTÁVEL no mesmo servidor Postgres, aplicamos as
// migrations e rodamos a MESMA lista de scripts apontando DATABASE_URL para ele.
//
// Uso:
//   node scripts/run-test-ci.mjs                     # roda os 22 scripts
//   node scripts/run-test-ci.mjs --only test-vault   # subconjunto (substring)
//   node scripts/run-test-ci.mjs --only h0 --only h2 # vários filtros
//   node scripts/run-test-ci.mjs --keep              # não dropa o banco no fim
//   node scripts/run-test-ci.mjs --list              # só lista os scripts
//   node scripts/run-test-ci.mjs --db-name x --timeout 600
//
// Requisitos: DATABASE_URL no .env/ambiente com permissão CREATE DATABASE.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

// Lista explícita e ordenada = MESMA do test:ci do package.json (o runner avisa se
// as duas divergirem; se divergir, o package.json é a fonte do gate de CI).
const SCRIPTS = [
  "test-vault.ts",
  "test-request-peer-integration.ts",
  "test-signer-process.ts",
  "test-wallet-crud.ts",
  "test-signer-dispatcher-structural.ts",
  "test-signer-vault-integration.ts",
  "test-h0-kdf-versioning.ts",
  "test-h0-audit-hashchain.ts",
  "test-h0-key-rotation.ts",
  "test-h1-rpc-resilience.ts",
  "test-h1-simulation-gate.ts",
  "test-h1-approval-hardening.ts",
  "test-h1-mev-baseline.ts",
  "test-h2-contract-verification.ts",
  "test-h2-liquidity-verification.ts",
  "test-h2-token-authority.ts",
  "test-h2-sell-simulation.ts",
  "test-h2-adversarial.ts",
  "test-h2-integration-gate.ts",
  "test-m3-signer-adapter.ts",
  "test-m3-signer-handlers.ts",
  "test-m3-broadcaster.ts",
];

const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes("--" + name);
}
function values(name) {
  const out = [];
  argv.forEach((a, i) => {
    if (a === "--" + name && argv[i + 1]) out.push(argv[i + 1]);
  });
  return out;
}
const ONLY = values("only");
const KEEP = flag("keep");
const LIST = flag("list");
const TIMEOUT_SEC = Number(values("timeout")[0] || 300);

if (LIST) {
  console.log(SCRIPTS.join("\n"));
  process.exit(0);
}

function log(m) {
  console.log("[test:ci:local] " + m);
}
function fail(m) {
  console.error("[test:ci:local] ERRO: " + m);
  process.exit(1);
}

// --- 0. Configuração / segurança ------------------------------------------
if (!process.env.DATABASE_URL) fail("DATABASE_URL ausente — carregue o .env (dotenv) ou exporte a URL.");
const base = new URL(process.env.DATABASE_URL);
if (!/^postgres(ql)?:$/.test(base.protocol)) fail("provider nao suportado: " + base.protocol + " (esperado postgresql://)");
const devDb = decodeURIComponent(base.pathname.replace(/^\//, ""));
const dbName = values("db-name")[0] || "autotrader_test_" + process.pid;
if (!/^[a-zA-Z0-9_]+$/.test(dbName)) fail("nome de banco invalido: " + dbName);
if (dbName === devDb) fail("recusado: o banco de teste nao pode ser o banco de dev (" + devDb + ").");

const testUrl = new URL(base.toString());
testUrl.pathname = "/" + dbName;
const adminUrl = new URL(base.toString());
adminUrl.pathname = "/postgres";

const selected = ONLY.length ? SCRIPTS.filter((s) => ONLY.some((f) => s.toLowerCase().includes(f.toLowerCase()))) : SCRIPTS.slice();
if (!selected.length) fail("nenhum script casou com --only " + JSON.stringify(ONLY));
for (const s of selected) {
  if (!existsSync(join("scripts", s))) fail("script ausente: scripts/" + s);
}

// Divergência entre a lista local e o test:ci do package.json (aviso, não erro).
try {
  const pkg = require(join(process.cwd(), "package.json"));
  const fromPkg = [...String(pkg.scripts["test:ci"] || "").matchAll(/scripts\/([\w.-]+\.ts)/g)].map((m) => m[1]);
  if (fromPkg.length && fromPkg.join(",") !== SCRIPTS.join(",")) {
    console.warn("[test:ci:local] AVISO: lista local difere do test:ci do package.json — atualize SCRIPTS.");
  }
} catch {
  /* sem package.json legível: segue */
}

const TSX_CLI = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const PRISMA_CLI = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
if (!existsSync(TSX_CLI)) fail("tsx nao encontrado (npm ci) em " + TSX_CLI);
if (!existsSync(PRISMA_CLI)) fail("prisma CLI nao encontrado em " + PRISMA_CLI);

// Env dos scripts: banco descartável + segredos de TESTE (nunca os de produção).
const childEnv = Object.assign({}, process.env, {
  DATABASE_URL: testUrl.toString(),
  NODE_ENV: "test",
  SIGNER_TEST_HOOKS: "1",
  SESSION_SECRET: "test-session-secret-32-chars-minimum-for-local-gate",
  ENCRYPTION_KEY: "base64:dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1iYXNlNjQ=",
  // Superfície de teste: nada de usar o banco real mesmo se algum script ignorar o env.
  RUN_TEST_CI_LOCAL: "1",
});

let admin = null;
let created = false;

async function withAdmin(fn) {
  admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    return await fn();
  } finally {
    await admin.end().catch(() => {});
    admin = null;
  }
}

async function dropIfExists() {
  await withAdmin(async () => {
    await admin.query('DROP DATABASE IF EXISTS "' + dbName + '" WITH (FORCE)');
  });
}

async function createDatabase() {
  await withAdmin(async () => {
    await admin.query('DROP DATABASE IF EXISTS "' + dbName + '" WITH (FORCE)');
    await admin.query('CREATE DATABASE "' + dbName + '"');
  });
  created = true;
}

function run(cmdArgs, opts) {
  const res = spawnSync(process.execPath, cmdArgs, Object.assign({ encoding: "utf8" }, opts));
  return {
    status: res.status === null ? 1 : res.status,
    out: String(res.stdout || "") + String(res.stderr || ""),
    timedOut: res.error && res.error.code === "ETIMEDOUT",
  };
}

async function main() {
  log("alvo: " + base.hostname + ":" + (base.port || "5432") + " (banco de trabalho: " + devDb + ")");
  log("banco de teste: " + dbName + " — o banco de dev NAO e tocado");
  log("scripts selecionados: " + selected.length + " de " + SCRIPTS.length);

  try {
    await createDatabase();
    log("banco criado");
  } catch (err) {
    const code = err && err.code;
    if (code === "42501") {
      fail(
        "usuário do DATABASE_URL não tem permissão CREATE DATABASE (42501). " +
          "O gate precisa de um banco descartável — NÃO rode contra o banco de dev. " +
          "Peça ao operador: ALTER ROLE <user> CREATEDB; ou rode contra um Postgres local (docker compose).",
      );
    }
    fail("falha ao criar banco de teste (" + (code || "sem code") + "): " + ((err && err.message) || err));
  }

  // --- 1. Schema via migrations (baseline versionado) ---------------------
  log("aplicando migrations (prisma migrate deploy)...");
  const migrate = run([PRISMA_CLI, "migrate", "deploy"], { env: childEnv, timeout: TIMEOUT_SEC * 1000 });
  if (migrate.status !== 0) {
    console.error("---- prisma migrate deploy ----");
    console.error(migrate.out.trim().split("\n").slice(-25).join("\n"));
    fail(
      "migrate deploy falhou. Nada foi executado. Verifique prisma/migrations e, para banco com tabelas, use scripts/db-migrate-safe.mjs.",
    );
  }
  log("schema aplicado");

  // --- 2. Scripts --------------------------------------------------------
  const results = [];
  for (let i = 0; i < selected.length; i++) {
    const script = selected[i];
    const label = "[" + (i + 1) + "/" + selected.length + "] " + script;
    log(label + " ...");
    const started = Date.now();
    const res = run([TSX_CLI, join("scripts", script)], { env: childEnv, timeout: TIMEOUT_SEC * 1000 });
    const ms = Date.now() - started;
    const ok = res.status === 0 && !res.timedOut;
    results.push({ script, ok, ms, status: res.status, timedOut: res.timedOut });
    if (!ok) {
      console.error("---- " + script + " (exit " + res.status + (res.timedOut ? ", TIMEOUT" : "") + ") ----");
      console.error(res.out.trim().split("\n").slice(-30).join("\n"));
    }
    log((ok ? "PASS" : "FAIL") + " " + script + " (" + (ms / 1000).toFixed(1) + "s)");
  }

  // --- 3. Resumo ---------------------------------------------------------
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log("\n===== test:ci:local — resumo =====");
  for (const r of results) {
    console.log((r.ok ? "PASS " : "FAIL ") + r.script.padEnd(40) + (r.ms / 1000).toFixed(1) + "s");
  }
  console.log("PASS=" + passed + " FAIL=" + failed + " de " + results.length);
  if (KEEP) log("--keep: banco mantido: " + dbName);
  return failed === 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  console.error("[test:ci:local] falha inesperada:", (err && err.message) || err);
  exitCode = 1;
} finally {
  if (created && !KEEP) {
    try {
      await dropIfExists();
      log("banco de teste dropado");
    } catch (err) {
      console.warn("[test:ci:local] aviso: falha ao dropar " + dbName + ": " + ((err && err.message) || err));
    }
  }
}
process.exit(exitCode);
