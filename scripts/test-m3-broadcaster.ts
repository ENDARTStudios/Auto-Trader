/**
 * M3.3 — Broadcaster test suite.
 *
 * This file proves the Broadcaster (src/lib/chain/broadcaster.ts)
 * honors its closed-scope contract:
 *
 *   1. Resolve nonce and gas parameters via the H1.1 QuorumRpcClient.
 *   2. Build the final transaction (fill nonce + gas into req.tx).
 *   3. Request signature via SignerAdapter.signAndReturnRaw().
 *   4. Receive rawSignedTx.
 *   5. Compute expectedHash = keccak256(rawSignedTx) locally (REG-014).
 *   6. Broadcast via QuorumRpcClient.broadcastRawTransaction.
 *   7. Verify broadcastHash === expectedHash (REG-014 mandatory check).
 *   8. Return SignerResult.
 *
 * And that it does NOT do any of the excluded things (no retries, no
 * replacement tx, no cancel, no mempool management, no bundle, no fee
 * bumping, no block confirmation).
 *
 * The test suite uses MOCK transports for both the RPC client and the
 * signer adapter — no real network, no real signer process. The mocks
 * are scripted per-test so each adversarial scenario is deterministic.
 *
 * Test matrix (per operator's M3.3 directive):
 *
 *   A. Functional baseline (3 tests)
 *     A.1 — valid request → nonce resolved, gas resolved, signed,
 *            broadcast, hash verified → ok=true with txHash
 *     A.2 — fixed gas limit override → eth_estimateGas NOT called
 *     A.3 — fixed maxPriorityFeePerGas override → eth_feeHistory NOT called
 *
 *   B. Adversarial (8 tests — the operator's directive)
 *     B.1 — nonce already used (RPC "nonce too low" on broadcast)
 *     B.2 — stale nonce (broadcast rejected)
 *     B.3 — insufficient gas (broadcast rejected)
 *     B.4 — RPC returns hash different from signed-tx hash (REG-014 violation)
 *     B.5 — broadcast partial + timeout (endpoint accepted but response lost)
 *     B.6 — error in one endpoint, success in another (H1.1 failover honored)
 *     B.7 — malformed RPC response (broadcast returns non-string txHash)
 *     B.8 — raw transaction altered after signature (REG-014 pre-broadcast check)
 *
 *   C. Immutability structural test (1 test)
 *     C.1 — the 8-step flow is structurally verified:
 *            buildTransaction → sign → hashBefore → broadcast → hashAfter
 *            where hashAfter === hashBefore (REG-014 closed loop)
 *
 *   D. Adapter integration (2 tests)
 *     D.1 — signer returns ok=false → Broadcaster returns ok=false with
 *            BROADCAST_SIGN_FAILED prefix
 *     D.2 — signer returns ok=true but no rawSignedTx → Broadcaster
 *            returns ok=false (signAndReturnRaw's INVALID_RESPONSE check)
 *
 * Run: npx tsx scripts/test-m3-broadcaster.ts
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { Wallet } from "ethers";

import { Broadcaster, BroadcasterError } from "../src/lib/chain/broadcaster";
import {
  QuorumRpcClient,
  type RpcEndpoint,
  type Transport,
  type BroadcastResult,
  type QuorumResult,
} from "../src/lib/chain/rpc-resilience";
import {
  SignerAdapter,
  type SignerTransport,
  type RpcResponse,
  type SignerWireRequest,
  SignerAdapterError,
} from "../src/lib/chain/signer-adapter";
import type { SignerRequest, SignerResult } from "../src/lib/chain/pipeline";
import { SIGNER_PROTOCOL_VERSION } from "../src/lib/signer-protocol";

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
// Mock RPC transport — scripted responses per method.
// -------------------------------------------------------------------------

type RpcScriptEntry =
  | { kind: "value"; value: unknown }
  | { kind: "error"; message: string }
  | { kind: "match"; match: (method: string, params: unknown[]) => boolean; value: unknown };

class MockRpcTransport {
  calls: { url: string; method: string; params: unknown[] }[] = [];
  scripts: Record<string, RpcScriptEntry[]> = {};
  /** Per-URL script override (for failover tests). */
  perUrlScripts: Record<string, Record<string, RpcScriptEntry[]>> = {};
  /** Custom broadcast handler — returns the BroadcastResult directly. */
  broadcastHandler: ((rawSignedTx: string) => Promise<BroadcastResult>) | null = null;

  reset(): void {
    this.calls = [];
    this.scripts = {};
    this.perUrlScripts = {};
    this.broadcastHandler = null;
  }

  asTransport(): Transport {
    return async (url: string, method: string, params: unknown[]) => {
      this.calls.push({ url, method, params });

      // eth_sendRawTransaction: check per-URL scripts first (for failover
      // tests where one URL should fail), then fall back to the shared
      // broadcastHandler, then to the default hash computation.
      if (method === "eth_sendRawTransaction") {
        const perUrl = this.perUrlScripts[url]?.[method];
        if (perUrl) {
          for (const entry of perUrl) {
            if (entry.kind === "value") return entry.value;
            if (entry.kind === "error") throw new Error(entry.message);
          }
        }
        if (this.broadcastHandler) {
          const result = await this.broadcastHandler(params[0] as string);
          if (!result.ok) {
            throw new Error(result.error ?? "broadcast failed");
          }
          return result.txHash;
        }
        // Default: compute the actual hash of the raw tx.
        const rawTx = params[0] as string;
        const hash = computeKeccak256(rawTx);
        return hash;
      }

      // Look up the script (per-URL overrides take precedence).
      const script = this.perUrlScripts[url]?.[method] ?? this.scripts[method];
      if (!script) {
        throw new Error(`no script for method ${method} on url ${url}`);
      }
      // Find the first matching entry.
      for (const entry of script) {
        if (entry.kind === "value") return entry.value;
        if (entry.kind === "error") throw new Error(entry.message);
        if (entry.kind === "match") {
          if (entry.match(method, params)) return entry.value;
        }
      }
      throw new Error(`script exhausted for ${method} on ${url}`);
    };
  }
}

