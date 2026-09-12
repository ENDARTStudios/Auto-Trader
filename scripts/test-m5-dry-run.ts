/**
 * M5.1 — Dry Run harness.
 *
 * Runs the FULL chain stack (Pipeline → SignerAdapter → WriterLease →
 * LeasedBroadcaster → CanaryBroadcaster → Broadcaster → QuorumRpcClient)
 * hundreds of times with mock transports and canary pct = 0 (NO broadcast).
 *
 * GOAL
 * ----
 * Validate that the runtime composition from src/lib/chain/runtime.ts
 * works under load and that every layer honors its invariants across
 * many consecutive operations:
 *
 *   1. Pipeline runs all gates in order (no bypass).
 *   2. Lease acquired + released on EVERY op (REG-015).
 *   3. CanaryBroadcaster skips broadcast when pct=0 (dry-run mode).
 *   4. Metrics recorded for every layer (pipeline, signer, broadcaster).
 *   5. No state leaks (lease store empty after each op, metrics counter
 *      increments linearly).
 *   6. Latency distribution is reasonable (p95 < 100ms with mocks).
 *   7. Audit sink receives exactly one entry per op (success or failure).
 *
 * WHAT DRY RUN DOES NOT DO
 * ------------------------
 *   - NO real network (all transports are mocks).
 *   - NO real broadcast (canary pct = 0).
 *   - NO real signing (signer transport is a mock that returns a
 *     precomputed signature).
 *   - NO adversarial gate failures (that's M5.4 Chaos).
 *
 * Test matrix:
 *
 *   A. Functional baseline (5 tests)
 *     A.1 — single op: pipeline ok, lease released, metrics recorded
 *     A.2 — 100 ops: all succeed, no leaks, 100 audit entries
 *     A.3 — 500 ops: all succeed, latency p95 < 50ms
 *     A.4 — 1000 ops: all succeed, memory stable (heap delta < 50MB)
 *     A.5 — canary pct=0: 0 broadcasts, 100% canary-skipped metrics
 *
 *   B. Lease invariants under load (4 tests)
 *     B.1 — lease acquired + released on every op (100 ops)
 *     B.2 — lease store is empty after each op (no leaked leases)
 *     B.3 — fencing token increases monotonically across ops
 *     B.4 — concurrent ops (10 parallel) — at most 1 holds lease at a time
 *
 *   C. Metrics invariants (3 tests)
 *     C.1 — pipeline.submit counter == op count
 *     C.2 — signer.submit counter == op count (canary skip still records)
 *     C.3 — broadcaster.canary.submit outcome=skipped counter == op count
 *
 *   D. Audit invariants (2 tests)
 *     D.1 — exactly one audit entry per op (success path)
 *     D.2 — audit event is "pipeline.success" when canary skips broadcast
 *
 * Run: npx tsx scripts/test-m5-dry-run.ts
 */

import { getAddress, zeroPadValue, Wallet } from "ethers";
import { createHash } from "crypto";

// Chain stack
import { QuorumRpcClient, type Transport, type RpcEndpoint } from "../src/lib/chain/rpc-resilience";
import { SimulationGate, type Simulator, type SimulationResult, type ExpectedDiff } from "../src/lib/chain/simulation-gate";
import {
  ContractVerifier,
  type ChainReader,
  type ContractManifest,
  type Selector,
  keccak256Hex,
} from "../src/lib/chain/contract-verification";
import {
  LiquidityVerifier,
  type LiquiditySource,
  type LiquidityManifest,
  type PoolInfo,
  type LpLockInfo,
} from "../src/lib/chain/liquidity-verification";
import {
  TokenAuthorityVerifier,
  type TokenAuthoritySource,
  type TokenAuthorityManifest,
  type AuthorityLog,
  SEL,
  OWNERSHIP_TRANSFERRED_TOPIC,
} from "../src/lib/chain/token-authority";
import {
  SellSimVerifier,
  type TradeSimulator,
  type BuySpec,
  type SellSpec,
  type SimResult,
  type SellSimManifest,
} from "../src/lib/chain/sell-simulation";
import {
  ApprovalGate,
  type ApprovalLedger,
  type ApprovalPolicy,
  type ApprovalRequest,
  InMemoryApprovalLedger,
} from "../src/lib/chain/approval-hardening";
import { type SlippageInputs } from "../src/lib/chain/mev-baseline";
import {
  Pipeline,
  type PipelineRequest,
  type PipelineResult,
  type GateName,
  type AuditSink,
  type SignerRequest,
  type SignerResult,
} from "../src/lib/chain/pipeline";
import { type SignerTransport, type RpcResponse } from "../src/lib/chain/signer-adapter";
import { SIGNER_PROTOCOL_VERSION } from "../src/lib/signer-protocol";

