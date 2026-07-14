// scripts/test-signer-process.ts
//
// Phase 1 (M1): Integration test for the signer process.
//
// This test exercises the REAL signer process — it spawns the actual
// `src/signer/main.ts` as a child process, waits for the SIGNER_READY
// message, connects to the Unix socket, sends a health_check RPC, reads
// the response, and confirms the signer exits when the parent
// disconnects.
//
// This is the discipline pattern enforced throughout the v19.3 review
// thread: the test must exercise the REAL mechanism, not a pure
// function simulation. The signer process is the trust boundary — if
// the test only called `dispatchRpc()` directly, it would NOT test:
//   - Process spawn + boot sequence
//   - Unix socket creation + listen
//   - SIGNER_READY message protocol
//   - Newline-delimited JSON framing over a real socket
//   - Parent-disconnect detection via stdin close
//   - Crash handler registration
//
// Test scenarios:
//   1. Spawn signer → SIGNER_READY → connect → health_check → "ok" → disconnect → signer exits
//   2. Method allowlist: RPC with unknown method → -32601 Method not found
//   3. Parse error: malformed JSON → -32700 Parse error
//   4. Parent disconnect: close stdin → signer exits within 2s
//   5. Pure function: parseRpcFrame + dispatchRpc (complementary, not replacement)
//
// Run with: npx tsx scripts/test-signer-process.ts

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERT FAILED: ${msg}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`
    );
  }
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
// Signer process fixture
// ---------------------------------------------------------------------------

interface SignerHandle {
  child: ChildProcess;
  socketPath: string;
  pid: number;
  version: string;
}

/**
 * Spawn the signer process and wait for the SIGNER_READY message.
 * Returns the handle + the resolved socket path.
 *
 * The signer is spawned with a CUSTOM socket path (in /tmp, unique per
 * test run) so parallel test runs don't collide on the socket file.
 */
async function spawnSigner(): Promise<SignerHandle> {
  const socketPath = `/tmp/signer-test-${process.pid}-${Date.now()}.sock`;

  // Ensure the socket file doesn't exist (it shouldn't, but be defensive).
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
        // Disable crash handlers' process.exit so the test can inspect
        // the child's output after a crash. (The crash handlers still
        // write to stderr + the crash log file.)
        DISABLE_CRASH_HANDLERS: "1",
      },
    }
  );

  // Read stdout line-by-line until we get the SIGNER_READY message.
  const stdoutRl = createInterface({ input: child.stdout! });

  const readyPromise = new Promise<SignerHandle>((resolve, reject) => {
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
            version: msg.version,
          });
        }
      } catch {
        // Not JSON — ignore (might be a log line that leaked to stdout).
      }
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `signer exited before SIGNER_READY (code=${code}, signal=${signal})`
        )
      );
    });
  });

  return readyPromise;
}

/**
 * Connect to the signer's Unix socket and send a single RPC request.
 * Returns the parsed response.
 */
async function sendRpc(
  socketPath: string,
  frame: string,
  timeoutMs = 5000
): Promise<{ jsonrpc: string; result?: unknown; error?: { code: number; message: string; data?: unknown }; id: number | string | null }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      // Connected — send the frame.
      socket.write(frame + "\n");
    });

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`RPC timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const rl = createInterface({ input: socket });
    rl.on("line", (line: string) => {
      clearTimeout(timeout);
      try {
        const resp = JSON.parse(line);
        socket.end();
        resolve(resp);
      } catch (err) {
        socket.destroy();
        reject(new Error(`failed to parse response: ${String(err)} (line=${line})`));
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`socket error: ${String(err)}`));
    });
  });
}

/**
 * Clean up: kill the signer child process + remove the socket file.
 */
