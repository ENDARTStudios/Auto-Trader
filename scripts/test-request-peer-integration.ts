// scripts/test-request-peer-integration.ts
//
// v19.3.2-review (operator review of v19.3.2):
//
// The operator caught that the existing scenarios 18 and 19 in test-vault.ts
// call the PURE decision function `resolveTrustedClientIp({ peerAddress, ... })`
// with synthetic peer-address values — they do NOT exercise the actual
// `http.Server.prototype.emit` monkey-patch nor the AsyncLocalStorage
// propagation. This is exactly the pattern that bit this thread three times
// (vault-empty test always "succeeds", CHECK 2 false-negative by timing):
// the riskiest piece of code is hidden behind a test that only validates the
// downstream logic.
//
// This file is the integration test the operator required:
//
//   1. Boot a REAL Node.js http.Server (not Next.js — we want to test the
//      http.Server.prototype.emit monkey-patch in isolation, without Next's
//      request pipeline in the way).
//   2. Install the monkey-patch via installRequestPeerCapture() — the same
//      function instrumentation.ts calls at boot.
//   3. Register a request handler that reads getRequestPeerAddress() from
//      the ALS and writes it to a per-request response.
//   4. Bind the server to 127.0.0.1.
//   5. Open TCP connections from TWO DISTINCT source IPs that both route to
//      loopback on Linux: 127.0.0.1 and 127.0.0.2. (The 127.0.0.0/8 range
//      is loopback in its entirety per RFC 5735 — any 127.x.x.x address
//      routes to localhost. The kernel preserves the source address the
//      socket was bound to, so req.socket.remoteAddress will be 127.0.0.1
//      OR 127.0.0.2 depending on which client interface initiated the
//      connection. This gives us two real, distinct, verifiable source IPs
//      on a single machine without Docker or network namespaces.)
//   6. Fire 5 CONCURRENT requests from each source IP — interleaved, not
//      sequential, so we genuinely exercise the ALS under concurrent
//      requests-in-flight.
//   7. Assert that the server reported the CORRECT source IP for each
//      request — i.e., the ALS did NOT leak across concurrent requests,
//      did NOT collapse to a shared value, and did NOT return null.
//   8. Additional regression assertions:
//        a. No request saw the "direct-untrusted" sentinel (that sentinel
//           was the v19.3.1 bug — it must NEVER appear).
//        b. No request saw null (which would mean the monkey-patch failed
//           to capture — surfaces as "unidentifiable-socket" downstream).
//        c. Every request from 127.0.0.1 saw exactly "127.0.0.1" — not
//           "127.0.0.2", not null, not a shared string.
//        d. Every request from 127.0.0.2 saw exactly "127.0.0.2".
//   9. EXCEPTION-PATH test: emit a fake 'request' event with a deliberately
//      malformed `req` object (no `socket` property) and confirm the
//      patchedEmit's try/catch handles it without crashing the server.
//      The handler should see peerAddress=null (which downstream maps to
//      "unidentifiable-socket") — proving the safe-degradation path the
//      operator required.
//
// Run with: npx tsx scripts/test-request-peer-integration.ts

import http from "node:http";
import net from "node:net";
import { AddressInfo } from "node:net";
import { installRequestPeerCapture, uninstallRequestPeerCaptureForTest } from "../src/lib/request-peer-capture";
import { getRequestPeerAddress } from "../src/lib/request-peer-als";

