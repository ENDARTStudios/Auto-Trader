// src/signer/main.ts
//
// Phase 1 (M1): Signer process entry point.
//
// This is the TRUST BOUNDARY. The signer process holds the decrypted
// private keys (after unlock) and signs transactions. The web process
// (Next.js) sends JSON-RPC requests over a Unix socket; the signer
// enforces an authorization policy (§7.3) BEFORE any key operation.
//
// A compromised web process CANNOT:
//   - Bypass the authorization policy (the policy is loaded at boot
//     from env vars, not from RPC parameters).
//   - Call arbitrary methods (the JSON-RPC dispatcher rejects any
//     method not in SIGNER_METHOD_ALLOWLIST).
//   - Read the keys directly (the keys live in the signer's memory,
//     not the web process's memory).
//   - Tamper with the audit log (the log is written by the signer to
//     a file the web process has no filesystem path to).
//
// M1 scope: the signer process boots, creates a Unix socket, accepts
// connections, handles `health_check` RPCs, and exits when the parent
// disconnects. The wallet methods (M2), signing methods (M3), writer
// lease (M4), and hash-chained audit log (M5) are added in later
// milestones.
//
// PARENT-DISCONNECT HANDLER: the signer reads from stdin. When stdin
// closes (parent process died), the signer zeroizes any in-memory keys
// and exits. This is the standard "supervisor die detection" pattern —
// it ensures the signer does not keep running with unlocked keys after
// the web process is gone. In M1, there are no keys to zeroize yet;
// the handler just exits. M2 will add the actual zeroize-on-disconnect.
//
// CRASH HANDLERS: the signer reuses `crash-logger.ts` from the web
// process. Crash logs are written to the same `logs/` directory — the
// crash record includes the pid, so signer crashes and web crashes are
// distinguishable in post-incident review.
//
// USAGE:
//   npx tsx src/signer/main.ts
//
// The signer writes a SignerReadyMessage JSON line to stdout when the
// socket is listening. The parent process reads this line to learn the
// socket path.

import net from "node:net";
import fs from "node:fs";
import { createInterface } from "node:readline";
import { registerCrashHandlers } from "@/lib/crash-logger";
import {
  DEFAULT_SOCKET_PATH_TEMPLATE,
  SIGNER_ENV,
  SIGNER_PROTOCOL_VERSION,
  isAllowedSignerMethod,
  parseRpcFrame,
  rpcError,
  rpcSuccess,
  type SignerReadyMessage,
} from "@/lib/signer-protocol";
import {
  handleWalletMethod,
  isWalletMethod,
  zeroizeVaultForDisconnect,
  inspectVaultForTest,
} from "@/signer/wallet-methods";

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------

function resolveSocketPath(): string {
  const override = process.env[SIGNER_ENV.SOCKET_PATH]?.trim();
  if (override) return override;
  return DEFAULT_SOCKET_PATH_TEMPLATE.replace("${pid}", String(process.pid));
}

