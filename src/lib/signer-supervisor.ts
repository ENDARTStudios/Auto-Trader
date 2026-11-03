// src/lib/signer-supervisor.ts — supervisor do processo SIGNER (round 3).
//
// O signer (src/signer/main.ts, empacotado em .next/standalone/signer.js por
// scripts/build-signer.mjs) é um PROCESSO separado: ele guarda as chaves
// descriptografadas e fica atrás de uma Unix socket 0600. Este módulo é o
// supervisor que o Next chama uma única vez no boot (src/instrumentation.ts).
//
// PRINCÍPIOS
// ----------
//   1. DESLIGADO POR PADRÃO: sem SIGNER_SPAWN=1 nada é spawnado. A execução
//      live continua fail-closed em produção até o operador habilitar.
//   2. NUNCA DERRUBA O APP: startSignerSupervisor() não lança; bundle ausente,
//      spawn falhando, timeout, crash — tudo vira log + retry com backoff.
//   3. UM SOCKET POR PROCESSO: SIGNER_SOCKET_PATH se definido, senão
//      <tmpdir>/auto-trader-signer-<pid-do-web>.sock. O env é setado ANTES do
//      spawn (health/adapter leem dali) e limpo quando o filho morre.
//   4. FILHO MORRE COM O PAI: stdin é um pipe; quando o web morre, o EOF no
//      stdin faz o signer zeroizar as chaves e sair (die-detection do
//      src/signer/main.ts). Também matamos no stop/shutdown.
//   5. BACKOFF EXPONENCIAL 1s → 30s, sem limite de tentativas, mas parando em
//      shutdown.
//
// POLÍTICA (defaults aplicados só se o operador não definiu):
//   SIGNER_MAX_TX_USD=100, SIGNER_MAX_WINDOW_USD=500, SIGNER_WINDOW_SEC=3600.
//   SIGNER_AUDIT_LOG=<tmp>/auto-trader-signer-<pid>.audit.jsonl (fora do /app
//   read-only do container; o signer ignora se o caminho não for gravável).
//
// TESTES: seams __setSignerSupervisorSpawnForTest / __setSignerSupervisorTimingForTest /
// __resetSignerSupervisorForTest (ver tests/signer-supervisor.test.ts). Nenhum
// socket real é aberto nos testes.

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { maskSignerSocketPath } from "@/lib/chain/signer-transport";

export interface SignerSupervisorStatus {
  enabled: boolean;
  spawned: boolean;
  ready: boolean;
  pid: number | null;
  restarts: number;
  socketPathMasked: string | null;
  lastError: string | null;
}

type SpawnFn = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"] },
) => ChildProcess;

interface SupervisorTiming {
  readyTimeoutMs: number;
  backoffBaseMs: number;
  maxBackoffMs: number;
  stopGraceMs: number;
}

interface SignerReadyLine {
  type?: unknown;
  socketPath?: unknown;
  version?: unknown;
  pid?: unknown;
}

const DEFAULT_TIMING: SupervisorTiming = {
  readyTimeoutMs: 10_000,
  backoffBaseMs: 1_000,
  maxBackoffMs: 30_000,
  stopGraceMs: 2_000,
};

const LOG_PREFIX = "[signer-supervisor]";

const state: {
  started: boolean;
  enabled: boolean;
  child: ChildProcess | null;
  ready: boolean;
  pid: number | null;
  restarts: number;
  attempts: number;
  socketPath: string | null;
  lastError: string | null;
  shuttingDown: boolean;
  readyTimer: ReturnType<typeof setTimeout> | null;
  backoffTimer: ReturnType<typeof setTimeout> | null;
  originalSocketEnv: string | undefined;
} = {
  started: false,
  enabled: false,
  child: null,
  ready: false,
  pid: null,
  restarts: 0,
  attempts: 0,
  socketPath: null,
  lastError: null,
  shuttingDown: false,
  readyTimer: null,
  backoffTimer: null,
  originalSocketEnv: undefined,
};

let spawnImpl: SpawnFn = nodeSpawn as unknown as SpawnFn;
let timing: SupervisorTiming = { ...DEFAULT_TIMING };
let processHandlersRegistered = false;