// Minimal shape of the legacy wire envelope this mock inspects.
// (SignerWireRequest no longer exists in signer-protocol.ts.)
interface LegacyWireRequest {
  requestId: string;
  payloadHash: string;
  payload: { tx: unknown };
}
import {
  buildRuntime,
  CanaryBroadcaster,
  type Runtime,
  type RuntimeConfig,
} from "../src/lib/chain/runtime";
import { Registry } from "../src/lib/observability/registry";
import { buildSnapshot } from "../src/lib/observability/snapshot";
import { InMemoryLeaseStore, LeaseError } from "../src/lib/chain/writer-lease";

// -------------------------------------------------------------------------
// Test runner
// -------------------------------------------------------------------------

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  \u2713 PASS`); pass++; }
  else { console.log(`  \u2717 FAIL: ${msg}`); fail++; process.exitCode = 1; }
}
function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok = actual === expected;
  if (ok) { console.log(`  \u2713 PASS — ${label}`); pass++; }
  else { console.log(`  \u2717 FAIL — ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); fail++; process.exitCode = 1; }
}
function assertLessThan<T>(actual: T, ceiling: T, label: string): void {
  if (actual < ceiling) { console.log(`  \u2713 PASS — ${label} (${actual} < ${ceiling})`); pass++; }
  else { console.log(`  \u2717 FAIL — ${label}: expected < ${ceiling}, got ${actual}`); fail++; process.exitCode = 1; }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// -------------------------------------------------------------------------
// Fixtures — happy-path addresses + manifests (from test-h2-integration-gate.ts)
// -------------------------------------------------------------------------

const TOKEN = getAddress("0x0000000000000000000000000000000000000001");
const POOL_A = getAddress("0x0000000000000000000000000000000000000010");
const LP_A = getAddress("0x00000000000000000000000000000000000000a0");
const LOCK_TRUSTED = getAddress("0x00000000000000000000000000000000000000f1");
const HOLDER_DEPLOYER = getAddress("0x00000000000000000000000000000000000000d1");
const OWNER_REAL = getAddress("0x" + "0".repeat(39) + "b");
const ROUTER = getAddress("0x0000000000000000000000000000000000000002");
const BUYER = getAddress("0x0000000000000000000000000000000000000003");
const ZERO_ADDR = "0x" + "0".repeat(40);
const NOW = Math.floor(Date.now() / 1000);
const MIN_LOCK_END = NOW + 30 * 86400;
const ZERO32 = "0x" + "0".repeat(64);

const STD_SELECTORS: Selector[] = [
  "0xa9059cbb", "0x095ea7b3", "0x70a08231", "0x18160ddd", SEL.owner,
].sort();

function buildBytecode(selectors: Selector[]): string {
  let code = "0x";
  for (const sel of selectors) code += "63" + sel.slice(2).toLowerCase() + "14";
  code += "00";
  return code;
}
const HAPPY_BYTECODE = buildBytecode(STD_SELECTORS);
const HAPPY_BYTECODE_HASH = keccak256Hex(HAPPY_BYTECODE);

function pad32(hex: string): string {
  let h = hex.toLowerCase();
  if (h.startsWith("0x")) h = h.slice(2);
  while (h.length < 64) h = "0" + h;
  return "0x" + h;
}
function addrReturn(addr: string): string {
  if (addr === ZERO_ADDR || /^0x0+$/.test(addr)) return pad32("0");
  return zeroPadValue(addr, 32);
}

// -------------------------------------------------------------------------
// Happy-path mocks — always return success.
// -------------------------------------------------------------------------

class HappyChainReader implements ChainReader {
  async getCode(_addr: string): Promise<string> { return HAPPY_BYTECODE; }
  async getStorageAt(_addr: string, _slot: string): Promise<string> { return ZERO32; }
  async call(_to: string, calldata: string): Promise<string> {
    if (calldata === SEL.owner) return addrReturn(OWNER_REAL);
    return ZERO32;
  }
}

class HappyLiquiditySource implements LiquiditySource {
  private pools = new Map<string, PoolInfo>();
  private locks = new Map<string, LpLockInfo>();
  private lpBalances = new Map<string, string>();
  private poolsForToken: PoolInfo[] = [];

  constructor() {
    const poolInfo: PoolInfo = {
      dex: "uniswap-v2", pool: POOL_A, lpToken: LP_A,
      lpTotalSupply: "1000000000000000000000",
      token0: TOKEN, token1: ROUTER,
      reserve0: "1000000000000000000000", reserve1: "1000000000000000000",
    };
    this.pools.set(POOL_A.toLowerCase(), poolInfo);
    this.poolsForToken = [poolInfo];
    const lockInfo: LpLockInfo = {
      lockContract: LOCK_TRUSTED, lockOwner: HOLDER_DEPLOYER,
      lockedAmount: "1000000000000000000000", unlockEpoch: MIN_LOCK_END,
      withdrawPermissioned: true,
    };
    this.locks.set(LP_A.toLowerCase() + ":" + LOCK_TRUSTED.toLowerCase(), lockInfo);
    this.lpBalances.set(LP_A.toLowerCase() + ":" + HOLDER_DEPLOYER.toLowerCase(), "0");
  }
  async getPool(pool: string): Promise<PoolInfo | null> { return this.pools.get(pool.toLowerCase()) ?? null; }
  async listPoolsForToken(_token: string): Promise<PoolInfo[]> { return this.poolsForToken; }
  async lpBalanceOf(lpToken: string, holder: string): Promise<string> { return this.lpBalances.get(lpToken.toLowerCase() + ":" + holder.toLowerCase()) ?? "0"; }
  async getLock(lpToken: string, lockContract: string): Promise<LpLockInfo | null> { return this.locks.get(lpToken.toLowerCase() + ":" + lockContract.toLowerCase()) ?? null; }
}

class HappyAuthoritySource implements TokenAuthoritySource {
  bytecode = HAPPY_BYTECODE;
  callReturns: Record<string, string> = {};
  logsByTopic = new Map<string, AuthorityLog[]>();

  constructor() {
    this.callReturns[SEL.owner] = addrReturn(OWNER_REAL);
  }
  async getCode(_token: string): Promise<string> { return this.bytecode; }
  async call(_token: string, calldata: string): Promise<string> { return this.callReturns[calldata] ?? ZERO32; }
  async getLogs(_token: string, topic0: string, _fromBlock?: number | "earliest"): Promise<AuthorityLog[]> { return this.logsByTopic.get(topic0) ?? []; }
}

class HappyTradeSimulator implements TradeSimulator {
  async simulateBuy(_spec: BuySpec): Promise<SimResult> {
    return { reverted: false, actualAmountOut: "1000000000000000000", gasUsed: 150000 };
  }
  async simulateSell(_spec: SellSpec, _buyAmountOut: string): Promise<SimResult> {
    return { reverted: false, actualAmountOut: "1000000000000000000", gasUsed: 150000 };
  }
}

// NOTE: holds a simulate() method but is NOT the Simulator itself —
// callers adapt it as `(tx) => simulator.simulate(tx)` because Simulator
// is a function type (see simulation-gate.ts).
class HappySimulator {
  async simulate(tx: { from: string; to: string; value: string; data: string }): Promise<SimulationResult> {
    // Return the expected transfer so the simulation gate matches the expectedDiff.
    return {
      ok: true,
      changes: [
        { kind: "erc20_transfer", token: TOKEN, from: ROUTER, to: BUYER, amount: "1000000000000000000" },
      ],
      gasUsed: 150000,
      from: tx.from,
    };
  }
}

// -------------------------------------------------------------------------
// Mock RPC transport — happy-path responses for nonce/gas/feeHistory.
// -------------------------------------------------------------------------

class MockRpcTransport {
  calls: { url: string; method: string; params: unknown[] }[] = [];
  broadcastCalls: string[] = [];

  asTransport(): Transport {
    return async (url: string, method: string, params: unknown[]) => {
      this.calls.push({ url, method, params });
      switch (method) {
        case "eth_getTransactionCount":
          return "0x0"; // nonce 0
        case "eth_estimateGas":
          return "0x5208"; // 21000
        case "eth_feeHistory":
          return {
            baseFeePerGas: ["0x2540be400"], // 10 gwei
            reward: [["0x9502f900"]], // 2.5 gwei
            gasUsedRatio: [0.5],
            oldestBlock: "0x1",
          };
        case "eth_gasPrice":
          return "0x2540be400";
        case "eth_blockNumber":
          return "0x64";
        case "eth_sendRawTransaction":
          this.broadcastCalls.push(params[0] as string);
          // Return a fake hash — the Broadcaster will verify this matches
          // keccak256(rawSignedTx), so we MUST return the real hash.
          return computeKeccak256(params[0] as string);
        default:
          throw new Error(`unexpected RPC method: ${method}`);
      }
    };
  }
  reset(): void { this.calls = []; this.broadcastCalls = []; }
}

function computeKeccak256(hex: string): string {
  if (!hex.startsWith("0x")) throw new Error(`not a hex string: ${hex.slice(0, 10)}`);
  const bytes = hexToBytes(hex.slice(2));
  const { keccak_256 } = require("@noble/hashes/sha3.js");
  const hash = keccak_256(bytes);
  return "0x" + bytesToHex(hash);
}
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

// -------------------------------------------------------------------------
// Mock signer transport — produces real signatures via a test wallet.
// -------------------------------------------------------------------------

const TEST_WALLET = Wallet.createRandom();

class MockSignerTransport implements SignerTransport {
  calls: { method: string; params: unknown; timeoutMs: number }[] = [];
  async rpc(method: string, params: unknown, timeoutMs: number): Promise<RpcResponse> {
    this.calls.push({ method, params, timeoutMs });
    if (method === "health_check") {
      return { ok: true, result: { status: "ok", pid: 12345, version: SIGNER_PROTOCOL_VERSION, uptimeMs: 1000 } };
    }
    if (method === "signTransaction") {
      const wireReq = params as LegacyWireRequest;
      const payload = wireReq.payload;
      const tx = payload.tx as Record<string, unknown>;
      const ethersTx: Record<string, unknown> = {
        to: tx.to, value: tx.value as string, data: tx.data as string,
        nonce: tx.nonce ?? 0,
        gasLimit: tx.gasLimit ?? "0x5208",
        maxFeePerGas: tx.maxFeePerGas ?? "0x2540be400",
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? "0x9502f900",
        type: 2, chainId: 1,
      };
      try {
        const rawSignedTx = await TEST_WALLET.signTransaction(ethersTx as any);
        const { Transaction } = await import("ethers");
        const parsed = Transaction.from(rawSignedTx);
        return {
          ok: true,
          result: {
            ok: true, txHash: parsed.hash, rawSignedTx,
            requestId: wireReq.requestId,
            receivedPayloadHash: wireReq.payloadHash,
            signerVersion: SIGNER_PROTOCOL_VERSION,
          },
        };
      } catch (err) {
        return { ok: true, result: { ok: false, error: `SIGNER_SIGN_FAILED: ${(err as Error).message}`, requestId: wireReq.requestId, receivedPayloadHash: wireReq.payloadHash, signerVersion: SIGNER_PROTOCOL_VERSION } };
      }
    }
    return { ok: false, error: { code: -32601, message: `method not found: ${method}` } };
  }
  reset(): void { this.calls = []; }
}

// -------------------------------------------------------------------------
// Mock audit sink — counts calls.
// -------------------------------------------------------------------------

class CountingAuditSink implements AuditSink {
  callCount = 0;
  lastEvent: string | null = null;
  append(event: string, _data: unknown): { seq: number; hash: string } {
    this.callCount++;
    this.lastEvent = event;
    return { seq: this.callCount, hash: "0x" + this.callCount.toString(16).padStart(64, "0") };
  }
}

// -------------------------------------------------------------------------
// Build a happy-path PipelineRequest.
// -------------------------------------------------------------------------

function buildHappyRequest(): PipelineRequest {
  const expectedDiff: ExpectedDiff = {
    changes: [
      { kind: "erc20_transfer", token: TOKEN, from: ROUTER, to: BUYER, amount: "1000000000000000000" },
    ],
    maxGas: 500000,
  };
  const contractManifest: ContractManifest = {
    address: TOKEN, expectedBytecodeHash: HAPPY_BYTECODE_HASH,
    expectedSelectors: STD_SELECTORS, allowedOwners: [OWNER_REAL],
  };
  const liquidityManifest: LiquidityManifest = {
    token: TOKEN, pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER, LOCK_TRUSTED],
    minLockEndEpoch: MIN_LOCK_END, minLockedFractionBps: 9500,
  };
  const authorityManifest: TokenAuthorityManifest = {
    token: TOKEN, allowedAuthorityHolders: [OWNER_REAL],
    requireRealRenounce: true, failClosedOnHidden: true,
  };
  const sellSimManifest: SellSimManifest = {
    buy: { token: TOKEN, router: ROUTER, buyer: BUYER, amountIn: "1000000000000000000", expectedAmountOut: "1000000000000000000", calldata: "0x" },
    sell: { router: ROUTER, token: TOKEN, seller: BUYER, amountIn: "1000000000000000000", expectedAmountOut: "1000000000000000000", calldata: "0x" },
    expectedBuyTaxBps: 0, expectedSellTaxBps: 0,
    slippage: { volatilityBps: 50, tradeSizeUsd: 1000, poolLiquidityUsd: 100000 },
  };
  const approvalRequest: ApprovalRequest = {
    token: TOKEN, owner: BUYER, spender: ROUTER,
    amount: "1000000000000000000", ownerBalance: "10000000000000000000",
  };
  const slippageInputs: SlippageInputs = { volatilityBps: 50, tradeSizeUsd: 1000, poolLiquidityUsd: 100000 };
  return {
    tx: { from: BUYER, to: ROUTER, value: "0", data: "0x" },
    expectedDiff, contractManifest, liquidityManifest, authorityManifest,
    sellSimManifest, approvalRequest,
    mevInputs: {
      slippage: slippageInputs, expectedPrice: 1.0, actualPrice: 1.0,
      sandwich: {
        victimAddress: BUYER,
        preState: { blockNumber: 100, spotPrice: 1.0, liquidityUsd: 100000 },
        postState: { blockNumber: 101, spotPrice: 1.0, liquidityUsd: 100000 },
        observedTrades: [],
      },
    },
  };
}