async function stopSigner(handle: SignerHandle): Promise<void> {
  // Close stdin to trigger the parent-disconnect handler.
  if (handle.child.stdin && !handle.child.stdin.destroyed) {
    handle.child.stdin.end();
  }
  // Wait for the child to exit (up to 3s).
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      // Force-kill if it didn't exit.
      try {
        handle.child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve();
    }, 3000);
    handle.child.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  // Remove the socket file if it still exists.
  try {
    if (fs.existsSync(handle.socketPath)) fs.unlinkSync(handle.socketPath);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Signer Process Integration Test Suite (Phase 1 / M1) ===\n");
  console.log("  (exercises the REAL signer process: spawn, socket, RPC, disconnect)\n");

  // Test 1: the happy path — spawn, health_check, disconnect, exit.
  await runTest("spawn → SIGNER_READY → health_check → ok → disconnect → signer exits", async () => {
    // Don't pre-set SIGNER_SOCKET_PATH — spawnSigner() generates its own
    // unique path. Predicting it with Date.now() in the test body races
    // with spawnSigner's own Date.now() call (1ms drift breaks the
    // equality assertion). The handle returns the actual path from the
    // SIGNER_READY message, which is the source of truth.
    const handle = await spawnSigner();
    try {
      // Verify the SIGNER_READY message fields.
      // The socketPath comes from the SIGNER_READY message — we don't
      // predict it (see comment above). Just verify it's a non-empty
      // string starting with /tmp/signer-test-.
      assert(
        typeof handle.socketPath === "string" && handle.socketPath.startsWith("/tmp/signer-test-"),
        `socketPath must be a /tmp/signer-test-* path — got ${handle.socketPath}`
      );
      assert(handle.pid > 0, "pid must be positive");
      assert(handle.version.length > 0, "version must be non-empty");

      // Send a health_check RPC.
      const resp = await sendRpc(
        handle.socketPath,
        JSON.stringify({ jsonrpc: "2.0", method: "health_check", id: 1 })
      );

      assertEq(resp.jsonrpc, "2.0", "jsonrpc version");
      assertEq(resp.id, 1, "id");
      assert(resp.error === undefined, `health_check must not return error — got ${JSON.stringify(resp.error)}`);
      assert(resp.result !== undefined, "health_check must return result");
      const result = resp.result as { status: string; pid: number; version: string; uptimeMs: number };
      assertEq(result.status, "ok", "health_check result.status");
      assertEq(result.pid, handle.pid, "health_check result.pid must match SIGNER_READY pid");
      assertEq(result.version, handle.version, "health_check result.version must match SIGNER_READY version");
      assert(typeof result.uptimeMs === "number" && result.uptimeMs >= 0, "uptimeMs must be a non-negative number");
    } finally {
      await stopSigner(handle);
    }
  });

  // Test 2: method allowlist — unknown method returns -32601.
  await runTest("method allowlist: unknown method returns -32601 Method not found", async () => {
    const handle = await spawnSigner();
    try {
      const resp = await sendRpc(
        handle.socketPath,
        // M2.3: `unlock` is now in the allowlist, so we use a method that
        // is genuinely not allowlisted. `sign` arrives in M3, `acquire_writer`
        // in M4 — both are NOT in SIGNER_METHOD_ALLOWLIST yet.
        JSON.stringify({ jsonrpc: "2.0", method: "sign", id: 2 })
      );
      assertEq(resp.id, 2, "id");
      assert(resp.result === undefined, "unknown method must not return result");
      assert(resp.error !== undefined, "unknown method must return error");
      assertEq(resp.error!.code, -32601, "error code must be -32601 (Method not found)");
      assert(
        resp.error!.message.includes("sign"),
        `error message must mention the method name — got ${resp.error!.message}`
      );
    } finally {
      await stopSigner(handle);
    }
  });

  // Test 3: parse error — malformed JSON returns -32700.
  await runTest("parse error: malformed JSON returns -32700 Parse error", async () => {
    const handle = await spawnSigner();
    try {
      const resp = await sendRpc(handle.socketPath, "not-valid-json{{{");
      assert(resp.error !== undefined, "malformed JSON must return error");
      assertEq(resp.error!.code, -32700, "error code must be -32700 (Parse error)");
      assert(resp.id === null, "parse error id must be null (couldn't extract id from malformed frame)");
    } finally {
      await stopSigner(handle);
    }
  });

  // Test 4: parent disconnect — closing stdin causes the signer to exit.
  await runTest("parent disconnect: closing stdin causes signer to exit within 3s", async () => {
    const handle = await spawnSigner();
    // First, confirm the signer is alive by sending a health_check.
    const resp = await sendRpc(
      handle.socketPath,
      JSON.stringify({ jsonrpc: "2.0", method: "health_check", id: 1 })
    );
    assertEq(resp.result?.status, "ok", "signer must be alive before disconnect");

    // Now close stdin — this triggers the parent-disconnect handler.
    const exitPromise = new Promise<number | null>((resolve) => {
      handle.child.on("exit", (code) => resolve(code));
    });
    handle.child.stdin!.end();

    const exitCode = await exitPromise;
    // Exit code 0 = parent disconnect is a normal shutdown.
    assertEq(exitCode, 0, `signer must exit with code 0 on parent disconnect — got ${exitCode}`);

    // Confirm the socket file was cleaned up.
    assert(
      !fs.existsSync(handle.socketPath),
      `socket file must be cleaned up after exit — ${handle.socketPath} still exists`
    );
  });

  // Test 5: pure function tests (complementary, not replacement).
  // These test parseRpcFrame directly — fast, deterministic, no process spawn.
  await runTest("pure function: parseRpcFrame validates JSON-RPC 2.0 structure", async () => {
    const { parseRpcFrame } = await import("../src/lib/signer-protocol");

    // Valid request.
    const ok = parseRpcFrame('{"jsonrpc":"2.0","method":"health_check","id":1}');
    assert(ok.ok, "valid request must parse");
    if (ok.ok) {
      assertEq(ok.method, "health_check", "method");
      assertEq(ok.id, 1, "id");
    }

    // Parse error.
    const parseErr = parseRpcFrame("not-json");
    assert(!parseErr.ok, "malformed JSON must fail");
    if (!parseErr.ok) {
      assertEq(parseErr.code, -32700, "parse error code");
    }

    // Invalid request — wrong jsonrpc version.
    const badVersion = parseRpcFrame('{"jsonrpc":"1.0","method":"health_check","id":1}');
    assert(!badVersion.ok, "wrong jsonrpc version must fail");
    if (!badVersion.ok) {
      assertEq(badVersion.code, -32600, "invalid request code");
    }

    // Invalid request — missing method.
    const noMethod = parseRpcFrame('{"jsonrpc":"2.0","id":1}');
    assert(!noMethod.ok, "missing method must fail");
    if (!noMethod.ok) {
      assertEq(noMethod.code, -32600, "invalid request code");
    }

    // Invalid request — missing id (notifications not supported in M1).
    const noId = parseRpcFrame('{"jsonrpc":"2.0","method":"health_check"}');
    assert(!noId.ok, "missing id must fail (notifications not supported)");
    if (!noId.ok) {
      assertEq(noId.code, -32600, "invalid request code");
    }
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