// ---------------------------------------------------------------------------
// Tiny test harness (same shape as test-vault.ts — no external dep)
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`ASSERT FAILED: ${msg}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
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
// HTTP client that binds its source address before connecting
// ---------------------------------------------------------------------------
function httpRequestWithSourceIp(
  sourceIp: string,
  port: number,
  path: string
): Promise<{ status: number; body: string; reportedPeer: string | null }> {
  return new Promise((resolve, reject) => {
    // Create a socket bound to the specific source IP — the kernel will
    // use this as the source address in the TCP SYN. For 127.0.0.1 and
    // 127.0.0.2 (both in 127.0.0.0/8 = loopback per RFC 5735), the
    // packets route to localhost but the source address is preserved.
    const socket = new net.Socket();
    socket.on("error", reject);

    socket.connect(
      { host: "127.0.0.1", port, localAddress: sourceIp },
      () => {
        const req = http.request(
          {
            createConnection: () => socket,
            method: "GET",
            path,
            host: "127.0.0.1",
            port,
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
              let reportedPeer: string | null = null;
              try {
                const parsed = JSON.parse(body);
                reportedPeer = parsed.reportedPeer ?? null;
              } catch {
                // body wasn't JSON — leave reportedPeer null
              }
              resolve({ status: res.statusCode ?? 0, body, reportedPeer });
            });
          }
        );
        req.on("error", reject);
        req.end();
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (port: number) => Promise<void>
): Promise<void> {
  // Install the monkey-patch BEFORE creating the server — this mirrors
  // what instrumentation.ts does at boot (before any http.Server exists).
  installRequestPeerCapture();
  try {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await fn(port);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    // Restore the prototype between tests so each test starts clean.
    uninstallRequestPeerCaptureForTest();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("=== Request-Peer Integration Test Suite (v19.3.2-review) ===\n");
  console.log("  (exercises the REAL http.Server.prototype.emit monkey-patch + AsyncLocalStorage)\n");

  // Test 1: two distinct source IPs (127.0.0.1 and 127.0.0.2) do NOT share
  // a bucket — the ALS correctly isolates the peer address per-request,
  // even under concurrent requests-in-flight. This is THE test the operator
  // required (point 2 of v19.3.2-review).
  await runTest(
    "two distinct direct-IP connections under concurrency do NOT share peer-address bucket",
    async () => {
      const observed: Array<{ source: string; reported: string | null }> = [];

      await withServer(
        (_req, res) => {
          // Inside the request handler, read the peer address from the ALS.
          // This is exactly what extractTrustedClientIp does in production.
          const peer = getRequestPeerAddress();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ reportedPeer: peer }));
        },
        async (port) => {
          // Fire 5 CONCURRENT requests from each source IP, interleaved.
          // 127.0.0.1 and 127.0.0.2 are both in the loopback range
          // (RFC 5735 reserves all of 127.0.0.0/8 for loopback), so they
          // route to localhost but the kernel preserves the source IP the
          // socket was bound to.
          const sources = ["127.0.0.1", "127.0.0.2"];
          const inflight: Promise<void>[] = [];
          for (let i = 0; i < 5; i++) {
            for (const src of sources) {
              inflight.push(
                httpRequestWithSourceIp(src, port, `/req-${i}-${src}`)
                  .then(({ reportedPeer }) => {
                    observed.push({ source: src, reported: reportedPeer });
                  })
              );
            }
          }
          await Promise.all(inflight);
        }
      );

      // Assertions
      assert(observed.length === 10, `expected 10 observations, got ${observed.length}`);

      for (const obs of observed) {
        // The "direct-untrusted" sentinel must NEVER appear — that was
        // the v19.3.1 bug.
        assert(
          obs.reported !== "direct-untrusted",
          `reported peer must NOT be the "direct-untrusted" sentinel (source=${obs.source}, reported=${obs.reported})`
        );
        // null would mean the monkey-patch failed to capture — surfaces as
        // "unidentifiable-socket" downstream, which collapses all requests
        // to one bucket (back to the self-DoS bug, just renamed).
        assert(
          obs.reported !== null,
          `reported peer must NOT be null — monkey-patch failed to capture (source=${obs.source})`
        );
      }

      const from1 = observed.filter((o) => o.source === "127.0.0.1");
      const from2 = observed.filter((o) => o.source === "127.0.0.2");
      assert(from1.length === 5, `expected 5 requests from 127.0.0.1, got ${from1.length}`);
      assert(from2.length === 5, `expected 5 requests from 127.0.0.2, got ${from2.length}`);

      for (const obs of from1) {
        assertEq(
          obs.reported,
          "127.0.0.1",
          `request from 127.0.0.1 must report peer "127.0.0.1" — ALS leaked across concurrent requests`
        );
      }
      for (const obs of from2) {
        assertEq(
          obs.reported,
          "127.0.0.2",
          `request from 127.0.0.2 must report peer "127.0.0.2" — ALS leaked across concurrent requests`
        );
      }
    }
  );

  // Test 2: exception-path test — a request whose `req` object has no
  // `socket` property (simulating a malformed/custom emit) must NOT crash
  // the server. The patchedEmit's try/catch must catch the error, fall
  // back to peerAddress=null, and still dispatch the original emit.
  // The handler will see peerAddress=null (which downstream maps to
  // "unidentifiable-socket"). This is the safe-degradation path the
  // operator required (point 1 of v19.3.2-review).
  await runTest(
    "patchedEmit try/catch degrades gracefully on malformed req — server does NOT crash",
    async () => {
      // We can't easily synthesize a real 'request' event with a malformed
      // req through the http server itself — but we CAN test the
      // patchedEmit function directly by emitting a fake 'request' event
      // on a server instance with a non-IncomingMessage argument.
      installRequestPeerCapture();
      try {
        const server = http.createServer((_req, res) => {
          // This handler should NOT be called for the fake emit below —
          // because we emit 'request' directly with a fake req whose
          // .socket is undefined, the patchedEmit's try/catch should
          // catch the access error, set peerAddress=null, and dispatch
          // the original emit. The original emit then fires the
          // 'request' listeners with the fake req — but we don't have
          // any real listener for that (the createServer handler is
          // attached to the 'request' event with a different signature
          // expectation). To avoid the real handler crashing, we remove
          // it first.
        });
        // Remove the default 'request' listener so the fake emit doesn't
        // trigger the real handler.
        server.removeAllListeners("request");
        // Add a test-only listener that records the peer address from
        // the ALS — proving the patchedEmit ran the original emit inside
        // runWithPeerAddress even though req.socket threw.
        let capturedPeer: string | null = "__not_set__";
        server.on("request", (_req, _res) => {
          capturedPeer = getRequestPeerAddress();
        });

        // Emit a fake 'request' event with a deliberately malformed req
        // object. The patchedEmit will try to read `req.socket?.remoteAddress`
        // — but since `req` here is `{}` (no socket property), the
        // optional chaining returns undefined, ?? null returns null.
        // So this actually doesn't throw — it gracefully returns null.
        // That's the CORRECT behavior. To test the try/catch path, we
        // need a req whose .socket access THROWS. We use a Proxy for that.
        const throwingReq = new Proxy(
          {},
          {
            get(_target, prop) {
              if (prop === "socket") {
                throw new Error("synthetic socket access failure (v19.3.2-review test)");
              }
              return undefined;
            },
          }
        ) as unknown as http.IncomingMessage;

        // The patchedEmit should NOT throw — it should catch the proxy
        // error, fall back to peerAddress=null, and dispatch the original
        // emit. The listener above should see peerAddress=null.
        let emitThrew = false;
        try {
          server.emit("request", throwingReq, {} as http.ServerResponse);
        } catch (err) {
          emitThrew = true;
          console.log(`\n    NOTE: emit threw unexpectedly: ${String(err)}`);
        }
        assert(!emitThrew, "patchedEmit must NOT propagate exceptions through emit() — operator's explicit directive");
        assertEq(
          capturedPeer,
          null,
          `when peer-address capture throws, ALS must be set to null (downstream maps to "unidentifiable-socket") — got ${JSON.stringify(capturedPeer)}`
        );
      } finally {
        uninstallRequestPeerCaptureForTest();
      }
    }
  );

  // Test 3: regression — if the monkey-patch is NOT installed (e.g.,
  // instrumentation.ts didn't run, or the user is on Edge runtime),
  // getRequestPeerAddress() returns null. This is the documented
  // fallback — it surfaces as "unidentifiable-socket" downstream, which
  // is a NAMED bucket (visible in audit logs) rather than a silent
  // failure. This test pins that contract.
  await runTest(
    "without monkey-patch installed, getRequestPeerAddress() returns null (named bucket downstream)",
    async () => {
      // Make sure the patch is NOT installed.
      uninstallRequestPeerCaptureForTest();
      const peer = getRequestPeerAddress();
      assertEq(
        peer,
        null,
        `getRequestPeerAddress() must return null when no request context is active — got ${JSON.stringify(peer)}`
      );
    }
  );

  // Test 4: STRUCTURAL — v19.3.2-structural-review (operator's draft-6 review).
  //
  // The operator identified that the previous version of patchedEmit had a
  // single try/catch around `runWithPeerAddress(peerAddress, () => originalEmit.apply(...))`.
  // Because `AsyncLocalStorage.run(store, callback)` does NOT catch exceptions
  // thrown inside `callback`, that try/catch was catching BOTH:
  //   (a) ALS setup failures (our code, recoverable)
  //   (b) downstream handler exceptions (NOT our code, must propagate)
  //
  // For case (b) the previous code re-dispatched originalEmit, which:
  //   - ran the downstream handler TWICE (duplicate side effects)
  //   - masked the original exception with the second invocation's exception
  //   - OR silently swallowed the original exception if the second invocation
  //     happened to succeed (state mutated by first run) — exactly the
  //     "silent failure without log" pattern this investigation exists to catch.
  //
  // The fix uses a sentinel `enteredHandler` to distinguish (a) from (b).
  // For (b), the exception is re-thrown so it propagates through emit() to
  // Node's `uncaughtException` handler, where crash-logger.ts writes the
  // trace and the process exits + restarts exactly as before the patch.
  //
  // This test verifies that behavior directly: a sync exception thrown by a
  // downstream 'request' listener (simulating a real bug in Next.js's request
  // pipeline, NOT in the IP-capture code) must PROPAGATE out of server.emit()
  // and must be the SAME exception object the handler threw (not a re-dispatch
  // artifact, not a swallowed-then-reraised different error).
  await runTest(
    "STRUCTURAL: sync exception in downstream 'request' listener PROPAGATES through patchedEmit — NOT swallowed by IP-capture try/catch",
    async () => {
      installRequestPeerCapture();
      try {
        const server = http.createServer((_req, _res) => {
          // Simulate a real bug in a request handler (NOT in the IP-capture
          // code). This is exactly the scenario the operator is worried
          // about: if patchedEmit's try/catch swallows this, the request
          // would hang without a response AND no crash log would be
          // generated — turning "crash with log" into "silent hang without
          // log", which is strictly worse than the bug being fixed.
          throw new Error("simulated downstream handler crash (v19.3.2-structural-review)");
        });

        // Synthesize a fake 'request' event. We use a real IncomingMessage
        // (with a real socket) so the peer-address capture succeeds — we
        // want to reach the ALS dispatch path, not the capture-fallback
        // path (Test 2 already covers that).
        const fakeReq = new http.IncomingMessage(new net.Socket());
        const fakeRes = {} as http.ServerResponse;

        // Emit the 'request' event. The patchedEmit should:
        //   1. Capture peerAddress (succeeds — fakeReq has a socket).
        //   2. Call runWithPeerAddress(peerAddress, () => originalEmit.apply(...)).
        //   3. originalEmit fires the 'request' listeners — our handler throws.
        //   4. Exception propagates out of the arrow callback.
        //   5. Propagates out of runWithPeerAddress (ALS doesn't catch).
        //   6. Caught by patchedEmit's try/catch.
        //   7. enteredHandler is true → RE-THROW (do NOT swallow, do NOT
        //      re-dispatch).
        //
        // The throw must propagate out of server.emit('request', ...).
        let caughtErr: unknown = null;
        try {
          server.emit("request", fakeReq, fakeRes);
        } catch (err) {
          caughtErr = err;
        }

        // ASSERTION 1: the exception was NOT swallowed. If caughtErr is
        // null, the patchedEmit ate the exception — that's the regression
        // the operator is worried about.
        assert(
          caughtErr !== null,
          "sync exception from downstream handler must PROPAGATE out of server.emit('request', ...) — NOT be swallowed by patchedEmit's try/catch (this is the v19.3.2-structural-review regression)"
        );

        // ASSERTION 2: the propagated exception is the SAME exception
        // the downstream handler threw — not a re-dispatch artifact, not
        // a different error from a second invocation. If patchedEmit had
        // re-dispatched originalEmit (the old behavior), the second
        // invocation would have thrown the same error, but the FIRST
        // invocation's side effects would have happened twice. We can't
        // directly observe side-effect duplication here (the handler
        // doesn't do anything observable), but we CAN verify the
        // exception identity — if it's our specific error message, the
        // propagation path is correct.
        assert(
          caughtErr instanceof Error &&
            caughtErr.message.includes("simulated downstream handler crash"),
          `propagated exception must be the downstream handler's error (message must include "simulated downstream handler crash") — got ${String(caughtErr)}`
        );

        // ASSERTION 3 (side-effect singularity): the handler ran EXACTLY
        // ONCE, not twice. We verify this by re-running the test with a
        // handler that increments a counter, and asserting the counter
        // is 1 after the emit throws.
        let handlerCallCount = 0;
        const server2 = http.createServer((_req, _res) => {
          handlerCallCount++;
          throw new Error("simulated downstream handler crash (call-count probe)");
        });
        const fakeReq2 = new http.IncomingMessage(new net.Socket());
        const fakeRes2 = {} as http.ServerResponse;
        try {
          server2.emit("request", fakeReq2, fakeRes2);
        } catch {
          // expected — the exception propagated
        }
        assertEq(
          handlerCallCount,
          1,
          `downstream handler must be invoked EXACTLY ONCE — got ${handlerCallCount} invocations. If >1, patchedEmit is re-dispatching originalEmit after catching the downstream exception (the v19.3.2-structural-review bug). If 0, patchedEmit never reached the dispatch (a different bug).`
        );

        // Clean up the sockets we created (otherwise the test process
        // hangs on socket keepalive).
        fakeReq.socket?.destroy();
        fakeReq2.socket?.destroy();
      } finally {
        uninstallRequestPeerCaptureForTest();
      }
    }
  );

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