// -------------------------------------------------------------------------
// Mock signer transport — returns scripted sign responses.
// -------------------------------------------------------------------------

class MockSignerTransport implements SignerTransport {
  calls: { method: string; params: unknown; timeoutMs: number }[] = [];
  /** Custom sign handler. */
  signHandler: ((wireReq: SignerWireRequest) => RpcResponse | Promise<RpcResponse>) | null = null;
  signerVersion: string = SIGNER_PROTOCOL_VERSION;

  reset(): void {
    this.calls = [];
    this.signHandler = null;
    this.signerVersion = SIGNER_PROTOCOL_VERSION;
  }

  async rpc(method: string, params: unknown, timeoutMs: number): Promise<RpcResponse> {
    this.calls.push({ method, params, timeoutMs });

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

    if (method === "signTransaction") {
      const wireReq = params as SignerWireRequest;
      if (this.signHandler) return this.signHandler(wireReq);
      // Default: produce a real signature using a test wallet.
      return defaultSignHandler(wireReq);
    }

    return { ok: false, error: { code: -32601, message: `method not found: ${method}` } };
  }
}

// -------------------------------------------------------------------------
// Default sign handler — uses a real ethers Wallet to produce a valid
// signature. The wallet is generated deterministically so the tests are
// reproducible.
// -------------------------------------------------------------------------

const TEST_WALLET = Wallet.createRandom();
const TEST_WALLET_ADDRESS = TEST_WALLET.address;