// Process handlers precisam de referência estável para remoção nos testes.
const onSignal = (): void => {
  void stopSignerSupervisor();
};
const onProcessExit = (): void => {
  // 'exit': síncrono e best-effort — timers não rodam mais aqui.
  clearTimers();
  try {
    state.child?.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  cleanupSocketFile();
};

function registerProcessHandlers(): void {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("exit", onProcessExit);
}

function unregisterProcessHandlers(): void {
  if (!processHandlersRegistered) return;
  processHandlersRegistered = false;
  process.off("SIGTERM", onSignal);
  process.off("SIGINT", onSignal);
  process.off("exit", onProcessExit);
}

function clearTimers(): void {
  if (state.readyTimer) {
    clearTimeout(state.readyTimer);
    state.readyTimer = null;
  }
  if (state.backoffTimer) {
    clearTimeout(state.backoffTimer);
    state.backoffTimer = null;
  }
}

export function isSignerSpawnEnabled(): boolean {
  return process.env.SIGNER_SPAWN === "1";
}

let bundlePathOverride: string | null = null;

export function resolveSignerBundlePath(): string {
  if (bundlePathOverride) return bundlePathOverride;
  // Em produção o Next standalone roda com cwd = <app>/.next/standalone
  // (server.js), então o candidato canônico `cwd/.next/standalone/signer.js`
  // resolve para .../standalone/.next/standalone/signer.js (bug rodada 3).
  // Ordem: env override -> irmão do server.js (argv[1]) -> cwd standalone ->
  // cwd repo. Retorna o primeiro que existir; fallback = repo canonical.
  const candidates: string[] = [];
  const fromEnv = process.env.SIGNER_BUNDLE_PATH?.trim();
  if (fromEnv) candidates.push(fromEnv);
  const entry = process.argv[1];
  if (entry) candidates.push(join(dirname(entry), "signer.js"));
  candidates.push(join(process.cwd(), "signer.js"));
  candidates.push(join(process.cwd(), ".next", "standalone", "signer.js"));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1] ?? join(process.cwd(), ".next", "standalone", "signer.js");
}

export function resolveSignerSocketPath(): string {
  const fromEnv = process.env.SIGNER_SOCKET_PATH?.trim();
  if (fromEnv) return fromEnv;
  return join(os.tmpdir(), "auto-trader-signer-" + process.pid + ".sock");
}

function resolveAuditLogPath(): string {
  return join(os.tmpdir(), "auto-trader-signer-" + process.pid + ".audit.jsonl");
}

/** Aplica defaults de política sem sobrescrever env explícito do operador. */
function applyPolicyDefaults(env: NodeJS.ProcessEnv): void {
  if (!env.SIGNER_MAX_TX_USD) env.SIGNER_MAX_TX_USD = "100";
  if (!env.SIGNER_MAX_WINDOW_USD) env.SIGNER_MAX_WINDOW_USD = "500";
  if (!env.SIGNER_WINDOW_SEC) env.SIGNER_WINDOW_SEC = "3600";
}

function cleanupSocketFile(): void {
  if (!state.socketPath) return;
  try {
    if (existsSync(state.socketPath)) unlinkSync(state.socketPath);
  } catch {
    /* best-effort */
  }
}

function restoreSocketEnv(): void {
  if (state.originalSocketEnv === undefined) {
    delete process.env.SIGNER_SOCKET_PATH;
  } else {
    process.env.SIGNER_SOCKET_PATH = state.originalSocketEnv;
  }
}

function scheduleRestart(): void {
  if (state.shuttingDown || !state.enabled) return;
  if (state.backoffTimer) return; // já agendado
  const exponent = Math.max(0, state.attempts - 1);
  const delay = Math.min(timing.backoffBaseMs * Math.pow(2, exponent), timing.maxBackoffMs);
  state.restarts += 1;
  console.warn(LOG_PREFIX + " signer indisponível — restart em " + delay + "ms (tentativa " + state.attempts + ")");
  state.backoffTimer = setTimeout(() => {
    state.backoffTimer = null;
    if (state.shuttingDown || !state.enabled) return;
    spawnSigner();
  }, delay);
  // Não segura o event loop do web só por causa do supervisor.
  state.backoffTimer.unref?.();
}