function writeReadyMessage(socketPath: string): void {
  const msg: SignerReadyMessage = {
    type: "SIGNER_READY",
    pid: process.pid,
    socketPath,
    version: SIGNER_PROTOCOL_VERSION,
  };
  // Single line JSON + newline. The parent reads this line from our
  // stdout. After this line, stdout is NOT used for further protocol
  // traffic — all RPC traffic goes over the Unix socket.
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch a parsed RPC request to the appropriate handler.
 *
 * M1: only `health_check` is implemented. The handler returns a static
 * object — the signer's pid, protocol version, and uptime. This is
 * sufficient for the web process to verify the signer is alive and
 * speaking the expected protocol version.
 *
 * Later milestones add wallet methods (M2), signing methods (M3), and
 * writer-lease methods (M4). Each method handler is a function that
 * takes the parsed params and returns a `MethodHandlerResult` (success
 * object) or throws (unexpected exception — see below).
 *
 * SECURITY: the method allowlist is checked FIRST. If the method is not
 * in SIGNER_METHOD_ALLOWLIST, the dispatcher returns -32601 WITHOUT
 * invoking any handler. This is the first layer of the trust boundary —
 * a compromised web process cannot invoke internal methods even if it
 * knows their names.
 *
 * ─────────────────────────────────────────────────────────────────────
 * OPERATOR'S NOTE 1 (from the §7.3.7 final sign-off) — applied here.
 * ─────────────────────────────────────────────────────────────────────
 * The pattern that resolved the v19.3.2-draft-6 structural bug —
 * distinguishing "our setup logic failed" from "the thing we were
 * wrapping failed" via a synchronous sentinel — applies to ANY point
 * in the signer that wraps a try/catch around a call that dispatches
 * to downstream code. The dispatcher is one of the two specific
 * candidates the operator called out (the other being writer lease
 * renewal, which arrives in M4).
 *
 * The mental test to run at every such point: "if the handler I am
 * calling fails, is my catch catching THAT error, or only the error of
 * my own setup logic around it?"
 *
 * Applied to `dispatchRpc`, the answer is:
 *
 *   LAYER 1 — Allowlist check + method routing (THIS function's body,
 *   before any handler invocation):
 *     - This is OUR code. Failures here (method not in allowlist,
 *       no handler registered for an allowlisted method) are
 *       recoverable application-level errors. Return `{ ok: false,
 *       code: -32601, ... }` — the caller gets a clean RPC error
 *       response, no crash.
 *
 *   LAYER 2 — Handler invocation (`handler(params)` in M2.3+):
 *     - This is DOWNSTREAM code. The handler may throw for two
 *       reasons:
 *       (a) Application error the handler chose to throw rather than
 *           return as `{ ok: false, ... }` — a handler bug (handlers
 *           are contractually required to return error objects, see
 *           `MethodHandler` in signer-protocol.ts).
 *       (b) Genuine unexpected exception (TypeError, OOM, etc.) — a
 *           real bug.
 *     - In BOTH cases, the exception MUST propagate out of
 *       `dispatchRpc` → out of the readline 'line' listener → to
 *       Node's `uncaughtException` handler → `crash-logger.ts` writes
 *       the stack trace → the process exits + restarts.
 *     - The dispatcher MUST NOT wrap `handler(params)` in a
 *       try/catch that converts the exception to an -32603 Internal
 *       Error response. Doing so would silently swallow bugs in the
 *       handler, which is exactly the "silent failure without log"
 *       pattern that this project's crash investigation (see
 *       `docs/signer-isolation-design.md` §12, MONITOR status) exists
 *       to eliminate.
 *
 * The current M1 implementation has only `health_check`, which is a
 * pure function that cannot throw — so no try/catch is needed and the
 * distinction is moot. M2.3 will add wallet handlers (unlock, lock,
 * etc.) that DO touch the filesystem (DB) and CAN throw — at that
 * point the discipline above becomes load-bearing. The handler
 * implementations in M2.3 will:
 *
 *   - Catch EXPECTED application errors (wrong passphrase, rate
 *     limited, vault locked, empty vault) INSIDE the handler and
 *     return them as `{ ok: false, ... }` objects — the dispatcher
 *     never sees them.
 *   - Let UNEXPECTED exceptions propagate — the dispatcher never
 *     catches them, they reach `crash-logger.ts` via
 *     `uncaughtException`.
 *
 * If a future maintainer is tempted to add a top-level try/catch in
 * `dispatchRpc` "for safety" — DON'T. Read SECURITY.md REG-001 (the
 * `enteredHandler` sentinel regression) for the structural pattern
 * this discipline is defending against. The "safety" catch is the
 * exact shape that swallows bugs and turns them into silent failures.
 *
 * If a try/catch is genuinely needed around a specific handler's
 * SETUP logic (e.g., param validation that the handler does BEFORE
 * touching downstream state), the handler itself should use the
 * sentinel pattern INTERNALLY — not push the catch up to the
 * dispatcher. The dispatcher's contract is: handlers return result
 * objects OR throw unexpected exceptions; the dispatcher routes both
 * faithfully.
 */
