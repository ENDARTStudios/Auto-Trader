/**
 * M3.1 — SignerAdapter test suite.
 *
 * This file proves the SignerAdapter (src/lib/chain/signer-adapter.ts)
 * honors its three responsibilities (mapping, protocol validation, RPC
 * serialization) without doing any of the things it explicitly must NOT
 * do (no retry, no fallback, no reconnection, no broadcast, no signing).
 *
 * Tests are organized in three categories per the operator's M3.1
 * directive:
 *
 *   CONTRACT (4 tests):
 *     A.1 — valid request → forwarded, signer accepts
 *     A.2 — invalid protocol version → SIGNER_PROTOCOL_MISMATCH
 *     A.3 — missing required field → SIGNER_INVALID_REQUEST
 *     A.4 — payload altered mid-flight → SIGNER_PAYLOAD_CORRUPTED
 *
 *   TRANSPORT (4 tests):
 *     B.1 — signer offline → SIGNER_UNAVAILABLE
 *     B.2 — timeout → SIGNER_TIMEOUT
 *     B.3 — invalid response → SIGNER_INVALID_RESPONSE
 *     B.4 — response with incompatible version → SIGNER_PROTOCOL_MISMATCH
 *
 *   SECURITY (3 tests):
 *     C.1 — adapter does not modify payload (byte-identical forward)
 *     C.2 — adapter does not ignore errors (propagates as ok=false)
 *     C.3 — adapter does not fallback (no retry, no version fallback)
 *
 * PLUS one integration test against the REAL signer process:
 *
 *   D.1 — real signer + adapter with wrong expectedProtocolVersion →
 *         adapter's pre-flight health_check detects mismatch and
 *         returns SIGNER_PROTOCOL_MISMATCH without sending the sign
 *         request. This is the real-mechanism test for property A.2.
 *
 * Run: npx tsx scripts/test-m3-signer-adapter.ts
 */

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { createHash, randomUUID } from "node:crypto";

import {
  SignerAdapter,
  SignerAdapterError,
  type SignerTransport,
  type RpcResponse,
  type SignerWireRequest,
} from "../src/lib/chain/signer-adapter";
import type { SignerRequest, SignerResult } from "../src/lib/chain/pipeline";
import {
  SIGNER_PROTOCOL_VERSION,
  RPC_ERROR_CODES,
} from "../src/lib/signer-protocol";

// -------------------------------------------------------------------------
// Test runner
// -------------------------------------------------------------------------

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  \u2713 PASS`);
    pass++;
  } else {
    console.log(`  \u2717 FAIL: ${msg}`);
    fail++;
    process.exitCode = 1;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok = actual === expected;
  if (ok) {
    console.log(`  \u2713 PASS — ${label}`);
    pass++;
  } else {
    console.log(`  \u2717 FAIL — ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    fail++;
    process.exitCode = 1;
  }
}

function assertStartsWith(actual: string, prefix: string, label: string): void {
  if (actual.startsWith(prefix)) {
    console.log(`  \u2713 PASS — ${label}`);
    pass++;
  } else {
    console.log(`  \u2717 FAIL — ${label}: expected prefix "${prefix}", got: ${JSON.stringify(actual)}`);
    fail++;
    process.exitCode = 1;
  }
}

// -------------------------------------------------------------------------
// Mock transport — records every call and returns scripted responses.
// -------------------------------------------------------------------------

interface MockCall {
  method: string;
  params: unknown;
  timeoutMs: number;
}

/**
 * MockSignerTransport — a test double for SignerTransport.
 *
 * Configurable per-test via the `mode` field:
 *   - "ok"          — returns a successful sign response (with valid echo)
 *   - "ok-mismatch-version" — health_check returns a different version
 *   - "reject"      — returns ok=false with a signer-side rejection
 *   - "rpc-error"   — returns a JSON-RPC error
 *   - "throw-timeout" — throws a timeout-shaped error
 *   - "throw-offline" — throws a connection-shaped error
 *   - "malformed"   — returns a non-object result
 *   - "wrong-request-id" — returns a response with mismatched requestId
 *   - "wrong-payload-hash" — returns a response with mismatched payloadHash
 *   - "ok-no-txhash" — returns ok=true but no txHash
 *
 * Records every call in `calls` so tests can verify the adapter sent
 * the right method/params/timeout.
 */
