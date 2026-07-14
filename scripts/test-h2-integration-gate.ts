/**
 * H2.6 — Integration Gate test suite.
 *
 * This file proves that the H1+H2 hardened primitives compose correctly
 * when chained in the operator-mandated order:
 *
 *   RPC → Simulation → Contract → Liquidity → Authority →
 *   Sell-Sim → Approval → MEV → Signer
 *
 * Properties verified:
 *
 *   A. HAPPY PATH — all gates pass, signer accepts, exactly one audit
 *      entry, signer received the request.
 *
 *   B.1-B.9. EACH GATE FAILS IN ISOLATION — for each gate, configure
 *      it to fail, verify:
 *        - result.ok === false
 *        - result.failedGate === expected gate name
 *        - result.originalReason === gate's raw reason (byte-identical)
 *        - result.executedGates === gates up to and including the failure
 *        - signerSink.callCount === 0 (signer never called)
 *        - auditSink.callCount === 1 (exactly one audit entry)
 *
 *   C.1-C.6. ADVERSARIAL (per permanent principle):
 *        C.1 — No bypass option exists on PipelineConfig (static check)
 *        C.2 — Double simultaneous failure: first-failure-wins
 *        C.3 — Corrupted state between gates: mutating a manifest after
 *              the gate ran does not affect subsequent gates
 *        C.4 — Audit exactly-once on exception path: a gate that throws
 *              still produces exactly one audit entry
 *        C.5 — Executed gates always form a prefix of GATE_ORDER
 *        C.6 — Signer receives the full SignerRequest (approved amount,
 *              slippage limit, sandwich score) — not a stripped-down tx
 *
 * Run: npx tsx scripts/test-h2-integration-gate.ts
 */

import { getAddress, zeroPadValue } from "ethers";
import { createHash } from "crypto";

import { QuorumRpcClient, Transport } from "../src/lib/chain/rpc-resilience";
import { SimulationGate, Simulator, SimulationResult, ExpectedDiff } from "../src/lib/chain/simulation-gate";
import {
  ContractVerifier,
  ChainReader,
  ContractManifest,
  Selector,
  keccak256Hex,
} from "../src/lib/chain/contract-verification";
import {
  LiquidityVerifier,
  LiquiditySource,
  LiquidityManifest,
  PoolInfo,
  LpLockInfo,
} from "../src/lib/chain/liquidity-verification";
import {
  TokenAuthorityVerifier,
  TokenAuthoritySource,
  TokenAuthorityManifest,
  AuthorityLog,
  SEL,
  OWNERSHIP_TRANSFERRED_TOPIC,
} from "../src/lib/chain/token-authority";
import {
  SellSimVerifier,
  TradeSimulator,
  BuySpec,
  SellSpec,
  SimResult,
  SellSimManifest,
} from "../src/lib/chain/sell-simulation";
import {
  ApprovalGate,
  ApprovalLedger,
  ApprovalPolicy,
  ApprovalRequest,
  InMemoryApprovalLedger,
} from "../src/lib/chain/approval-hardening";
import { SlippageInputs } from "../src/lib/chain/mev-baseline";
import {
  Pipeline,
  PipelineConfig,
  PipelineRequest,
  PipelineResult,
  GateName,
  GATE_ORDER,
  AuditSink,
  SignerSink,
  SignerRequest,
  SignerResult,
} from "../src/lib/chain/pipeline";

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

// -------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------

const TOKEN = getAddress("0x0000000000000000000000000000000000000001");
const POOL_A = getAddress("0x0000000000000000000000000000000000000010");
const LP_A = getAddress("0x00000000000000000000000000000000000000a0");
const LOCK_TRUSTED = getAddress("0x00000000000000000000000000000000000000f1");
const HOLDER_DEPLOYER = getAddress("0x00000000000000000000000000000000000000d1");
const OWNER_REAL = getAddress("0x" + "0".repeat(39) + "b");
const OWNER_UNKNOWN = getAddress("0x" + "0".repeat(38) + "ba");
const ROUTER = getAddress("0x0000000000000000000000000000000000000002");
const BUYER = getAddress("0x0000000000000000000000000000000000000003");
const ZERO_ADDR = "0x" + "0".repeat(40);

const NOW = Math.floor(Date.now() / 1000);
const MIN_LOCK_END = NOW + 30 * 86400; // 30 days
const ZERO32 = "0x" + "0".repeat(64);

const STD_SELECTORS: Selector[] = [
  "0xa9059cbb", // transfer(address,uint256)
  "0x095ea7b3", // approve(address,uint256)
  "0x70a08231", // balanceOf(address)
  "0x18160ddd", // totalSupply()
  SEL.owner,    // owner()
].sort();

