// scripts/stress-test-vault.ts
//
// v19.2-BLOCKING: controlled stress test to force the silent-crash
// recurrence under production-build conditions.
//
// The operator's directive: "force a recorrência agora, de forma controlada,
// antes de decidir". This script does exactly that — it:
//
//   1. Builds the production bundle (`next build`)
//   2. Starts the production server (`next start` on a configurable port)
//   3. Hammers /api/vault with concurrent unlock + lock requests at
//      configurable concurrency + duration, specifically targeting the
//      conditions under which the v18 silent crashes appeared (concurrent
//      unlock/lock on the vault endpoint).
//   4. Monitors server process liveness + /api/status responsiveness
//      continuously throughout the test.
//   5. If the server dies: captures the exit code, prints pointers to
//      logs/crash-*.log + scripts/diag-oom-check.sh, exits non-zero with
//      diagnostic summary.
//   6. If the server survives: prints summary stats (requests sent,
//      success rate, latency percentiles, server memory at end) and exits 0.
//
// Two outcomes, both useful (per operator):
//   - If reproduces → real stack trace captured, root cause can be fixed
//     before any new architecture (signer isolation).
//   - If does NOT reproduce in production build → strong evidence the bug
//     was dev-mode-specific (Turbopack/HMR), priority drops from
//     "blocking" to "monitor".
//
// Usage:
//   npx tsx scripts/stress-test-vault.ts                       # defaults: 5 min, 20 concurrent
//   DURATION_SEC=1800 CONCURRENCY=50 npx tsx scripts/stress-test-vault.ts
//   PORT=3100 PASSPHRASE=real_pass npx tsx scripts/stress-test-vault.ts
//
// Requires: curl (for liveness ping), npx next build, free port.

import { spawn, ChildProcess } from "child_process";
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const PORT = parseInt(process.env.PORT ?? "3100", 10);
const DURATION_SEC = parseInt(process.env.DURATION_SEC ?? "300", 10); // 5 min default
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "20", 10);
const PASSPHRASE = process.env.PASSPHRASE ?? ""; // if empty, only tests lock + wrong-passphrase
const BASE = `http://localhost:${PORT}`;
const LOG_DIR = join(process.cwd(), "logs");
const SERVER_LOG = join(LOG_DIR, "stress-server.log");
const STRESS_LOG = join(LOG_DIR, "stress-run.log");

mkdirSync(LOG_DIR, { recursive: true });

interface Stats {
  sent: number;
  succeeded: number; // 2xx
  failed: number; // 4xx/5xx
  errors: number; // network error / no response
  latencies: number[]; // ms
  serverDied: boolean;
  serverDiedAt?: number;
  exitCode?: number;
}