class MockSignerTransport implements SignerTransport {
  calls: MockCall[] = [];
  mode: string = "ok";
  /** Custom handler — overrides `mode` if set. */
  handler: ((method: string, params: unknown) => RpcResponse | Promise<RpcResponse>) | null = null;
  /** Custom thrower — overrides `mode` if set. */
  thrower: ((method: string, params: unknown) => Error) | null = null;
  /** The "signer's" version — used for health_check responses. */
  signerVersion: string = SIGNER_PROTOCOL_VERSION;

  reset(): void {
    this.calls = [];
    this.mode = "ok";
    this.handler = null;
    this.thrower = null;
    this.signerVersion = SIGNER_PROTOCOL_VERSION;
  }

  async rpc(method: string, params: unknown, timeoutMs: number): Promise<RpcResponse> {
    this.calls.push({ method, params, timeoutMs });

    if (this.thrower) {
      throw this.thrower(method, params);
    }
    if (this.handler) {
      return this.handler(method, params);
    }

    // health_check probe
    if (method === "health_check") {
      return {
        ok: true,
        result: {
          status: "ok",
          pid: 12345,
          version: this.signerVersion,
          uptimeMs: 1000,
        },
      };
    }

    // sign request
    const wireReq = params as SignerWireRequest;
    return this.handleSign(wireReq);
  }

  private handleSign(wireReq: SignerWireRequest): RpcResponse {
    switch (this.mode) {
      case "ok":
        return {
          ok: true,
          result: {
            ok: true,
            txHash: "0x" + "ab".repeat(32),
            requestId: wireReq.requestId,
            receivedPayloadHash: wireReq.payloadHash,
            signerVersion: this.signerVersion,
          },
        };

      case "reject":
        return {
          ok: true,
          result: {
            ok: false,
            error: "SIGNER_REJECTED: vault locked",
            requestId: wireReq.requestId,
            receivedPayloadHash: wireReq.payloadHash,
            signerVersion: this.signerVersion,
          },
        };

      case "rpc-error":
        return {
          ok: false,
          error: { code: RPC_ERROR_CODES.VAULT_LOCKED, message: "vault locked" },
        };

      case "rpc-error-protocol-mismatch":
        return {
          ok: false,
          error: {
            code: RPC_ERROR_CODES.POLICY_VIOLATION,
            message: `${SignerAdapterError.PROTOCOL_MISMATCH}: protocolVersion 0.0.0-bad does not match signer version ${SIGNER_PROTOCOL_VERSION}`,
          },
        };

      case "malformed":
        return { ok: true, result: "not-an-object" };

      case "wrong-request-id":
        return {
          ok: true,
          result: {
            ok: true,
            txHash: "0x" + "cd".repeat(32),
            requestId: "different-request-id",
            receivedPayloadHash: wireReq.payloadHash,
            signerVersion: this.signerVersion,
          },
        };

      case "wrong-payload-hash":
        return {
          ok: true,
          result: {
            ok: true,
            txHash: "0x" + "ef".repeat(32),
            requestId: wireReq.requestId,
            receivedPayloadHash: "0x" + "00".repeat(32),
            signerVersion: this.signerVersion,
          },
        };

      case "ok-no-txhash":
        return {
          ok: true,
          result: {
            ok: true,
            requestId: wireReq.requestId,
            receivedPayloadHash: wireReq.payloadHash,
            signerVersion: this.signerVersion,
          },
        };

      default:
        throw new Error(`MockSignerTransport: unknown mode "${this.mode}"`);
    }
  }
}

// -------------------------------------------------------------------------
// Fixtures — a valid SignerRequest.
// -------------------------------------------------------------------------