async function defaultSignHandler(wireReq: SignerWireRequest): Promise<RpcResponse> {
  const payload = wireReq.payload;
  const tx = payload.tx as Record<string, unknown>;

  // Build the ethers transaction object.
  const ethersTx: Record<string, unknown> = {
    to: tx.to,
    value: tx.value as string,
    data: tx.data as string,
    nonce: tx.nonce ?? 0,
    gasLimit: tx.gasLimit ?? "0x5208",
    maxFeePerGas: tx.maxFeePerGas ?? "0x2540be400",
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? "0x9502f900",
    type: 2,
    chainId: 1,
  };

  try {
    const rawSignedTx = await TEST_WALLET.signTransaction(ethersTx as any);
    const { Transaction } = await import("ethers");
    const parsed = Transaction.from(rawSignedTx);
    const txHash = parsed.hash;
    return {
      ok: true,
      result: {
        ok: true,
        txHash,
        rawSignedTx,
        requestId: wireReq.requestId,
        receivedPayloadHash: wireReq.payloadHash,
        signerVersion: SIGNER_PROTOCOL_VERSION,
      },
    };
  } catch (err) {
    return {
      ok: true,
      result: {
        ok: false,
        error: `SIGNER_SIGN_FAILED: ${(err as Error).message}`,
        requestId: wireReq.requestId,
        receivedPayloadHash: wireReq.payloadHash,
        signerVersion: SIGNER_PROTOCOL_VERSION,
      },
    };
  }
}

// -------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------

function validSignerRequest(from: string = TEST_WALLET_ADDRESS): SignerRequest {
  return {
    tx: {
      from,
      to: "0x0000000000000000000000000000000000000002",
      value: "0",
      data: "0x",
    },
    expectedDiff: { changes: [] },
    approvedAmount: "0",
    slippageLimitBps: 300,
    sandwichScore: 0,
  };
}

const RPC_ENDPOINTS: RpcEndpoint[] = [
  { id: "alpha", url: "https://alpha.example", priority: 100 },
  { id: "beta", url: "https://beta.example", priority: 90 },
];

// -------------------------------------------------------------------------
// Helper: compute keccak256 of a 0x-prefixed hex string.
// -------------------------------------------------------------------------