function dispatchRpc(
  method: string,
  _params: unknown
): Promise<{ ok: true; result: unknown } | { ok: false; code: number; message: string; data?: unknown }> {
  // LAYER 1: allowlist check — OUR code, recoverable.
  if (!isAllowedSignerMethod(method) && !isTestHookMethod(method)) {
    return Promise.resolve({
      ok: false,
      code: -32601, // METHOD_NOT_FOUND
      message: `Method not found: ${method}`,
    });
  }

  // M1: health_check is a pure function.
  if (method === "health_check") {
    return Promise.resolve({
      ok: true,
      result: {
        status: "ok",
        pid: process.pid,
        version: SIGNER_PROTOCOL_VERSION,
        uptimeMs: Math.floor(process.uptime() * 1000),
      },
    });
  }

  // M2.3: wallet methods dispatched to the wallet handler module.
  // LAYER 2 starts here — the handler invocation is DOWNSTREAM code.
  // The handler is contractually required to RETURN application errors
  // as `{ ok: false, ... }`. If it THROWS, the exception propagates out
  // of `dispatchRpc` → out of the readline 'line' listener → to Node's
  // `uncaughtException` handler → crash-logger.ts writes the stack →
  // process exits + restarts.
  //
  // The dispatcher MUST NOT wrap `handleWalletMethod(...)` in a
  // try/catch that converts the exception to -32603. See the LAYER 2
  // discipline block above.
  if (isWalletMethod(method)) {
    // We RETURN the promise — the caller (rl.on('line')) awaits it.
    // If the handler throws, the rejection propagates through the
    // promise chain. We do NOT .catch() it here.
    return handleWalletMethod(method, _params);
  }

  // Test hooks (only registered when SIGNER_TEST_HOOKS=1). Used by
  // scripts/test-signer-dispatcher-structural.ts to verify the LAYER 2
  // discipline (handler exceptions propagate, are not swallowed, are
  // captured by crash-logger.ts). NEVER enabled in production.
  if (isTestHookMethod(method)) {
    return Promise.resolve(handleTestHook(method, _params));
  }

  // LAYER 1 (continued): method is in the allowlist but no handler is
  // registered for it. This is a programming error (allowlist + handler
  // should ship together per the M2.1 NOTE in signer-protocol.ts) —
  // return -32601 rather than -32603 so the caller sees "method not
  // available" rather than "internal error". The audit log entry for
  // this branch will be loud (it should never happen in a correctly-
  // wired signer).
  //
  // This branch does NOT invoke any downstream code, so the Note 1
  // discipline (don't catch downstream exceptions) does not apply here.
  process.stderr.write(
    `[signer] ALLOWLIST/HANDLER MISMATCH: method "${method}" is in the allowlist but has no handler. This is a programming error — the allowlist and handlers must ship together. Returning -32601.\n`
  );
  return Promise.resolve({
    ok: false,
    code: -32601,
    message: `Method not implemented: ${method}`,
  });
}

// ---------------------------------------------------------------------------
// Test hooks (ONLY active when SIGNER_TEST_HOOKS=1)
// ---------------------------------------------------------------------------
//
// These methods exist for ONE purpose: to verify the LAYER 2 discipline
// (operator's Note 1 from the §7.3.7 final sign-off). The structural
// dispatcher test (scripts/test-signer-dispatcher-structural.ts) needs a
// way to make a handler THROW a known exception, so it can verify that:
//
//   1. The exception propagates to `uncaughtException` (not swallowed).
//   2. No -32603 Internal Error response is sent on the socket.
//   3. crash-logger.ts writes a crash-*.log file with the stack trace.
//   4. The handler is invoked exactly once (no retry).
//   5. The mechanism is real (live process + real socket, not a unit test).
//
// The `__test_throw` method throws an Error with a unique marker message
// so the test can verify the crash log contains exactly that string.
//
// SECURITY: these methods are NEVER registered unless SIGNER_TEST_HOOKS=1
// is set. The env var is checked at boot, not at request time — a
// compromised web process cannot enable test hooks at runtime. The
// isTestHookMethod() check below is a SECOND layer of defense (defense
// in depth): even if the env var were somehow set in production, the
// isTestHookMethod() check would still reject the method unless the
// env var was set AT BOOT TIME.
//
// The operator's review of M2.3 must verify that:
//   - SIGNER_TEST_HOOKS is NOT set in any production deployment script.
//   - The test runner (test:ci) sets it ONLY for the structural test.
//   - The isTestHookMethod() function is a pure env-var check, not a
//     runtime-configurable flag.

