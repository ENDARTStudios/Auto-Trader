#!/usr/bin/env node
// scripts/e2e-standalone.mjs — runner E2E local reprodutível (DB descartável + standalone)
//
// Por que existe: 'next dev' entra em loop de reload full-page quando outros
// processos escrevem no workspace (ex.: vitest --coverage em paralelo), e o
// Playwright então falha dezenas de testes de UI por motivo que não é do spec.
// Este runner sobe o ARTEFATO DE PRODUÇÃO (.next/standalone) — sem watcher/HMR —
// contra um Postgres DESCARTÁVEL, roda as duas suítes (main + meridian) e faz
// cleanup sempre. É o caminho local canônico para E2E; 'next dev' fica para
// iteração manual.
//
// Uso:
//   node scripts/e2e-standalone.mjs                 # main + meridian (reusa build existente)
//   node scripts/e2e-standalone.mjs --build         # força 'npm run build'
//   node scripts/e2e-standalone.mjs --main-only     # só Playwright main (porta 3000)
//   node scripts/e2e-standalone.mjs --meridian-only # só meridian (porta 3100)
//   node scripts/e2e-standalone.mjs --keep          # mantém DB + logs para debug
//   node scripts/e2e-standalone.mjs --json          # imprime resumo JSON no fim
//   node scripts/e2e-standalone.mjs --workers 2     # paralelismo da suíte main (default: 2)
//
// SEM novas dependências: usa pg/dotenv já presentes no repo, e os CLIs
// (prisma, tsx, playwright) de node_modules.
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const ROOT = process.cwd();
const PORT_MAIN = 3000;
const PORT_MERIDIAN = 3100;
const PRISMA_CLI = join(ROOT, "node_modules", "prisma", "build", "index.js");
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const PW_CLI = join(ROOT, "node_modules", "@playwright", "test", "cli.js");
const STANDALONE_SERVER = join(ROOT, ".next", "standalone", "server.js");

const argv = process.argv.slice(2);
const has = (f) => argv.includes("--" + f);
const valueOf = (f) => { const i = argv.indexOf("--" + f); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const OPT = { build: has("build"), keep: has("keep"), mainOnly: has("main-only"), meridianOnly: has("meridian-only"), json: has("json"), workers: Number(valueOf("workers") || 2) };
const RUN_MAIN = !OPT.meridianOnly;
const RUN_MERIDIAN = !OPT.mainOnly;

// Segredos de TESTE (nunca os de produção). Mesmos valores de scripts/run-test-ci.mjs.
const TEST_ENV = {
  NODE_ENV: "production",
  SESSION_SECRET: "test-session-secret-32-chars-minimum-for-local-gate",
  ENCRYPTION_KEY: "base64:dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1iYXNlNjQ=",
  E2E_RATE_LIMIT_BYPASS: "1",
  SIGNER_TEST_HOOKS: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  // Playwright: fora de CI o reuseExistingServer é permitido. Forçamos CI vazio
  // para o runner nunca tentar subir o webServer dev por cima dos standalone.
  CI: "",
};

const log = (m) => console.log("[e2e-standalone] " + m);

let dbName = "autotrader_e2e_" + process.pid;
let testUrl = null;
let adminUrl = null;
let dbCreated = false;
let workDir = null;
let uploadDir = null;
let servers = [];
let cleaningUp = false;
let testsFailed = false;

const summary = {
  db: { name: dbName, created: false, dropped: false },
  build: { ran: false, exitCode: null, durationMs: null },
  main: { ran: false, exitCode: null, passed: null, failed: null, skipped: null, durationMs: null, log: null },
  meridian: { ran: false, exitCode: null, passed: null, failed: null, skipped: null, durationMs: null, log: null },
  cleanup: { serversStopped: false, dbDropped: false, tmpRemoved: false, portsFree: null },
  ok: false,
};

function parseDbUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL ausente — carregue o .env (dotenv) ou exporte a URL.");
  const base = new URL(raw);
  if (!/^postgres(ql)?:$/.test(base.protocol)) throw new Error("provider não suportado: " + base.protocol);
  const devDb = decodeURIComponent(base.pathname.replace(/^\//, ""));
  const t = new URL(base.toString());
  t.pathname = "/" + dbName;
  const a = new URL(base.toString());
  a.pathname = "/postgres";
  return { devDb, testUrl: t.toString(), adminUrl: a.toString() };
}

function ensureTools() {
  for (const [label, p] of [["prisma CLI", PRISMA_CLI], ["tsx CLI", TSX_CLI], ["playwright CLI", PW_CLI]]) {
    if (!existsSync(p)) throw new Error(label + " não encontrado em " + p + " (rode npm ci)");
  }
  if (!existsSync(join(ROOT, "scripts", "seed-auth.ts"))) throw new Error("scripts/seed-auth.ts ausente");
}

async function portIsFree(port) {
  return await new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const done = (free) => { if (settled) return; settled = true; socket.destroy(); resolve(free); };
    socket.setTimeout(800);
    socket.once("connect", () => done(false));
    socket.once("timeout", () => done(true));
    socket.once("error", () => done(true));
  });
}