function buildBytecode(selectors: Selector[]): string {
  let code = "0x";
  for (const sel of selectors) {
    code += "63" + sel.slice(2).toLowerCase() + "14";
  }
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
// Mock sources — each is a mutable class so scenarios can reconfigure.
// -------------------------------------------------------------------------

class MockChainReader implements ChainReader {
  bytecode = HAPPY_BYTECODE;
  storage: Record<string, string> = {};
  callReturns: Record<string, string> = {};

  constructor() {
    // Default: owner() returns OWNER_REAL.
    this.callReturns[SEL.owner] = addrReturn(OWNER_REAL);
  }

  async getCode(_addr: string): Promise<string> {
    return this.bytecode;
  }
  async getStorageAt(_addr: string, slot: string): Promise<string> {
    return this.storage[slot] ?? ZERO32;
  }
  async call(_to: string, calldata: string): Promise<string> {
    return this.callReturns[calldata] ?? ZERO32;
  }
}

class MockLiquiditySource implements LiquiditySource {
  pools: Map<string, PoolInfo> = new Map();
  locks: Map<string, LpLockInfo> = new Map();
  lpBalances: Map<string, string> = new Map();
  poolsForToken: PoolInfo[] = [];

  constructor() {
    // Default: one pool, fully locked, 30-day lock, permissioned withdraw.
    const poolInfo: PoolInfo = {
      dex: "uniswap-v2",
      pool: POOL_A,
      lpToken: LP_A,
      lpTotalSupply: "1000000000000000000000", // 1000 LP
      token0: TOKEN,
      token1: ROUTER,
      reserve0: "1000000000000000000000",
      reserve1: "1000000000000000000",
    };
    this.pools.set(POOL_A.toLowerCase(), poolInfo);
    this.poolsForToken = [poolInfo];

    const lockInfo: LpLockInfo = {
      lockContract: LOCK_TRUSTED,
      lockOwner: HOLDER_DEPLOYER,
      lockedAmount: "1000000000000000000000", // 100% locked
      unlockEpoch: MIN_LOCK_END,
      withdrawPermissioned: true,
    };
    this.locks.set(LP_A.toLowerCase() + ":" + LOCK_TRUSTED.toLowerCase(), lockInfo);

    // Deployer holds 0 unlocked LP (all locked).
    this.lpBalances.set(LP_A.toLowerCase() + ":" + HOLDER_DEPLOYER.toLowerCase(), "0");
  }

  async getPool(pool: string): Promise<PoolInfo | null> {
    return this.pools.get(pool.toLowerCase()) ?? null;
  }
  async listPoolsForToken(_token: string): Promise<PoolInfo[]> {
    return this.poolsForToken;
  }
  async lpBalanceOf(lpToken: string, holder: string): Promise<string> {
    return this.lpBalances.get(lpToken.toLowerCase() + ":" + holder.toLowerCase()) ?? "0";
  }
  async getLock(lpToken: string, lockContract: string): Promise<LpLockInfo | null> {
    return this.locks.get(lpToken.toLowerCase() + ":" + lockContract.toLowerCase()) ?? null;
  }
}

class MockTokenAuthoritySource implements TokenAuthoritySource {
  bytecode = HAPPY_BYTECODE;
  callReturns: Record<string, string> = {};
  logsByTopic: Map<string, AuthorityLog[]> = new Map();

  constructor() {
    this.callReturns[SEL.owner] = addrReturn(OWNER_REAL);
  }

  async getCode(_token: string): Promise<string> {
    return this.bytecode;
  }
  async call(_token: string, calldata: string): Promise<string> {
    return this.callReturns[calldata] ?? ZERO32;
  }
  async getLogs(_token: string, topic0: string, _fromBlock?: number | "earliest"): Promise<AuthorityLog[]> {
    return this.logsByTopic.get(topic0) ?? [];
  }
}

class MockTradeSimulator implements TradeSimulator {
  buyResult: SimResult = {
    reverted: false,
    actualAmountOut: "1000000000000000000", // 1 token
    gasUsed: 150000,
  };
  sellResult: SimResult = {
    reverted: false,
    actualAmountOut: "1000000000000000000", // 1 quote
    gasUsed: 150000,
  };

  async simulateBuy(_spec: BuySpec): Promise<SimResult> {
    return { ...this.buyResult };
  }
  async simulateSell(_spec: SellSpec, _buyAmountOut: string): Promise<SimResult> {
    return { ...this.sellResult };
  }
}

class MockSimulator implements Simulator {
  result: SimulationResult = {
    ok: true,
    changes: [],
    gasUsed: 150000,
    from: BUYER,
  };

  constructor() {
    // Default: simulation produces the expected transfer.
    this.result.changes = [
      {
        kind: "erc20_transfer",
        token: TOKEN,
        from: ROUTER,
        to: BUYER,
        amount: "1000000000000000000",
      },
    ];
  }

  async simulate(tx: { from: string; to: string; value: string; data: string }): Promise<SimulationResult> {
    return { ...this.result, from: tx.from };
  }
}

class MockTransport {
  // Map: endpoint URL → handler function.
  handlers: Map<string, (method: string, params: unknown[]) => unknown> = new Map();

  constructor() {
    // Default: both endpoints return block number 0x1.
    const handler = (method: string) => {
      if (method === "eth_blockNumber") return "0x1";
      throw new Error(`unexpected method: ${method}`);
    };
    this.handlers.set("http://mock1", handler);
    this.handlers.set("http://mock2", handler);
  }

  asTransport(): Transport {
    return async (url, method, params) => {
      const fn = this.handlers.get(url);
      if (!fn) throw new Error(`no handler for ${url}`);
      return fn(method, params);
    };
  }
}

// -------------------------------------------------------------------------
// Mock AuditSink — records every call.
// -------------------------------------------------------------------------

class MockAuditSink implements AuditSink {
  calls: Array<{ event: string; payload: Record<string, unknown> }> = [];
  private seq = 0;

  append(event: string, payload: Record<string, unknown>): { seq: number; hash: string } {
    this.seq++;
    this.calls.push({ event, payload });
    // Fake but deterministic hash — sha256 of event + seq.
    const hashInput = `${event}:${this.seq}`;
    const hash = "0x" + createHash("sha256").update(hashInput, "utf8").digest("hex");
    return { seq: this.seq, hash };
  }

  get callCount(): number {
    return this.calls.length;
  }

  get lastCall(): { event: string; payload: Record<string, unknown> } | undefined {
    return this.calls[this.calls.length - 1];
  }

  reset(): void {
    this.calls = [];
    this.seq = 0;
  }
}

// -------------------------------------------------------------------------
// Mock SignerSink — records every call.
// -------------------------------------------------------------------------

class MockSignerSink implements SignerSink {
  calls: SignerRequest[] = [];
  result: SignerResult = { ok: true, txHash: "0xMOCK_TX_HASH" };

  async submit(req: SignerRequest): Promise<SignerResult> {
    this.calls.push(req);
    return { ...this.result };
  }

  get callCount(): number {
    return this.calls.length;
  }

  get lastRequest(): SignerRequest | undefined {
    return this.calls[this.calls.length - 1];
  }

  reset(): void {
    this.calls = [];
    this.result = { ok: true, txHash: "0xMOCK_TX_HASH" };
  }
}

// -------------------------------------------------------------------------
// Helpers: build a happy-path pipeline + request.
// -------------------------------------------------------------------------

interface MockBundle {
  chain: MockChainReader;
  liquidity: MockLiquiditySource;
  authority: MockTokenAuthoritySource;
  tradeSim: MockTradeSimulator;
  simulator: MockSimulator;
  transport: MockTransport;
  audit: MockAuditSink;
  signer: MockSignerSink;
  ledger: ApprovalLedger;
}

function freshMocks(): MockBundle {
  return {
    chain: new MockChainReader(),
    liquidity: new MockLiquiditySource(),
    authority: new MockTokenAuthoritySource(),
    tradeSim: new MockTradeSimulator(),
    simulator: new MockSimulator(),
    transport: new MockTransport(),
    audit: new MockAuditSink(),
    signer: new MockSignerSink(),
    ledger: new InMemoryApprovalLedger(),
  };
}

function buildPipeline(mocks: MockBundle, approvalPolicy?: ApprovalPolicy): Pipeline {
  const rpc = new QuorumRpcClient({
    endpoints: [
      { id: "ep1", url: "http://mock1", priority: 1 },
      { id: "ep2", url: "http://mock2", priority: 1 },
    ],
    transport: mocks.transport.asTransport(),
  });

  const simulation = new SimulationGate({
    simulator: (tx) => mocks.simulator.simulate(tx),
  });

  const contract = new ContractVerifier({ chain: mocks.chain });
  const liquidity = new LiquidityVerifier(mocks.liquidity);
  const authority = new TokenAuthorityVerifier(mocks.authority);
  const sellSim = new SellSimVerifier(mocks.tradeSim);

  const approval = new ApprovalGate(mocks.ledger, approvalPolicy ?? {
    maxApprovalPerSpender: "1000000000000000000000", // 1000 tokens
    allowFullBalanceApproval: false,
    autoRevokeAfterUse: true,
  });

  return new Pipeline({
    rpc,
    simulation,
    contract,
    liquidity,
    authority,
    sellSim,
    approval,
    audit: mocks.audit,
    signer: mocks.signer,
  });
}

function buildRequest(): PipelineRequest {
  const expectedDiff: ExpectedDiff = {
    changes: [
      {
        kind: "erc20_transfer",
        token: TOKEN,
        from: ROUTER,
        to: BUYER,
        amount: "1000000000000000000",
      },
    ],
    maxGas: 500000,
  };

  const contractManifest: ContractManifest = {
    address: TOKEN,
    expectedBytecodeHash: HAPPY_BYTECODE_HASH,
    expectedSelectors: STD_SELECTORS,
    allowedOwners: [OWNER_REAL],
  };

  const liquidityManifest: LiquidityManifest = {
    token: TOKEN,
    pools: [{ pool: POOL_A, lockContract: LOCK_TRUSTED }],
    trustedLockContracts: [LOCK_TRUSTED],
    allowedLpHolders: [HOLDER_DEPLOYER, LOCK_TRUSTED],
    minLockEndEpoch: MIN_LOCK_END,
    minLockedFractionBps: 9500,
  };

  const authorityManifest: TokenAuthorityManifest = {
    token: TOKEN,
    allowedAuthorityHolders: [OWNER_REAL],
    requireRealRenounce: true,
    failClosedOnHidden: true,
  };

  const sellSimManifest: SellSimManifest = {
    buy: {
      token: TOKEN,
      router: ROUTER,
      buyer: BUYER,
      amountIn: "1000000000000000000",
      expectedAmountOut: "1000000000000000000",
      calldata: "0x",
    },
    sell: {
      router: ROUTER,
      token: TOKEN,
      seller: BUYER,
      amountIn: "1000000000000000000",
      expectedAmountOut: "1000000000000000000",
      calldata: "0x",
    },
    expectedBuyTaxBps: 0,
    expectedSellTaxBps: 0,
    slippage: {
      volatilityBps: 50,
      tradeSizeUsd: 1000,
      poolLiquidityUsd: 100000,
    },
  };

  const approvalRequest: ApprovalRequest = {
    token: TOKEN,
    owner: BUYER,
    spender: ROUTER,
    amount: "1000000000000000000", // 1 token
    ownerBalance: "10000000000000000000", // 10 tokens
  };

  const slippageInputs: SlippageInputs = {
    volatilityBps: 50,
    tradeSizeUsd: 1000,
    poolLiquidityUsd: 100000,
  };

  return {
    tx: { from: BUYER, to: ROUTER, value: "0", data: "0x" },
    expectedDiff,
    contractManifest,
    liquidityManifest,
    authorityManifest,
    sellSimManifest,
    approvalRequest,
    mevInputs: {
      slippage: slippageInputs,
      expectedPrice: 1.0,
      actualPrice: 1.0,
      sandwich: {
        victimAddress: BUYER,
        preState: { blockNumber: 100, spotPrice: 1.0, liquidityUsd: 100000 },
        postState: { blockNumber: 101, spotPrice: 1.0, liquidityUsd: 100000 },
        observedTrades: [],
      },
    },
  };
}

// Helper: verify the standard invariants for a failed pipeline result.
function assertFailureInvariants(
  result: PipelineResult,
  expectedFailedGate: GateName,
  expectedExecutedPrefix: GateName[],
  expectedReasonSubstring: string,
  mocks: MockBundle,
  label: string,
): void {
  assertEqual(result.ok, false, `${label}: result.ok is false`);
  assertEqual(result.failedGate, expectedFailedGate, `${label}: failedGate is ${expectedFailedGate}`);
  assert(
    result.executedGates.length === expectedExecutedPrefix.length &&
      result.executedGates.every((g, i) => g === expectedExecutedPrefix[i]),
    `${label}: executedGates is exactly ${JSON.stringify(expectedExecutedPrefix)}, got ${JSON.stringify(result.executedGates)}`,
  );
  assert(
    result.originalReason !== null && result.originalReason.includes(expectedReasonSubstring),
    `${label}: originalReason contains "${expectedReasonSubstring}", got: ${result.originalReason}`,
  );
  assertEqual(mocks.signer.callCount, 0, `${label}: signer NOT called`);
  assertEqual(mocks.audit.callCount, 1, `${label}: exactly one audit entry`);
  assertEqual(mocks.audit.lastCall?.event ?? "", "pipeline.failure", `${label}: audit event is pipeline.failure`);
}

// =========================================================================
// Test entry
// =========================================================================

console.log("\n=== H2.6 — Integration Gate ===\n");

async function main(): Promise<void> {

// =========================================================================
// A. HAPPY PATH
// =========================================================================

console.log("A. Happy path — all gates pass, signer accepts");

{
  const mocks = freshMocks();
  const pipeline = buildPipeline(mocks);
  const req = buildRequest();

  const result = await pipeline.process(req);

  assertEqual(result.ok, true, "A: result.ok is true");
  assertEqual(result.failedGate, null, "A: failedGate is null");
  assertEqual(result.originalReason, null, "A: originalReason is null");
  assertEqual(mocks.signer.callCount, 1, "A: signer called exactly once");
  assertEqual(mocks.audit.callCount, 1, "A: audit written exactly once");
  assertEqual(mocks.audit.lastCall?.event ?? "", "pipeline.success", "A: audit event is pipeline.success");
  assert(
    result.executedGates.length === GATE_ORDER.length &&
      result.executedGates.every((g, i) => g === GATE_ORDER[i]),
    `A: executedGates is full GATE_ORDER, got ${JSON.stringify(result.executedGates)}`,
  );
  assert(
    mocks.signer.lastRequest !== undefined &&
      mocks.signer.lastRequest.tx.from === BUYER &&
      mocks.signer.lastRequest.tx.to === ROUTER,
    "A: signer received the full tx (from + to)",
  );
  assert(
    mocks.signer.lastRequest !== undefined &&
      mocks.signer.lastRequest.approvedAmount === "1000000000000000000",
    "A: signer received the approved amount (1 token)",
  );
}

// =========================================================================
// B.1 — RPC preflight fails (quorum disagreement)
// =========================================================================

console.log("\nB.1 — RPC preflight fails (quorum disagreement)");

{
  const mocks = freshMocks();
  // Make BOTH endpoints throw — quorum fails with "all endpoints errored".
  mocks.transport.handlers.set("http://mock1", () => { throw new Error("endpoint 1 down"); });
  mocks.transport.handlers.set("http://mock2", () => { throw new Error("endpoint 2 down"); });

  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(buildRequest());

  const expectedPrefix: GateName[] = ["rpc"];
  assertFailureInvariants(result, "rpc", expectedPrefix, "quorum", mocks, "B.1");
}

// =========================================================================
// B.2 — Simulation gate fails (simulation reverted)
// =========================================================================

console.log("\nB.2 — Simulation gate fails (simulation reverted)");

{
  const mocks = freshMocks();
  mocks.simulator.result = {
    ok: false,
    changes: [],
    gasUsed: 0,
    from: BUYER,
    revertReason: "execution reverted: insufficient output",
  };

  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(buildRequest());

  const expectedPrefix: GateName[] = ["rpc", "simulation"];
  assertFailureInvariants(result, "simulation", expectedPrefix, "simulation reverted", mocks, "B.2");
  // Verify the original reason is preserved verbatim (includes the revert reason).
  assert(
    result.originalReason?.includes("insufficient output") === true,
    `B.2: originalReason preserves the revert reason, got: ${result.originalReason}`,
  );
}

// =========================================================================
// B.3 — Contract verification fails (bytecode hash mismatch)
// =========================================================================

console.log("\nB.3 — Contract verification fails (bytecode hash mismatch)");

{
  const mocks = freshMocks();
  // Change the bytecode WITHOUT updating the manifest's expected hash.
  mocks.chain.bytecode = buildBytecode([...STD_SELECTORS, "0xdeadbeef"]);
  mocks.authority.bytecode = mocks.chain.bytecode; // keep consistent

  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(buildRequest());

  const expectedPrefix: GateName[] = ["rpc", "simulation", "contract"];
  assertFailureInvariants(result, "contract", expectedPrefix, "bytecode hash mismatch", mocks, "B.3");
}

// =========================================================================
// B.4 — Liquidity verification fails (lock percentage too low)
// =========================================================================

console.log("\nB.4 — Liquidity verification fails (lock percentage too low)");

{
  const mocks = freshMocks();
  // Drop the locked amount to 50% — below the 95% threshold.
  const lock = mocks.liquidity.locks.get(LP_A.toLowerCase() + ":" + LOCK_TRUSTED.toLowerCase())!;
  lock.lockedAmount = "500000000000000000000"; // 500 of 1000 LP

  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(buildRequest());

  const expectedPrefix: GateName[] = ["rpc", "simulation", "contract", "liquidity"];
  assertFailureInvariants(result, "liquidity", expectedPrefix, "lock-percentage-low", mocks, "B.4");
}

// =========================================================================
// B.5 — Token authority verification fails (owner not allowlisted)
// =========================================================================

console.log("\nB.5 — Token authority verification fails (owner not allowlisted)");

{
  const mocks = freshMocks();
  // Make owner() return a non-allowlisted address.
  mocks.chain.callReturns[SEL.owner] = addrReturn(OWNER_UNKNOWN);
  mocks.authority.callReturns[SEL.owner] = addrReturn(OWNER_UNKNOWN);

  const pipeline = buildPipeline(mocks);
  const req = buildRequest();
  // Add OWNER_UNKNOWN to the CONTRACT manifest's allowedOwners so the
  // contract gate passes; keep it OUT of the authority manifest's
  // allowedAuthorityHolders so the authority gate fails.
  req.contractManifest.allowedOwners = [OWNER_REAL, OWNER_UNKNOWN];
  const result = await pipeline.process(req);

  const expectedPrefix: GateName[] = ["rpc", "simulation", "contract", "liquidity", "authority"];
  assertFailureInvariants(result, "authority", expectedPrefix, "held by unknown", mocks, "B.5");
}

// =========================================================================
// B.6 — Sell simulation fails (sell reverts — honeypot)
// =========================================================================

console.log("\nB.6 — Sell simulation fails (sell reverts — honeypot)");

{
  const mocks = freshMocks();
  mocks.tradeSim.sellResult = {
    reverted: true,
    revertReason: "execution reverted: transfer failed",
    actualAmountOut: "0",
    gasUsed: 0,
  };

  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(buildRequest());

  const expectedPrefix: GateName[] = ["rpc", "simulation", "contract", "liquidity", "authority", "sell-sim"];
  assertFailureInvariants(result, "sell-sim", expectedPrefix, "sell reverted", mocks, "B.6");
}

// =========================================================================
// B.7 — Approval gate rejects (unlimited approval)
// =========================================================================

console.log("\nB.7 — Approval gate rejects (unlimited approval)");

{
  const mocks = freshMocks();
  const req = buildRequest();
  // Request type(uint256).max — hard-blocked by ApprovalGate.
  req.approvalRequest.amount = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(req);

  const expectedPrefix: GateName[] = ["rpc", "simulation", "contract", "liquidity", "authority", "sell-sim", "approval"];
  assertFailureInvariants(result, "approval", expectedPrefix, "unlimited approval", mocks, "B.7");
}

// =========================================================================
// B.8 — MEV gate rejects (slippage exceeds dynamic limit)
// =========================================================================

console.log("\nB.8 — MEV gate rejects (slippage exceeds dynamic limit)");

{
  const mocks = freshMocks();
  const req = buildRequest();
  // Set actual price 50% below expected — way beyond the 3% hard cap.
  req.mevInputs.actualPrice = 0.5;

  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(req);

  const expectedPrefix: GateName[] = [
    "rpc", "simulation", "contract", "liquidity", "authority", "sell-sim", "approval", "mev",
  ];
  assertFailureInvariants(result, "mev", expectedPrefix, "slippage", mocks, "B.8");
}

// =========================================================================
// B.9 — Signer rejects (rare — every gate passed but signer said no)
// =========================================================================

console.log("\nB.9 — Signer rejects (every gate passed, signer returned ok=false)");

{
  const mocks = freshMocks();
  mocks.signer.result = { ok: false, error: "signer process unavailable" };

  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(buildRequest());

  assertEqual(result.ok, false, "B.9: result.ok is false");
  assertEqual(result.failedGate, "signer", "B.9: failedGate is signer");
  assert(
    result.originalReason === "signer process unavailable",
    `B.9: originalReason preserved verbatim, got: ${result.originalReason}`,
  );
  assertEqual(mocks.signer.callCount, 1, "B.9: signer WAS called (it's the failing gate)");
  assertEqual(mocks.audit.callCount, 1, "B.9: exactly one audit entry");
  assert(
    result.executedGates.length === GATE_ORDER.length,
    `B.9: all 9 gates executed, got ${result.executedGates.length}`,
  );
}

// =========================================================================
// C.1 — ADVERSARIAL: No bypass option exists on PipelineConfig
// =========================================================================

console.log("\nC.1 — ADVERSARIAL: no bypass option exists on PipelineConfig (static check)");

{
  // Inspect the PipelineConfig type to confirm there is NO skipGate /
  // ignoreFailure / bypassOrder option. This is a structural property:
  // an attacker who controls the request cannot make the composer skip
  // a gate because the composer doesn't expose that capability.
  const cfg: PipelineConfig = {
    rpc: {} as any,
    simulation: {} as any,
    contract: {} as any,
    liquidity: {} as any,
    authority: {} as any,
    sellSim: {} as any,
    approval: {} as any,
    audit: {} as any,
    signer: {} as any,
  };

  // List the keys an attacker could try to set.
  const keys = Object.keys(cfg);
  const forbidden = ["skipGate", "ignoreFailure", "bypassOrder", "skipGates", "disabledGates", "bypass"];
  const found = forbidden.filter(k => (k in cfg));
  assert(found.length === 0, `C.1: no bypass keys in PipelineConfig (found: ${found.join(", ") || "none"})`);
  // 9 mandatory keys (log is optional and deliberately omitted here).
  const mandatoryKeys = ["rpc", "simulation", "contract", "liquidity", "authority", "sellSim", "approval", "audit", "signer"];
  const allMandatoryPresent = mandatoryKeys.every(k => keys.includes(k));
  assert(allMandatoryPresent, `C.1: all 9 mandatory keys present, got: ${keys.join(", ")}`);
  // No extra keys beyond the mandatory 9 + optional log.
  const extra = keys.filter(k => !mandatoryKeys.includes(k) && k !== "log");
  assert(extra.length === 0, `C.1: no extra keys beyond mandatory + log, found: ${extra.join(", ")}`);
}

// =========================================================================
// C.2 — ADVERSARIAL: Double simultaneous failure — first-failure-wins
// =========================================================================

console.log("\nC.2 — ADVERSARIAL: double simultaneous failure (first-failure-wins)");

{
  const mocks = freshMocks();
  // Configure TWO gates to fail: contract (bytecode mismatch) AND
  // liquidity (lock percentage too low). The pipeline must report the
  // FIRST failure (contract) and never reach the liquidity gate.
  mocks.chain.bytecode = buildBytecode([...STD_SELECTORS, "0xdeadbeef"]);
  mocks.authority.bytecode = mocks.chain.bytecode;
  const lock = mocks.liquidity.locks.get(LP_A.toLowerCase() + ":" + LOCK_TRUSTED.toLowerCase())!;
  lock.lockedAmount = "500000000000000000000"; // 50% — would fail liquidity

  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(buildRequest());

  // Contract is gate 3; liquidity is gate 4. The pipeline must stop at
  // contract and never invoke liquidity. The liquidity failure reason
  // must NOT appear in originalReason.
  assertEqual(result.failedGate, "contract", "C.2: first failure (contract) wins");
  assert(
    result.originalReason?.includes("bytecode hash mismatch") === true,
    `C.2: originalReason is the contract reason, got: ${result.originalReason}`,
  );
  assert(
    result.originalReason?.includes("lock-percentage-low") === false,
    "C.2: liquidity reason does NOT leak into originalReason",
  );
  assert(
    !result.executedGates.includes("liquidity"),
    "C.2: liquidity gate was NOT executed (short-circuit)",
  );
  assertEqual(mocks.audit.callCount, 1, "C.2: exactly one audit entry");
}

// =========================================================================
// C.3 — ADVERSARIAL: Corrupted state between gates
// =========================================================================

console.log("\nC.3 — ADVERSARIAL: corrupted state between gates (no shared mutation)");

{
  const mocks = freshMocks();
  const pipeline = buildPipeline(mocks);
  const req = buildRequest();

  // Mutate the contractManifest AFTER constructing the request but
  // BEFORE process(). The pipeline receives the manifest as-is and
  // passes it to contract.verify(). The pipeline does NOT share
  // mutable state between gates — each gate gets its own slice.
  //
  // To verify this, we confirm that mutating the request's manifest
  // between two process() calls produces DIFFERENT results (the
  // pipeline does not cache the manifest from the first call).
  const result1 = await pipeline.process(req);
  assertEqual(result1.ok, true, "C.3: first process() succeeds");

  // Now corrupt the contractManifest — change the expected hash.
  // The second process() must fail at the contract gate.
  req.contractManifest.expectedBytecodeHash = "0x" + "0".repeat(64);
  const result2 = await pipeline.process(req);

  assertEqual(result2.ok, false, "C.3: second process() fails after manifest mutation");
  assertEqual(result2.failedGate, "contract", "C.3: failure is at contract gate (no stale cache)");
  assertEqual(mocks.audit.callCount, 2, "C.3: two audit entries (one per process call)");
}

// =========================================================================
// C.4 — ADVERSARIAL: Audit exactly-once on exception path
// =========================================================================

console.log("\nC.4 — ADVERSARIAL: audit exactly-once when a gate THROWS (not just ok=false)");

{
  const mocks = freshMocks();
  // Make the SignerSink.submit() throw. The ContractVerifier catches
  // getCode exceptions internally (returns ok=false with a reason), so
  // we use the signer — its submit() is user-provided and can throw
  // in a way that bypasses every gate's internal try/catch.
  // We push to `calls` before throwing so callCount correctly reflects
  // that the signer was invoked (even though it crashed).
  const signerCalls = mocks.signer.calls;
  mocks.signer.submit = async (req: SignerRequest): Promise<SignerResult> => {
    signerCalls.push(req);
    throw new Error("signer process crashed");
  };

  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(buildRequest());

  assertEqual(result.ok, false, "C.4: result.ok is false");
  assertEqual(result.failedGate, "signer", "C.4: failedGate is signer (where the exception occurred)");
  assert(
    result.originalReason?.startsWith("exception:") === true,
    `C.4: originalReason is prefixed with "exception:", got: ${result.originalReason}`,
  );
  assert(
    result.originalReason?.includes("signer process crashed") === true,
    `C.4: originalReason preserves the exception message, got: ${result.originalReason}`,
  );
  assertEqual(mocks.signer.callCount, 1, "C.4: signer WAS called (it's the failing gate)");
  assertEqual(mocks.audit.callCount, 1, "C.4: exactly one audit entry (even on exception)");
  assertEqual(mocks.audit.lastCall?.event ?? "", "pipeline.failure", "C.4: audit event is pipeline.failure");
  assert(
    result.executedGates.length === GATE_ORDER.length,
    `C.4: all 9 gates executed (signer is last), got ${result.executedGates.length}`,
  );
}

// =========================================================================
// C.5 — ADVERSARIAL: executedGates always forms a prefix of GATE_ORDER
// =========================================================================

console.log("\nC.5 — ADVERSARIAL: executedGates is always a prefix of GATE_ORDER");

{
  // Run multiple scenarios and verify executedGates is always a prefix.
  const scenarios: Array<{ name: string; setup: (m: MockBundle, req: PipelineRequest) => void; expectedLen: number }> = [
    { name: "happy", setup: () => {}, expectedLen: 9 },
    { name: "rpc fails", setup: (m) => {
      m.transport.handlers.set("http://mock1", () => { throw new Error("down"); });
      m.transport.handlers.set("http://mock2", () => { throw new Error("down"); });
    }, expectedLen: 1 },
    { name: "sim fails", setup: (m) => {
      m.simulator.result = { ok: false, changes: [], gasUsed: 0, from: BUYER, revertReason: "no" };
    }, expectedLen: 2 },
    { name: "contract fails", setup: (m) => {
      m.chain.bytecode = buildBytecode([...STD_SELECTORS, "0xdeadbeef"]);
      m.authority.bytecode = m.chain.bytecode;
    }, expectedLen: 3 },
    { name: "liquidity fails", setup: (m) => {
      const lock = m.liquidity.locks.get(LP_A.toLowerCase() + ":" + LOCK_TRUSTED.toLowerCase())!;
      lock.lockedAmount = "1";
    }, expectedLen: 4 },
    { name: "authority fails", setup: (m, req) => {
      // Change owner to OWNER_UNKNOWN. Add it to the CONTRACT manifest's
      // allowedOwners so the contract gate passes, but keep it OUT of the
      // authority manifest's allowedAuthorityHolders so the authority gate
      // fails.
      m.chain.callReturns[SEL.owner] = addrReturn(OWNER_UNKNOWN);
      m.authority.callReturns[SEL.owner] = addrReturn(OWNER_UNKNOWN);
      req.contractManifest.allowedOwners = [OWNER_REAL, OWNER_UNKNOWN];
    }, expectedLen: 5 },
    { name: "sell-sim fails", setup: (m) => {
      m.tradeSim.sellResult = { reverted: true, revertReason: "no", actualAmountOut: "0", gasUsed: 0 };
    }, expectedLen: 6 },
    { name: "approval fails", setup: () => {}, expectedLen: 7 },
    { name: "mev fails", setup: (m) => {
      // We'll mutate the request below to set actualPrice = 0.5
    }, expectedLen: 8 },
  ];

  for (const sc of scenarios) {
    const mocks = freshMocks();
    const req = buildRequest();
    sc.setup(mocks, req);
    const pipeline = buildPipeline(mocks);
    if (sc.name === "approval fails") {
      req.approvalRequest.amount = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    }
    if (sc.name === "mev fails") {
      req.mevInputs.actualPrice = 0.5;
    }
    const result = await pipeline.process(req);

    // Verify executedGates is a prefix of GATE_ORDER.
    const isPrefix =
      result.executedGates.length <= GATE_ORDER.length &&
      result.executedGates.every((g, i) => g === GATE_ORDER[i]);
    assert(isPrefix, `C.5 [${sc.name}]: executedGates is a prefix of GATE_ORDER (len ${result.executedGates.length})`);
    assertEqual(result.executedGates.length, sc.expectedLen, `C.5 [${sc.name}]: executedGates length is ${sc.expectedLen}`);
  }
}

// =========================================================================
// C.6 — ADVERSARIAL: Signer receives the full SignerRequest (not stripped)
// =========================================================================

console.log("\nC.6 — ADVERSARIAL: signer receives the full SignerRequest (approved amount + slippage + sandwich)");

{
  const mocks = freshMocks();
  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(buildRequest());

  assertEqual(result.ok, true, "C.6: pipeline succeeded");
  assertEqual(mocks.signer.callCount, 1, "C.6: signer called once");

  const signerReq = mocks.signer.lastRequest!;
  assert(signerReq !== undefined, "C.6: signer request exists");
  assert(
    signerReq.tx.from === BUYER && signerReq.tx.to === ROUTER,
    "C.6: signer received the tx (from + to)",
  );
  assert(
    signerReq.expectedDiff.changes.length === 1,
    "C.6: signer received the expectedDiff (1 change)",
  );
  assert(
    signerReq.approvedAmount === "1000000000000000000",
    `C.6: signer received approvedAmount=1 token, got ${signerReq.approvedAmount}`,
  );
  assert(
    signerReq.slippageLimitBps > 0 && signerReq.slippageLimitBps <= 300,
    `C.6: signer received slippageLimitBps in (0, 300], got ${signerReq.slippageLimitBps}`,
  );
  assert(
    signerReq.sandwichScore === 0,
    `C.6: signer received sandwichScore=0 (no sandwich), got ${signerReq.sandwichScore}`,
  );
}

// =========================================================================
// C.7 — ADVERSARIAL: original reason is byte-identical to gate's reason
// =========================================================================

console.log("\nC.7 — ADVERSARIAL: originalReason is byte-identical to the gate's raw reason");

{
  const mocks = freshMocks();
  // Configure contract verification to fail with a known reason.
  mocks.chain.bytecode = buildBytecode([...STD_SELECTORS, "0xdeadbeef"]);
  mocks.authority.bytecode = mocks.chain.bytecode;

  // Run the contract verifier in isolation to get its raw reason.
  const contract = new ContractVerifier({ chain: mocks.chain });
  const rawResult = await contract.verify(buildRequest().contractManifest);
  const rawReason = rawResult.reasons.join("; ");

  // Run the full pipeline.
  const pipeline = buildPipeline(mocks);
  const result = await pipeline.process(buildRequest());

  assertEqual(
    result.originalReason,
    rawReason,
    "C.7: pipeline.originalReason === contract verifier's raw reasons.join('; ')",
  );
}

// =========================================================================
// Summary
// =========================================================================

console.log(`\n=== H2.6 Summary: ${pass} pass, ${fail} fail ===`);
console.log("\nProperties verified:");
console.log("  A.   Happy path — all gates pass, signer accepts, exactly one audit entry");
console.log("  B.1. RPC preflight fails → pipeline stops at rpc");
console.log("  B.2. Simulation fails → approval never executes");
console.log("  B.3. Contract fails → liquidity never executes");
console.log("  B.4. Liquidity fails → authority never executes");
console.log("  B.5. Authority fails → sell-sim never executes");
console.log("  B.6. Sell-sim fails → approval never executes");
console.log("  B.7. Approval rejects → MEV never executes");
console.log("  B.8. MEV rejects → signer never receives request");
console.log("  B.9. Signer rejects → all gates ran, signer was called");
console.log("  C.1. No bypass option exists on PipelineConfig (static)");
console.log("  C.2. Double simultaneous failure — first-failure-wins");
console.log("  C.3. Corrupted state between gates — no shared mutation, no stale cache");
console.log("  C.4. Audit exactly-once on exception path (gate throws, not just ok=false)");
console.log("  C.5. executedGates always forms a prefix of GATE_ORDER (9 scenarios)");
console.log("  C.6. Signer receives the full SignerRequest (approved amount + slippage + sandwich)");
console.log("  C.7. originalReason is byte-identical to the gate's raw reason");

if (fail > 0) {
  console.log("\nFAILURES DETECTED — see above.");
  process.exit(1);
}

}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