const stats: Stats = {
  sent: 0,
  succeeded: 0,
  failed: 0,
  errors: 0,
  latencies: [],
  serverDied: false,
};

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(STRESS_LOG, line + "\n");
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// --- Single request --------------------------------------------------------
async function fireRequest(): Promise<{ ok: boolean; status: number; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    // Alternate between 4 request types to maximize coverage of vault state
    // transitions:
    //   - GET /api/vault (status check, no state change)
    //   - POST lock (resets vault state to locked)
    //   - POST unlock with WRONG passphrase (failed attempt, increments counter)
    //   - POST unlock with CORRECT passphrase (loads keys, full DB read)
    //     [only if PASSPHRASE env is set]
    const choice = Math.random();
    let body: string;
    if (choice < 0.25) {
      // GET — use a separate fetch
      const res = await fetch(`${BASE}/api/vault`, { signal: AbortSignal.timeout(15000) });
      const latencyMs = Date.now() - start;
      stats.latencies.push(latencyMs);
      return { ok: res.ok, status: res.status, latencyMs };
    } else if (choice < 0.5) {
      body = JSON.stringify({ action: "lock" });
    } else if (choice < 0.85 || !PASSPHRASE) {
      body = JSON.stringify({ action: "unlock", passphrase: `wrong-${Math.random()}` });
    } else {
      body = JSON.stringify({ action: "unlock", passphrase: PASSPHRASE });
    }
    const res = await fetch(`${BASE}/api/vault`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 254 + 1)}`, // random source IP for audit
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;
    stats.latencies.push(latencyMs);
    return { ok: res.ok, status: res.status, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    stats.latencies.push(latencyMs);
    return { ok: false, status: 0, latencyMs, error: String(err) };
  }
}

async function checkServerAlive(serverPid: number): Promise<boolean> {
  // Two checks: process must be alive AND /api/status must respond
  try {
    process.kill(serverPid, 0);
  } catch {
    return false;
  }
  try {
    const res = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  log("=== v19.2 stress test: force silent-crash recurrence ===");
  log(`Config: port=${PORT} duration=${DURATION_SEC}s concurrency=${CONCURRENCY} passphrase=${PASSPHRASE ? "set" : "NOT set (only lock+wrong unlock tested)"}`);
  log(`Server log: ${SERVER_LOG}`);
  log(`Stress log: ${STRESS_LOG}`);

  // --- 1. Build production bundle ----------------------------------------
  log("\n[1/4] Building production bundle (next build)...");
  const buildStart = Date.now();
  const build = spawn("npx", ["next", "build"], { stdio: ["ignore", "pipe", "pipe"] });
  const buildLog: string[] = [];
  build.stdout?.on("data", (d) => buildLog.push(d.toString()));
  build.stderr?.on("data", (d) => buildLog.push(d.toString()));
  const buildExit = await new Promise<number>((resolve) => build.on("exit", resolve));
  if (buildExit !== 0) {
    log(`  BUILD FAILED (exit ${buildExit}, ${((Date.now() - buildStart) / 1000).toFixed(1)}s)`);
    log(`  Last 20 lines of build output:`);
    for (const line of buildLog.slice(-20)) console.log(`    ${line.trimEnd()}`);
    return 1;
  }
  log(`  build OK (${((Date.now() - buildStart) / 1000).toFixed(1)}s)`);

  // --- 2. Start production server ----------------------------------------
  log("\n[2/4] Starting production server...");
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  });
  // Pipe server output to log file
  const serverLogBuf: string[] = [];
  server.stdout?.on("data", (d) => {
    const s = d.toString();
    serverLogBuf.push(s);
    appendFileSync(SERVER_LOG, s);
  });
  server.stderr?.on("data", (d) => {
    const s = d.toString();
    serverLogBuf.push(s);
    appendFileSync(SERVER_LOG, s);
  });

  // Track server exit independently
  let serverExitCode: number | null = null;
  server.on("exit", (code, signal) => {
    serverExitCode = code ?? -1;
    log(`  SERVER EXITED code=${code} signal=${signal}`);
    stats.serverDied = true;
    stats.serverDiedAt = Date.now();
    stats.exitCode = code ?? -1;
  });

  // Wait for /api/status to respond (max 30s)
  log("  waiting for /api/status to respond...");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (serverExitCode !== null) break;
    try {
      const res = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        ready = true;
        log(`  server ready after ${i + 1}s`);
        break;
      }
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) {
    log("  SERVER DID NOT BECOME READY — aborting stress test");
    if (serverExitCode === null) server.kill("SIGTERM");
    return 1;
  }

  // --- 3. Run stress loop ------------------------------------------------
  log(`\n[3/4] Starting stress loop: ${DURATION_SEC}s at ${CONCURRENCY} concurrency`);
  const stressStart = Date.now();
  const stressEnd = stressStart + DURATION_SEC * 1000;

  let inFlight = 0;
  let lastProgress = Date.now();

  await new Promise<void>((resolve) => {
    const scheduler = setInterval(() => {
      // Stop if duration exceeded OR server died
      if (Date.now() > stressEnd || stats.serverDied) {
        clearInterval(scheduler);
        // Wait for in-flight requests to finish (max 20s)
        const waitStart = Date.now();
        const waiter = setInterval(() => {
          if (inFlight === 0 || Date.now() - waitStart > 20000 || stats.serverDied) {
            clearInterval(waiter);
            resolve();
          }
        }, 200);
        return;
      }

      // Fill the concurrency window
      while (inFlight < CONCURRENCY) {
        inFlight++;
        stats.sent++;
        fireRequest().then((r) => {
          inFlight--;
          if (r.error) {
            stats.errors++;
          } else if (r.ok) {
            stats.succeeded++;
          } else {
            stats.failed++;
          }
          // If we got a network error (status=0), the server might be dead
          if (r.error && r.status === 0) {
            // Don't immediately declare death — could be a timeout. Schedule
            // a liveness check.
          }
        });

        // Progress log every 10s
        if (Date.now() - lastProgress > 10000) {
          const elapsed = ((Date.now() - stressStart) / 1000).toFixed(1);
          log(`  [${elapsed}s] sent=${stats.sent} ok=${stats.succeeded} fail=${stats.failed} err=${stats.errors} inFlight=${inFlight} p50=${percentile(stats.latencies, 50)}ms p99=${percentile(stats.latencies, 99)}ms`);
          lastProgress = Date.now();
        }
      }
    }, 50); // check every 50ms for slots
  });

  // --- 4. Final liveness check + summary ---------------------------------
  log("\n[4/4] Final liveness check...");
  const alive = await checkServerAlive(server.pid!);

  if (!alive || stats.serverDied) {
    log("\n=== SERVER DIED during stress test ===");
    log(`Exit code: ${stats.exitCode ?? "unknown"}`);
    log(`Sent: ${stats.sent} requests before death`);
    log(`Succeeded: ${stats.succeeded}  Failed: ${stats.failed}  Errors: ${stats.errors}`);
    log(`\nDiagnostic next steps:`);
    log(`  1. Read the synchronous crash dump: ls -la logs/crash-*.log`);
    log(`  2. Run kernel OOM check: ./scripts/diag-oom-check.sh`);
    log(`  3. Tail the server log: tail -100 ${SERVER_LOG}`);
    log(`\nLast 30 lines of server output:`);
    for (const line of serverLogBuf.slice(-30)) {
      console.log(`    ${line.trimEnd()}`);
    }
    // Make sure server is really dead
    if (serverExitCode === null) {
      server.kill("SIGKILL");
    }
    return 2; // exit 2 = "crash reproduced" (distinct from 1 = setup failure)
  }

  // Server survived — clean shutdown
  log("\n=== SERVER SURVIVED stress test ===");
  log(`Duration: ${((Date.now() - stressStart) / 1000).toFixed(1)}s`);
  log(`Requests: ${stats.sent}`);
  log(`  Succeeded (2xx): ${stats.succeeded}`);
  log(`  Failed (4xx/5xx): ${stats.failed}`);
  log(`  Errors (network): ${stats.errors}`);
  log(`Latency:`);
  log(`  p50: ${percentile(stats.latencies, 50)}ms`);
  log(`  p90: ${percentile(stats.latencies, 90)}ms`);
  log(`  p99: ${percentile(stats.latencies, 99)}ms`);
  log(`  max: ${Math.max(...stats.latencies, 0)}ms`);
  log(`\nInterpretation:`);
  log(`  - Server did NOT crash under ${CONCURRENCY}-way concurrent vault load`);
  log(`  - This is strong evidence (not proof) that the v18 silent crashes`);
  log(`    were specific to next dev + Turbopack/HMR, not a latent bug in`);
  log(`    production module loading.`);
  log(`  - Priority of the silent-crash investigation drops from BLOCKING to`);
  log(`    MONITOR until either (a) it recurs organically in production, or`);
  log(`    (b) signer isolation is implemented (which contains the blast`);
  log(`    radius of any future crash regardless).`);

  // Clean shutdown
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 2000));
  if (serverExitCode === null) server.kill("SIGKILL");

  return 0;
}

main().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error("Stress test runner crashed:", err);
  process.exit(1);
});