const TEST_HOOKS_ENABLED = process.env.SIGNER_TEST_HOOKS === "1";

function isTestHookMethod(method: string): boolean {
  if (!TEST_HOOKS_ENABLED) return false;
  return method === "__test_throw" || method === "__test_inspect_vault";
}

function handleTestHook(
  method: string,
  params: unknown
): { ok: true; result: unknown } | { ok: false; code: number; message: string; data?: unknown } {
  if (method === "__test_throw") {
    // Throw an Error with a unique marker. The marker is passed in
    // params.marker so the test can verify the crash log contains
    // exactly this string.
    const p = (params ?? {}) as { marker?: unknown };
    const marker =
      typeof p.marker === "string" ? p.marker : "default-test-throw-marker";
    const err = new Error(
      `__test_throw marker=${marker} (intentional test hook — verifies LAYER 2 propagation discipline)`
    );
    // Set a custom property so the crash log + test can verify identity.
    (err as Error & { __testMarker?: string }).__testMarker = marker;
    throw err;
  }
  if (method === "__test_inspect_vault") {
    // Return the vault's stats for inspection. Used by the integration
    // test to verify the vault state after unlock/before disconnect.
    const s = inspectVaultForTest();
    return {
      ok: true,
      result: s,
    };
  }
  // Should never happen — isTestHookMethod already filtered.
  return {
    ok: false,
    code: -32601,
    message: `Unknown test hook: ${method}`,
  };
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

function handleConnection(socket: net.Socket): void {
  // Each connection gets a readline interface — we parse newline-
  // delimited JSON frames. This is the simplest framing that doesn't
  // require length-prefix parsing.
  const rl = createInterface({ input: socket });

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    const parsed = parseRpcFrame(trimmed);
    if (!parsed.ok) {
      // parseRpcFrame already determined the error code + message.
      // The id may be null (if the frame was so malformed we couldn't
      // extract an id).
      socket.write(rpcError(parsed.id, parsed.code, parsed.message));
      return;
    }

    // Dispatch to the handler. dispatchRpc returns a Promise (handlers
    // are async — they touch the DB and wallet-crypto.ts).
    //
    // CRITICAL (LAYER 2 discipline from operator's Note 1): we do NOT
    // .catch() the promise. If the handler throws, the rejection
    // propagates as an unhandledRejection → crash-logger.ts captures
    // it → process exits + restarts. We MUST NOT convert the rejection
    // to an -32603 Internal Error response on the socket — that would
    // silently swallow bugs in the handler, which is exactly the
    // "silent failure without log" pattern this project's crash
    // investigation exists to eliminate.
    //
    // The .then() below ONLY handles the success path (handler returned
    // a result object, which may still be `{ ok: false, ... }` for
    // application errors like "wrong passphrase"). Application errors
    // are written to the socket as JSON-RPC error responses. Unexpected
    // exceptions propagate as unhandled rejections.
    dispatchRpc(parsed.method, parsed.params).then(
      (result) => {
        if (result.ok) {
          socket.write(rpcSuccess(parsed.id, result.result));
        } else {
          socket.write(rpcError(parsed.id, result.code, result.message, result.data));
        }
      }
      // NOTE: no .catch() — intentional. See comment above.
    );
  });

  socket.on("error", (err) => {
    // Socket errors are NOT fatal — the connection may have been
    // reset by the peer. Log to stderr and let the connection close.
    process.stderr.write(`[signer] socket error on connection: ${String(err)}\n`);
  });

  // Note: we do NOT close the server after the first connection.
  // The web process may reconnect (e.g., after a crash + restart of
  // the web process itself). The signer stays alive until stdin
  // closes (parent disconnect) or a crash occurs.
}

// ---------------------------------------------------------------------------
// Parent-disconnect handler
// ---------------------------------------------------------------------------

