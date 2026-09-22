// scripts/test-signer-dispatcher-structural.ts
//
// Phase 1 / M2.3: Structural test for the signer RPC dispatcher's
// LAYER 2 discipline (operator's Note 1 from the §7.3.7 final sign-off).
//
// This test verifies that handler exceptions PROPAGATE to the
// `uncaughtException` handler + crash-logger.ts, and are NOT silently
// swallowed by being converted to -32603 Internal Error responses.
//
// It is the dispatcher equivalent of Test 4 in test-request-peer-
// integration.ts, extended from 3 assertions to 5 to cover the
// crash-logger capture dimension (which the request-peer test does not
// exercise, since the request-peer ALS wrapper doesn't write to a
// crash log file).
//
// The 5 assertions:
//   1. PROPAGATION — the handler exception reaches `uncaughtException`
//      (observed via the process exiting with non-zero code, which only
//      happens if crash-logger.ts fired).
//   2. NO-SWALLOW — no -32603 Internal Error response is sent on the
//      socket (the socket closes without any response line).
//   3. NO-RERUN — the handler is invoked exactly once (verified by
//      counting crash log entries containing the unique marker).
//   4. CRASH-LOG CAPTURE — a `crash-uncaughtException-*.log` file was
//      created in the test's CRASH_LOG_DIR, and its contents include
//      the exact marker string from the thrown Error.
//   5. REAL-MECHANISM — live process + real Unix socket, not a unit
//      test of `dispatchRpc()`.
//
// The test uses the `__test_throw` test hook (only registered when
// SIGNER_TEST_HOOKS=1 is set at signer boot time). The hook throws an
// Error with a unique marker passed via params.marker.
//
// Run with: npx tsx scripts/test-signer-dispatcher-structural.ts
//
// PLATFORM: requires spawn + AF_UNIX. Skips entirely on Windows (EACCES);
// Linux CI runs the full suite.

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const IS_WIN = process.platform === "win32";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log("✓ PASS");
    passed++;
  } catch (err) {
    console.log("✗ FAIL");
    console.log(`    ${String(err instanceof Error ? err.message : err)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Signer process fixture (with SIGNER_TEST_HOOKS=1 + crash handlers ENABLED)
// ---------------------------------------------------------------------------

interface SignerHandle {
  child: ChildProcess;
  socketPath: string;
  pid: number;
  crashLogDir: string;
}

/**
 * Spawn the signer with test hooks enabled + crash handlers writing to
 * a unique CRASH_LOG_DIR for this test run.
 *
 * Unlike the M1 test fixture, we do NOT set DISABLE_CRASH_HANDLERS=1 —
 * we WANT the crash handlers to fire so we can verify the crash log is
 * written.
 */
async function spawnSignerForStructuralTest(crashLogDir: string): Promise<SignerHandle> {
  // Pre-create the crash log dir so the signer can write to it.
  if (!fs.existsSync(crashLogDir)) {
    fs.mkdirSync(crashLogDir, { recursive: true });
  }

  const socketPath = `/tmp/signer-structural-${process.pid}-${Date.now()}.sock`;
  try {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  } catch {
    // ignore
  }

  const child = spawn(
    "npx",
    ["tsx", path.join(__dirname, "..", "src", "signer", "main.ts")],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        SIGNER_SOCKET_PATH: socketPath,
        SIGNER_TEST_HOOKS: "1",
        CRASH_LOG_DIR: crashLogDir,
        // Ensure crash handlers are enabled (do NOT set DISABLE_CRASH_HANDLERS).
        DISABLE_CRASH_HANDLERS: "",
      },
    }
  );

  const stdoutRl = createInterface({ input: child.stdout! });

  return new Promise<SignerHandle>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`signer did not send SIGNER_READY within 10s`));
    }, 10000);

    stdoutRl.on("line", (line: string) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "SIGNER_READY") {
          clearTimeout(timeout);
          resolve({
            child,
            socketPath: msg.socketPath,
            pid: msg.pid,
            crashLogDir,
          });
        }
      } catch {
        // Not JSON — ignore.
      }
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(`signer exited before SIGNER_READY (code=${code}, signal=${signal})`)
      );
    });
  });
}

/**
 * Send an RPC frame to the signer. Returns the parsed response OR null
 * if the socket closed without sending a response line (which is what
 * happens when the signer crashes due to an uncaughtException).
 */
async function sendRpcNoThrow(
  socketPath: string,
  frame: string,
  timeoutMs = 5000
): Promise<{ jsonrpc: string; result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown }; id: number | string | null } | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(frame + "\n");
    });

    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(null); // timeout = no response
    }, timeoutMs);

    const rl = createInterface({ input: socket });
    rl.on("line", (line: string) => {
      clearTimeout(timeout);
      try {
        const resp = JSON.parse(line);
        socket.end();
        resolve(resp);
      } catch {
        socket.destroy();
        resolve(null);
      }
    });

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve(null); // socket error = no response (signer crashed)
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      // If we haven't resolved yet, this means the socket closed without
      // sending a response line — which is exactly what we expect when
      // the signer crashes on an uncaughtException.
      resolve(null);
    });
  });
}

/**
 * Wait for the child process to exit, with a timeout.
 */
async function waitForExit(child: ChildProcess, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve(null);
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

/**
 * Find the most recent crash-uncaughtException-*.log file in the dir.
 */
function findCrashLog(crashLogDir: string): string | null {
  try {
    const files = fs.readdirSync(crashLogDir);
    const crashFiles = files
      .filter((f) => f.startsWith("crash-uncaughtException-") && f.endsWith(".log"))
      .map((f) => ({ name: f, path: path.join(crashLogDir, f), mtime: fs.statSync(path.join(crashLogDir, f)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return crashFiles.length > 0 ? crashFiles[0].path : null;
  } catch {
    return null;
  }
}

/**
 * Count the number of distinct crash EVENTS for a given marker.
 *
 * Each crash event produces:
 *   1. A per-crash file named `crash-uncaughtException-<epoch>.log`
 *      (one file per crash).
 *   2. An appended entry in the rolling `crash.log` file.
 *
 * The marker string appears multiple times WITHIN a single crash entry
 * (in the message line, in the stack trace, etc.). So counting string
 * occurrences overcounts.
 *
 * The correct "no-rerun" assertion is: count the number of per-crash
 * FILES that contain the marker. Each file = one crash event. If the
 * handler was invoked exactly once, there should be exactly 1 file.
 */
function countCrashEventsForMarker(crashLogDir: string, marker: string): number {
  try {
    const files = fs.readdirSync(crashLogDir);
    let count = 0;
    for (const f of files) {
      // Only count per-crash files (not the rolling crash.log or boot.log).
      if (!f.startsWith("crash-uncaughtException-") || !f.endsWith(".log")) continue;
      const content = fs.readFileSync(path.join(crashLogDir, f), "utf8");
      if (content.includes(marker)) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// The structural test (5 assertions)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (IS_WIN) {
    console.log("=== Signer Dispatcher Structural Test — SKIP on Windows ===");
    console.log("  Requires spawn + AF_UNIX (EACCES on win32); src/signer frozen Unix-only. Linux CI runs full suite.");
    process.exit(0);
  }
  console.log("=== Structural test for dispatcher LAYER 2 discipline ===\n");
  console.log("=== Signer Dispatcher Structural Test Suite (Phase 1 / M2.3) ===\n");
  console.log("  (verifies LAYER 2 discipline: handler exceptions propagate, are NOT swallowed, are captured by crash-logger)\n");

  await runTest(
    "STRUCTURAL: handler exception PROPAGATES to uncaughtException — NOT swallowed, captured by crash-logger, real mechanism",
    async () => {
      // Unique marker for this test run — guarantees the crash log
      // entry we find is from THIS test, not a previous run.
      const marker = `m23-structural-${process.pid}-${Date.now()}`;
      const crashLogDir = `/tmp/signer-m23-crash-${process.pid}-${Date.now()}`;

      const handle = await spawnSignerForStructuralTest(crashLogDir);

      try {
        // Send the __test_throw RPC. The handler will throw an Error
        // with our marker in the message. We do NOT expect a response —
        // the dispatcher's .then() is never called because the promise
        // rejects, and the rejection propagates as an unhandledRejection
        // (Node 15+ treats this as a crash).
        const resp = await sendRpcNoThrow(
          handle.socketPath,
          JSON.stringify({
            jsonrpc: "2.0",
            method: "__test_throw",
            params: { marker },
            id: 1,
          })
        );

        // Wait for the child to exit (the crash handler calls process.exit(1)).
        const exitCode = await waitForExit(handle.child);

        // Give the filesystem a moment to flush (the crash handler uses
        // writeFileSync, so this should already be done, but be defensive).
        await new Promise((r) => setTimeout(r, 100));

        // ---------------------------------------------------------------
        // ASSERTION 1: PROPAGATION
        // The handler exception reached `uncaughtException` → crash-logger
        // fired → process exited with code 1. If the exception had been
        // swallowed (converted to -32603), the process would still be
        // alive and exitCode would be null (timeout) or 0.
        // ---------------------------------------------------------------
        assert(
          exitCode === 1,
          `ASSERTION 1 (PROPAGATION) FAILED: expected exitCode=1 (crash handler fired), got exitCode=${exitCode}`
        );

        // ---------------------------------------------------------------
        // ASSERTION 2: NO-SWALLOW
        // No -32603 Internal Error response was sent on the socket.
        // The socket closed without any response line. If the dispatcher
        // had caught the exception and converted it to -32603, we would
        // have received a JSON response with error.code === -32603.
        // ---------------------------------------------------------------
        assert(
          resp === null,
          `ASSERTION 2 (NO-SWALLOW) FAILED: expected no response (socket closed on crash), got ${JSON.stringify(resp)}`
        );

        // ---------------------------------------------------------------
        // ASSERTION 3: NO-RERUN
        // The handler was invoked exactly once. We verify this by
        // counting how many times the marker appears in the crash log
        // files — it should be exactly 1 (one throw → one crash log
        // entry containing the marker). If the dispatcher retried, the
        // marker would appear multiple times.
        // ---------------------------------------------------------------
        const markerCount = countCrashEventsForMarker(crashLogDir, marker);
        assert(
          markerCount === 1,
          `ASSERTION 3 (NO-RERUN) FAILED: expected exactly 1 crash event containing the marker, got ${markerCount}`
        );

        // ---------------------------------------------------------------
        // ASSERTION 4: CRASH-LOG CAPTURE
        // A crash-uncaughtException-*.log file was created in the
        // CRASH_LOG_DIR, AND its contents include the exact marker
        // string from the thrown Error (proving it's the same exception
        // object, not a different one).
        // ---------------------------------------------------------------
        const crashFile = findCrashLog(crashLogDir);
        assert(
          crashFile !== null,
          `ASSERTION 4a (CRASH-LOG CAPTURE) FAILED: no crash-uncaughtException-*.log file found in ${crashLogDir}`
        );
        const crashContent = fs.readFileSync(crashFile!, "utf8");
        assert(
          crashContent.includes(marker),
          `ASSERTION 4b (CRASH-LOG CAPTURE) FAILED: crash log does not contain the marker "${marker}". Log content:\n${crashContent.slice(0, 500)}`
        );
        // Also verify the stack trace is present (not just the message).
        assert(
          crashContent.includes("STACK TRACE:") || crashContent.includes("__test_throw"),
          `ASSERTION 4c (CRASH-LOG CAPTURE) FAILED: crash log missing stack trace. Log content:\n${crashContent.slice(0, 500)}`
        );

        // ---------------------------------------------------------------
        // ASSERTION 5: REAL-MECHANISM
        // The test exercised a LIVE signer process (spawned via spawn)
        // communicating over a REAL Unix socket (net.createConnection),
        // NOT a unit test of dispatchRpc(). This is verified by the
        // fact that we have a real pid + real socketPath + the process
        // actually crashed (exit code 1).
        // ---------------------------------------------------------------
        assert(
          handle.pid > 0,
          `ASSERTION 5 (REAL-MECHANISM) FAILED: no real pid — handle.pid=${handle.pid}`
        );
        assert(
          handle.socketPath.startsWith("/tmp/signer-structural-"),
          `ASSERTION 5 (REAL-MECHANISM) FAILED: no real socket path — handle.socketPath=${handle.socketPath}`
        );
        assert(
          exitCode === 1,
          `ASSERTION 5 (REAL-MECHANISM) FAILED: process did not really crash — exitCode=${exitCode}`
        );
      } finally {
        // Clean up the crash log dir.
        try {
          if (fs.existsSync(handle.socketPath)) fs.unlinkSync(handle.socketPath);
          // Keep the crash log dir for inspection on failure.
          if (failed === 0 && fs.existsSync(crashLogDir)) {
            fs.rmSync(crashLogDir, { recursive: true });
          }
        } catch {
          // ignore
        }
      }
    }
  );

  // ---------------------------------------------------------------------
  // Complementary test: the happy-path test hook (__test_inspect_vault)
  // returns a normal response (does NOT crash). This verifies that the
  // test-hook infrastructure itself is sound — only __test_throw crashes.
  // ---------------------------------------------------------------------
  await runTest(
    "COMPLEMENTARY: __test_inspect_vault returns normal response (test hooks are sound)",
    async () => {
      const crashLogDir = `/tmp/signer-m23-inspect-${process.pid}-${Date.now()}`;
      const handle = await spawnSignerForStructuralTest(crashLogDir);

      try {
        const resp = await sendRpcNoThrow(
          handle.socketPath,
          JSON.stringify({
            jsonrpc: "2.0",
            method: "__test_inspect_vault",
            id: 2,
          })
        );

        assert(resp !== null, "expected a normal response from __test_inspect_vault");
        assert(resp!.error === undefined, `__test_inspect_vault must not return error — got ${JSON.stringify(resp!.error)}`);
        assert(resp!.result !== undefined, "__test_inspect_vault must return result");
        const result = resp!.result as { unlocked: boolean; walletCount: number; exchangeCount: number };
        assertEq(result.unlocked, false, "vault should be locked at boot");
        assertEq(result.walletCount, 0, "no wallets loaded at boot");
        assertEq(result.exchangeCount, 0, "no exchanges loaded at boot");

        // The process should still be alive — verify by sending a
        // health_check.
        const healthResp = await sendRpcNoThrow(
          handle.socketPath,
          JSON.stringify({ jsonrpc: "2.0", method: "health_check", id: 3 })
        );
        assert(healthResp !== null, "signer should still respond to health_check after __test_inspect_vault");
        assertEq(healthResp!.result?.status, "ok", "signer is alive");
      } finally {
        // Clean up: close stdin to trigger the parent-disconnect handler.
        if (handle.child.stdin && !handle.child.stdin.destroyed) {
          handle.child.stdin.end();
        }
        await waitForExit(handle.child, 3000);
        try {
          if (fs.existsSync(handle.socketPath)) fs.unlinkSync(handle.socketPath);
          if (fs.existsSync(crashLogDir)) fs.rmSync(crashLogDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    }
  );

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERT FAILED: ${msg}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`
    );
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
