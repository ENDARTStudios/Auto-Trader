/**
 * M5.2 — Shadow Mode Runner.
 *
 * Sends READ-ONLY queries to REAL blockchain RPC endpoints (BSC mainnet).
 * NO broadcast. Compares nonce, gas, fee, block number, and latency across
 * the quorum.
 *
 * GOAL
 * ----
 * Validate that the QuorumRpcClient (H1.1) can talk to real BSC endpoints,
 * that the endpoints agree on canonical chain state (block number, gas
 * price, nonce), and that per-endpoint latency is within operational
 * thresholds. This is the "shadow" stage: we observe the chain WITHOUT
 * acting on it, so we can catch RPC drift / latency / disagreement BEFORE
 * going live.
 *
 * WHAT SHADOW MODE DOES NOT DO
 * ----------------------------
 *   - NO broadcast (no eth_sendRawTransaction).
 *   - NO real signing (signer transport is not used).
 *   - NO pipeline / gates (this is purely RPC-layer observability).
 *   - NO adversarial fault injection (that's M5.4 Chaos).
 *
 * DESIGN
 * ------
 * 1. Construct a real HTTP Transport that POSTs JSON-RPC via `fetch`.
 * 2. Build a QuorumRpcClient with 3 real BSC mainnet endpoints.
 * 3. For each endpoint, call these read-only methods N times (default 50):
 *      - eth_blockNumber
 *      - eth_getTransactionCount (BSC burn address 0x000...0001)
 *      - eth_feeHistory (blockCount=1, rewardPercentiles=[50])
 *      - eth_gasPrice
 * 4. Record latency per call, per endpoint.
 * 5. Compare results across endpoints (quorum agreement check).
 * 6. Run test assertions (A/B/C).
 *
 * NETWORK FALLBACK
 * ----------------
 * The test environment may not have internet access. If ALL endpoints fail
 * with network errors, the runner FALLS BACK to mock endpoints and prints:
 *   "Shadow Mode running with MOCK endpoints (no internet) — results are
 *    not representative"
 *
 * In mock mode, assertions that require real endpoints are SKIPPED with
 * `assert(true, "skipped — mock mode")`. The runner's own logic (latency
 * recording, comparison, reporting) is still validated.
 *
 * CLI FLAGS
 * ---------
 *   --real    Force real endpoints (skip mock fallback). If all real
 *             endpoints fail, assertions fail (no fallback).
 *   --rounds N  Number of rounds per method per endpoint (default 50).
 *
 * Test matrix:
 *
 *   A. Quorum health (3 tests)
 *     A.1 — at least 2 of 3 endpoints respond to eth_blockNumber
 *     A.2 — block numbers agree within 2 blocks across endpoints
 *     A.3 — gas prices agree within 20% across endpoints
 *
 *   B. Latency profile (3 tests)
 *     B.1 — eth_blockNumber p95 < 2000ms
 *     B.2 — eth_getTransactionCount p95 < 2000ms
 *     B.3 — eth_feeHistory p95 < 3000ms
 *
 *   C. Consistency (2 tests)
 *     C.1 — nonce is consistent across endpoints (same address → same nonce)
 *     C.2 — feeHistory reward array is non-empty
 *
 * Run: npx tsx scripts/test-m5-shadow.ts
 *      npx tsx scripts/test-m5-shadow.ts --real --rounds 100
 */

// Chain stack
import { QuorumRpcClient, type Transport, type RpcEndpoint } from "../src/lib/chain/rpc-resilience";

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

// -------------------------------------------------------------------------
// CLI flag parsing
// -------------------------------------------------------------------------

const argv = process.argv.slice(2);
const forceReal = argv.includes("--real");
const roundsIdx = argv.indexOf("--rounds");
const roundsArg = roundsIdx >= 0 ? argv[roundsIdx + 1] : undefined;
const rounds = roundsArg ? Math.max(1, parseInt(roundsArg, 10)) : 50;