function setupParentDisconnectHandler(server: net.Server): void {
  // When stdin closes, the parent process is gone. The signer MUST:
  //   1. Zeroize any in-memory keys (M2.3 — implemented).
  //   2. Close the server (stop accepting new connections).
  //   3. Exit with code 0 (parent disconnect is a normal shutdown
  //      condition, not a crash — the supervisor will not restart the
  //      signer unless the parent is also running).
  //
  // We read stdin on a readline interface so we get the 'close' event
  // when the parent process dies (stdin's read pipe closes).
  const stdinRl = createInterface({ input: process.stdin });

  stdinRl.on("close", () => {
    process.stderr.write(
      `[signer] parent disconnect detected (stdin closed) — shutting down.\n`
    );

    // M2.3: zeroize the vault BEFORE closing the server. This wipes
    // every in-memory decrypted private key + API secret, so even if
    // a memory dump were taken between disconnect and process exit,
    // the keys are gone. The audit entry (written to SIGNER_AUDIT_LOG
    // if set) records how many keys were wiped, so post-mortem review
    // can confirm the zeroization happened.
    const auditLogPath = process.env[SIGNER_ENV.AUDIT_LOG_PATH];
    try {
      const result = zeroizeVaultForDisconnect(auditLogPath);
      process.stderr.write(
        `[signer] vault zeroized on disconnect — ${result.walletsWiped} wallet(s), ${result.exchangesWiped} exchange(s) wiped.\n`
      );
    } catch (err) {
      // Zeroization failure is a CRITICAL security event — log loudly.
      // We still proceed to exit (the process is going down anyway),
      // but the operator must investigate.
      process.stderr.write(
        `[signer] CRITICAL: vault zeroization FAILED on disconnect — ${String(err)}. INVESTIGATE.\n`
      );
    }

    server.close(() => {
      process.exit(0);
    });

    // If server.close() takes too long (pending connections), force
    // exit after 2 seconds.
    setTimeout(() => {
      process.stderr.write(`[signer] server.close() timed out — forcing exit.\n`);
      process.exit(0);
    }, 2000).unref();
  });
}

// ---------------------------------------------------------------------------
// Socket file cleanup
// ---------------------------------------------------------------------------

function cleanupSocketFile(socketPath: string): void {
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch {
    // Best-effort — if cleanup fails, the next boot will fail to bind.
    // The operator can manually remove the stale socket file.
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // Register crash handlers FIRST — before anything else can throw.
  // This ensures any crash during boot (socket creation, etc.) is
  // captured by crash-logger.ts.
  registerCrashHandlers();

  const socketPath = resolveSocketPath();

  // Clean up any stale socket file from a previous crash.
  cleanupSocketFile(socketPath);

  const server = net.createServer((socket) => {
    handleConnection(socket);
  });

  server.on("error", (err) => {
    process.stderr.write(`[signer] server error: ${String(err)}\n`);
    // A server-level error is fatal — exit so the supervisor restarts.
    process.exit(1);
  });

  // Listen on the Unix socket with 0600 permissions — only the same
  // user as the signer can connect.
  server.listen(socketPath, () => {
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch {
      // Best-effort — if chmod fails, log and continue (the socket is
      // still listening, just with default permissions).
      process.stderr.write(
        `[signer] WARN: chmod 0600 on socket failed — socket may be accessible to other users.\n`
      );
    }

    // Write the SIGNER_READY message to stdout — the parent process
    // reads this to learn the socket path.
    writeReadyMessage(socketPath);

    process.stderr.write(
      `[signer] listening on ${socketPath} (pid=${process.pid}, version=${SIGNER_PROTOCOL_VERSION})\n`
    );
  });

  // Set up the parent-disconnect handler.
  setupParentDisconnectHandler(server);

  // Cleanup the socket file on normal exit signals too (SIGINT/SIGTERM).
  // The crash-logger.ts handles SIGINT/SIGTERM for the web process, but
  // the signer is a separate process — we need our own handler here.
  const cleanup = () => {
    cleanupSocketFile(socketPath);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// Run.
main();
