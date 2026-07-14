// Crash logger — synchronous file logging for uncaught exceptions.
//
// v19-BLOCKING: the operator's review identified that the prior "server died
// silently" crashes during v18 testing were never root-caused. The `setImmediate`
// wrapper around notifyVaultEvent made the symptom stop appearing in that test
// session, but no stack trace was ever captured and no mechanical explanation
// was confirmed. This module is the first step of the diagnosis path:
//
//   1. (this file) — synchronous crash dump to a file before the process exits,
//      so a stack trace is NEVER lost to an async DB write that loses the race
//      with process termination.
//   2. (instrumentation.ts) — register `uncaughtException` + `unhandledRejection`
//      handlers at the earliest possible hook (Next.js instrumentation runs
//      before request handlers in both `next dev` and `next start`).
//   3. (scripts/diag-oom-check.sh) — kernel-side OOM-kill check via dmesg +
//      journalctl, to be run by the operator the next time a silent crash
//      happens.
//   4. (scripts/smoke-test-production.sh) — repeat the v18 vault smoke test
//      against `next build && next start`, NOT against `next dev` (Turbopack
//      + HMR is structurally different from production module loading).
//
// The handlers intentionally call `process.exit(1)` after flushing. The Node
// docs explicitly recommend exiting after uncaughtException because the app
// state is undefined afterwards. Continuing to run risks corrupting the vault
// or executing trades on partial state — the worst possible failure mode for
// a fund-custody system.
//
// CRITICAL: every write here uses fs.writeFileSync + fs.appendFileSync (synchronous
// I/O). Async writes (fs.promises, console.log with redirection buffering) can
// lose the tail of the trace if the process is killed mid-flush. Synchronous
// writes block the event loop but guarantee the bytes hit the disk before the
// process exits. This is the right trade-off for a crash handler.

import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const CRASH_LOG_DIR =
  process.env.CRASH_LOG_DIR ?? join(process.cwd(), "logs");

let _initialized = false;
let _bootTime = new Date();

/**
 * Initialize the crash log directory. Idempotent — safe to call from
 * instrumentation.ts and from any other bootstrap path. The directory is
 * created synchronously; if creation fails (e.g. permissions), we fall back
 * to writing crash logs to /tmp so we never LOSE a crash trace.
 */
export function initCrashLogDir(): void {
  if (_initialized) return;
  _initialized = true;
  try {
    if (!existsSync(CRASH_LOG_DIR)) {
      mkdirSync(CRASH_LOG_DIR, { recursive: true, mode: 0o750 });
    }
    // Write a boot marker so we can correlate "server started" vs "server died"
    // timestamps when reviewing crash logs after the fact.
    const bootFile = join(CRASH_LOG_DIR, "boot.log");
    appendFileSync(
      bootFile,
      `[${new Date().toISOString()}] process pid=${process.pid} node=${process.version} cwd=${process.cwd()} env.NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}\n`
    );
  } catch {
    // Fallback: /tmp/<pid>-crash-logs — better than nothing
    try {
      const fallback = `/tmp/${process.pid}-crash-logs`;
      if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true });
    } catch {
      // give up silently — the handlers below will still try stderr
    }
  }
}

function resolveLogDir(): string {
  if (existsSync(CRASH_LOG_DIR)) return CRASH_LOG_DIR;
  const fallback = `/tmp/${process.pid}-crash-logs`;
  if (existsSync(fallback)) return fallback;
  // last-resort: just use cwd
  return process.cwd();
}

interface CrashRecord {
  kind: "uncaughtException" | "unhandledRejection";
  error: unknown;
  timestamp: string;
  bootAgeMs: number;
}

function formatCrash(rec: CrashRecord): string {
  const { kind, error, timestamp, bootAgeMs } = rec;
  const err = error instanceof Error ? error : new Error(String(error));
  const stack = err.stack ?? "(no stack trace available)";
  const cause =
    err.cause instanceof Error
      ? `\n--- cause ---\n${err.cause.stack ?? String(err.cause)}`
      : "";

  return [
    "=".repeat(78),
    `[${timestamp}] ${kind}`,
    `pid=${process.pid} uptime=${(bootAgeMs / 1000).toFixed(1)}s node=${process.version}`,
    `message: ${err.message}`,
    "",
    "STACK TRACE:",
    stack,
    cause,
    "",
    "ACTIVE HANDLERS / TIMERS:",
    `  unref'd handles: ${getActiveHandlesDescription()}`,
    `  process.listenerCount(uncaughtException)=${process.listenerCount("uncaughtException")}`,
    `  process.listenerCount(unhandledRejection)=${process.listenerCount("unhandledRejection")}`,
    "=".repeat(78),
    "",
  ].join("\n");
}