function handleReadyLine(line: string): void {
  if (state.ready) return;
  let parsed: SignerReadyLine;
  try {
    parsed = JSON.parse(line) as SignerReadyLine;
  } catch {
    return; // stdout do signer depois do READY é ignorado; linha inválida não é fatal
  }
  if (!parsed || parsed.type !== "SIGNER_READY") return;
  if (typeof parsed.socketPath !== "string" || parsed.socketPath !== state.socketPath) {
    state.lastError = "SIGNER_READY_SOCKET_MISMATCH";
    console.error(LOG_PREFIX + " SIGNER_READY com socketPath inesperado — reiniciando");
    try {
      state.child?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    return;
  }
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    state.lastError = "SIGNER_READY_INVALID_VERSION";
    try {
      state.child?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    return;
  }
  if (state.readyTimer) {
    clearTimeout(state.readyTimer);
    state.readyTimer = null;
  }
  state.ready = true;
  state.pid = state.child?.pid ?? (typeof parsed.pid === "number" ? parsed.pid : null);
  state.attempts = 0; // backoff volta ao início após sucesso
  state.lastError = null;
  console.log(
    LOG_PREFIX + " signer pronto (pid=" + String(state.pid) + ", socket=" + String(maskSignerSocketPath(state.socketPath)) + ", version=" + parsed.version + ")",
  );
}

function spawnSigner(): void {
  if (state.shuttingDown || !state.enabled) return;
  if (state.child) return;

  const bundlePath = resolveSignerBundlePath();
  if (!existsSync(bundlePath)) {
    state.lastError = "SIGNER_BUNDLE_MISSING";
    console.error(LOG_PREFIX + " bundle ausente: " + bundlePath + " — supervisor desiste (fail-safe)");
    return;
  }

  const socketPath = state.socketPath ?? resolveSignerSocketPath();
  state.socketPath = socketPath;
  // Setar ANTES do spawn: health route + makeSignerAdapterFromEnv leem daqui.
  process.env.SIGNER_SOCKET_PATH = socketPath;

  const env: NodeJS.ProcessEnv = { ...process.env, SIGNER_SOCKET_PATH: socketPath };
  applyPolicyDefaults(env);
  if (!env.SIGNER_AUDIT_LOG) env.SIGNER_AUDIT_LOG = resolveAuditLogPath();

  state.attempts += 1;
  state.ready = false;

  let child: ChildProcess;
  try {
    child = spawnImpl(process.execPath, [bundlePath], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    state.lastError = "SIGNER_SPAWN_FAILED";
    console.error(LOG_PREFIX + " spawn falhou: " + (err instanceof Error ? err.message : String(err)));
    scheduleRestart();
    return;
  }

  state.child = child;

  // stdout: apenas a linha SIGNER_READY é protocolo. Acumula por linha.
  let stdoutBuffer = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    let newline = stdoutBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line.length > 0) handleReadyLine(line);
      newline = stdoutBuffer.indexOf("\n");
    }
  });

  // stderr: repassa com prefixo (nunca contém chaves; o signer não loga segredos).
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (line.trim().length > 0) console.error(LOG_PREFIX + " signer: " + line.trim());
    }
  });

  // stdin fica aberto: quando o web morre, o pipe fecha e o signer sai sozinho.
  child.stdin?.on("error", () => {});

  state.readyTimer = setTimeout(() => {
    state.readyTimer = null;
    if (state.ready) return;
    state.lastError = "SIGNER_READY_TIMEOUT";
    console.error(
      LOG_PREFIX + " signer não enviou SIGNER_READY em " + timing.readyTimeoutMs + "ms — matando para tentar de novo",
    );
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }, timing.readyTimeoutMs);
  state.readyTimer.unref?.();

  child.once("error", (err: Error) => {
    state.lastError = "SIGNER_SPAWN_ERROR: " + err.message;
    console.error(LOG_PREFIX + " erro no processo do signer: " + err.message);
    // 'exit' pode não vir quando o spawn falha; agenda aqui e deixa o exit
    // handler ser idempotente (backoffTimer evita duplo agendamento).
    scheduleRestart();
  });

  child.once("exit", (code, signal) => {
    const wasReady = state.ready;
    state.child = null;
    state.ready = false;
    state.pid = null;
    if (state.readyTimer) {
      clearTimeout(state.readyTimer);
      state.readyTimer = null;
    }
    // Honestidade do status/health: enquanto não há filho, o socket não existe.
    restoreSocketEnv();
    if (state.shuttingDown || !state.enabled) return;
    state.lastError = "SIGNER_EXITED (" + String(code ?? signal) + ")";
    console.warn(
      LOG_PREFIX + " signer saiu (code=" + String(code) + ", signal=" + String(signal) + ", wasReady=" + wasReady + ")",
    );
    scheduleRestart();
  });
}