async function assertPortsFree() {
  const conflicts = [];
  for (const port of [PORT_MAIN, PORT_MERIDIAN]) {
    if (!(await portIsFree(port))) conflicts.push(port);
  }
  if (conflicts.length) {
    throw new Error("porta(s) ocupada(s): " + conflicts.join(", ") + ". Feche o dev server/instância anterior (Get-NetTCPConnection -LocalPort 3000 -State Listen + Stop-Process) e tente de novo.");
  }
}

async function withAdmin(fn) {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try { return await fn(c); } finally { await c.end().catch(() => {}); }
}

async function createDatabase() {
  await withAdmin(async (c) => {
    await c.query('DROP DATABASE IF EXISTS "' + dbName + '" WITH (FORCE)');
    await c.query('CREATE DATABASE "' + dbName + '"');
  });
  dbCreated = true;
  summary.db.created = true;
}

async function dropDatabase() {
  if (!dbCreated || OPT.keep) return;
  await withAdmin(async (c) => {
    await c.query('DROP DATABASE IF EXISTS "' + dbName + '" WITH (FORCE)');
  });
  dbCreated = false;
  summary.db.dropped = true;
  summary.cleanup.dbDropped = true;
}

function runSync(args, { env = {}, stdio = "inherit" } = {}) {
  const res = spawnSync(process.execPath, args, { cwd: ROOT, stdio, env: { ...process.env, ...env }, windowsHide: true });
  return { status: res.status === null ? 1 : res.status, output: String(res.stdout || "") + String(res.stderr || "") };
}

function runShell(command, { env = {}, stdio = "inherit" } = {}) {
  const res = spawnSync(command, { cwd: ROOT, shell: true, stdio, env: { ...process.env, ...env }, windowsHide: true });
  return { status: res.status === null ? 1 : res.status };
}

async function runPlaywright(label, extraArgs, baseURL) {
  const logPath = join(workDir, label + ".log");
  const args = [PW_CLI, "test", "--reporter=line", ...extraArgs];
  const env = { ...process.env, ...TEST_ENV, PLAYWRIGHT_BASE_URL: baseURL };
  log("rodando Playwright [" + label + "] PLAYWRIGHT_BASE_URL=" + baseURL);
  const started = Date.now();
  let output = "";
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const onData = (chunk) => { const text = chunk.toString(); output += text; process.stdout.write(text); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (err) => { output += "\n[spawn error] " + err.message; resolve(1); });
    child.once("close", (c) => resolve(c === null ? 1 : c));
  });
  writeFileSync(logPath, output);
  const counts = parseCounts(output);
  return { exitCode: code, durationMs: Date.now() - started, logPath, ...counts };
}

function parseCounts(text) {
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const m of text.matchAll(/(\d+)\s+(passed|failed|skipped|did not run)\b/g)) {
    const n = Number(m[1]);
    const kind = m[2];
    if (kind === "passed") counts.passed = Math.max(counts.passed, n);
    else if (kind === "failed") counts.failed = Math.max(counts.failed, n);
    else counts.skipped = Math.max(counts.skipped, n);
  }
  return counts;
}