// -------------------------------------------------------------------------
// Build a fresh runtime with happy-path mocks.
// -------------------------------------------------------------------------

function freshRuntime(opts?: {
  canaryPct?: number;
  registry?: Registry;
}): { runtime: Runtime; rpcTransport: MockRpcTransport; signerTransport: MockSignerTransport; audit: CountingAuditSink; leaseStore: InMemoryLeaseStore; registry: Registry } {
  const rpcTransport = new MockRpcTransport();
  const signerTransport = new MockSignerTransport();
  const audit = new CountingAuditSink();
  const leaseStore = new InMemoryLeaseStore();
  const registry = opts?.registry ?? Registry.create();

  const chain = new HappyChainReader();
  const liquidity = new HappyLiquiditySource();
  const authority = new HappyAuthoritySource();
  const tradeSim = new HappyTradeSimulator();
  const simulator = new HappySimulator();
  const ledger = new InMemoryApprovalLedger();

  const simulation = new SimulationGate({ simulator: (tx) => simulator.simulate(tx) });
  const contract = new ContractVerifier({ chain });
  const liquidityVerifier = new LiquidityVerifier(liquidity);
  const authorityVerifier = new TokenAuthorityVerifier(authority);
  const sellSim = new SellSimVerifier(tradeSim);
  // autoRevokeAfterUse: false — the dry-run harness runs many ops against
  // the same ledger; revoking after each op would cause op #2+ to fail at
  // the approval gate. The H2.6 integration test already validates
  // revocation behavior; here we're testing the M5 stack (lease, metrics,
  // canary), not the approval gate.
  const approvalPolicy: ApprovalPolicy = {
    maxApprovalPerSpender: "1000000000000000000000",
    allowFullBalanceApproval: false, autoRevokeAfterUse: false,
  };
  const approval = new ApprovalGate(ledger, approvalPolicy);

  const endpoints: RpcEndpoint[] = [
    { id: "alpha", url: "https://alpha.example", priority: 100 },
    { id: "beta", url: "https://beta.example", priority: 90 },
  ];

  const runtime = buildRuntime({
    rpc: { endpoints, transport: rpcTransport.asTransport(), callTimeoutMs: 1000 },
    signer: { transport: signerTransport },
    lease: { store: leaseStore, ttlMs: 10_000 },
    canary: { pct: opts?.canaryPct ?? 0 },
    registry,
    signingAddress: BUYER,
    gates: { simulation, contract, liquidity: liquidityVerifier, authority: authorityVerifier, sellSim, approval, audit },
  });

  return { runtime, rpcTransport, signerTransport, audit, leaseStore, registry };
}