/**
 * Inicia o supervisor. Gated por SIGNER_SPAWN=1. NUNCA lança.
 * Idempotente: chamadas repetidas no mesmo processo não spawnam de novo.
 */
export async function startSignerSupervisor(): Promise<void> {
  try {
    if (state.started) return;
    state.enabled = isSignerSpawnEnabled();
    state.started = true;
    if (!state.enabled) {
      console.log(LOG_PREFIX + " desligado (SIGNER_SPAWN!=1) — signer não será spawnado");
      return;
    }
    const bundlePath = resolveSignerBundlePath();
    if (!existsSync(bundlePath)) {
      state.lastError = "SIGNER_BUNDLE_MISSING";
      console.error(LOG_PREFIX + " SIGNER_SPAWN=1 mas bundle ausente: " + bundlePath);
      console.error(LOG_PREFIX + " rode 'npm run build' (next build + scripts/build-signer.mjs) — supervisor fica inativo");
      return;
    }
    state.originalSocketEnv = process.env.SIGNER_SOCKET_PATH;
    state.socketPath = resolveSignerSocketPath();
    state.shuttingDown = false;
    registerProcessHandlers();
    spawnSigner();
  } catch (err) {
    state.lastError = "SIGNER_SUPERVISOR_START_FAILED";
    console.error(LOG_PREFIX + " start falhou: " + (err instanceof Error ? err.message : String(err)));
  }
}

/** Para o supervisor e o filho. NUNCA lança. Idempotente. */
export async function stopSignerSupervisor(): Promise<void> {
  try {
    state.shuttingDown = true;
    clearTimers();
    const child = state.child;
    state.child = null;
    state.ready = false;
    state.pid = null;
    state.started = false;
    if (child && child.exitCode === null && !child.killed) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        child.once("exit", finish);
        try {
          child.kill("SIGTERM");
        } catch {
          finish();
        }
        const killer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          finish();
        }, timing.stopGraceMs);
        killer.unref?.();
      });
    }
    cleanupSocketFile();
    restoreSocketEnv();
    unregisterProcessHandlers();
    state.socketPath = null;
    state.shuttingDown = false;
  } catch (err) {
    console.error(LOG_PREFIX + " stop falhou: " + (err instanceof Error ? err.message : String(err)));
  }
}

/** Status para /api/signer/health — caminho sempre mascarado. */
export function getSignerSupervisorStatus(): SignerSupervisorStatus {
  return {
    enabled: state.enabled || isSignerSpawnEnabled(),
    spawned: Boolean(state.child),
    ready: state.ready,
    pid: state.pid,
    restarts: state.restarts,
    socketPathMasked: maskSignerSocketPath(state.socketPath ?? process.env.SIGNER_SOCKET_PATH),
    lastError: state.lastError,
  };
}

// ---------------------------------------------------------------------------
// Seams de teste (não usados em produção)
// ---------------------------------------------------------------------------

/** Substitui o spawn por um fake; use null para restaurar o nativo. */
export function __setSignerSupervisorSpawnForTest(fn: SpawnFn | null): void {
  spawnImpl = (fn ?? nodeSpawn) as unknown as SpawnFn;
}

/** Aponta o bundle para um arquivo temporário nos testes (sem depender do build). */
export function __setSignerSupervisorBundlePathForTest(path: string | null): void {
  bundlePathOverride = path;
}

/** Encurta timeouts/backoff para os testes. */
export function __setSignerSupervisorTimingForTest(overrides: Partial<SupervisorTiming> | null): void {
  timing = overrides ? { ...DEFAULT_TIMING, ...overrides } : { ...DEFAULT_TIMING };
}

/** Reseta todo o estado do supervisor (para isolamento entre testes). */
export async function __resetSignerSupervisorForTest(): Promise<void> {
  await stopSignerSupervisor();
  clearTimers();
  unregisterProcessHandlers();
  state.started = false;
  state.enabled = false;
  state.child = null;
  state.ready = false;
  state.pid = null;
  state.restarts = 0;
  state.attempts = 0;
  state.socketPath = null;
  state.lastError = null;
  state.shuttingDown = false;
  state.originalSocketEnv = undefined;
  spawnImpl = nodeSpawn as unknown as SpawnFn;
  timing = { ...DEFAULT_TIMING };
  bundlePathOverride = null;
}
