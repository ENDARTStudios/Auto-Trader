/**
 * M5.4 — Chaos test suite.
 *
 * Injects failures into the full chain stack (Pipeline → SignerAdapter →
 * WriterLease → LeasedBroadcaster → CanaryBroadcaster → Broadcaster →
 * QuorumRpcClient) and verifies the system FAILS CLOSED under every
 * fault mode:
 *
 *   - No duplicate broadcasts (REG-014 + broadcastRawTransaction walks
 *     endpoints sequentially, returning after the first accept).
 *   - No lost transactions (every pipeline.process() produces exactly
 *     one audit entry, success or failure).
 *   - Fencing remains valid (lease is released on EVERY exit path —
 *     REG-015; fencing token never decreases — REG-017).
 *
 * The happy-path mock classes are COPIED from test-m5-dry-run.ts (not
 * imported) because the chaos tests need to ADD fault-injection fields
 * to the transports without changing the dry-run harness.
 *
 * Test matrix (per operator's M5.4 directive — 20 tests):
 *
 *   A. RPC failures (4 tests)
 *     A.1 — RPC endpoint down (one of two endpoints throws) → H1.1
 *           failover honored, pipeline succeeds
 *     A.2 — ALL RPC endpoints down → pipeline fails at rpc gate,
 *           signer NEVER called
 *     A.3 — RPC timeout (transport hangs) → pipeline fails at rpc
 *           gate within timeoutMs
 *     A.4 — RPC returns malformed data (non-hex nonce) → broadcaster
 *           fails closed with BROADCAST_NONCE_RESOLUTION_FAILED
 *
 *   B. Signer failures (3 tests)
 *     B.1 — Signer transport unavailable (ECONNREFUSED) → broadcaster
 *           fails with BROADCAST_SIGN_FAILED, lease released (REG-015)
 *     B.2 — Signer returns ok=false → broadcaster passes through error,
 *           lease released
 *     B.3 — Signer returns ok=true but no rawSignedTx → broadcaster
 *           fails with BROADCAST_SIGN_FAILED (INVALID_RESPONSE)
 *
 *   C. Lease failures (4 tests)
 *     C.1 — Lease store unavailable on acquire → LEASE_ACQUIRE_FAILED,
 *           no broadcast
 *     C.2 — Lease expires mid-broadcast (TTL too short) → verifyToken
 *           fails → LEASE_FENCING_TOKEN_STALE
 *     C.3 — Owner change mid-broadcast (another process takes lease) →
 *           LEASE_FENCING_TOKEN_STALE
 *     C.4 — Lease renewer fails continuously → lease lost, isHeld()
 *           returns false
 *
 *   D. Broadcast failures (3 tests)
 *     D.1 — RPC returns different hash (REG-014 violation) →
 *           BROADCAST_IMMUTABILITY_VIOLATION
 *     D.2 — Broadcast partially fails (one endpoint accepts, response
 *           lost) → fail closed
 *     D.3 — Raw tx altered after signature → REG-014 pre-broadcast
 *           check catches it
 *
 *   E. Combined/compound failures (3 tests)
 *     E.1 — RPC down + signer down simultaneously → pipeline fails at
 *           rpc gate (first failure wins)
 *     E.2 — Lease busy + retry → second attempt succeeds (simulating
 *           engine retry)
 *     E.3 — High latency (all ops slow) → no timeout if within limit,
 *           timeout if exceeded
 *
 *   F. Invariants under chaos (3 tests)
 *     F.1 — No duplicate broadcasts: even with retries, each
 *           SignerRequest broadcasts at most once
 *     F.2 — No lost transactions: every pipeline.process() call
 *           produces exactly one audit entry
 *     F.3 — Fencing token never decreases: even across failures +
 *           owner changes
 *
 * Run: npx tsx scripts/test-m5-chaos.ts
 */