async function waitHealth(port, child, label) {
  const deadline = Date.now() + 120000;
  let lastErr = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("server " + label + " morreu cedo (exit " + child.exitCode + ")");
    try {
      const res = await fetch("http://localhost:" + port + "/api/health", { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
      lastErr = "HTTP " + res.status;
    } catch (err) { lastErr = String(err); }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout esperando /api/health em :" + port + " (" + label + "): " + lastErr);
}

async function startServer(label, port) {
  const logPath = join(workDir, label + ".server.log");
  const fd = openSync(logPath, "a");
  const child = spawn(process.execPath, [STANDALONE_SERVER], {
    cwd: join(ROOT, ".next", "standalone"),
    windowsHide: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, ...TEST_ENV, DATABASE_URL: testUrl, UPLOAD_DIR: uploadDir, PORT: String(port), HOSTNAME: "127.0.0.1" },
  });
  servers.push({ label, port, child, logPath });
  log("servidor " + label + " iniciado em :" + port + " (pid " + child.pid + ")");
  try { await waitHealth(port, child, label); } catch (err) { printServerLogs(); throw err; }
  log("servidor " + label + " pronto (/api/health 200)");
}

function printServerLogs() {
  for (const s of servers) {
    try {
      const text = readFileSync(s.logPath, "utf8").trim();
      const tail = text.split("\n").slice(-15).join("\n");
      console.error("---- log " + s.label + " (" + s.logPath + ") ----\n" + tail);
    } catch { /* sem log */ }
  }
}

async function killServer(entry) {
  const { child } = entry;
  if (child.exitCode !== null) return;
  try { child.kill("SIGTERM"); } catch { /* ignore */ }
  const exited = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 4000);
    child.once("exit", () => { clearTimeout(t); resolve(true); });
  });
  if (!exited && child.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* ignore */ } }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function stopServers() {
  for (const s of servers) await killServer(s);
  servers = [];
  summary.cleanup.serversStopped = true;
}

async function cleanup() {
  if (cleaningUp) return;
  cleaningUp = true;
  try { await stopServers(); } catch (err) { console.error("[e2e-standalone] cleanup: falha matando servers: " + err); }
  try { await dropDatabase(); } catch (err) { console.error("[e2e-standalone] cleanup: falha dropando DB " + dbName + ": " + err); }
  try { if (workDir && !OPT.keep) { rmSync(workDir, { recursive: true, force: true }); summary.cleanup.tmpRemoved = true; } } catch (err) { console.error("[e2e-standalone] cleanup: falha removendo tmp: " + err); }
  try { if (!OPT.keep) rmSync(join(ROOT, ".auth", "meridian.json"), { force: true }); } catch { /* ignore */ }
  try {
    const free = [];
    for (const port of [PORT_MAIN, PORT_MERIDIAN]) free.push((await portIsFree(port)) ? port + ":free" : port + ":OCCUPIED");
    summary.cleanup.portsFree = free.join(" ");
    if (free.some((f) => f.endsWith("OCCUPIED"))) console.error("[e2e-standalone] AVISO: porta ainda ocupada após cleanup: " + free.join(" "));
  } catch { /* ignore */ }
}

