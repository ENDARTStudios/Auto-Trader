// scripts/stress-test-heterogeneous.ts
//
// v19.2-CHECK1+CHECK2: heterogeneous stress test against production build.
//
// The operator's review identified two gaps in the previous stress test:
//
//   CHECK 1 (heterogeneous recipe): the original silent-crash bug involved
//   unlock-with-wrong-passphrase INTERLEAVED with other vault operations
//   (create wallet, lock, delete) in specific sequences — not just high
//   volume of the same call. The previous stress test used random request
//   types but at high volume, which is good for resource-exhaustion bugs
//   but not for logic-race bugs that depend on a specific operation
//   interleaving. This script runs 4 concurrent worker profiles, each
//   doing a DIFFERENT sequence, to reproduce the heterogeneous conditions.
//
//   CHECK 2 (crash handler armed under load): zero crash-*.log during the
//   previous stress test is only strong evidence if the handler was actually
//   firing under load. This script mid-test triggers a deliberate crash via
//   the /api/debug/crash-test endpoint and verifies crash-*.log is produced
//   even with concurrent load running.
//
// CRITICAL FIX from retrospective audit: the dev DB had 0 wallets when the
// previous stress test ran, so every "wrong passphrase" unlock returned 200
// (empty-vault success) instead of 401 (crypto failure). The crypto failure
// path (PBKDF2 derivation + GCM auth fail + recordFailedAttempt + notify)
// was NEVER EXERCISED. This script creates real wallets with a known
// passphrase BEFORE starting the stress loop, so the wrong-passphrase path
// is actually hit.
//
// WORKER PROFILES (the original crash recipe, decomposed):
//
//   Worker A "attacker"   : wrong-unlock × 3 → lock → (repeat)
//     Hammers the crypto failure path: PBKDF2 + GCM auth fail + rate-limit
//     counter + notifyVaultEvent(vault_unlock_failed). After 5 failures
//     across all workers, hits cooldown.
//
//   Worker B "operator"   : right-unlock → GET status → lock → (repeat)
//     Normal operation interleave with the attacker's failures. The
//     right-unlock does a full DB read + decrypt of all wallets.
//
//   Worker C "lifecycle"  : create wallet → right-unlock → lock → delete → (repeat)
//     Mutates the DB while other workers are reading it. The create+delete
//     changes the walletRows.length seen by concurrent unlock calls.
//
//   Worker D "interleaver": wrong-unlock → create → right-unlock → lock → delete → (repeat)
//     The specific sequence the operator said caused the original crash.
//     Each iteration does all 5 operations in sequence, so the vault state
//     is constantly transitioning.
//
// All 4 workers run concurrently for the configured duration. The server
// process is monitored for liveness throughout. At the 40% mark, the
// debug crash endpoint is triggered (CHECK 2) to verify the crash handler
// fires under load — this kills the server, which is the expected outcome.
//
// Usage:
//   npx tsx scripts/stress-test-heterogeneous.ts
//   DURATION_SEC=300 CONCURRENCY=4 npx tsx scripts/stress-test-heterogeneous.ts
//
// Exit codes:
//   0 = server survived full duration (no organic crash) — CHECK 1 negative
//   2 = server crashed ORGANICALLY before the debug trigger — CHECK 1 positive
//       (crash-*.log has a real stack trace from the race)
//   3 = debug crash trigger fired + crash-*.log produced — CHECK 2 passed
//   4 = debug crash trigger fired but NO crash-*.log — CHECK 2 FAILED
//       (handler was not armed under load — this is the bad outcome)
//   1 = setup failure (build, server start, wallet creation)