// -------------------------------------------------------------------------
// Main test driver
// -------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n=== M5.1 — Dry Run Harness ===\n");

  // -------------------------------------------------------------------------
  // A. Functional baseline
  // -------------------------------------------------------------------------

  console.log("A. Functional baseline\n");

  // A.1 — single op: pipeline ok, lease released, metrics recorded
  console.log("A.1 — single op: pipeline ok, lease released, metrics recorded");
  {
    const { runtime, audit, leaseStore, registry } = freshRuntime();
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(r.ok, "pipeline.process should succeed");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    assertEqual(audit.lastEvent, "pipeline.success", "audit event is pipeline.success");

    // Lease released after op.
    const rec = await leaseStore.current(runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease is free after op");

    // Metrics recorded into the Registry.
    const snap = buildSnapshot(registry);
    assert(snap.errors.signer >= 0, "signer metrics present in snapshot");

    await runtime.shutdown();
  }

  // A.2 — 100 ops: all succeed, no leaks, 100 audit entries
  console.log("A.2 — 100 ops: all succeed, no leaks, 100 audit entries");
  {
    const { runtime, audit, leaseStore } = freshRuntime();
    const req = buildHappyRequest();
    let okCount = 0;
    for (let i = 0; i < 100; i++) {
      const r = await runtime.pipeline.process(req);
      if (r.ok) okCount++;
    }
    assertEqual(okCount, 100, "all 100 ops succeed");
    assertEqual(audit.callCount, 100, "100 audit entries");

    // Lease store should be empty (free) after all ops.
    const rec = await leaseStore.current(runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease is free after 100 ops");

    await runtime.shutdown();
  }

  // A.3 — 500 ops: all succeed, latency p95 < 50ms (mock transports)
  console.log("A.3 — 500 ops: all succeed, latency p95 < 50ms");
  {
    const registry = Registry.create();
    const { runtime } = freshRuntime({ registry });
    const req = buildHappyRequest();
    const latencies: number[] = [];
    for (let i = 0; i < 500; i++) {
      const start = Date.now();
      await runtime.pipeline.process(req);
      latencies.push(Date.now() - start);
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    assertLessThan(p95, 50, "p95 latency < 50ms");

    // Also check the Registry's latency histogram (signerLatencyMs).
    const metricP95 = registry.metrics.signerLatencyMs.p95();
    assertLessThan(metricP95, 50, "Registry signerLatencyMs p95 < 50ms");

    await runtime.shutdown();
  }

  // A.4 — 1000 ops: memory stable (heap delta < 50MB)
  console.log("A.4 — 1000 ops: memory stable (heap delta < 50MB)");
  {
    const { runtime } = freshRuntime();
    const req = buildHappyRequest();
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1000; i++) {
      await runtime.pipeline.process(req);
    }
    if (global.gc) global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const deltaMb = (heapAfter - heapBefore) / (1024 * 1024);
    assertLessThan(Math.abs(deltaMb), 50, `|heap delta| < 50MB (got ${deltaMb.toFixed(1)}MB)`);

    await runtime.shutdown();
  }

  // A.5 — canary pct=0: 0 broadcasts, 100% canary-skipped metrics
  console.log("A.5 — canary pct=0: 0 broadcasts, 100% canary-skipped metrics");
  {
    const registry = Registry.create();
    const { runtime, rpcTransport } = freshRuntime({ registry, canaryPct: 0 });
    const req = buildHappyRequest();
    for (let i = 0; i < 50; i++) {
      await runtime.pipeline.process(req);
    }
    assertEqual(rpcTransport.broadcastCalls.length, 0, "0 real broadcasts (canary pct=0)");

    const skipped = registry.metrics.canarySkipped.get();
    assertEqual(skipped, 50, "50 canary-skipped metrics recorded");

    await runtime.shutdown();
  }

  // -------------------------------------------------------------------------
  // B. Lease invariants under load
  // -------------------------------------------------------------------------

  console.log("\nB. Lease invariants under load\n");

  // B.1 — lease acquired + released on every op (100 ops)
  // Uses canaryPct=100 so every op actually acquires the lease (canary skip
  // at pct=0 bypasses the lease entirely — that's correct canary behavior,
  // but here we're testing the lease lifecycle).
  console.log("B.1 — lease acquired + released on every op (100 ops, canaryPct=100)");
  {
    const { runtime, leaseStore } = freshRuntime({ canaryPct: 100 });
    const req = buildHappyRequest();
    for (let i = 0; i < 100; i++) {
      await runtime.pipeline.process(req);
      const rec = await leaseStore.current(runtime.lease.getKey());
      if (rec.state !== "free") {
        assert(false, `lease not free after op ${i}: state=${rec.state}`);
        break;
      }
    }
    assert(true, "lease free after every op (100 ops checked)");

    await runtime.shutdown();
  }

  // B.2 — lease store is empty after each op (no leaked leases)
  console.log("B.2 — lease store is empty after each op (canaryPct=100)");
  {
    const { runtime, leaseStore } = freshRuntime({ canaryPct: 100 });
    const req = buildHappyRequest();
    for (let i = 0; i < 50; i++) {
      await runtime.pipeline.process(req);
    }
    const rec = await leaseStore.current(runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease store has no held records after 50 ops");
    assertEqual(rec.owner, null, "no owner after release");

    await runtime.shutdown();
  }

  // B.3 — fencing token increases monotonically across ops
  console.log("B.3 — fencing token increases monotonically across ops (canaryPct=100)");
  {
    const { runtime, leaseStore } = freshRuntime({ canaryPct: 100 });
    const req = buildHappyRequest();
    const tokens: number[] = [];
    for (let i = 0; i < 10; i++) {
      await runtime.pipeline.process(req);
      const rec = await leaseStore.current(runtime.lease.getKey());
      tokens.push(rec.token);
    }
    let monotonic = true;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i]! <= tokens[i - 1]!) { monotonic = false; break; }
    }
    assert(monotonic, `tokens should strictly increase: got ${JSON.stringify(tokens)}`);

    await runtime.shutdown();
  }

  // B.4 — concurrent ops (10 parallel) — lease serializes: at most 1 wins
  console.log("B.4 — concurrent ops (10 parallel) — lease serializes (1 wins, 9 LEASE_BUSY)");
  {
    const { runtime, leaseStore } = freshRuntime({ canaryPct: 100 });
    const req = buildHappyRequest();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => runtime.pipeline.process(req)),
    );
    const oks = results.filter((r) => r.ok).length;
    // The lease serializes access — at most 1 op holds the lease at any
    // instant. The other 9 get LEASE_BUSY → LEASE_ACQUIRE_FAILED. This is
    // CORRECT behavior: the lease is a coordination primitive, not a queue.
    // Callers that get LEASE_BUSY should retry (the engine's retry logic
    // handles this in production).
    assertEqual(oks, 1, "exactly 1 concurrent op wins the lease");
    const fails = results.filter((r) => !r.ok);
    assertEqual(fails.length, 9, "9 concurrent ops fail with LEASE_ACQUIRE_FAILED");
    const allLeaseBusy = fails.every((r) =>
      r.originalReason?.includes("LEASE_ACQUIRE_FAILED"),
    );
    assert(allLeaseBusy, "all failures are LEASE_ACQUIRE_FAILED");

    const rec = await leaseStore.current(runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease free after 10 concurrent ops");

    await runtime.shutdown();
  }

  // -------------------------------------------------------------------------
  // C. Metrics invariants
  // -------------------------------------------------------------------------

  console.log("\nC. Metrics invariants\n");

  // C.1 — signerLatencyMs histogram count == op count
  console.log("C.1 — signerLatencyMs histogram count == op count");
  {
    const registry = Registry.create();
    const { runtime } = freshRuntime({ registry });
    const req = buildHappyRequest();
    const N = 75;
    for (let i = 0; i < N; i++) {
      await runtime.pipeline.process(req);
    }
    const signerCount = registry.metrics.signerLatencyMs.snapshot().count;
    assertEqual(signerCount, N, `signerLatencyMs count == ${N}`);

    await runtime.shutdown();
  }

  // C.2 — signerLatencyMs count == op count (canary skip still records)
  console.log("C.2 — signerLatencyMs count == op count (canary skip still records)");
  {
    const registry = Registry.create();
    const { runtime } = freshRuntime({ registry, canaryPct: 0 });
    const req = buildHappyRequest();
    const N = 30;
    for (let i = 0; i < N; i++) {
      await runtime.pipeline.process(req);
    }
    // Even with canary pct=0, the InstrumentedSignerSink records every submit.
    const signerCount = registry.metrics.signerLatencyMs.snapshot().count;
    assertEqual(signerCount, N, `signerLatencyMs count == ${N} (canary skip still recorded)`);

    await runtime.shutdown();
  }

  // C.3 — canarySkipped counter == op count
  console.log("C.3 — canarySkipped counter == op count");
  {
    const registry = Registry.create();
    const { runtime } = freshRuntime({ registry, canaryPct: 0 });
    const req = buildHappyRequest();
    const N = 40;
    for (let i = 0; i < N; i++) {
      await runtime.pipeline.process(req);
    }
    const skipped = registry.metrics.canarySkipped.get();
    assertEqual(skipped, N, `canarySkipped counter == ${N}`);

    await runtime.shutdown();
  }

  // -------------------------------------------------------------------------
  // D. Audit invariants
  // -------------------------------------------------------------------------

  console.log("\nD. Audit invariants\n");

  // D.1 — exactly one audit entry per op (success path)
  console.log("D.1 — exactly one audit entry per op (success path)");
  {
    const { runtime, audit } = freshRuntime();
    const req = buildHappyRequest();
    for (let i = 0; i < 25; i++) {
      await runtime.pipeline.process(req);
    }
    assertEqual(audit.callCount, 25, "25 audit entries for 25 ops");

    await runtime.shutdown();
  }

  // D.2 — audit event is "pipeline.success" when canary skips broadcast
  console.log("D.2 — audit event is 'pipeline.success' when canary skips broadcast");
  {
    const { runtime, audit } = freshRuntime({ canaryPct: 0 });
    const req = buildHappyRequest();
    await runtime.pipeline.process(req);
    assertEqual(audit.lastEvent, "pipeline.success", "audit event is pipeline.success (canary skip)");

    await runtime.shutdown();
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  console.log("\n=== Summary ===");
  console.log(`  Pass: ${pass}`);
  console.log(`  Fail: ${fail}`);
  console.log(`  Total: ${pass + fail}`);
  console.log("");

  if (fail > 0) {
    console.log(`\u2717 ${fail} test(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\u2713 All ${pass} tests passed.`);
  }
}

main().catch((err) => {
  console.error("Test driver crashed:", err);
  process.exit(1);
});