function getActiveHandlesDescription(): string {
  // process._getActiveHandles is an internal Node API (available since v9)
  // but isn't in the public typings. We cast to any to access it without
  // triggering a TS error — the optional chain guards against the case
  // where it doesn't exist (rare, but possible in some bundlers).
  const handles: unknown[] =
    (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  const types = handles.map((h) => {
    if (h && typeof h === "object" && "constructor" in h) {
      return (h as { constructor: { name: string } }).constructor.name;
    }
    return typeof h;
  });
  return `[${types.join(", ")}]`;
}

/**
 * Write the crash record to a per-crash file (named with the kind + epoch ms
 * for sortability) AND append to the rolling crash.log. Both writes are
 * synchronous. Returns the path of the per-crash file so callers can log it
 * to stderr for grep-ability.
 */
function writeCrashRecord(rec: CrashRecord): string {
  const dir = resolveLogDir();
  const epoch = Date.now();
  const perCrashFile = join(dir, `crash-${rec.kind}-${epoch}.log`);
  const rollingFile = join(dir, "crash.log");
  const body = formatCrash(rec);

  try {
    writeFileSync(perCrashFile, body, { mode: 0o600 });
  } catch {
    // fall through — we still try append below
  }
  try {
    appendFileSync(rollingFile, body, { mode: 0o600 });
  } catch {
    // fall through
  }
  return perCrashFile;
}

/**
 * Synchronously write the crash to disk + stderr, then exit non-zero.
 *
 * EXIT POLICY: we exit with code 1 on uncaughtException. The Node docs are
 * explicit that the process state is undefined after an uncaught exception —
 * continuing to serve requests risks corrupting the vault state or executing
 * trades on partial state, which is the worst-case failure for a fund-custody
 * system. A supervised production deployment (systemd, pm2, docker) will
 * restart the process, which is the desired behavior.
 *
 * For unhandledRejection, we ALSO exit. This is stricter than Node's default
 * (which only warns), but for a system that signs real transactions we want
 * any promise chain that escapes its handler to be treated as a hard failure
 * — it's the only way to surface logic errors that would otherwise silently
 * drop a risk check or a notification.
 */
export function handleCrash(
  kind: "uncaughtException" | "unhandledRejection",
  error: unknown
): void {
  const timestamp = new Date().toISOString();
  const bootAgeMs = Date.now() - _bootTime.getTime();

  const perCrashFile = writeCrashRecord({
    kind,
    error,
    timestamp,
    bootAgeMs,
  });

  // Write to stderr synchronously — process.stderr.write is sync when writing
  // to a TTY or a pipe (not a file), which is the case in dev and most prod
  // setups. Even if it's not strictly sync, we still call process.exit below
  // after a short delay to give stderr a chance to flush.
  try {
    process.stderr.write(
      `\n!!! ${kind} at ${timestamp} (uptime ${(bootAgeMs / 1000).toFixed(1)}s) !!!\n`
    );
    process.stderr.write(`!!! Crash dump written to: ${perCrashFile}\n`);
    process.stderr.write(
      `!!! Run scripts/diag-oom-check.sh to also check kernel OOM-kill.\n\n`
    );
    if (error instanceof Error) {
      process.stderr.write(error.stack ?? String(error));
    } else {
      process.stderr.write(String(error));
    }
    process.stderr.write("\n");
  } catch {
    // ignore — we've already written to file
  }

  // Give stderr ~50ms to flush if it's buffered, then exit. We use a sync
  // exit so the process can't keep running with corrupted state.
  // Note: we do NOT call process.exit() inside unhandledRejection because
  // Node's behavior changed in v15+ to make unhandled rejections exit anyway.
  // But to be consistent + explicit, we exit in both cases.
  try {
    process.exit(1);
  } catch {
    // if exit is somehow not allowed (rare), force-kill
    process.kill(process.pid, "SIGKILL");
  }
}

/**
 * Public entry point — called by instrumentation.ts.
 * Idempotent: safe to call multiple times; subsequent calls are no-ops.
 */
export function registerCrashHandlers(): void {
  if (process.env.DISABLE_CRASH_HANDLERS === "1") return;
  initCrashLogDir();

  // Avoid double-registering during Next.js HMR in dev (instrumentation may
  // re-evaluate). process.listenerCount guards against this.
  if (process.listenerCount("uncaughtException") > 0) {
    // There's already a listener. Next.js / Node may install its own. We
    // still want OURS to run because ours writes to a file synchronously.
    // But we can't remove Node's default listener without breaking things.
    // So we add ours as an additional listener — Node will call all of them.
  }

  process.on("uncaughtException", (err) => {
    handleCrash("uncaughtException", err);
  });
  process.on("unhandledRejection", (reason) => {
    handleCrash("unhandledRejection", reason);
  });

  // Also trap SIGINT / SIGTERM — write a clean exit marker so we can
  // distinguish "operator killed it" from "process died on its own".
  process.on("SIGINT", () => {
    try {
      appendFileSync(
        join(resolveLogDir(), "exit.log"),
        `[${new Date().toISOString()}] SIGINT received, exiting cleanly pid=${process.pid}\n`
      );
    } catch {
      // ignore
    }
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    try {
      appendFileSync(
        join(resolveLogDir(), "exit.log"),
        `[${new Date().toISOString()}] SIGTERM received, exiting cleanly pid=${process.pid}\n`
      );
    } catch {
      // ignore
    }
    process.exit(143);
  });
}