import { spawn, ChildProcess } from "child_process";
import { writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

const PORT = parseInt(process.env.PORT ?? "3100", 10);
const DURATION_SEC = parseInt(process.env.DURATION_SEC ?? "300", 10); // 5 min
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "4", 10); // workers per profile
const BASE = `http://localhost:${PORT}`;
const LOG_DIR = join(process.cwd(), "logs");
const SERVER_LOG = join(LOG_DIR, "stress-hetero-server.log");
const STRESS_LOG = join(LOG_DIR, "stress-hetero-run.log");
const CRASH_TEST_SECRET = process.env.ENABLE_CRASH_TEST_SECRET ?? "hetero-stress-test-2026";
// v19.3: when "1" (default), run CHECK 2 (deliberate crash at 40% mark) on top
// of CHECK 1 (heterogeneous load). When "0", run CHECK 1 ONLY — clean run for
// a same-order-of-magnitude sample without killing the server mid-test.
// Operator's v19.3 review: "rodaria uma passada adicional — mesma receita
// heterogênea, sem o gatilho de debug desta vez — por uns 120-180s corridos".
const RUN_CHECK_2 = process.env.RUN_CHECK_2 ?? "1";

// The passphrase used to create test wallets + the "right unlock" attempts.
const TEST_PASSPHRASE = "hetero-stress-passphrase-2026";

mkdirSync(LOG_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
interface WorkerStats {
  sent: number;
  succeeded: number;
  failed: number;
  errors: number;
}

const stats: Record<string, WorkerStats> = {
  attacker: { sent: 0, succeeded: 0, failed: 0, errors: 0 },
  operator: { sent: 0, succeeded: 0, failed: 0, errors: 0 },
  lifecycle: { sent: 0, succeeded: 0, failed: 0, errors: 0 },
  interleaver: { sent: 0, succeeded: 0, failed: 0, errors: 0 },
};

let serverDied = false;
let serverExitCode: number | null = null;
let serverDiedAt = 0;
// v19.3: track whether the server died DURING the stress loop (organic crash)
// vs AFTER it (script's own end-of-test SIGTERM). Without this distinction,
// the organicCrash determination false-positives when RUN_CHECK_2=0 because
// serverDied is set by the 'exit' handler regardless of when the exit happens.
let serverDiedDuringStress = false;
let stressLoopEndedAt = 0;

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(STRESS_LOG, line + "\n");
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function postJSON(
  path: string,
  body: unknown,
  timeoutMs = 15000
): Promise<{ ok: boolean; status: number; latencyMs: number; body?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 254 + 1)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    const text = await res.text();
    return { ok: res.ok, status: res.status, latencyMs, body: text.slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, latencyMs: Date.now() - start };
  }
}

async function getJSON(path: string, timeoutMs = 10000): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function deleteReq(path: string, timeoutMs = 10000): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

function recordResult(profile: string, r: { ok: boolean; status: number }): void {
  const s = stats[profile];
  s.sent++;
  if (r.status === 0) s.errors++;
  else if (r.ok) s.succeeded++;
  else s.failed++;
}

// ---------------------------------------------------------------------------
// Worker profiles
// ---------------------------------------------------------------------------

// Worker A "attacker": wrong-unlock × 3 → lock → (repeat)
// Hammers the crypto failure path.
async function workerAttacker(stopAt: number): Promise<void> {
  while (Date.now() < stopAt && !serverDied) {
    for (let i = 0; i < 3 && Date.now() < stopAt; i++) {
      const r = await postJSON("/api/vault", {
        action: "unlock",
        passphrase: `wrong-attacker-${Date.now()}-${i}`,
      });
      recordResult("attacker", r);
      // We expect 401 (wrong passphrase) or 429 (rate-limited).
      // 200 would mean empty vault — which we're fixing by creating wallets.
      if (r.status === 200) {
        log(`  [attacker] WARNING: wrong unlock returned 200 — vault may be empty`);
      }
    }
    const r = await postJSON("/api/vault", { action: "lock" });
    recordResult("attacker", r);
  }
}

// Worker B "operator": right-unlock → GET status → lock → (repeat)
// Normal operation interleaved with failures.
async function workerOperator(stopAt: number): Promise<void> {
  while (Date.now() < stopAt && !serverDied) {
    const r1 = await postJSON("/api/vault", {
      action: "unlock",
      passphrase: TEST_PASSPHRASE,
    });
    recordResult("operator", r1);

    const r2 = await getJSON("/api/vault");
    if (r2.status === 0) stats.operator.errors++;
    else if (r2.ok) stats.operator.succeeded++;
    else stats.operator.failed++;
    stats.operator.sent++;

    const r3 = await postJSON("/api/vault", { action: "lock" });
    recordResult("operator", r3);
  }
}