function validSignerRequest(): SignerRequest {
  return {
    tx: {
      from: "0x0000000000000000000000000000000000000003",
      to: "0x0000000000000000000000000000000000000002",
      value: "0",
      data: "0x",
    },
    expectedDiff: {
      changes: [
        {
          kind: "erc20_transfer",
          token: "0x0000000000000000000000000000000000000001",
          from: "0x0000000000000000000000000000000000000002",
          to: "0x0000000000000000000000000000000000000003",
          amount: "1000000000000000000",
        },
      ],
      maxGas: 500000,
    },
    approvedAmount: "1000000000000000000",
    slippageLimitBps: 50,
    sandwichScore: 0,
  };
}

// -------------------------------------------------------------------------
// Real signer process fixture — for the integration test (D.1).
// -------------------------------------------------------------------------

interface SignerHandle {
  child: ChildProcess;
  socketPath: string;
  pid: number;
  version: string;
}

async function spawnSigner(): Promise<SignerHandle> {
  const socketPath = `/tmp/signer-m3-test-${process.pid}-${Date.now()}.sock`;
  try {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  } catch { /* ignore */ }

  const child = spawn(
    "npx",
    ["tsx", path.join(__dirname, "..", "src", "signer", "main.ts")],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        SIGNER_SOCKET_PATH: socketPath,
        DISABLE_CRASH_HANDLERS: "1",
      },
    },
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
          resolve({ child, socketPath: msg.socketPath, pid: msg.pid, version: msg.version });
        }
      } catch { /* not JSON */ }
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`signer exited before SIGNER_READY (code=${code}, signal=${signal})`));
    });
  });
}

async function stopSigner(handle: SignerHandle): Promise<void> {
  if (handle.child.stdin && !handle.child.stdin.destroyed) {
    handle.child.stdin.end();
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try { handle.child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve();
    }, 3000);
    handle.child.on("exit", () => { clearTimeout(timeout); resolve(); });
  });
  try { if (fs.existsSync(handle.socketPath)) fs.unlinkSync(handle.socketPath); } catch { /* ignore */ }
}

/**
 * Real Unix-socket transport — connects to the spawned signer, sends
 * one JSON-RPC frame, reads one response, then closes. Each rpc() call
 * opens a fresh connection (M3.1 doesn't need connection pooling — M4's
 * writer lease will own the lifecycle).
 */
class UnixSocketTransport implements SignerTransport {
  constructor(private socketPath: string) {}

  async rpc(method: string, params: unknown, timeoutMs: number): Promise<RpcResponse> {
    const frame = JSON.stringify({ jsonrpc: "2.0", method, params, id: randomUUID() });
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath, () => {
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
          if (resp.error) {
            resolve({ ok: false, error: resp.error });
          } else {
            resolve({ ok: true, result: resp.result });
          }
        } catch (err) {
          socket.destroy();
          reject(new Error(`failed to parse response: ${String(err)}`));
        }
      });
      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`socket error: ${String(err)}`));
      });
    });
  }
}

// =========================================================================
// Test entry
// =========================================================================

console.log("\n=== M3.1 — SignerAdapter ===\n");