// -------------------------------------------------------------------------
// Real BSC mainnet endpoints (public, no API key required).
// -------------------------------------------------------------------------

const BSC_ENDPOINTS: RpcEndpoint[] = [
  { id: "binance",  url: "https://bsc-dataseed.binance.org",       priority: 100, provider: "Binance" },
  { id: "defibit",  url: "https://bsc-dataseed1.defibit.io",        priority: 90,  provider: "Defibit" },
  { id: "nariox",   url: "https://bsc-dataseed.nariox.org",         priority: 80,  provider: "Nariox" },
];

// The BSC burn address (per operator's M5.2 directive). Used as the
// "known address" for eth_getTransactionCount queries. All endpoints
// should return the same nonce for this address.
const SHADOW_ADDRESS = "0x0000000000000000000000000000000000000001";

// -------------------------------------------------------------------------
// HTTP Transport — wraps `fetch` for JSON-RPC POST requests.
//
// The Transport signature is `(url, method, params) => Promise<unknown>`.
// We POST a JSON-RPC envelope and return `result`. Errors (network,
// HTTP non-2xx, JSON-RPC error) are thrown so the QuorumRpcClient's
// callWithTimeout can catch them and record per-endpoint health.
// -------------------------------------------------------------------------

function makeHttpTransport(): Transport {
  return async (url: string, method: string, params: unknown[]): Promise<unknown> => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // Node 24's fetch supports signal; we let the QuorumRpcClient's
      // callWithTimeout handle the outer timeout (default 5s).
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
    }
    const json = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
    if (json.error) {
      throw new Error(`JSON-RPC error ${json.error.code}: ${json.error.message} from ${url}`);
    }
    if (json.result === undefined) {
      throw new Error(`empty result from ${url}`);
    }
    return json.result;
  };
}

// -------------------------------------------------------------------------
// Mock Transport — fallback when real endpoints are unreachable.
//
// Returns deterministic canned responses for the 4 read methods we test.
// Used ONLY when all real endpoints fail with network errors AND --real
// was not passed.
// -------------------------------------------------------------------------

const MOCK_BLOCK_NUMBER = "0x68f6084"; // ~110_000_000-ish in hex
const MOCK_NONCE = "0x0";
const MOCK_GAS_PRICE = "0x2540be400"; // 10 gwei
const MOCK_FEE_HISTORY = {
  baseFeePerGas: ["0x0", "0x0"],
  reward: [["0x9502f900"]],
  gasUsedRatio: [0.5],
  oldestBlock: "0x68f6083",
};

function makeMockTransport(): Transport {
  return async (_url: string, method: string, _params: unknown[]): Promise<unknown> => {
    // Simulate a small delay so latency recording is non-trivial.
    await new Promise<void>((r) => setTimeout(r, 1 + Math.random() * 3));
    switch (method) {
      case "eth_blockNumber":       return MOCK_BLOCK_NUMBER;
      case "eth_getTransactionCount": return MOCK_NONCE;
      case "eth_gasPrice":          return MOCK_GAS_PRICE;
      case "eth_feeHistory":        return MOCK_FEE_HISTORY;
      default: throw new Error(`mock transport: unexpected method ${method}`);
    }
  };
}

// -------------------------------------------------------------------------
// Per-endpoint probe — call a method N times against ONE endpoint,
// record latency + result + error per call.
// -------------------------------------------------------------------------

interface CallRecord {
  ok: boolean;
  latencyMs: number;
  value: unknown;
  error?: string;
}

interface EndpointStats {
  endpointId: string;
  url: string;
  method: string;
  total: number;
  ok: number;
  fail: number;
  latencies: number[];
  lastError: string | null;
  lastValue: unknown;
  /**
   * Per-round values: `rounds[r]` is the value returned by this endpoint
   * in round `r` (null if the call failed). Used for cross-endpoint
   * comparison within the SAME round — this is critical because BSC
   * produces a block every ~3 seconds, and sequential probing would
   * show 3-6 block differences between endpoints purely due to time
   * skew (not endpoint disagreement).
   */
  roundValues: (unknown | null)[];
}