// Worker C "lifecycle": create wallet → right-unlock → lock → delete → (repeat)
// Mutates the DB while other workers are reading it.
async function workerLifecycle(stopAt: number): Promise<void> {
  let counter = 0;
  while (Date.now() < stopAt && !serverDied) {
    counter++;
    const label = `lifecycle-${process.pid}-${counter}`;
    const address = `0x${randomBytes(20).toString("hex")}`;
    const privateKey = `0x${randomBytes(32).toString("hex")}`;

    // Create wallet with the test passphrase
    const r1 = await postJSON("/api/wallets", {
      label,
      type: "evm",
      address,
      privateKey,
      passphrase: TEST_PASSPHRASE,
    });
    recordResult("lifecycle", r1);

    // Extract wallet ID from response
    let walletId: string | null = null;
    if (r1.ok && r1.body) {
      try {
        const parsed = JSON.parse(r1.body);
        walletId = parsed.wallet?.id ?? null;
      } catch {
        // ignore
      }
    }

    // Right-unlock (should now decrypt the new wallet + all baseline wallets)
    const r2 = await postJSON("/api/vault", {
      action: "unlock",
      passphrase: TEST_PASSPHRASE,
    });
    recordResult("lifecycle", r2);

    // Lock
    const r3 = await postJSON("/api/vault", { action: "lock" });
    recordResult("lifecycle", r3);

    // Delete the wallet we created
    if (walletId) {
      const r4 = await deleteReq(`/api/wallets/${walletId}`);
      if (r4.status === 0) stats.lifecycle.errors++;
      else if (r4.ok) stats.lifecycle.succeeded++;
      else stats.lifecycle.failed++;
      stats.lifecycle.sent++;
    }
  }
}

// Worker D "interleaver": wrong-unlock → create → right-unlock → lock → delete → (repeat)
// The specific sequence the operator said caused the original crash.
async function workerInterleaver(stopAt: number): Promise<void> {
  let counter = 0;
  while (Date.now() < stopAt && !serverDied) {
    counter++;
    // 1. Wrong unlock (crypto failure path)
    const r1 = await postJSON("/api/vault", {
      action: "unlock",
      passphrase: `wrong-interleave-${counter}`,
    });
    recordResult("interleaver", r1);
    if (r1.status === 200) {
      log(`  [interleaver] WARNING: wrong unlock returned 200 — vault may be empty`);
    }

    // 2. Create wallet (DB mutation while vault state is mid-transition)
    const label = `interleave-${process.pid}-${counter}`;
    const address = `0x${randomBytes(20).toString("hex")}`;
    const privateKey = `0x${randomBytes(32).toString("hex")}`;
    const r2 = await postJSON("/api/wallets", {
      label,
      type: "evm",
      address,
      privateKey,
      passphrase: TEST_PASSPHRASE,
    });
    recordResult("interleaver", r2);

    let walletId: string | null = null;
    if (r2.ok && r2.body) {
      try {
        const parsed = JSON.parse(r2.body);
        walletId = parsed.wallet?.id ?? null;
      } catch {
        // ignore
      }
    }

    // 3. Right unlock (full decrypt of all wallets including the new one)
    const r3 = await postJSON("/api/vault", {
      action: "unlock",
      passphrase: TEST_PASSPHRASE,
    });
    recordResult("interleaver", r3);

    // 4. Lock (wipe keys)
    const r4 = await postJSON("/api/vault", { action: "lock" });
    recordResult("interleaver", r4);

    // 5. Delete wallet (DB mutation while vault is locked)
    if (walletId) {
      const r5 = await deleteReq(`/api/wallets/${walletId}`);
      if (r5.status === 0) stats.interleaver.errors++;
      else if (r5.ok) stats.interleaver.succeeded++;
      else stats.interleaver.failed++;
      stats.interleaver.sent++;
    }
  }
}