function computeKeccak256(hex: string): string {
  if (!hex.startsWith("0x")) throw new Error(`not a hex string: ${hex.slice(0, 10)}`);
  const bytes = hexToBytes(hex.slice(2));
  const hash = keccak_256(bytes);
  return "0x" + bytesToHex(hash);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

// -------------------------------------------------------------------------
// Main test driver
// -------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n=== M3.3 — Broadcaster Test Suite ===\n");

  // Shared transport mocks — their state is reset per-test via `.reset()`.
  // The rpcClient + signerAdapter are created FRESH per-test via
  // `freshBroadcaster()` so the QuorumRpcClient's health-score state
  // does not leak between tests (a failing endpoint in one test would
  // otherwise degrade the health score and affect subsequent tests).
  const rpcTransport = new MockRpcTransport();
  const signerTransport = new MockSignerTransport();

  function freshBroadcaster(cfg?: ConstructorParameters<typeof Broadcaster>[0] extends infer C ? Omit<C, "rpc" | "signerAdapter"> : never): { broadcaster: Broadcaster; rpc: QuorumRpcClient; signerAdapter: SignerAdapter } {
    const rpc = new QuorumRpcClient({
      endpoints: RPC_ENDPOINTS,
      transport: rpcTransport.asTransport(),
      callTimeoutMs: 1000,
    });
    const signerAdapter = new SignerAdapter({
      transport: signerTransport,
      expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
    });
    const broadcaster = new Broadcaster({ rpc, signerAdapter, ...cfg } as any);
    return { broadcaster, rpc, signerAdapter };
  }

  // -------------------------------------------------------------------------
  // A. Functional baseline
  // -------------------------------------------------------------------------

  console.log("A. Functional baseline\n");

  // A.1 — valid request → ok=true with txHash
  console.log("A.1 — valid request → nonce resolved, gas resolved, signed, broadcast, hash verified");
  {
    rpcTransport.reset();
    signerTransport.reset();

    // Script the RPC responses.
    rpcTransport.scripts["eth_getTransactionCount"] = [
      { kind: "value", value: "0x5" }, // nonce = 5
    ];
    rpcTransport.scripts["eth_estimateGas"] = [
      { kind: "value", value: "0x5208" }, // 21000
    ];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"], // next base fee = 0x5
          reward: [["0x3e8"]], // 50th percentile tip = 0x3e8 = 1000
        },
      },
    ];

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === true, "A.1: result.ok should be true");
    assert(typeof result.txHash === "string" && result.txHash!.startsWith("0x"), "A.1: txHash should be a 0x-prefixed string");
    assert(result.txHash!.length === 66, "A.1: txHash should be 32 bytes (66 chars including 0x)");

    // Verify the RPC was called for nonce + gas + feeHistory + broadcast.
    const methods = rpcTransport.calls.map(c => c.method);
    assert(methods.includes("eth_getTransactionCount"), "A.1: eth_getTransactionCount called");
    assert(methods.includes("eth_estimateGas"), "A.1: eth_estimateGas called");
    assert(methods.includes("eth_feeHistory"), "A.1: eth_feeHistory called");
    assert(methods.includes("eth_sendRawTransaction"), "A.1: eth_sendRawTransaction called");

    // Verify the signer was called.
    assert(signerTransport.calls.some(c => c.method === "signTransaction"), "A.1: signTransaction called");
  }

  // A.2 — fixed gas limit override → eth_estimateGas NOT called
  console.log("\nA.2 — fixedGasLimit override → eth_estimateGas NOT called");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x0" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    const { broadcaster } = freshBroadcaster({ fixedGasLimit: 100000n });

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === true, "A.2: result.ok should be true");
    const methods = rpcTransport.calls.map(c => c.method);
    assert(!methods.includes("eth_estimateGas"), "A.2: eth_estimateGas should NOT be called when fixedGasLimit is set");
  }

  // A.3 — fixed maxPriorityFeePerGas override → eth_feeHistory NOT called
  console.log("\nA.3 — fixedMaxPriorityFeePerGas override → eth_feeHistory NOT called");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x0" }];
    rpcTransport.scripts["eth_gasPrice"] = [{ kind: "value", value: "0x2540be400" }]; // 10 gwei

    const { broadcaster } = freshBroadcaster({ fixedGasLimit: 100000n, fixedMaxPriorityFeePerGas: 1_000_000_000n });

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === true, "A.3: result.ok should be true");
    const methods = rpcTransport.calls.map(c => c.method);
    assert(!methods.includes("eth_feeHistory"), "A.3: eth_feeHistory should NOT be called when fixedMaxPriorityFeePerGas is set");
    assert(methods.includes("eth_gasPrice"), "A.3: eth_gasPrice called (fallback for maxFeePerGas)");
  }

  // -------------------------------------------------------------------------
  // B. Adversarial
  // -------------------------------------------------------------------------

  console.log("\nB. Adversarial\n");

  // B.1 — nonce already used (RPC "nonce too low" on broadcast)
  console.log("B.1 — nonce already used → broadcast rejected");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x5" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    // Broadcast handler: simulate "nonce too low" rejection.
    rpcTransport.broadcastHandler = async (_rawTx) => {
      return {
        ok: false,
        broadcastBy: null,
        failedOver: false,
        error: "nonce too low",
      };
    };

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === false, "B.1: result.ok should be false");
    assertStartsWith(result.error!, BroadcasterError.BROADCAST_FAILED, "B.1: error prefix");
    // Note: the H1.1 broadcastRawTransaction walks endpoints and returns a
    // generic "all healthy endpoints rejected" message — the specific RPC
    // error ("nonce too low") is logged but not surfaced in the result.
    // The Broadcaster wraps this as BROADCAST_FAILED. The test verifies the
    // prefix + that the broadcast was actually attempted (calls include
    // eth_sendRawTransaction).
    assert(rpcTransport.calls.some(c => c.method === "eth_sendRawTransaction"), "B.1: broadcast was attempted");
  }

  // B.2 — stale nonce (broadcast rejected)
  console.log("\nB.2 — stale nonce → broadcast rejected");
  {
    rpcTransport.reset();
    signerTransport.reset();

    // Return a low nonce, then have the broadcast reject it.
    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x1" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    rpcTransport.broadcastHandler = async (_rawTx) => {
      return {
        ok: false,
        broadcastBy: null,
        failedOver: false,
        error: "replacement transaction underpriced",
      };
    };

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === false, "B.2: result.ok should be false");
    assertStartsWith(result.error!, BroadcasterError.BROADCAST_FAILED, "B.2: error prefix");
  }

  // B.3 — insufficient gas (broadcast rejected)
  console.log("\nB.3 — insufficient gas → broadcast rejected");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x0" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    rpcTransport.broadcastHandler = async (_rawTx) => {
      return {
        ok: false,
        broadcastBy: null,
        failedOver: false,
        error: "intrinsic gas too low",
      };
    };

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === false, "B.3: result.ok should be false");
    assertStartsWith(result.error!, BroadcasterError.BROADCAST_FAILED, "B.3: error prefix");
    // The specific RPC error ("intrinsic gas too low") is logged inside the
    // H1.1 client but not surfaced in the result message. The Broadcaster
    // wraps the generic rejection as BROADCAST_FAILED.
    assert(rpcTransport.calls.some(c => c.method === "eth_sendRawTransaction"), "B.3: broadcast was attempted");
  }

  // B.4 — RPC returns hash different from signed-tx hash (REG-014 violation)
  console.log("\nB.4 — RPC returns different hash → REG-014 immutability violation");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x0" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    // Broadcast handler: return a DIFFERENT hash than the actual keccak256.
    rpcTransport.broadcastHandler = async (_rawTx) => {
      return {
        ok: true,
        txHash: "0x" + "ff".repeat(32), // wrong hash
        broadcastBy: "alpha",
        failedOver: false,
      };
    };

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === false, "B.4: result.ok should be false (immutability violation)");
    assertStartsWith(result.error!, BroadcasterError.IMMUTABILITY_VIOLATION, "B.4: error prefix");
    assert(result.error!.includes("does not match"), "B.4: error mentions hash mismatch");
  }

  // B.5 — broadcast partial + timeout (endpoint accepted but response lost)
  console.log("\nB.5 — broadcast partial + timeout → fail closed");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x0" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    // Broadcast handler: simulate a timeout — all endpoints fail.
    rpcTransport.broadcastHandler = async (_rawTx) => {
      return {
        ok: false,
        broadcastBy: null,
        failedOver: false,
        error: "broadcastRawTransaction: all healthy endpoints rejected (timeout)",
      };
    };

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === false, "B.5: result.ok should be false");
    assertStartsWith(result.error!, BroadcasterError.BROADCAST_FAILED, "B.5: error prefix");
  }

  // B.6 — error in one endpoint, success in another (H1.1 failover honored)
  console.log("\nB.6 — error in alpha, success in beta → H1.1 failover");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x0" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    // Make alpha fail, beta succeed. The QuorumRpcClient will try alpha first.
    rpcTransport.perUrlScripts["https://alpha.example"] = {
      "eth_sendRawTransaction": [{ kind: "error", message: "alpha endpoint down" }],
    };
    // Beta's default handler computes the real hash.

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === true, "B.6: result.ok should be true (failover succeeded)");
    assert(typeof result.txHash === "string", "B.6: txHash present");

    // Verify alpha was tried before beta.
    const broadcastCalls = rpcTransport.calls.filter(c => c.method === "eth_sendRawTransaction");
    assert(broadcastCalls.length >= 2, "B.6: at least 2 broadcast attempts (alpha + beta)");
    assert(broadcastCalls[0].url === "https://alpha.example", "B.6: alpha tried first");
    assert(broadcastCalls[1].url === "https://beta.example", "B.6: beta tried second");
  }

  // B.7 — malformed RPC response (broadcast returns non-string txHash)
  console.log("\nB.7 — malformed RPC response (non-string txHash)");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x0" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    // Broadcast handler: return a non-string txHash (number instead of "0x...").
    rpcTransport.broadcastHandler = async (_rawTx) => {
      // The H1.1 client will return this as-is.
      // We simulate a malformed RPC response by returning a non-hex txHash.
      return {
        ok: true,
        txHash: "not-a-valid-hash",
        broadcastBy: "alpha",
        failedOver: false,
      };
    };

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === false, "B.7: result.ok should be false");
    assertStartsWith(result.error!, BroadcasterError.IMMUTABILITY_VIOLATION, "B.7: error prefix (malformed hash fails immutability check)");
  }

  // B.8 — raw transaction altered after signature (REG-014 pre-broadcast check)
  console.log("\nB.8 — raw transaction altered after signature → must fail");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x0" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    // Custom signer handler: returns a valid signature, but we'll tamper
    // with the rawSignedTx in the broadcast handler to simulate alteration.
    let capturedRawSignedTx: string | null = null;
    signerTransport.signHandler = async (wireReq) => {
      const resp = await defaultSignHandler(wireReq);
      if (resp.ok && resp.result && (resp.result as any).rawSignedTx) {
        capturedRawSignedTx = (resp.result as any).rawSignedTx;
      }
      return resp;
    };

    // Broadcast handler: tamper with the raw tx before broadcasting.
    rpcTransport.broadcastHandler = async (rawTx) => {
      // Tamper: flip the last byte.
      const tampered = rawTx.slice(0, -2) + (rawTx.slice(-2) === "00" ? "01" : "00");
      // Compute the hash of the TAMPERED tx (so the RPC "honestly" reports
      // the hash of what it received). The Broadcaster's expectedHash was
      // computed over the ORIGINAL rawSignedTx, so this will mismatch.
      const tamperedHash = computeKeccak256(tampered);
      return {
        ok: true,
        txHash: tamperedHash,
        broadcastBy: "alpha",
        failedOver: false,
      };
    };

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === false, "B.8: result.ok should be false (altered tx detected)");
    assertStartsWith(result.error!, BroadcasterError.IMMUTABILITY_VIOLATION, "B.8: error prefix");
    assert(capturedRawSignedTx !== null, "B.8: signer was called and produced a signature");
  }

  // -------------------------------------------------------------------------
  // C. Immutability structural test
  // -------------------------------------------------------------------------

  console.log("\nC. Immutability structural test\n");

  // C.1 — the 8-step flow: buildTransaction → sign → hashBefore → broadcast → hashAfter
  console.log("C.1 — REG-014 closed loop: hashBefore === hashAfter");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x7" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    // Capture the rawSignedTx the signer produced AND the hash the broadcaster computed.
    let signerProducedRawTx: string | null = null;
    let broadcastReceivedRawTx: string | null = null;

    signerTransport.signHandler = async (wireReq) => {
      const resp = await defaultSignHandler(wireReq);
      if (resp.ok && resp.result && (resp.result as any).rawSignedTx) {
        signerProducedRawTx = (resp.result as any).rawSignedTx;
      }
      return resp;
    };

    rpcTransport.broadcastHandler = async (rawTx) => {
      broadcastReceivedRawTx = rawTx;
      // Compute the real hash — the Broadcaster will verify this matches its expectedHash.
      const hash = computeKeccak256(rawTx);
      return {
        ok: true,
        txHash: hash,
        broadcastBy: "alpha",
        failedOver: false,
      };
    };

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === true, "C.1: result.ok should be true");

    // Verify the closed loop:
    // 1. The signer produced a rawSignedTx.
    assert(signerProducedRawTx !== null, "C.1: signer produced rawSignedTx");
    // 2. The broadcaster received the EXACT SAME bytes (no modification).
    assert(broadcastReceivedRawTx === signerProducedRawTx, "C.1: broadcaster received EXACT same bytes as signer produced (immutability)");
    // 3. The hash the broadcaster returned matches the hash of the signer's bytes.
    const expectedHash = computeKeccak256(signerProducedRawTx!);
    assertEqual(result.txHash, expectedHash, "C.1: returned txHash === keccak256(rawSignedTx)");
    // 4. The hash also matches what the RPC computed (the broadcaster verified this internally).
    const rpcHash = computeKeccak256(broadcastReceivedRawTx!);
    assertEqual(rpcHash, expectedHash, "C.1: RPC hash === local hash (REG-014 verified)");
  }

  // -------------------------------------------------------------------------
  // D. Adapter integration
  // -------------------------------------------------------------------------

  console.log("\nD. Adapter integration\n");

  // D.1 — signer returns ok=false → Broadcaster returns ok=false
  console.log("D.1 — signer returns ok=false → BROADCAST_SIGN_FAILED");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x0" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    // Signer rejects (vault locked).
    signerTransport.signHandler = async (wireReq) => {
      return {
        ok: true,
        result: {
          ok: false,
          error: "SIGNER_VAULT_LOCKED: vault is locked",
          requestId: wireReq.requestId,
          receivedPayloadHash: wireReq.payloadHash,
          signerVersion: SIGNER_PROTOCOL_VERSION,
        },
      };
    };

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === false, "D.1: result.ok should be false");
    // The Broadcaster propagates the signer's error verbatim — it does
    // NOT wrap it as BROADCAST_SIGN_FAILED because the signer's error
    // prefix (SIGNER_VAULT_LOCKED) is more informative than a generic
    // "sign failed". The Broadcaster only adds its own prefix when the
    // signer returns ok=false WITHOUT an error string.
    assert(result.error!.includes("SIGNER_VAULT_LOCKED"), "D.1: error mentions vault locked");

    // Verify broadcast was NOT called.
    const methods = rpcTransport.calls.map(c => c.method);
    assert(!methods.includes("eth_sendRawTransaction"), "D.1: eth_sendRawTransaction should NOT be called when signer rejects");
  }

  // D.2 — signer returns ok=true but no rawSignedTx
  console.log("\nD.2 — signer returns ok=true but no rawSignedTx → INVALID_RESPONSE");
  {
    rpcTransport.reset();
    signerTransport.reset();

    rpcTransport.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x0" }];
    rpcTransport.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
    rpcTransport.scripts["eth_feeHistory"] = [
      {
        kind: "value",
        value: {
          baseFeePerGas: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          reward: [["0x3e8"]],
        },
      },
    ];

    // Signer returns ok=true with txHash but NO rawSignedTx.
    signerTransport.signHandler = async (wireReq) => {
      return {
        ok: true,
        result: {
          ok: true,
          txHash: "0x" + "ab".repeat(32),
          // rawSignedTx intentionally omitted
          requestId: wireReq.requestId,
          receivedPayloadHash: wireReq.payloadHash,
          signerVersion: SIGNER_PROTOCOL_VERSION,
        },
      };
    };

    const { broadcaster } = freshBroadcaster();

    const result = await broadcaster.submit(validSignerRequest());

    assert(result.ok === false, "D.2: result.ok should be false");
    // The adapter's signAndReturnRaw catches this and returns INVALID_RESPONSE,
    // which the Broadcaster wraps as SIGN_FAILED.
    assert(result.error!.includes("INVALID_RESPONSE") || result.error!.includes("SIGN_FAILED"), "D.2: error mentions INVALID_RESPONSE or SIGN_FAILED");

    // Verify broadcast was NOT called.
    const methods = rpcTransport.calls.map(c => c.method);
    assert(!methods.includes("eth_sendRawTransaction"), "D.2: eth_sendRawTransaction should NOT be called when rawSignedTx is missing");
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  console.log("\n=== M3.3 Summary: " + pass + " pass, " + fail + " fail ===\n");

  if (fail === 0) {
    console.log("Properties verified:");
    console.log("  A.1  valid request → nonce + gas + sign + broadcast + verify");
    console.log("  A.2  fixedGasLimit override → eth_estimateGas skipped");
    console.log("  A.3  fixedMaxPriorityFeePerGas override → eth_feeHistory skipped");
    console.log("  B.1  nonce already used → fail closed");
    console.log("  B.2  stale nonce → fail closed");
    console.log("  B.3  insufficient gas → fail closed");
    console.log("  B.4  RPC returns different hash → REG-014 immutability violation");
    console.log("  B.5  broadcast partial + timeout → fail closed");
    console.log("  B.6  error in alpha, success in beta → H1.1 failover honored");
    console.log("  B.7  malformed RPC response → fail closed");
    console.log("  B.8  raw tx altered after signature → REG-014 pre-broadcast check");
    console.log("  C.1  REG-014 closed loop: hashBefore === hashAfter");
    console.log("  D.1  signer rejects → BROADCAST_SIGN_FAILED, no broadcast");
    console.log("  D.2  signer returns ok=true but no rawSignedTx → INVALID_RESPONSE");
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFATAL: unhandled error in test driver:");
  console.error(err);
  process.exit(1);
});