async function main(): Promise<void> {

// =========================================================================
// A. CONTRACT TESTS
// =========================================================================

console.log("A.1 — valid request → adapter forwards, signer accepts");

{
  const transport = new MockSignerTransport();
  const adapter = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const req = validSignerRequest();

  const result = await adapter.submit(req);

  assertEqual(result.ok, true, "A.1: result.ok is true");
  assert(typeof result.txHash === "string" && result.txHash.startsWith("0x"), "A.1: txHash is a 0x-prefixed string");
  // Two transport calls: health_check probe + signTransaction
  assertEqual(transport.calls.length, 2, "A.1: transport called twice (health_check + signTransaction)");
  assertEqual(transport.calls[0].method, "health_check", "A.1: first call is health_check");
  assertEqual(transport.calls[1].method, "signTransaction", "A.1: second call is signTransaction");

  // Verify the wire request structure
  const wireReq = transport.calls[1].params as SignerWireRequest;
  assertEqual(wireReq.protocolVersion, SIGNER_PROTOCOL_VERSION, "A.1: wireReq.protocolVersion matches");
  assertEqual(wireReq.operation, "signTransaction", "A.1: wireReq.operation is signTransaction");
  assert(typeof wireReq.requestId === "string" && wireReq.requestId.length > 0, "A.1: wireReq.requestId is a non-empty string");
  assert(typeof wireReq.payloadHash === "string" && wireReq.payloadHash.startsWith("0x"), "A.1: wireReq.payloadHash is a 0x-prefixed hex string");

  // Verify the payload is byte-identical to the SignerRequest
  assertEqual(wireReq.payload.tx.from, req.tx.from, "A.1: payload.tx.from matches");
  assertEqual(wireReq.payload.tx.to, req.tx.to, "A.1: payload.tx.to matches");
  assertEqual(wireReq.payload.approvedAmount, req.approvedAmount, "A.1: payload.approvedAmount matches");
  assertEqual(wireReq.payload.slippageLimitBps, req.slippageLimitBps, "A.1: payload.slippageLimitBps matches");
  assertEqual(wireReq.payload.sandwichScore, req.sandwichScore, "A.1: payload.sandwichScore matches");
}

console.log("\nA.2 — invalid protocol version → SIGNER_PROTOCOL_MISMATCH");

{
  const transport = new MockSignerTransport();
  // The mock signer reports a DIFFERENT version than the adapter expects.
  transport.signerVersion = "9.9.9-future";
  const adapter = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const req = validSignerRequest();

  const result = await adapter.submit(req);

  assertEqual(result.ok, false, "A.2: result.ok is false");
  assert(result.error !== undefined && result.error.startsWith(SignerAdapterError.PROTOCOL_MISMATCH), `A.2: error starts with ${SignerAdapterError.PROTOCOL_MISMATCH}`);
  // The adapter should have called health_check but NOT signTransaction
  assertEqual(transport.calls.length, 1, "A.2: transport called once (health_check only)");
  assertEqual(transport.calls[0].method, "health_check", "A.2: first call is health_check");
}

console.log("\nA.3 — missing required field → SIGNER_INVALID_REQUEST");

{
  const transport = new MockSignerTransport();
  const adapter = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });

  // Missing tx
  const reqMissingTx = { ...validSignerRequest(), tx: undefined } as unknown as SignerRequest;
  const r1 = await adapter.submit(reqMissingTx);
  assertEqual(r1.ok, false, "A.3.a: missing tx → ok=false");
  assert(r1.error !== undefined && r1.error.startsWith(SignerAdapterError.INVALID_REQUEST), `A.3.a: error starts with ${SignerAdapterError.INVALID_REQUEST}`);

  // Missing approvedAmount
  const reqMissingAmount = { ...validSignerRequest(), approvedAmount: undefined } as unknown as SignerRequest;
  const r2 = await adapter.submit(reqMissingAmount);
  assertEqual(r2.ok, false, "A.3.b: missing approvedAmount → ok=false");
  assert(r2.error !== undefined && r2.error.startsWith(SignerAdapterError.INVALID_REQUEST), `A.3.b: error starts with ${SignerAdapterError.INVALID_REQUEST}`);

  // NaN slippageLimitBps
  const reqNanSlippage = { ...validSignerRequest(), slippageLimitBps: NaN };
  const r3 = await adapter.submit(reqNanSlippage);
  assertEqual(r3.ok, false, "A.3.c: NaN slippageLimitBps → ok=false");
  assert(r3.error !== undefined && r3.error.startsWith(SignerAdapterError.INVALID_REQUEST), `A.3.c: error starts with ${SignerAdapterError.INVALID_REQUEST}`);

  // Missing tx.from
  const reqMissingFrom = { ...validSignerRequest(), tx: { to: "0x", value: "0", data: "0x" } } as unknown as SignerRequest;
  const r4 = await adapter.submit(reqMissingFrom);
  assertEqual(r4.ok, false, "A.3.d: missing tx.from → ok=false");
  assert(r4.error !== undefined && r4.error.startsWith(SignerAdapterError.INVALID_REQUEST), `A.3.d: error starts with ${SignerAdapterError.INVALID_REQUEST}`);

  // Transport should NOT have been called at all — field validation
  // happens BEFORE the protocol probe.
  assertEqual(transport.calls.length, 0, "A.3: transport NOT called (field validation precedes transport)");
}