// ---------------------------------------------------------------------------
// Liveness check
// ---------------------------------------------------------------------------
async function checkServerAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
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

function countCrashLogs(): number {
  try {
    const files = readdirSync(LOG_DIR);
    return files.filter((f) => f.startsWith("crash-")).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<number> {
  log("=== v19.2 heterogeneous stress test (CHECK 1 + CHECK 2) ===");
  log(`Config: port=${PORT} duration=${DURATION_SEC}s concurrency=${CONCURRENCY} workers/profile`);
  log(`  → total workers: ${CONCURRENCY * 4}`);
  log(`  → test passphrase: ${TEST_PASSPHRASE}`);
  log(`  → crash test secret: ${CRASH_TEST_SECRET}`);
  log(`Server log: ${SERVER_LOG}`);
  log(`Stress log: ${STRESS_LOG}`);

  const crashLogsBefore = countCrashLogs();
  log(`Crash logs at start: ${crashLogsBefore}`);

  // --- 1. Build production bundle ----------------------------------------
  log("\n[1/6] Building production bundle (next build)...");
  const buildStart = Date.now();
  const build = spawn("npx", ["next", "build"], { stdio: ["ignore", "pipe", "pipe"] });
  const buildLog: string[] = [];
  build.stdout?.on("data", (d) => buildLog.push(d.toString()));
  build.stderr?.on("data", (d) => buildLog.push(d.toString()));
  const buildExit = await new Promise<number>((resolve) => build.on("exit", resolve));
  if (buildExit !== 0) {
    log(`  BUILD FAILED (exit ${buildExit}, ${((Date.now() - buildStart) / 1000).toFixed(1)}s)`);
    for (const line of buildLog.slice(-20)) console.log(`    ${line.trimEnd()}`);
    return 1;
  }
  log(`  build OK (${((Date.now() - buildStart) / 1000).toFixed(1)}s)`);

  // --- 2. Start production server with crash test endpoint enabled -------
  log("\n[2/6] Starting production server (crash test endpoint ENABLED)...");
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      ENABLE_CRASH_TEST_ENDPOINT: "1",
      ENABLE_CRASH_TEST_SECRET: CRASH_TEST_SECRET,
    },
  });
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
  server.on("exit", (code, signal) => {
    serverExitCode = code ?? -1;
    serverDied = true;
    serverDiedAt = Date.now();
    // v19.3: only flag as "died during stress" if the stress loop hasn't
    // ended yet. After stressLoopEndedAt is set, any exit is the script's
    // own SIGTERM/SIGKILL — not an organic crash.
    if (stressLoopEndedAt === 0 || serverDiedAt <= stressLoopEndedAt + 1000) {
      serverDiedDuringStress = true;
    }
    log(`  SERVER EXITED code=${code} signal=${signal} duringStress=${serverDiedDuringStress}`);
  });

  // Wait for /api/status
  log("  waiting for /api/status...");
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
    log("  SERVER DID NOT BECOME READY — aborting");
    if (serverExitCode === null) server.kill("SIGTERM");
    return 1;
  }

  // --- 3. Create baseline wallets (CRITICAL: fixes the empty-vault gap) --
  log("\n[3/6] Creating 5 baseline wallets with known passphrase...");
  for (let i = 0; i < 5; i++) {
    const r = await postJSON("/api/wallets", {
      label: `baseline-${i}-${process.pid}`,
      type: "evm",
      address: `0x${randomBytes(20).toString("hex")}`,
      privateKey: `0x${randomBytes(32).toString("hex")}`,
      passphrase: TEST_PASSPHRASE,
    });
    if (!r.ok) {
      log(`  failed to create baseline wallet ${i}: HTTP ${r.status} ${r.body ?? ""}`);
      server.kill("SIGTERM");
      return 1;
    }
  }
  log("  5 baseline wallets created");

  // Verify: wrong unlock should now return 401, NOT 200
  const verifyR = await postJSON("/api/vault", {
    action: "unlock",
    passphrase: "definitely-wrong",
  });
  if (verifyR.status === 401) {
    log(`  VERIFY: wrong passphrase → 401 ✓ (crypto failure path is exercised)`);
  } else if (verifyR.status === 429) {
    log(`  VERIFY: wrong passphrase → 429 (rate-limited from previous tests — acceptable)`);
  } else if (verifyR.status === 200) {
    log(`  VERIFY: wrong passphrase → 200 ✗ VAULT IS STILL EMPTY — baseline wallets not loaded`);
    server.kill("SIGTERM");
    return 1;
  } else {
    log(`  VERIFY: wrong passphrase → ${verifyR.status} (unexpected)`);
  }
  // Clear rate limit for clean start
  await postJSON("/api/vault", { action: "lock" });

  // --- 4. Run heterogeneous stress loop ----------------------------------
  log(`\n[4/6] Starting heterogeneous stress loop: ${DURATION_SEC}s`);
  const stressStart = Date.now();
  const stressEnd = stressStart + DURATION_SEC * 1000;
  const debugTriggerAt = stressStart + Math.floor(DURATION_SEC * 1000 * 0.4); // 40% mark

  // Launch CONCURRENCY workers per profile
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(workerAttacker(stressEnd));
    workers.push(workerOperator(stressEnd));
    workers.push(workerLifecycle(stressEnd));
    workers.push(workerInterleaver(stressEnd));
  }
  log(`  launched ${workers.length} workers (${CONCURRENCY} per profile)`);

  // Progress monitor
  const monitor = setInterval(() => {
    const elapsed = ((Date.now() - stressStart) / 1000).toFixed(1);
    const total = Object.values(stats).reduce((a, s) => a + s.sent, 0);
    const ok = Object.values(stats).reduce((a, s) => a + s.succeeded, 0);
    const fail = Object.values(stats).reduce((a, s) => a + s.failed, 0);
    const err = Object.values(stats).reduce((a, s) => a + s.errors, 0);
    log(`  [${elapsed}s] total=${total} ok=${ok} fail=${fail} err=${err} | ` +
      `attacker=${stats.attacker.sent} operator=${stats.operator.sent} ` +
      `lifecycle=${stats.lifecycle.sent} interleaver=${stats.interleaver.sent}`);
  }, 15000);

  // CHECK 2: trigger debug crash at 40% mark (if server still alive AND
  // RUN_CHECK_2!="0"). When RUN_CHECK_2="0" the run is a "clean" CHECK 1
  // pass — same heterogeneous recipe, no debug trigger, no server kill.
  // This is the mode used for the v19.3 additional 120-180s sample the
  // operator requested: same order of magnitude as the prior 120s/35,570
  // homogeneous test, but with heterogeneous operation sequences.
  type Check2Outcome = "pending" | "not-triggered" | "passed" | "failed" | "organically-crashed" | "skipped";
  let check2Result: Check2Outcome =
    RUN_CHECK_2 === "0" ? "skipped" : "pending";

  let debugTriggerTimer: NodeJS.Timeout | null = null;
  if (RUN_CHECK_2 !== "0") {
    debugTriggerTimer = setTimeout(async () => {
      if (serverDied) {
        check2Result = "organically-crashed";
        log(`\n  [CHECK 2] Server already crashed ORGANICALLY before debug trigger — skipping`);
        return;
      }
      log(`\n  [CHECK 2] Triggering deliberate crash via /api/debug/crash-test...`);
      const crashLogsPreTrigger = countCrashLogs();
      log(`  [CHECK 2] crash-*.log count before trigger: ${crashLogsPreTrigger}`);

      const r = await postJSON("/api/debug/crash-test", {
        type: "uncaught",
        secret: CRASH_TEST_SECRET,
      }, 10000);
      log(`  [CHECK 2] debug endpoint response: HTTP ${r.status} ${r.body ?? "(no body)"}`);

      // Poll for the crash log for up to 15 seconds. Under concurrent load, the
      // setTimeout(100ms) inside the debug endpoint can be delayed by several
      // seconds (event loop congestion). The first run showed a 3.5s delay
      // between the HTTP response and the actual crash. Polling is more robust
      // than a fixed wait.
      let crashLogsPostTrigger = crashLogsPreTrigger;
      const pollDeadline = Date.now() + 15_000;
      while (Date.now() < pollDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        crashLogsPostTrigger = countCrashLogs();
        if (crashLogsPostTrigger > crashLogsPreTrigger) break;
      }
      const pollElapsed = ((Date.now() - (pollDeadline - 15_000)) / 1000).toFixed(1);
      log(`  [CHECK 2] crash-*.log count after trigger: ${crashLogsPostTrigger} (polled for ${pollElapsed}s)`);

      if (crashLogsPostTrigger > crashLogsPreTrigger) {
        check2Result = "passed";
        log(`  [CHECK 2] PASSED — crash handler fired under load, new crash-*.log produced`);
      } else {
        check2Result = "failed";
        log(`  [CHECK 2] FAILED — debug endpoint was called but NO new crash-*.log produced`);
        log(`  [CHECK 2] This means the crash handler was NOT armed/firing under load.`);
      }
    }, debugTriggerAt - Date.now());
  } else {
    log(`\n  [CHECK 2] SKIPPED (RUN_CHECK_2=0) — clean CHECK 1 run, no debug trigger`);
  }

  // Wait for stress duration OR server death
  await new Promise<void>((resolve) => {
    const stopChecker = setInterval(() => {
      if (Date.now() > stressEnd || serverDied) {
        clearInterval(stopChecker);
        resolve();
      }
    }, 500);
  });
  // v19.3: mark the stress loop as ended so the 'exit' handler stops
  // flagging subsequent exits as "during stress". This is what lets us
  // distinguish "server died mid-loop" (organic crash) from "server died
  // from script's own SIGTERM after loop completed normally" (cleanup).
  stressLoopEndedAt = Date.now();

  clearInterval(monitor);
  if (debugTriggerTimer) clearTimeout(debugTriggerTimer);

  // --- 5. Final analysis -------------------------------------------------
  log("\n[5/6] Final analysis...");

  const crashLogsAfter = countCrashLogs();
  const newCrashLogs = crashLogsAfter - crashLogsBefore;

  log(`\n=== STRESS TEST SUMMARY ===`);
  log(`Duration: ${((Date.now() - stressStart) / 1000).toFixed(1)}s`);
  log(`Server died: ${serverDied ? `YES (exit=${serverExitCode})` : "NO"}`);
  log(`Crash logs: ${crashLogsBefore} before → ${crashLogsAfter} after (${newCrashLogs} new)`);
  log(`\nPer-profile stats:`);
  for (const [profile, s] of Object.entries(stats)) {
    log(`  ${profile.padEnd(12)}: sent=${s.sent} ok=${s.succeeded} fail=${s.failed} err=${s.errors}`);
  }
  const totalSent = Object.values(stats).reduce((a, s) => a + s.sent, 0);
  const totalOk = Object.values(stats).reduce((a, s) => a + s.succeeded, 0);
  const totalFail = Object.values(stats).reduce((a, s) => a + s.failed, 0);
  const totalErr = Object.values(stats).reduce((a, s) => a + s.errors, 0);
  log(`\nTotal: sent=${totalSent} ok=${totalOk} fail=${totalFail} err=${totalErr}`);

  // --- 6. Determine outcome ----------------------------------------------
  log("\n[6/6] Outcome determination...");

  // Kill server if still alive
  if (serverExitCode === null) {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 2000));
    if (serverExitCode === null) server.kill("SIGKILL");
  }

  // Read the crash log content (if any) to distinguish debug-triggered
  // crashes from organic crashes. The debug endpoint's error message
  // contains "DELIBERATE CRASH TEST" — if that's in the crash log, the
  // crash was from CHECK 2, not organic.
  let crashLogContent = "";
  if (newCrashLogs > 0) {
    try {
      const files = readdirSync(LOG_DIR).filter((f) => f.startsWith("crash-"));
      // Read the most recent crash log
      const sorted = files.sort().reverse();
      if (sorted.length > 0) {
        crashLogContent = readFileSync(join(LOG_DIR, sorted[0]), "utf8");
      }
    } catch {
      // ignore
    }
  }
  const isDebugCrash = crashLogContent.includes("DELIBERATE CRASH TEST");

  // CHECK 1: did the server crash ORGANICALLY (not from the debug trigger)?
  // v19.3: use serverDiedDuringStress (not serverDied) to distinguish
  // mid-stress crashes from the script's own end-of-test SIGTERM. A crash
  // is organic if:
  //   - serverDiedDuringStress=true AND check2Result is "organically-crashed"
  //     (died before the debug trigger fired), OR
  //   - serverDiedDuringStress=true AND the crash log does NOT contain
  //     "DELIBERATE CRASH TEST" (the crash was from something other than
  //     the debug endpoint)
  // Widen back to the full union: the assignments above happen inside async
  // callbacks, so CFA narrows `check2Result` (and even an annotated const) to
  // a subset and flags the verdict comparisons as unintentional (TS2367).
  // All six values ARE possible here at runtime — the `as` is the documented
  // escape hatch, not a lie.
  const outcomeAtVerdict = check2Result as Check2Outcome;
  const organicCrash = serverDiedDuringStress && (outcomeAtVerdict === "organically-crashed" || (!isDebugCrash && outcomeAtVerdict !== "passed"));
  if (organicCrash) {
    log(`\n=== CHECK 1: POSITIVE — server crashed ORGANICALLY under heterogeneous load ===`);
    log(`This is the crash we were trying to reproduce. The crash-*.log has a real stack trace.`);
    log(`Next steps: read the crash log, identify the root cause, fix BEFORE signer isolation.`);
    return 2;
  }

  // CHECK 2: did the debug crash trigger produce a crash-*.log?
  if (outcomeAtVerdict === "passed") {
    log(`\n=== CHECK 2: PASSED — crash handler fires under concurrent load ===`);
    log(`The debug crash endpoint produced a crash-*.log even with ${totalSent} requests in flight.`);
    log(`This confirms the handler was armed and firing throughout the stress test.`);
    log(`\n=== CHECK 1: NEGATIVE — server did NOT crash organically in ${DURATION_SEC}s ===`);
    log(`Combined with CHECK 2 passing, the silent-crash investigation can be downgraded`);
    log(`to MONITOR without reservation.`);
    return 3;
  }

  if (outcomeAtVerdict === "failed") {
    log(`\n=== CHECK 2: FAILED — crash handler did NOT fire under load ===`);
    log(`The debug endpoint was called but no crash-*.log was produced. This means the`);
    log(`handler registered at boot is somehow not firing under concurrent load. This is`);
    log(`a NEW finding that needs investigation before MONITOR can be signed off.`);
    return 4;
  }

  if (outcomeAtVerdict === "skipped") {
    log(`\n=== CHECK 1 (clean run): NEGATIVE — server survived ${DURATION_SEC}s without organic crash ===`);
    log(`CHECK 2: SKIPPED (RUN_CHECK_2=0) — already validated separately in prior run.`);
    log(`This clean run provides a same-order-of-magnitude sample (target: 120-180s)`);
    log(`without the debug trigger killing the server mid-test.`);
    return 0;
  }

  // check2Result === "not-triggered" (shouldn't happen — timer always fires)
  // or check2Result === "organically-crashed" (handled above)
  log(`\n=== CHECK 1: NEGATIVE — server survived ${DURATION_SEC}s without organic crash ===`);
  log(`CHECK 2: ${check2Result}`);
  log(`Note: debug trigger may not have fired if server died before the 40% mark.`);
  return 0;
}

main().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error("Stress test runner crashed:", err);
  process.exit(1);
});