import { getAddress, zeroPadValue, Wallet } from "ethers";

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
  type ApprovalPolicy,
  type ApprovalRequest,
  InMemoryApprovalLedger,
} from "../src/lib/chain/approval-hardening";
import { type SlippageInputs } from "../src/lib/chain/mev-baseline";
import {
  Pipeline,
  type PipelineRequest,
  type AuditSink,
  type SignerRequest,
} from "../src/lib/chain/pipeline";
import { SIGNER_PROTOCOL_VERSION } from "../src/lib/signer-protocol";
import { type SignerTransport, type RpcResponse, type SignerWireRequest } from "../src/lib/chain/signer-adapter";
import {
  buildRuntime,
  InMemoryMetricsRecorder,
  type Runtime,
} from "../src/lib/chain/runtime";
import { Registry } from "../src/lib/observability/registry";
import {
  InMemoryLeaseStore,
  WriterLease,
  LeaseError,
  type LeaseStore,
  type LeaseKey,
  type LeaseOwner,
  type LeaseRecord,
} from "../src/lib/chain/writer-lease";

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
function assertStartsWith(actual: string, prefix: string, label: string): void {
  if (actual.startsWith(prefix)) { console.log(`  \u2713 PASS — ${label}`); pass++; }
  else { console.log(`  \u2717 FAIL — ${label}: expected prefix "${prefix}", got ${JSON.stringify(actual)}`); fail++; process.exitCode = 1; }
}
function assertIncludes(actual: string, needle: string, label: string): void {
  if (actual.includes(needle)) { console.log(`  \u2713 PASS — ${label}`); pass++; }
  else { console.log(`  \u2717 FAIL — ${label}: expected to include "${needle}", got ${JSON.stringify(actual)}`); fail++; process.exitCode = 1; }
}
function assertLessThan<T>(actual: T, ceiling: T, label: string): void {
  if (actual < ceiling) { console.log(`  \u2713 PASS — ${label} (${actual} < ${ceiling})`); pass++; }
  else { console.log(`  \u2717 FAIL — ${label}: expected < ${ceiling}, got ${actual}`); fail++; process.exitCode = 1; }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// -------------------------------------------------------------------------
// Fixtures — happy-path addresses + manifests (copied from dry-run harness)
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
// Happy-path mocks — COPIED from test-m5-dry-run.ts (unchanged behavior)
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

// Simulator is a type alias for a function (not an interface), so we
// implement it as a function rather than a class.
const happySimulator: Simulator = async (tx: { from: string; to: string; value: string; data: string }): Promise<SimulationResult> => {
  return {
    ok: true,
    changes: [
      { kind: "erc20_transfer", token: TOKEN, from: ROUTER, to: BUYER, amount: "1000000000000000000" },
    ],
    gasUsed: 150000,
    from: tx.from,
  };
};

// -------------------------------------------------------------------------
// Mock RPC transport — ENHANCED with fault injection.
//
// Fault-injection fields (all default to "no fault"):
//   failUrl         — when set, requests to this URL throw.
//   failAllUrls     — when true, ALL requests throw (regardless of URL).
//   returnWrongHash — when true, eth_sendRawTransaction returns a hash
//                     that does NOT match keccak256(rawSignedTx). Used
//                     for REG-014 immutability violation tests (D.1).
//   malformedNonce  — when true, eth_getTransactionCount returns a
//                     non-hex string ("not-hex"). Used for A.4.
//   hangAll         — when true, the transport NEVER resolves. Used for
//                     timeout tests (A.3, E.3-exceed).
//   delayMs         — when > 0, all responses are delayed by this many
//                     milliseconds. Used for high-latency tests (E.3).
// -------------------------------------------------------------------------

class MockRpcTransport {
  calls: { url: string; method: string; params: unknown[] }[] = [];
  broadcastCalls: string[] = [];

  failUrl: string | null = null;
  failAllUrls: boolean = false;
  returnWrongHash: boolean = false;
  malformedNonce: boolean = false;
  hangAll: boolean = false;
  delayMs: number = 0;

  asTransport(): Transport {
    return async (url: string, method: string, params: unknown[]) => {
      this.calls.push({ url, method, params });

      if (this.failAllUrls || url === this.failUrl) {
        throw new Error(`transport error: ${url} unavailable`);
      }

      if (this.hangAll) {
        // Never resolve — callWithTimeout will time out.
        return new Promise<unknown>(() => { /* hangs forever */ });
      }

      if (this.delayMs > 0) {
        await sleep(this.delayMs);
      }

      switch (method) {
        case "eth_getTransactionCount":
          if (this.malformedNonce) return "not-hex";
          return "0x0";
        case "eth_estimateGas":
          return "0x5208"; // 21000
        case "eth_feeHistory":
          return {
            baseFeePerGas: ["0x2540be400"],
            reward: [["0x9502f900"]],
            gasUsedRatio: [0.5],
            oldestBlock: "0x1",
          };
        case "eth_gasPrice":
          return "0x2540be400";
        case "eth_blockNumber":
          return "0x64";
        case "eth_sendRawTransaction":
          this.broadcastCalls.push(params[0] as string);
          if (this.returnWrongHash) {
            // Return a hash that does NOT match keccak256(rawSignedTx).
            return "0x" + "ab".repeat(32);
          }
          return computeKeccak256(params[0] as string);
        default:
          throw new Error(`unexpected RPC method: ${method}`);
      }
    };
  }

  reset(): void {
    this.calls = [];
    this.broadcastCalls = [];
    this.failUrl = null;
    this.failAllUrls = false;
    this.returnWrongHash = false;
    this.malformedNonce = false;
    this.hangAll = false;
    this.delayMs = 0;
  }
}

function computeKeccak256(hex: string): string {
  if (!hex.startsWith("0x")) throw new Error(`not a hex string: ${hex.slice(0, 10)}`);
  const bytes = hexToBytes(hex.slice(2));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
// Mock signer transport — ENHANCED with scripted failures.
//
// failMode controls the behavior of both health_check and signTransaction:
//   "ok"          — normal success (signs via TEST_WALLET, returns rawSignedTx)
//   "unavailable" — transport throws ECONNREFUSED (simulates signer process down)
//   "reject"      — signer returns ok=false with "SIGNER_REJECTED: test rejection"
//   "no-raw"      — signer returns ok=true with txHash but NO rawSignedTx
//   "wrong-hash"  — signer returns ok=true with rawSignedTx but a txHash that
//                   does NOT match keccak256(rawSignedTx). Used for D.3
//                   (REG-014 pre-broadcast check).
// -------------------------------------------------------------------------

type SignerFailMode = "ok" | "unavailable" | "reject" | "no-raw" | "wrong-hash";

const TEST_WALLET = Wallet.createRandom();

class MockSignerTransport implements SignerTransport {
  calls: { method: string; params: unknown; timeoutMs: number }[] = [];
  failMode: SignerFailMode = "ok";

  async rpc(method: string, params: unknown, timeoutMs: number): Promise<RpcResponse> {
    this.calls.push({ method, params, timeoutMs });

    if (method === "health_check") {
      if (this.failMode === "unavailable") {
        throw new Error("connect ECONNREFUSED /var/run/signer.sock");
      }
      return { ok: true, result: { status: "ok", pid: 12345, version: SIGNER_PROTOCOL_VERSION, uptimeMs: 1000 } };
    }

    if (method === "signTransaction") {
      if (this.failMode === "unavailable") {
        throw new Error("connect ECONNREFUSED /var/run/signer.sock");
      }

      const wireReq = params as SignerWireRequest;

      if (this.failMode === "reject") {
        return {
          ok: true,
          result: {
            ok: false,
            error: "SIGNER_REJECTED: test rejection (vault locked)",
            requestId: wireReq.requestId,
            receivedPayloadHash: wireReq.payloadHash,
            signerVersion: SIGNER_PROTOCOL_VERSION,
          },
        };
      }

      // For "ok", "no-raw", "wrong-hash": sign the transaction for real.
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
      let rawSignedTx: string;
      let parsedHash: string;
      try {
        rawSignedTx = await TEST_WALLET.signTransaction(ethersTx as any);
        const { Transaction } = await import("ethers");
        const parsed = Transaction.from(rawSignedTx);
        parsedHash = parsed.hash as string;
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

      if (this.failMode === "no-raw") {
        return {
          ok: true,
          result: {
            ok: true,
            txHash: parsedHash,
            // rawSignedTx intentionally omitted
            requestId: wireReq.requestId,
            receivedPayloadHash: wireReq.payloadHash,
            signerVersion: SIGNER_PROTOCOL_VERSION,
          },
        };
      }

      if (this.failMode === "wrong-hash") {
        return {
          ok: true,
          result: {
            ok: true,
            txHash: "0x" + "cd".repeat(32), // WRONG hash
            rawSignedTx,
            requestId: wireReq.requestId,
            receivedPayloadHash: wireReq.payloadHash,
            signerVersion: SIGNER_PROTOCOL_VERSION,
          },
        };
      }

      // "ok" mode
      return {
        ok: true,
        result: {
          ok: true,
          txHash: parsedHash,
          rawSignedTx,
          requestId: wireReq.requestId,
          receivedPayloadHash: wireReq.payloadHash,
          signerVersion: SIGNER_PROTOCOL_VERSION,
        },
      };
    }

    return { ok: false, error: { code: -32601, message: `method not found: ${method}` } };
  }

  reset(): void {
    this.calls = [];
    this.failMode = "ok";
  }
}

// -------------------------------------------------------------------------
// Counting audit sink — counts calls (copied from dry-run harness)
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
// Build a happy-path PipelineRequest (copied from dry-run harness)
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
// Build a fresh runtime with ENHANCED fault-injecting mocks.
//
// The chaos tests need direct access to:
//   - rpcTransport (to set failUrl, returnWrongHash, etc.)
//   - signerTransport (to set failMode)
//   - leaseStore (to injectFailure)
//   - audit (to count entries)
//   - lease (the WriterLease — to check isHeld, currentToken)
//
// Returns all handles so each test can configure fault injection BEFORE
// calling pipeline.process().
// -------------------------------------------------------------------------

interface ChaosRuntime {
  runtime: Runtime;
  rpcTransport: MockRpcTransport;
  signerTransport: MockSignerTransport;
  audit: CountingAuditSink;
  leaseStore: LeaseStore;
  lease: WriterLease;
  metrics: InMemoryMetricsRecorder;
  registry: Registry;
}

function freshRuntime(opts?: {
  canaryPct?: number;
  callTimeoutMs?: number;
  leaseStore?: LeaseStore;
  leaseTtlMs?: number;
}): ChaosRuntime {
  const rpcTransport = new MockRpcTransport();
  const signerTransport = new MockSignerTransport();
  const audit = new CountingAuditSink();
  const leaseStore = opts?.leaseStore ?? new InMemoryLeaseStore();
  const metrics = new InMemoryMetricsRecorder();
  const registry = metrics.getRegistry();

  const chain = new HappyChainReader();
  const liquidity = new HappyLiquiditySource();
  const authority = new HappyAuthoritySource();
  const tradeSim = new HappyTradeSimulator();
  const simulator = happySimulator;
  const ledger = new InMemoryApprovalLedger();
  const simulation = new SimulationGate({ simulator });
  const contract = new ContractVerifier({ chain });
  const liquidityVerifier = new LiquidityVerifier(liquidity);
  const authorityVerifier = new TokenAuthorityVerifier(authority);
  const sellSim = new SellSimVerifier(tradeSim);
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
    rpc: { endpoints, transport: rpcTransport.asTransport(), callTimeoutMs: opts?.callTimeoutMs ?? 1000 },
    signer: { transport: signerTransport },
    lease: { store: leaseStore, ttlMs: opts?.leaseTtlMs ?? 10_000 },
    canary: { pct: opts?.canaryPct ?? 100 },
    registry,
    signingAddress: BUYER,
    gates: { simulation, contract, liquidity: liquidityVerifier, authority: authorityVerifier, sellSim, approval, audit },
    // Use fixed gas/fee overrides so the Broadcaster skips eth_estimateGas
    // and eth_feeHistory. This reduces the number of quorumReads per op
    // from 4 (blockNumber + getTransactionCount + estimateGas + feeHistory)
    // to 3 (blockNumber + getTransactionCount + gasPrice). With 2 endpoints
    // and one consistently failing, 3 quorumReads keep the failing
    // endpoint's health above the 0.2 floor (1.0 → 0.7 → 0.4 → 0.1 is
    // checked at the START of each call, so 0.4 > 0.2 passes). With 4
    // quorumReads, the 4th call sees health=0.1 < 0.2 → endpoint excluded
    // → quorum impossible (only 1 healthy endpoint).
    fixedGasLimit: BigInt(21000),
    fixedMaxPriorityFeePerGas: BigInt(2500000000), // 2.5 gwei
  });

  return { runtime, rpcTransport, signerTransport, audit, leaseStore, lease: runtime.lease, metrics, registry };
}

// -------------------------------------------------------------------------
// Saboteur lease store — wraps a real store and can simulate:
//   - mid-broadcast TTL expiry (current() returns state="expired")
//   - mid-broadcast owner change (current() returns a different owner+token)
//
// Pattern copied from test-m4-writer-lease.ts D.3.
// -------------------------------------------------------------------------

type SaboteurMode = "expire-mid-broadcast" | "owner-change-mid-broadcast";

function makeSaboteurStore(realStore: LeaseStore, ownerId: LeaseOwner, mode: SaboteurMode): LeaseStore {
  return {
    async acquire(key, owner, ttlMs) { return realStore.acquire(key, owner, ttlMs); },
    async renew(key, owner, ttlMs) { return realStore.renew(key, owner, ttlMs); },
    async release(key, owner) { return realStore.release(key, owner); },
    async current(key): Promise<LeaseRecord> {
      const rec = await realStore.current(key);
      if (rec.state === "held" && rec.owner === ownerId) {
        if (mode === "expire-mid-broadcast") {
          // Simulate TTL expiring between acquire and verifyToken.
          return { ...rec, state: "expired" as const };
        }
        if (mode === "owner-change-mid-broadcast") {
          // Simulate another process taking over the lease.
          return { ...rec, owner: "host-other:9999:zzzz" as LeaseOwner, token: rec.token + 1 };
        }
      }
      return rec;
    },
    async revoke(key) { return realStore.revoke(key); },
  };
}

// -------------------------------------------------------------------------
// Always-fail-renew store — for C.4 (renewer fails continuously).
// -------------------------------------------------------------------------

function makeAlwaysFailRenewStore(realStore: LeaseStore): LeaseStore {
  return {
    async acquire(key, owner, ttlMs) { return realStore.acquire(key, owner, ttlMs); },
    async renew(_key, _owner, _ttlMs) { return { ok: false, error: LeaseError.STORE_UNAVAILABLE }; },
    async release(key, owner) { return realStore.release(key, owner); },
    async current(key) { return realStore.current(key); },
    async revoke(key) { return realStore.revoke(key); },
  };
}

// -------------------------------------------------------------------------
// Main test driver
// -------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n=== M5.4 — Chaos Test Suite ===\n");

  // =========================================================================
  // A. RPC failures
  // =========================================================================

  console.log("A. RPC failures\n");

  // A.1 — RPC endpoint down (one of two endpoints throws) → H1.1 failover
  console.log("A.1 — RPC endpoint down (one of two) → H1.1 failover, pipeline succeeds");
  {
    const { runtime, rpcTransport, audit } = freshRuntime({ canaryPct: 100 });
    rpcTransport.failUrl = "https://alpha.example"; // alpha down, beta up
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(r.ok, "pipeline should succeed via failover to beta");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    assertEqual(audit.lastEvent, "pipeline.success", "audit event is pipeline.success");
    assert(rpcTransport.broadcastCalls.length >= 1, "broadcast happened (at least 1 eth_sendRawTransaction)");
    await runtime.shutdown();
  }

  // A.2 — ALL RPC endpoints down → pipeline fails at rpc gate, signer NEVER called
  console.log("A.2 — ALL RPC endpoints down → pipeline fails at rpc gate, signer NEVER called");
  {
    const { runtime, rpcTransport, signerTransport, audit } = freshRuntime({ canaryPct: 100 });
    rpcTransport.failAllUrls = true;
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "rpc", "failed at rpc gate");
    assertEqual(signerTransport.calls.length, 0, "signer NEVER called (rpc gate stopped execution)");
    assertEqual(audit.callCount, 1, "exactly one audit entry (pipeline.failure)");
    assertEqual(audit.lastEvent, "pipeline.failure", "audit event is pipeline.failure");
    await runtime.shutdown();
  }

  // A.3 — RPC timeout (transport hangs) → pipeline fails at rpc gate within timeoutMs
  console.log("A.3 — RPC timeout (transport hangs) → pipeline fails at rpc gate within timeoutMs");
  {
    const { runtime, rpcTransport, signerTransport } = freshRuntime({ canaryPct: 100, callTimeoutMs: 200 });
    rpcTransport.hangAll = true;
    const req = buildHappyRequest();
    const start = Date.now();
    const r = await runtime.pipeline.process(req);
    const elapsed = Date.now() - start;
    assert(!r.ok, "pipeline should fail (timeout)");
    assertEqual(r.failedGate, "rpc", "failed at rpc gate");
    assertEqual(signerTransport.calls.length, 0, "signer NEVER called");
    // Should complete within ~timeoutMs (allow some slack for Promise overhead).
    assertLessThan(elapsed, 600, `elapsed < 600ms (timeout=200ms, got ${elapsed}ms)`);
    await runtime.shutdown();
  }

  // A.4 — RPC returns malformed data (non-hex nonce) → broadcaster fails with BROADCAST_NONCE_RESOLUTION_FAILED
  console.log("A.4 — RPC returns malformed nonce → BROADCAST_NONCE_RESOLUTION_FAILED");
  {
    const { runtime, rpcTransport, audit } = freshRuntime({ canaryPct: 100 });
    rpcTransport.malformedNonce = true;
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "signer", "failed at signer gate (broadcaster is the signer sink)");
    assertIncludes(r.originalReason ?? "", "BROADCAST_NONCE_RESOLUTION_FAILED", "error is BROADCAST_NONCE_RESOLUTION_FAILED");
    assertEqual(rpcTransport.broadcastCalls.length, 0, "broadcast NOT attempted (nonce resolution failed first)");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    await runtime.shutdown();
  }

  // =========================================================================
  // B. Signer failures
  // =========================================================================

  console.log("\nB. Signer failures\n");

  // B.1 — Signer transport unavailable (ECONNREFUSED) → BROADCAST_SIGN_FAILED, lease released
  console.log("B.1 — Signer transport unavailable → BROADCAST_SIGN_FAILED, lease released (REG-015)");
  {
    const { runtime, signerTransport, leaseStore, rpcTransport, audit } = freshRuntime({ canaryPct: 100 });
    signerTransport.failMode = "unavailable";
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "signer", "failed at signer gate");
    assertStartsWith(r.originalReason ?? "", "BROADCAST_SIGN_FAILED", "error starts with BROADCAST_SIGN_FAILED");
    // Lease must be released (REG-015).
    const rec = await leaseStore.current(runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease released after signer failure (REG-015)");
    // Broadcast NOT attempted (signer failed before broadcast).
    assertEqual(rpcTransport.broadcastCalls.length, 0, "broadcast NOT attempted");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    await runtime.shutdown();
  }

  // B.2 — Signer returns ok=false → broadcaster passes through error, lease released
  console.log("B.2 — Signer returns ok=false → error passed through, lease released");
  {
    const { runtime, signerTransport, leaseStore, rpcTransport, audit } = freshRuntime({ canaryPct: 100 });
    signerTransport.failMode = "reject";
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "signer", "failed at signer gate");
    // The original signer rejection ("SIGNER_REJECTED") must be preserved
    // in the error (passed through as detail under BROADCAST_SIGN_FAILED).
    assertIncludes(r.originalReason ?? "", "SIGNER_REJECTED", "error preserves signer's rejection reason");
    assertIncludes(r.originalReason ?? "", "vault locked", "error preserves signer's detail message");
    // Lease released (REG-015).
    const rec = await leaseStore.current(runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease released after signer rejection (REG-015)");
    // Broadcast NOT attempted.
    assertEqual(rpcTransport.broadcastCalls.length, 0, "broadcast NOT attempted");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    await runtime.shutdown();
  }

  // B.3 — Signer returns ok=true but no rawSignedTx → BROADCAST_SIGN_FAILED (INVALID_RESPONSE)
  console.log("B.3 — Signer returns ok=true but no rawSignedTx → BROADCAST_SIGN_FAILED (INVALID_RESPONSE)");
  {
    const { runtime, signerTransport, leaseStore, rpcTransport, audit } = freshRuntime({ canaryPct: 100 });
    signerTransport.failMode = "no-raw";
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "signer", "failed at signer gate");
    assertStartsWith(r.originalReason ?? "", "BROADCAST_SIGN_FAILED", "error starts with BROADCAST_SIGN_FAILED");
    assertIncludes(r.originalReason ?? "", "INVALID_RESPONSE", "error mentions INVALID_RESPONSE");
    // Lease released (REG-015).
    const rec = await leaseStore.current(runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease released after invalid response (REG-015)");
    // Broadcast NOT attempted.
    assertEqual(rpcTransport.broadcastCalls.length, 0, "broadcast NOT attempted");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    await runtime.shutdown();
  }

  // =========================================================================
  // C. Lease failures
  // =========================================================================

  console.log("\nC. Lease failures\n");

  // C.1 — Lease store unavailable on acquire → LEASE_ACQUIRE_FAILED, no broadcast
  console.log("C.1 — Lease store unavailable on acquire → LEASE_ACQUIRE_FAILED, no broadcast");
  {
    // Create the InMemoryLeaseStore separately so we can call injectFailure()
    // (which is an InMemoryLeaseStore-specific method, not on the LeaseStore
    // interface).
    const leaseStore = new InMemoryLeaseStore();
    leaseStore.injectFailure(); // next store operation fails
    const { runtime, rpcTransport, audit } = freshRuntime({ canaryPct: 100, leaseStore });
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "signer", "failed at signer gate (lease is in the signer path)");
    assertStartsWith(r.originalReason ?? "", "LEASE_ACQUIRE_FAILED", "error starts with LEASE_ACQUIRE_FAILED");
    assertIncludes(r.originalReason ?? "", "STORE_UNAVAILABLE", "error mentions STORE_UNAVAILABLE");
    // Broadcast NOT attempted (lease acquire failed before broadcaster).
    assertEqual(rpcTransport.broadcastCalls.length, 0, "broadcast NOT attempted");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    await runtime.shutdown();
  }

  // C.2 — Lease expires mid-broadcast (TTL too short) → verifyToken fails → LEASE_FENCING_TOKEN_STALE
  console.log("C.2 — Lease expires mid-broadcast (TTL too short) → LEASE_FENCING_TOKEN_STALE");
  {
    const realStore = new InMemoryLeaseStore();
    const ownerId = "host-chaos:1234:c2";
    const saboteur = makeSaboteurStore(realStore, ownerId, "expire-mid-broadcast");
    const { runtime, rpcTransport, audit } = freshRuntime({
      canaryPct: 100,
      leaseStore: saboteur,
      leaseTtlMs: 10_000,
    });
    // Override the lease owner so the saboteur can recognize it.
    // (The runtime generates a random owner; we need to set it to match
    // the saboteur's check. We do this by rebuilding the runtime with
    // a custom owner — but buildRuntime doesn't expose owner override
    // directly. Instead, we use the saboteur's "expire-mid-broadcast"
    // mode which triggers on ANY held lease, not just a specific owner.)
    //
    // Actually, the saboteur checks `rec.owner === ownerId`. But the
    // runtime's lease has a DIFFERENT owner (auto-generated). So the
    // saboteur won't trigger.
    //
    // Fix: make the saboteur trigger on ANY held lease (regardless of
    // owner). We rebuild the saboteur with the runtime's actual owner.
    const actualOwner = runtime.lease.getOwner();
    const saboteur2 = makeSaboteurStore(realStore, actualOwner, "expire-mid-broadcast");
    // We can't swap the store after buildRuntime. So we need a different
    // approach: build the runtime with a saboteur that triggers on any
    // held lease.

    // Restart with a properly-configured saboteur.
    await runtime.shutdown();

    // Build a saboteur that triggers on ANY held lease (no owner check).
    const saboteurAny: LeaseStore = {
      async acquire(key, owner, ttlMs) { return realStore.acquire(key, owner, ttlMs); },
      async renew(key, owner, ttlMs) { return realStore.renew(key, owner, ttlMs); },
      async release(key, owner) { return realStore.release(key, owner); },
      async current(key) {
        const rec = await realStore.current(key);
        if (rec.state === "held") {
          // Simulate TTL expiring between acquire and verifyToken.
          return { ...rec, state: "expired" as const };
        }
        return rec;
      },
      async revoke(key) { return realStore.revoke(key); },
    };

    const rt2 = freshRuntime({ canaryPct: 100, leaseStore: saboteurAny, leaseTtlMs: 10_000 });
    const req = buildHappyRequest();
    const r = await rt2.runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "signer", "failed at signer gate");
    assertStartsWith(r.originalReason ?? "", "LEASE_FENCING_TOKEN_STALE", "error starts with LEASE_FENCING_TOKEN_STALE");
    // Broadcast NOT attempted (fencing check aborted before broadcaster).
    assertEqual(rt2.rpcTransport.broadcastCalls.length, 0, "broadcast NOT attempted (fencing check aborted)");
    // Lease released (REG-015 — withLease always releases).
    const rec = await realStore.current(rt2.runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease released after fencing failure (REG-015)");
    assertEqual(rt2.audit.callCount, 1, "exactly one audit entry");
    await rt2.runtime.shutdown();
    void saboteur; void ownerId; void saboteur2; void actualOwner; // satisfy linter
  }

  // C.3 — Owner change mid-broadcast (another process takes lease) → LEASE_FENCING_TOKEN_STALE
  console.log("C.3 — Owner change mid-broadcast → LEASE_FENCING_TOKEN_STALE");
  {
    const realStore = new InMemoryLeaseStore();
    // Saboteur: on current(), return a DIFFERENT owner (simulates takeover).
    const saboteurAny: LeaseStore = {
      async acquire(key, owner, ttlMs) { return realStore.acquire(key, owner, ttlMs); },
      async renew(key, owner, ttlMs) { return realStore.renew(key, owner, ttlMs); },
      async release(key, owner) { return realStore.release(key, owner); },
      async current(key) {
        const rec = await realStore.current(key);
        if (rec.state === "held") {
          // Simulate another process taking over the lease.
          return { ...rec, owner: "host-other:9999:zzzz" as LeaseOwner, token: rec.token + 1 };
        }
        return rec;
      },
      async revoke(key) { return realStore.revoke(key); },
    };

    const { runtime, rpcTransport, audit } = freshRuntime({
      canaryPct: 100,
      leaseStore: saboteurAny,
      leaseTtlMs: 10_000,
    });
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "signer", "failed at signer gate");
    assertStartsWith(r.originalReason ?? "", "LEASE_FENCING_TOKEN_STALE", "error starts with LEASE_FENCING_TOKEN_STALE");
    assertEqual(rpcTransport.broadcastCalls.length, 0, "broadcast NOT attempted (fencing check aborted)");
    // Lease released (REG-015).
    const rec = await realStore.current(runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease released after owner-change fencing failure (REG-015)");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    await runtime.shutdown();
  }

  // C.4 — Lease renewer fails continuously → lease lost, isHeld() returns false
  console.log("C.4 — Lease renewer fails continuously → lease lost, isHeld() returns false");
  {
    const realStore = new InMemoryLeaseStore();
    const alwaysFailRenew = makeAlwaysFailRenewStore(realStore);
    const { runtime, lease } = freshRuntime({
      canaryPct: 100,
      leaseStore: alwaysFailRenew,
      leaseTtlMs: 100,       // short TTL so the test runs fast
    });

    // Manually acquire the lease and start the renewer (simulating a
    // long-held lease that needs renewal).
    const acq = await lease.acquire();
    assert(acq.ok, "lease acquired");
    assertEqual(lease.isHeld(), true, "lease is held after acquire");
    lease.startRenewer();

    // Wait for the renewer to fire and fail. The renewer interval is
    // ttlMs/3 ≈ 33ms. Wait ~150ms for at least one renew attempt.
    await sleep(150);

    // After a renew failure, the lease's local state is cleared and
    // the renewer stops.
    assertEqual(lease.isHeld(), false, "lease lost after renewer failure (isHeld=false)");

    await runtime.shutdown();
  }

  // =========================================================================
  // D. Broadcast failures
  // =========================================================================

  console.log("\nD. Broadcast failures\n");

  // D.1 — RPC returns different hash (REG-014 violation) → BROADCAST_IMMUTABILITY_VIOLATION
  console.log("D.1 — RPC returns different hash → BROADCAST_IMMUTABILITY_VIOLATION (REG-014)");
  {
    const { runtime, rpcTransport, audit, leaseStore } = freshRuntime({ canaryPct: 100 });
    rpcTransport.returnWrongHash = true;
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "signer", "failed at signer gate");
    assertStartsWith(r.originalReason ?? "", "BROADCAST_IMMUTABILITY_VIOLATION", "error starts with BROADCAST_IMMUTABILITY_VIOLATION");
    // Broadcast WAS attempted (the hash mismatch is detected AFTER broadcast).
    assertEqual(rpcTransport.broadcastCalls.length, 1, "broadcast was attempted (1 eth_sendRawTransaction call)");
    // Lease released (REG-015).
    const rec = await leaseStore.current(runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease released after immutability violation (REG-015)");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    await runtime.shutdown();
  }

  // D.2 — Broadcast partially fails (one endpoint accepts, response lost) → fail closed
  console.log("D.2 — Broadcast partially fails (alpha hangs, beta throws) → fail closed");
  {
    // Strategy: alpha hangs on eth_sendRawTransaction (response lost),
    // beta throws on eth_sendRawTransaction. The broadcaster tries alpha
    // first (priority 100), times out, then tries beta, which throws.
    // Result: all endpoints failed → BROADCAST_FAILED.
    //
    // For non-broadcast methods (eth_blockNumber, eth_getTransactionCount,
    // etc.), both endpoints work normally so the pipeline reaches the
    // broadcaster.
    const { runtime, rpcTransport, audit, leaseStore } = freshRuntime({
      canaryPct: 100,
      callTimeoutMs: 150, // short timeout so the hang doesn't take long
    });

    // Custom transport: hang on eth_sendRawTransaction for alpha, throw
    // for beta. Other methods work normally.
    const customTransport: Transport = async (url, method, params) => {
      rpcTransport.calls.push({ url, method, params });
      if (method === "eth_sendRawTransaction") {
        if (url === "https://alpha.example") {
          // Alpha "accepts" but response is lost (hangs forever).
          return new Promise<unknown>(() => { /* hangs */ });
        }
        // Beta throws.
        throw new Error("beta: eth_sendRawTransaction rejected");
      }
      // Other methods: delegate to the standard mock.
      switch (method) {
        case "eth_getTransactionCount": return "0x0";
        case "eth_estimateGas": return "0x5208";
        case "eth_feeHistory": return { baseFeePerGas: ["0x2540be400"], reward: [["0x9502f900"]], gasUsedRatio: [0.5], oldestBlock: "0x1" };
        case "eth_gasPrice": return "0x2540be400";
        case "eth_blockNumber": return "0x64";
        default: throw new Error(`unexpected method: ${method}`);
      }
    };

    // Rebuild the runtime with the custom transport.
    await runtime.shutdown();
    const metrics = new InMemoryMetricsRecorder();
    const registry = metrics.getRegistry();
    const audit2 = new CountingAuditSink();
    const leaseStore2 = new InMemoryLeaseStore();
    const chain = new HappyChainReader();
    const liquidity = new HappyLiquiditySource();
    const authority = new HappyAuthoritySource();
    const tradeSim = new HappyTradeSimulator();
    const simulator = happySimulator;
    const ledger = new InMemoryApprovalLedger();
    const simulation = new SimulationGate({ simulator });
    const contract = new ContractVerifier({ chain });
    const liquidityVerifier = new LiquidityVerifier(liquidity);
    const authorityVerifier = new TokenAuthorityVerifier(authority);
    const sellSim = new SellSimVerifier(tradeSim);
    const approvalPolicy: ApprovalPolicy = {
      maxApprovalPerSpender: "1000000000000000000000",
      allowFullBalanceApproval: false, autoRevokeAfterUse: false,
    };
    const approval = new ApprovalGate(ledger, approvalPolicy);
    const endpoints: RpcEndpoint[] = [
      { id: "alpha", url: "https://alpha.example", priority: 100 },
      { id: "beta", url: "https://beta.example", priority: 90 },
    ];
    const runtime2 = buildRuntime({
      rpc: { endpoints, transport: customTransport, callTimeoutMs: 150 },
      signer: { transport: new MockSignerTransport() },
      lease: { store: leaseStore2, ttlMs: 10_000 },
      canary: { pct: 100 },
      registry,
      signingAddress: BUYER,
      gates: { simulation, contract, liquidity: liquidityVerifier, authority: authorityVerifier, sellSim, approval, audit: audit2 },
      fixedGasLimit: BigInt(21000),
      fixedMaxPriorityFeePerGas: BigInt(2500000000),
    });

    const req = buildHappyRequest();
    const start = Date.now();
    const r = await runtime2.pipeline.process(req);
    const elapsed = Date.now() - start;
    assert(!r.ok, "pipeline should fail (partial broadcast failure)");
    assertEqual(r.failedGate, "signer", "failed at signer gate (broadcaster)");
    assertIncludes(r.originalReason ?? "", "BROADCAST_FAILED", "error is BROADCAST_FAILED");
    // Should complete within ~timeoutMs (alpha hung, timed out at 150ms).
    assertLessThan(elapsed, 500, `elapsed < 500ms (alpha timeout=150ms, got ${elapsed}ms)`);
    // Lease released (REG-015).
    const rec = await leaseStore2.current(runtime2.lease.getKey());
    assertEqual(rec.state, "free", "lease released after broadcast failure (REG-015)");
    assertEqual(audit2.callCount, 1, "exactly one audit entry");
    await runtime2.shutdown();
    void rpcTransport; void audit; void leaseStore; // satisfy linter for the abandoned first runtime
  }

  // D.3 — Raw tx altered after signature → REG-014 pre-broadcast check catches it
  console.log("D.3 — Raw tx altered after signature (signer reports wrong hash) → REG-014 pre-broadcast check");
  {
    const { runtime, signerTransport, rpcTransport, audit, leaseStore } = freshRuntime({ canaryPct: 100 });
    signerTransport.failMode = "wrong-hash";
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "signer", "failed at signer gate");
    assertStartsWith(r.originalReason ?? "", "BROADCAST_IMMUTABILITY_VIOLATION", "error starts with BROADCAST_IMMUTABILITY_VIOLATION");
    assertIncludes(r.originalReason ?? "", "signer-reported hash", "error mentions signer-reported hash mismatch");
    // Broadcast NOT attempted (pre-broadcast check caught the mismatch).
    assertEqual(rpcTransport.broadcastCalls.length, 0, "broadcast NOT attempted (pre-broadcast check aborted)");
    // Lease released (REG-015).
    const rec = await leaseStore.current(runtime.lease.getKey());
    assertEqual(rec.state, "free", "lease released after pre-broadcast check failure (REG-015)");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    await runtime.shutdown();
  }

  // =========================================================================
  // E. Combined/compound failures
  // =========================================================================

  console.log("\nE. Combined/compound failures\n");

  // E.1 — RPC down + signer down simultaneously → pipeline fails at rpc gate (first failure wins)
  console.log("E.1 — RPC down + signer down → pipeline fails at rpc gate (first failure wins)");
  {
    const { runtime, rpcTransport, signerTransport, audit } = freshRuntime({ canaryPct: 100 });
    rpcTransport.failAllUrls = true;    // RPC down
    signerTransport.failMode = "unavailable"; // Signer down
    const req = buildHappyRequest();
    const r = await runtime.pipeline.process(req);
    assert(!r.ok, "pipeline should fail");
    assertEqual(r.failedGate, "rpc", "failed at rpc gate (first failure wins)");
    // Signer NEVER called (rpc gate stopped execution).
    assertEqual(signerTransport.calls.length, 0, "signer NEVER called (rpc gate failed first)");
    assertEqual(audit.callCount, 1, "exactly one audit entry");
    await runtime.shutdown();
  }

  // E.2 — Lease busy + retry → second attempt succeeds (simulating engine retry)
  console.log("E.2 — Lease busy + retry → second attempt succeeds");
  {
    const { runtime, leaseStore } = freshRuntime({ canaryPct: 100 });

    // Pre-acquire the lease with a DIFFERENT owner (simulating another
    // process holding it). The first pipeline.process() should fail
    // with LEASE_ACQUIRE_FAILED.
    const otherOwner: LeaseOwner = "host-other:5555:e2";
    const otherLease = new WriterLease({
      store: leaseStore,
      key: runtime.lease.getKey(),
      owner: otherOwner,
      ttlMs: 10_000,
    });
    await otherLease.acquire();

    const req = buildHappyRequest();
    const r1 = await runtime.pipeline.process(req);
    assert(!r1.ok, "first attempt should fail (lease busy)");
    assertEqual(r1.failedGate, "signer", "failed at signer gate");
    assertStartsWith(r1.originalReason ?? "", "LEASE_ACQUIRE_FAILED", "error starts with LEASE_ACQUIRE_FAILED");

    // Release the other owner's lease (simulating it finishing).
    await otherLease.release();

    // Retry — should succeed now.
    const r2 = await runtime.pipeline.process(req);
    assert(r2.ok, "second attempt should succeed (lease now free)");
    assertEqual(r2.failedGate, null, "no failed gate on success");

    await runtime.shutdown();
  }

  // E.3 — High latency (all ops slow) → no timeout if within limit, timeout if exceeded
  console.log("E.3 — High latency → no timeout if within limit, timeout if exceeded");
  {
    // Sub-test 1: delay 50ms, timeout 200ms → succeeds
    const { runtime: rt1, rpcTransport: rpc1, audit: audit1 } = freshRuntime({
      canaryPct: 100,
      callTimeoutMs: 200,
    });
    rpc1.delayMs = 50;
    const req = buildHappyRequest();
    const r1 = await rt1.pipeline.process(req);
    assert(r1.ok, "pipeline should succeed (50ms delay < 200ms timeout)");
    assertEqual(audit1.lastEvent, "pipeline.success", "audit event is pipeline.success");
    await rt1.shutdown();

    // Sub-test 2: delay 300ms, timeout 200ms → fails at rpc gate
    const { runtime: rt2, rpcTransport: rpc2, signerTransport: sig2, audit: audit2 } = freshRuntime({
      canaryPct: 100,
      callTimeoutMs: 200,
    });
    rpc2.delayMs = 300;
    const r2 = await rt2.pipeline.process(req);
    assert(!r2.ok, "pipeline should fail (300ms delay > 200ms timeout)");
    assertEqual(r2.failedGate, "rpc", "failed at rpc gate (timeout)");
    assertEqual(sig2.calls.length, 0, "signer NEVER called (rpc gate timed out)");
    assertEqual(audit2.callCount, 1, "exactly one audit entry");
    await rt2.shutdown();
  }

  // =========================================================================
  // F. Invariants under chaos
  // =========================================================================

  console.log("\nF. Invariants under chaos\n");

  // F.1 — No duplicate broadcasts: even with retries, each SignerRequest broadcasts at most once
  console.log("F.1 — No duplicate broadcasts: each pipeline.process() → at most 1 eth_sendRawTransaction");
  {
    const { runtime, rpcTransport, audit } = freshRuntime({ canaryPct: 100 });
    const req = buildHappyRequest();

    // Run 10 successful ops.
    for (let i = 0; i < 10; i++) {
      await runtime.pipeline.process(req);
    }
    // Each op should broadcast exactly once.
    assertEqual(rpcTransport.broadcastCalls.length, 10, "10 ops → 10 broadcasts (no duplicates)");
    assertEqual(audit.callCount, 10, "10 audit entries");

    // Now simulate failures (signer rejects) + retries. Each retry
    // should broadcast at most 0 times (signer fails before broadcast).
    rpcTransport.reset();
    const { runtime: rt2, rpcTransport: rpc2, signerTransport: sig2 } = freshRuntime({ canaryPct: 100 });
    sig2.failMode = "reject";
    for (let i = 0; i < 5; i++) {
      await rt2.pipeline.process(req); // all fail at signer
    }
    assertEqual(rpc2.broadcastCalls.length, 0, "5 failed ops (signer reject) → 0 broadcasts");
    await runtime.shutdown();
    await rt2.shutdown();
  }

  // F.2 — No lost transactions: every pipeline.process() call produces exactly one audit entry
  console.log("F.2 — No lost transactions: every pipeline.process() → exactly 1 audit entry");
  {
    const { runtime, rpcTransport, signerTransport, audit } = freshRuntime({ canaryPct: 100 });
    const req = buildHappyRequest();

    // Mix of success + failure:
    //   op 0: success
    //   op 1: signer fails (reject)
    //   op 2: success
    //   op 3: RPC fails (malformed nonce)
    //   op 4: success
    //   op 5: signer fails (unavailable)
    //   op 6: success

    // op 0: success
    await runtime.pipeline.process(req);

    // op 1: signer rejects
    signerTransport.failMode = "reject";
    await runtime.pipeline.process(req);
    signerTransport.failMode = "ok";

    // op 2: success
    await runtime.pipeline.process(req);

    // op 3: RPC malformed nonce
    rpcTransport.malformedNonce = true;
    await runtime.pipeline.process(req);
    rpcTransport.malformedNonce = false;

    // op 4: success
    await runtime.pipeline.process(req);

    // op 5: signer unavailable
    signerTransport.failMode = "unavailable";
    await runtime.pipeline.process(req);
    signerTransport.failMode = "ok";

    // op 6: success
    await runtime.pipeline.process(req);

    // 7 ops → 7 audit entries (no lost transactions).
    assertEqual(audit.callCount, 7, "7 ops → 7 audit entries (no lost transactions)");

    await runtime.shutdown();
  }

  // F.3 — Fencing token never decreases: even across failures + owner changes
  console.log("F.3 — Fencing token never decreases across failures + owner changes");
  {
    const { runtime, leaseStore, signerTransport, rpcTransport } = freshRuntime({ canaryPct: 100 });
    const req = buildHappyRequest();
    const tokens: number[] = [];

    // Run a mix of successful + failed ops. After each op, record the
    // current fencing token from the lease store.
    //
    // The token only increases on acquire. If an op fails before acquire
    // (e.g., lease busy), the token doesn't change. If an op fails after
    // acquire (e.g., signer fails), the token was already incremented.
    // Either way, the token sequence must be non-decreasing.

    // op 0: success → token increments
    await runtime.pipeline.process(req);
    tokens.push((await leaseStore.current(runtime.lease.getKey())).token);

    // op 1: signer fails → token increments (acquire happened before sign)
    signerTransport.failMode = "reject";
    await runtime.pipeline.process(req);
    tokens.push((await leaseStore.current(runtime.lease.getKey())).token);
    signerTransport.failMode = "ok";

    // op 2: success → token increments
    await runtime.pipeline.process(req);
    tokens.push((await leaseStore.current(runtime.lease.getKey())).token);

    // op 3: RPC malformed nonce → token increments (acquire happened before nonce resolution)
    rpcTransport.malformedNonce = true;
    await runtime.pipeline.process(req);
    tokens.push((await leaseStore.current(runtime.lease.getKey())).token);
    rpcTransport.malformedNonce = false;

    // op 4: success → token increments
    await runtime.pipeline.process(req);
    tokens.push((await leaseStore.current(runtime.lease.getKey())).token);

    // op 5: signer unavailable → token increments (acquire happened before health_check)
    signerTransport.failMode = "unavailable";
    await runtime.pipeline.process(req);
    tokens.push((await leaseStore.current(runtime.lease.getKey())).token);
    signerTransport.failMode = "ok";

    // op 6: success → token increments
    await runtime.pipeline.process(req);
    tokens.push((await leaseStore.current(runtime.lease.getKey())).token);

    // Verify non-decreasing (REG-017 — fencing token never decreases).
    let nonDecreasing = true;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i]! < tokens[i - 1]!) {
        nonDecreasing = false;
        break;
      }
    }
    assert(nonDecreasing, `fencing token never decreases: got ${JSON.stringify(tokens)}`);

    // Also verify the token strictly increased at least once (sanity).
    assert(tokens[tokens.length - 1]! > tokens[0]!, "token increased from first to last op");

    await runtime.shutdown();
  }

  // =========================================================================
  // Summary
  // =========================================================================

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