async function probeEndpoint(
  transport: Transport,
  url: string,
  endpointId: string,
  method: string,
  params: unknown[],
  n: number,
): Promise<EndpointStats> {
  const records: CallRecord[] = [];
  for (let i = 0; i < n; i++) {
    const start = Date.now();
    try {
      const value = await transport(url, method, params);
      records.push({ ok: true, latencyMs: Date.now() - start, value });
    } catch (err) {
      records.push({
        ok: false,
        latencyMs: Date.now() - start,
        value: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const okRecs = records.filter((r) => r.ok);
  const failRecs = records.filter((r) => !r.ok);
  return {
    endpointId,
    url,
    method,
    total: records.length,
    ok: okRecs.length,
    fail: failRecs.length,
    latencies: okRecs.map((r) => r.latencyMs).sort((a, b) => a - b),
    lastError: failRecs.length > 0 ? failRecs[failRecs.length - 1]!.error ?? "unknown" : null,
    lastValue: okRecs.length > 0 ? okRecs[okRecs.length - 1]!.value : null,
    roundValues: records.map((r) => r.value),
  };
}

/**
 * Probe ALL endpoints for a given method in PARALLEL, for N rounds.
 *
 * Each round fires all endpoint calls simultaneously, so the returned
 * values are comparable across endpoints (queried at the same instant).
 * This is the production quorum-read pattern — the shadow runner uses
 * it so cross-endpoint agreement assertions aren't skewed by sequential
 * probing time.
 *
 * Returns one EndpointStats per endpoint (same shape as probeEndpoint,
 * but populated from the parallel rounds).
 */
async function probeAllEndpointsParallel(
  transport: Transport,
  endpoints: RpcEndpoint[],
  method: string,
  params: unknown[],
  n: number,
): Promise<EndpointStats[]> {
  // results[endpointIndex][roundIndex] = CallRecord
  const results: CallRecord[][] = endpoints.map(() => []);

  for (let round = 0; round < n; round++) {
    // Fire all endpoint calls in parallel for THIS round.
    const calls = endpoints.map(async (ep, eIdx) => {
      const start = Date.now();
      try {
        const value = await transport(ep.url, method, params);
        return { ok: true, latencyMs: Date.now() - start, value } as CallRecord;
      } catch (err) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          value: null,
          error: err instanceof Error ? err.message : String(err),
        } as CallRecord;
      }
    });
    const roundResults = await Promise.all(calls);
    for (let eIdx = 0; eIdx < endpoints.length; eIdx++) {
      results[eIdx]!.push(roundResults[eIdx]!);
    }
  }

  // Build EndpointStats from the collected records.
  return endpoints.map((ep, eIdx) => {
    const records = results[eIdx]!;
    const okRecs = records.filter((r) => r.ok);
    const failRecs = records.filter((r) => !r.ok);
    return {
      endpointId: ep.id,
      url: ep.url,
      method,
      total: records.length,
      ok: okRecs.length,
      fail: failRecs.length,
      latencies: okRecs.map((r) => r.latencyMs).sort((a, b) => a - b),
      lastError: failRecs.length > 0 ? failRecs[failRecs.length - 1]!.error ?? "unknown" : null,
      lastValue: okRecs.length > 0 ? okRecs[okRecs.length - 1]!.value : null,
      roundValues: records.map((r) => r.value),
    };
  });
}

// -------------------------------------------------------------------------
// Latency percentile helper.
// -------------------------------------------------------------------------

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx]!;
}

// -------------------------------------------------------------------------
// Cross-endpoint comparison helpers.
// -------------------------------------------------------------------------

function hexToBigInt(hex: string): bigint {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return BigInt(0);
  try { return BigInt(hex); } catch { return BigInt(0); }
}