console.log("\nA.4 — payload altered mid-flight → SIGNER_PAYLOAD_CORRUPTED");

{
  const transport = new MockSignerTransport();
  transport.mode = "wrong-payload-hash";
  const adapter = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const req = validSignerRequest();

  const result = await adapter.submit(req);

  assertEqual(result.ok, false, "A.4: result.ok is false");
  assert(result.error !== undefined && result.error.startsWith(SignerAdapterError.PAYLOAD_CORRUPTED), `A.4: error starts with ${SignerAdapterError.PAYLOAD_CORRUPTED}`);
  // Two calls: health_check (passes) + signTransaction (returns corrupted hash)
  assertEqual(transport.calls.length, 2, "A.4: transport called twice");
}

// =========================================================================
// B. TRANSPORT TESTS
// =========================================================================

console.log("\nB.1 — signer offline → SIGNER_UNAVAILABLE");

{
  const transport = new MockSignerTransport();
  transport.thrower = () => new Error("connect ECONNREFUSED /tmp/signer.sock");
  const adapter = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const req = validSignerRequest();

  const result = await adapter.submit(req);

  assertEqual(result.ok, false, "B.1: result.ok is false");
  assert(result.error !== undefined && result.error.startsWith(SignerAdapterError.UNAVAILABLE), `B.1: error starts with ${SignerAdapterError.UNAVAILABLE}`);
}

console.log("\nB.2 — timeout → SIGNER_TIMEOUT");

{
  const transport = new MockSignerTransport();
  transport.thrower = () => new Error("RPC timed out after 5000ms");
  const adapter = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
    requestTimeoutMs: 100, // short timeout for the test
  });
  const req = validSignerRequest();

  const result = await adapter.submit(req);

  assertEqual(result.ok, false, "B.2: result.ok is false");
  assert(result.error !== undefined && result.error.startsWith(SignerAdapterError.TIMEOUT), `B.2: error starts with ${SignerAdapterError.TIMEOUT}`);
}

console.log("\nB.3 — invalid response → SIGNER_INVALID_RESPONSE");

{
  const transport = new MockSignerTransport();
  transport.mode = "malformed";
  const adapter = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const req = validSignerRequest();

  const result = await adapter.submit(req);

  assertEqual(result.ok, false, "B.3: result.ok is false");
  assert(result.error !== undefined && result.error.startsWith(SignerAdapterError.INVALID_RESPONSE), `B.3: error starts with ${SignerAdapterError.INVALID_RESPONSE}`);
}

console.log("\nB.4 — response with incompatible version → SIGNER_PROTOCOL_MISMATCH (via signer-side rejection)");

{
  const transport = new MockSignerTransport();
  // Simulate the signer rejecting the request with a protocol mismatch
  // (this is what the real signer's dispatchRpc does when
  // params.protocolVersion doesn't match SIGNER_PROTOCOL_VERSION).
  transport.mode = "rpc-error-protocol-mismatch";
  const adapter = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const req = validSignerRequest();

  const result = await adapter.submit(req);

  assertEqual(result.ok, false, "B.4: result.ok is false");
  assert(result.error !== undefined && result.error.startsWith(SignerAdapterError.PROTOCOL_MISMATCH), `B.4: error starts with ${SignerAdapterError.PROTOCOL_MISMATCH}`);
}

// =========================================================================
// C. SECURITY TESTS
// =========================================================================

console.log("\nC.1 — adapter does not modify payload (byte-identical forward)");

{
  const transport = new MockSignerTransport();
  const adapter = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const req = validSignerRequest();

  await adapter.submit(req);

  // Inspect the wire request the adapter sent — the payload must be
  // byte-identical to the SignerRequest (no field dropped, no field
  // renamed, no field transformed).
  const wireReq = transport.calls[1].params as SignerWireRequest;
  const expectedPayloadJson = JSON.stringify({
    tx: req.tx,
    expectedDiff: req.expectedDiff,
    approvedAmount: req.approvedAmount,
    slippageLimitBps: req.slippageLimitBps,
    sandwichScore: req.sandwichScore,
  });
  const actualPayloadJson = JSON.stringify(wireReq.payload);
  assertEqual(actualPayloadJson, expectedPayloadJson, "C.1: payload forwarded byte-identical");

  // Also verify the payloadHash matches what the adapter should have computed.
  const expectedHash = "0x" + createHash("sha256").update(expectedPayloadJson, "utf8").digest("hex");
  assertEqual(wireReq.payloadHash, expectedHash, "C.1: payloadHash matches sha256(canonical payload)");
}