async function main() {
  const { devDb, testUrl: tUrl, adminUrl: aUrl } = parseDbUrl();
  testUrl = tUrl;
  adminUrl = aUrl;
  ensureTools();
  log("branch: " + (readBranch() || "?") + " · banco de dev intocado: " + devDb);
  log("banco de teste: " + dbName);

  workDir = join(tmpdir(), "autotrader-e2e-" + process.pid);
  mkdirSync(workDir, { recursive: true });
  uploadDir = join(workDir, "uploads");
  mkdirSync(uploadDir, { recursive: true });
  log("tmp: " + workDir);

  await assertPortsFree();

  if (OPT.build || !existsSync(STANDALONE_SERVER)) {
    log("build: " + (OPT.build ? "--build forçado" : "artefato standalone ausente") + " — rodando npm run build...");
    const t = Date.now();
    const res = runShell("npm run build", { stdio: "inherit" });
    summary.build = { ran: true, exitCode: res.status, durationMs: Date.now() - t };
    if (res.status !== 0) throw new Error("npm run build falhou (exit " + res.status + ")");
  } else {
    log("build: reutilizando .next/standalone existente (use --build para forçar)");
    const buildId = join(ROOT, ".next", "BUILD_ID");
    if (existsSync(buildId)) log("build: BUILD_ID de " + new Date(statSync(buildId).mtimeMs).toISOString());
  }

  await createDatabase();
  log("banco criado: " + dbName);

  log("aplicando migrations (prisma migrate deploy)...");
  const migrate = runSync([PRISMA_CLI, "migrate", "deploy"], { env: { DATABASE_URL: testUrl, NODE_ENV: "test" } });
  if (migrate.status !== 0) throw new Error("prisma migrate deploy falhou (exit " + migrate.status + ")");

  const seedEnv = { ...TEST_ENV, NODE_ENV: "test", DATABASE_URL: testUrl };
  for (const seed of ["seed-auth.ts", "seed-flags.ts", "seed-demo.ts"]) {
    const p = join(ROOT, "scripts", seed);
    if (!existsSync(p)) { log("seed: " + seed + " ausente — pulando"); continue; }
    log("seed: " + seed);
    const res = runSync([TSX_CLI, p], { env: seedEnv });
    if (res.status !== 0) throw new Error("seed " + seed + " falhou (exit " + res.status + ")");
  }

  if (RUN_MAIN) await startServer("main", PORT_MAIN);
  if (RUN_MERIDIAN) { rmSync(join(ROOT, ".auth", "meridian.json"), { force: true }); await startServer("meridian", PORT_MERIDIAN); }

  if (RUN_MAIN) {
    summary.main = { ...summary.main, ...(await runPlaywright("main", ["--workers", String(OPT.workers)], "http://localhost:" + PORT_MAIN)), ran: true };
    if (summary.main.exitCode !== 0) testsFailed = true;
  }
  if (RUN_MERIDIAN) {
    summary.meridian = { ...summary.meridian, ...(await runPlaywright("meridian", ["--config", "playwright.meridian.config.ts"], "http://localhost:" + PORT_MERIDIAN)), ran: true };
    if (summary.meridian.exitCode !== 0) testsFailed = true;
  }

  summary.ok = !testsFailed;
  return testsFailed ? 1 : 0;
}

function readBranch() {
  try { return readFileSync(join(ROOT, ".git", "HEAD"), "utf8").trim().replace("ref: refs/heads/", ""); } catch { return null; }
}

function printSummary() {
  const mark = (r) => (r.ran ? (r.exitCode === 0 ? "PASS" : "FAIL") + " (" + (r.passed ?? "?") + " passed, " + (r.failed ?? "?") + " failed)" : "skipped");
  console.log("\n[e2e-standalone] RESUMO");
  console.log("  main:     " + mark(summary.main));
  console.log("  meridian: " + mark(summary.meridian));
  console.log("  db:       " + (summary.db.name || "?") + (OPT.keep ? " (mantido)" : summary.db.dropped ? " (dropado)" : " queued"));
  console.log("  cleanup:  " + JSON.stringify(summary.cleanup));
  if (OPT.json) console.log(JSON.stringify(summary, null, 2));
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => { log("sinal " + sig + " — cleanup..."); await cleanup(); process.exit(130); });
}
process.on("uncaughtException", async (err) => { console.error("[e2e-standalone] uncaught: " + (err && err.stack ? err.stack : err)); await cleanup(); process.exit(2); });
process.on("unhandledRejection", (err) => { console.error("[e2e-standalone] unhandledRejection: " + err); });

main()
  .then(async (code) => { await cleanup(); printSummary(); process.exit(code); })
  .catch(async (err) => { console.error("[e2e-standalone] ERRO: " + (err && err.message ? err.message : err)); await cleanup(); printSummary(); process.exit(2); });