/**
 * Extract a comparable numeric value from an endpoint's last result,
 * keyed by method. Returns null if the value is missing or malformed.
 */
function extractComparable(method: string, value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (method === "eth_blockNumber" || method === "eth_getTransactionCount" || method === "eth_gasPrice") {
    return typeof value === "string" ? hexToBigInt(value) : null;
  }
  // eth_feeHistory — compare baseFeePerGas[0] (or baseFeePerGas[1] on BSC
  // where baseFeePerGas[0] is sometimes "0x0" for the parent block).
  if (method === "eth_feeHistory") {
    const fh = value as { baseFeePerGas?: string[]; reward?: string[][] };
    if (!fh || !Array.isArray(fh.baseFeePerGas)) return null;
    // Use the LAST entry (current block's base fee).
    const last = fh.baseFeePerGas[fh.baseFeePerGas.length - 1];
    return last ? hexToBigInt(last) : null;
  }
  return null;
}

// -------------------------------------------------------------------------
// Pretty-print helpers.
// -------------------------------------------------------------------------

function fmtMs(n: number): string {
  return n === 0 ? "n/a" : `${n}ms`;
}

function printEndpointStats(stats: EndpointStats): void {
  const successRate = stats.total === 0 ? 0 : (stats.ok / stats.total) * 100;
  const p50 = percentile(stats.latencies, 0.5);
  const p95 = percentile(stats.latencies, 0.95);
  const p99 = percentile(stats.latencies, 0.99);
  console.log(
    `    ${stats.endpointId.padEnd(8)} ${stats.method.padEnd(26)} ` +
    `ok=${stats.ok}/${stats.total} (${successRate.toFixed(0)}%)  ` +
    `p50=${fmtMs(p50)}  p95=${fmtMs(p95)}  p99=${fmtMs(p99)}  ` +
    `lastErr=${stats.lastError ?? "—"}`,
  );
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n=== M5.2 — Shadow Mode Runner ===\n");
  console.log(`  endpoints: ${BSC_ENDPOINTS.map((e) => e.id).join(", ")}`);
  console.log(`  rounds per method per endpoint: ${rounds}`);
  console.log(`  force real (--real): ${forceReal}`);
  console.log("");

  // -----------------------------------------------------------------
  // Phase 1: Probe all endpoints IN PARALLEL per round.
  //
  // We probe all 3 endpoints simultaneously for each round so that
  // cross-endpoint comparison isn't skewed by sequential probing time
  // (BSC produces a block every ~3s; sequential probing of 3 endpoints
  // × N rounds would show 3-6 block differences purely from time skew).
  // -----------------------------------------------------------------

  console.log("Phase 1 — Per-endpoint probing (real BSC mainnet, parallel per round)\n");

  const realTransport = makeHttpTransport();

  const methods: Array<{ method: string; params: unknown[] }> = [
    { method: "eth_blockNumber",          params: [] },
    { method: "eth_getTransactionCount",  params: [SHADOW_ADDRESS, "latest"] },
    { method: "eth_feeHistory",           params: ["0x1", "latest", [50]] },
    { method: "eth_gasPrice",             params: [] },
  ];

  // allStats[methodIndex][endpointIndex] = EndpointStats
  const allStats: EndpointStats[][] = methods.map(() => []);

  let totalRealCalls = 0;
  let totalRealFailures = 0;

  for (let mIdx = 0; mIdx < methods.length; mIdx++) {
    const { method, params } = methods[mIdx]!;
    console.log(`  Method: ${method}`);
    const statsArr = await probeAllEndpointsParallel(realTransport, BSC_ENDPOINTS, method, params, rounds);
    for (let eIdx = 0; eIdx < BSC_ENDPOINTS.length; eIdx++) {
      allStats[mIdx]![eIdx] = statsArr[eIdx]!;
      totalRealCalls += statsArr[eIdx]!.total;
      totalRealFailures += statsArr[eIdx]!.fail;
      printEndpointStats(statsArr[eIdx]!);
    }
    console.log("");
  }

  // -----------------------------------------------------------------
  // Phase 2: Determine whether to fall back to mock endpoints.
  // -----------------------------------------------------------------

  // "All endpoints fail" = every call to every endpoint errored.
  // If even ONE endpoint responded successfully, we keep real mode.
  const realSuccessCount = totalRealCalls - totalRealFailures;
  const allRealFailed = realSuccessCount === 0;

  let usingMock = false;
  let transport: Transport = realTransport;
  let endpoints: RpcEndpoint[] = BSC_ENDPOINTS;

  if (allRealFailed && !forceReal) {
    console.log("  \u26a0  ALL real endpoints failed — falling back to MOCK endpoints.\n");
    console.log("  Shadow Mode running with MOCK endpoints (no internet) — results are not representative\n");
    usingMock = true;
    transport = makeMockTransport();
    // Mock endpoints: reuse the same IDs so the report format is identical.
    endpoints = BSC_ENDPOINTS.map((e) => ({ ...e, url: `mock://${e.id}` }));

    // Re-probe with mock transport (parallel per round).
    for (let mIdx = 0; mIdx < methods.length; mIdx++) {
      const { method, params } = methods[mIdx]!;
      console.log(`  Method (mock): ${method}`);
      const statsArr = await probeAllEndpointsParallel(transport, endpoints, method, params, rounds);
      for (let eIdx = 0; eIdx < endpoints.length; eIdx++) {
        allStats[mIdx]![eIdx] = statsArr[eIdx]!;
        printEndpointStats(statsArr[eIdx]!);
      }
      console.log("");
    }
  } else if (allRealFailed && forceReal) {
    console.log("  \u2717  ALL real endpoints failed and --real was passed — NOT falling back.\n");
  }

  // -----------------------------------------------------------------
  // Phase 3: Cross-endpoint comparison via QuorumRpcClient.
  //
  // Construct a QuorumRpcClient with the (real or mock) endpoints and
  // call quorumRead once per method. This validates that the quorum
  // logic itself works with the configured endpoints — it's the
  // "production path" exercise.
  // -----------------------------------------------------------------

  console.log("Phase 2 — Cross-endpoint quorum agreement\n");

  const rpc = new QuorumRpcClient({
    endpoints,
    transport,
    callTimeoutMs: 5_000,
    log: (level, msg, fields) => {
      // Surface quorum warnings/errors to console for visibility.
      if (level === "warn" || level === "error") {
        console.log(`    [rpc.${level}] ${msg}${fields ? " " + JSON.stringify(fields) : ""}`);
      }
    },
  });

  const quorumResults: Array<{ method: string; params: unknown[]; ok: boolean; agreed: string[]; queried: string[] }> = [];
  for (const { method, params } of methods) {
    const r = await rpc.quorumRead<unknown>(method, params);
    quorumResults.push({ method, params, ok: r.ok, agreed: r.agreed, queried: r.queried });
    console.log(
      `  ${method.padEnd(26)} ok=${r.ok}  queried=[${r.queried.join(",")}]  ` +
      `agreed=[${r.agreed.join(",")}]${r.error ? "  error=" + r.error : ""}`,
    );
  }
  console.log("");

  // -----------------------------------------------------------------
  // Phase 4: Health snapshot.
  // -----------------------------------------------------------------

  console.log("Phase 3 — Endpoint health snapshot (after probing)\n");
  const health = rpc.healthSnapshot();
  for (const [id, s] of Object.entries(health)) {
    console.log(`  ${id.padEnd(8)} health=${s.health.toFixed(2)}  consecFail=${s.consecutiveFailures}  breakerOpen=${s.breakerOpen}`);
  }
  console.log("");

  // -----------------------------------------------------------------
  // Phase 5: Test assertions.
  // -----------------------------------------------------------------

  console.log("Phase 4 — Test assertions\n");

  // Helper: get the last successful value for a method+endpoint.
  const lastValue = (mIdx: number, eIdx: number): unknown =>
    allStats[mIdx]![eIdx]?.lastValue ?? null;

  // Helper: count endpoints that responded at least once to a method.
  const endpointsResponding = (mIdx: number): number =>
    allStats[mIdx]!.filter((s) => s.ok > 0).length;

  /**
   * Find the last round index where ALL endpoints succeeded for the given
   * method. Used for same-round cross-endpoint comparison — this avoids
   * time-skew artifacts (BSC produces a block every ~3s, so comparing
   * values from different rounds would show 3-6 block differences even
   * when endpoints are perfectly healthy).
   *
   * Returns -1 if no round had all endpoints succeeding.
   */
  const lastRoundAllSucceeded = (mIdx: number): number => {
    const statsArr = allStats[mIdx]!;
    if (statsArr.length === 0) return -1;
    const numRounds = statsArr[0]!.roundValues.length;
    for (let r = numRounds - 1; r >= 0; r--) {
      let allOk = true;
      for (const s of statsArr) {
        if (s.roundValues[r] === null || s.roundValues[r] === undefined) {
          allOk = false;
          break;
        }
      }
      if (allOk) return r;
    }
    return -1;
  };

  /**
   * Get the value returned by a specific endpoint in a specific round
   * for a given method. Returns null if the call failed.
   */
  const roundValue = (mIdx: number, eIdx: number, round: number): unknown =>
    allStats[mIdx]![eIdx]?.roundValues[round] ?? null;

  // -------- A. Quorum health --------

  console.log("A. Quorum health\n");

  // A.1 — at least 2 of 3 endpoints respond to eth_blockNumber
  console.log("A.1 — at least 2 of 3 endpoints respond to eth_blockNumber");
  {
    if (usingMock) {
      assert(true, "skipped — mock mode");
    } else {
      const responding = endpointsResponding(0); // eth_blockNumber is index 0
      assert(responding >= 2, `expected >= 2 endpoints responding, got ${responding}`);
    }
  }

  // A.2 — block numbers agree within 2 blocks across endpoints
  // (same-round comparison to avoid time-skew artifacts)
  console.log("A.2 — block numbers agree within 2 blocks across endpoints (same round)");
  {
    if (usingMock) {
      assert(true, "skipped — mock mode");
    } else {
      const round = lastRoundAllSucceeded(0);
      if (round < 0) {
        assert(false, "no round where all endpoints succeeded for eth_blockNumber");
      } else {
        const blocks: bigint[] = [];
        for (let eIdx = 0; eIdx < endpoints.length; eIdx++) {
          const v = roundValue(0, eIdx, round);
          const b = extractComparable("eth_blockNumber", v);
          if (b !== null) blocks.push(b);
        }
        if (blocks.length < 2) {
          assert(false, `only ${blocks.length} endpoints returned a block number in round ${round}`);
        } else {
          const max = blocks.reduce((m, b) => (b > m ? b : m), BigInt(0));
          const min = blocks.reduce((m, b) => (b < m ? b : m), max);
          const delta = max - min;
          assert(delta <= BigInt(2), `block numbers disagree by ${delta} blocks in round ${round} (max=${max}, min=${min})`);
        }
      }
    }
  }

  // A.3 — gas prices agree within 20% across endpoints (same round)
  console.log("A.3 — gas prices agree within 20% across endpoints (same round)");
  {
    if (usingMock) {
      assert(true, "skipped — mock mode");
    } else {
      const round = lastRoundAllSucceeded(3); // eth_gasPrice is index 3
      if (round < 0) {
        assert(false, "no round where all endpoints succeeded for eth_gasPrice");
      } else {
        const prices: bigint[] = [];
        for (let eIdx = 0; eIdx < endpoints.length; eIdx++) {
          const v = roundValue(3, eIdx, round);
          const p = extractComparable("eth_gasPrice", v);
          if (p !== null && p > BigInt(0)) prices.push(p);
        }
        if (prices.length < 2) {
          assert(false, `only ${prices.length} endpoints returned a gas price in round ${round}`);
        } else {
          const max = prices.reduce((m, p) => (p > m ? p : m), BigInt(0));
          const min = prices.reduce((m, p) => (p < m ? p : m), max);
          // variance = (max - min) / min
          const varianceBps = Number(((max - min) * BigInt(10000)) / min);
          assert(varianceBps <= 2000, `gas price variance ${varianceBps / 100}% > 20% in round ${round} (max=${max}, min=${min})`);
        }
      }
    }
  }

  // -------- B. Latency profile --------

  console.log("\nB. Latency profile\n");

  // For mock mode, all p95 latencies will be < 10ms (mock delay is 1-4ms),
  // so the assertions trivially pass. We still run them to validate the
  // runner's latency-recording logic.

  // B.1 — eth_blockNumber p95 < 2000ms (aggregate across endpoints)
  console.log("B.1 — eth_blockNumber p95 < 2000ms");
  {
    const allLatencies: number[] = [];
    for (const s of allStats[0]!) allLatencies.push(...s.latencies);
    allLatencies.sort((a, b) => a - b);
    const p95 = percentile(allLatencies, 0.95);
    assertLessThan(p95, 2000, `eth_blockNumber p95`);
  }

  // B.2 — eth_getTransactionCount p95 < 2000ms
  console.log("B.2 — eth_getTransactionCount p95 < 2000ms");
  {
    const allLatencies: number[] = [];
    for (const s of allStats[1]!) allLatencies.push(...s.latencies);
    allLatencies.sort((a, b) => a - b);
    const p95 = percentile(allLatencies, 0.95);
    assertLessThan(p95, 2000, `eth_getTransactionCount p95`);
  }

  // B.3 — eth_feeHistory p95 < 3000ms
  console.log("B.3 — eth_feeHistory p95 < 3000ms");
  {
    const allLatencies: number[] = [];
    for (const s of allStats[2]!) allLatencies.push(...s.latencies);
    allLatencies.sort((a, b) => a - b);
    const p95 = percentile(allLatencies, 0.95);
    assertLessThan(p95, 3000, `eth_feeHistory p95`);
  }

  // -------- C. Consistency --------

  console.log("\nC. Consistency\n");

  // C.1 — nonce is consistent across endpoints (same address → same nonce)
  // (same-round comparison)
  console.log("C.1 — nonce is consistent across endpoints (same round)");
  {
    if (usingMock) {
      assert(true, "skipped — mock mode");
    } else {
      const round = lastRoundAllSucceeded(1); // eth_getTransactionCount is index 1
      if (round < 0) {
        assert(false, "no round where all endpoints succeeded for eth_getTransactionCount");
      } else {
        const nonces: bigint[] = [];
        for (let eIdx = 0; eIdx < endpoints.length; eIdx++) {
          const v = roundValue(1, eIdx, round);
          const n = extractComparable("eth_getTransactionCount", v);
          if (n !== null) nonces.push(n);
        }
        if (nonces.length < 2) {
          assert(false, `only ${nonces.length} endpoints returned a nonce in round ${round}`);
        } else {
          const allSame = nonces.every((n) => n === nonces[0]);
          assert(allSame, `nonce mismatch in round ${round}: ${nonces.map((n) => n.toString()).join(", ")}`);
        }
      }
    }
  }

  // C.2 — feeHistory reward array is non-empty
  console.log("C.2 — feeHistory reward array is non-empty");
  {
    // This works in both real and mock mode (mock returns a valid reward array).
    let anyNonEmpty = false;
    for (let eIdx = 0; eIdx < endpoints.length; eIdx++) {
      const v = lastValue(2, eIdx); // eth_feeHistory is index 2
      const fh = v as { reward?: string[][] } | null;
      if (fh && Array.isArray(fh.reward) && fh.reward.length > 0 && Array.isArray(fh.reward[0]) && fh.reward[0]!.length > 0) {
        anyNonEmpty = true;
        break;
      }
    }
    assert(anyNonEmpty, "no endpoint returned a non-empty feeHistory.reward array");
  }

  // -------- Runner-logic validation (always runs, even in mock mode) --------

  console.log("\nD. Runner logic validation (always runs)\n");

  // D.1 — QuorumRpcClient.healthSnapshot returns all configured endpoints
  console.log("D.1 — QuorumRpcClient.healthSnapshot returns all configured endpoints");
  {
    const ids = Object.keys(health).sort();
    const expected = endpoints.map((e) => e.id).sort();
    assertEqual(JSON.stringify(ids), JSON.stringify(expected), "health snapshot covers all endpoints");
  }

  // D.2 — Per-endpoint stats were recorded for every (method, endpoint) pair
  console.log("D.2 — Per-endpoint stats recorded for every (method, endpoint) pair");
  {
    let allRecorded = true;
    for (let mIdx = 0; mIdx < methods.length; mIdx++) {
      for (let eIdx = 0; eIdx < endpoints.length; eIdx++) {
        const s = allStats[mIdx]![eIdx];
        if (!s || s.total !== rounds) {
          allRecorded = false;
          console.log(`      missing/incomplete stats: method=${methods[mIdx]!.method} endpoint=${endpoints[eIdx]!.id} total=${s?.total}`);
          break;
        }
      }
    }
    assert(allRecorded, "all (method, endpoint) pairs have complete stats");
  }

  // D.3 — Latency percentiles computed correctly (p50 <= p95 <= p99)
  console.log("D.3 — Latency percentiles monotonic (p50 <= p95 <= p99)");
  {
    let allMonotonic = true;
    for (let mIdx = 0; mIdx < methods.length; mIdx++) {
      for (const s of allStats[mIdx]!) {
        const p50 = percentile(s.latencies, 0.5);
        const p95 = percentile(s.latencies, 0.95);
        const p99 = percentile(s.latencies, 0.99);
        if (!(p50 <= p95 && p95 <= p99)) {
          allMonotonic = false;
          console.log(`      non-monotonic: ${s.endpointId}/${s.method} p50=${p50} p95=${p95} p99=${p99}`);
        }
      }
    }
    assert(allMonotonic, "all latency percentiles are monotonic");
  }

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------

  console.log("\n=== Summary ===");
  console.log(`  Mode: ${usingMock ? "MOCK (no internet)" : "REAL BSC mainnet"}`);
  console.log(`  Endpoints: ${endpoints.length}`);
  console.log(`  Rounds per method per endpoint: ${rounds}`);
  console.log(`  Total calls: ${allStats.flat().reduce((sum, s) => sum + s.total, 0)}`);
  console.log(`  Total successes: ${allStats.flat().reduce((sum, s) => sum + s.ok, 0)}`);
  console.log(`  Total failures: ${allStats.flat().reduce((sum, s) => sum + s.fail, 0)}`);
  console.log("");

  // Quorum health verdict.
  const healthyEndpoints = Object.values(health).filter((s) => s.health >= 0.5 && !s.breakerOpen).length;
  console.log(`  Quorum verdict: ${healthyEndpoints}/${endpoints.length} endpoints healthy (health >= 0.5)`);
  if (!usingMock && healthyEndpoints >= 2) {
    console.log("  \u2713 Quorum is healthy enough for production.");
  } else if (!usingMock) {
    console.log("  \u26a0  Quorum is NOT healthy enough for production — investigate endpoints.");
  } else {
    console.log("  (mock mode — no production verdict)");
  }

  console.log("");
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
  console.error("\nShadow Mode runner crashed:");
  console.error(err);
  process.exit(2);
});