console.log("\nC.2 — adapter does not ignore errors (propagates as ok=false)");

{
  const transport = new MockSignerTransport();

  // Case 2a: signer returns ok=false (application-level rejection).
  transport.mode = "reject";
  const adapterA = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const rA = await adapterA.submit(validSignerRequest());
  assertEqual(rA.ok, false, "C.2.a: signer rejection → adapter returns ok=false");
  assert(rA.error !== undefined && rA.error.includes("SIGNER_REJECTED"), "C.2.a: error includes signer's rejection reason");

  // Case 2b: signer returns a JSON-RPC error.
  transport.reset();
  transport.mode = "rpc-error";
  const adapterB = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const rB = await adapterB.submit(validSignerRequest());
  assertEqual(rB.ok, false, "C.2.b: RPC error → adapter returns ok=false");
  assert(rB.error !== undefined && rB.error.startsWith(SignerAdapterError.RPC_ERROR), `C.2.b: error starts with ${SignerAdapterError.RPC_ERROR}`);

  // Case 2c: signer returns ok=true but no txHash (structural defect).
  transport.reset();
  transport.mode = "ok-no-txhash";
  const adapterC = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const rC = await adapterC.submit(validSignerRequest());
  assertEqual(rC.ok, false, "C.2.c: ok=true but no txHash → adapter returns ok=false (not silently accept)");
  assert(rC.error !== undefined && rC.error.startsWith(SignerAdapterError.INVALID_RESPONSE), `C.2.c: error starts with ${SignerAdapterError.INVALID_RESPONSE}`);
}

console.log("\nC.3 — adapter does not fallback (no retry, no version fallback)");

{
  const transport = new MockSignerTransport();

  // Case 3a: transport throws — adapter must NOT retry.
  transport.thrower = () => new Error("connect ECONNREFUSED");
  const adapterA = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const rA = await adapterA.submit(validSignerRequest());
  assertEqual(rA.ok, false, "C.3.a: transport error → ok=false");
  assertEqual(transport.calls.length, 1, "C.3.a: transport called exactly once (no retry)");

  // Case 3b: signer returns protocol mismatch — adapter must NOT
  // fallback to a different version.
  transport.reset();
  transport.signerVersion = "9.9.9-future";
  const adapterB = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const rB = await adapterB.submit(validSignerRequest());
  assertEqual(rB.ok, false, "C.3.b: version mismatch → ok=false");
  assert(rB.error !== undefined && rB.error.startsWith(SignerAdapterError.PROTOCOL_MISMATCH), "C.3.b: error is PROTOCOL_MISMATCH");
  // Only ONE health_check call — adapter must NOT try a different version.
  assertEqual(transport.calls.length, 1, "C.3.b: transport called exactly once (no version fallback)");
  // No signTransaction call — adapter must NOT proceed despite mismatch.
  const signCalls = transport.calls.filter(c => c.method === "signTransaction").length;
  assertEqual(signCalls, 0, "C.3.b: signTransaction NOT called (no bypass on mismatch)");

  // Case 3c: signer rejects sign request — adapter must NOT retry.
  transport.reset();
  transport.mode = "reject";
  const adapterC = new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
  const rC = await adapterC.submit(validSignerRequest());
  assertEqual(rC.ok, false, "C.3.c: signer rejection → ok=false");
  // Two calls: health_check + signTransaction. NO third call (no retry).
  assertEqual(transport.calls.length, 2, "C.3.c: transport called exactly twice (health_check + signTransaction, no retry)");
}

// =========================================================================
// D. INTEGRATION TEST — real signer process
// =========================================================================

console.log("\nD.1 — real signer + adapter with wrong expectedProtocolVersion → SIGNER_PROTOCOL_MISMATCH");

{
  let handle: SignerHandle | null = null;
  try {
    handle = await spawnSigner();
    console.log(`    (spawned signer pid=${handle.pid}, version=${handle.version}, socket=${handle.socketPath})`);

    // Build an adapter that expects a WRONG version. The real signer
    // reports SIGNER_PROTOCOL_VERSION (currently "1.1.0-m2"); the
    // adapter expects "0.0.0-nonexistent". The pre-flight health_check
    // must detect the mismatch and refuse to forward.
    const transport = new UnixSocketTransport(handle.socketPath);
    const adapter = new SignerAdapter({
      transport,
      expectedProtocolVersion: "0.0.0-nonexistent",
    });

    const result = await adapter.submit(validSignerRequest());

    assertEqual(result.ok, false, "D.1: result.ok is false");
    assert(result.error !== undefined && result.error.startsWith(SignerAdapterError.PROTOCOL_MISMATCH), `D.1: error starts with ${SignerAdapterError.PROTOCOL_MISMATCH}`);
    // The error message should mention both the expected and reported versions.
    assert(
      result.error !== undefined &&
      result.error.includes("0.0.0-nonexistent") &&
      result.error.includes(SIGNER_PROTOCOL_VERSION),
      "D.1: error mentions both expected and reported versions",
    );
  } finally {
    if (handle) await stopSigner(handle);
  }
}

console.log("\nD.2 — real signer + adapter with correct expectedProtocolVersion → health_check passes (signTransaction returns -32601 since M3.2 not yet shipped)");

{
  let handle: SignerHandle | null = null;
  try {
    handle = await spawnSigner();
    console.log(`    (spawned signer pid=${handle.pid}, version=${handle.version})`);

    const transport = new UnixSocketTransport(handle.socketPath);
    const adapter = new SignerAdapter({
      transport,
      expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
    });

    const result = await adapter.submit(validSignerRequest());

    // The pre-flight health_check should pass (versions match). Then
    // the adapter sends signTransaction, which the real signer doesn't
    // implement yet (M3.2 will add it) — so it returns -32601
    // METHOD_NOT_FOUND. The adapter surfaces this as SIGNER_RPC_ERROR.
    assertEqual(result.ok, false, "D.2: result.ok is false (signTransaction not yet implemented)");
    assert(
      result.error !== undefined && result.error.startsWith(SignerAdapterError.RPC_ERROR),
      `D.2: error starts with ${SignerAdapterError.RPC_ERROR} (expected, since M3.2 not yet shipped)`,
    );
    assert(
      result.error !== undefined && result.error.includes("-32601"),
      "D.2: error includes -32601 (method not found)",
    );
  } finally {
    if (handle) await stopSigner(handle);
  }
}

// =========================================================================
// Summary
// =========================================================================

console.log("\n=== M3.1 Summary: " + pass + " pass, " + fail + " fail ===");
console.log("\nProperties verified:");
console.log("  A.1  valid request → forwarded, signer accepts");
console.log("  A.2  invalid protocol version → SIGNER_PROTOCOL_MISMATCH");
console.log("  A.3  missing required field → SIGNER_INVALID_REQUEST");
console.log("  A.4  payload altered mid-flight → SIGNER_PAYLOAD_CORRUPTED");
console.log("  B.1  signer offline → SIGNER_UNAVAILABLE");
console.log("  B.2  timeout → SIGNER_TIMEOUT");
console.log("  B.3  invalid response → SIGNER_INVALID_RESPONSE");
console.log("  B.4  response with incompatible version → SIGNER_PROTOCOL_MISMATCH");
console.log("  C.1  adapter does not modify payload (byte-identical forward)");
console.log("  C.2  adapter does not ignore errors (propagates as ok=false)");
console.log("  C.3  adapter does not fallback (no retry, no version fallback)");
console.log("  D.1  real signer + wrong version → SIGNER_PROTOCOL_MISMATCH (integration)");
console.log("  D.2  real signer + correct version → health_check passes, signTransaction=-32601 (integration)");

if (fail > 0) {
  console.error(`\n*** ${fail} TEST(S) FAILED ***`);
  process.exit(1);
}

}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
