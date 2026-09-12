/**
 * H1.1 — RPC Resilience test suite.
 *
 * Tests the QuorumRpcClient class directly against an injectable mock
 * transport. No real network calls are made.
 *
 * 16 scenarios across 4 categories:
 *
 *   A. Quorum (5 tests)
 *     1. Quorum read succeeds when 3/3 endpoints agree.
 *     2. Quorum read succeeds when 2/3 endpoints agree (majority).
 *     3. Quorum read FAILS when only 1 healthy endpoint (quorum impossible).
 *     4. Quorum read FAILS when all 3 endpoints return different values.
 *     5. Quorum read FAILS when all endpoints error.
 *
 *   B. Failover (4 tests)
 *     6. readWithFailover returns the primary's value on first try.
 *     7. readWithFailover fails over to the secondary when primary errors.
 *     8. readWithFailover fails over to the tertiary when primary+secondary error.
 *     9. readWithFailover returns ok=false when all endpoints error.
 *
 *   C. Circuit breaker (3 tests)
 *    10. Breaker opens after N consecutive failures (default 5).
 *    11. Open breaker excludes the endpoint from the healthy pool.
 *    12. Breaker closes after a successful call (post-cooldown).
 *
 *   D. Adversarial — the permanent principle (4 tests)
 *    13. Malicious endpoint returning wrong chain id is detected:
 *        quorum disagreement blocks the action.
 *    14. Malicious endpoint returning stale block number is detected.
 *    15. Malicious endpoint returning wrong balance is detected.
 *    16. Quorum comparison is stable across key ordering AND sensitive
 *        to single-field changes (the serializeForQuorum property test).
 *
 * Run: npx tsx scripts/test-h1-rpc-resilience.ts
 */

import {
  QuorumRpcClient,
  RpcEndpoint,
  Transport,
  serializeForQuorum,
} from "../src/lib/chain/rpc-resilience";

let pass = 0;
let fail = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  \u2713 PASS`);
    pass++;
  } else {
    console.log(`  \u2717 FAIL: ${msg}`);
    fail++;
    process.exitCode = 1;
  }
}

// -------------------------------------------------------------------------
// Mock transport builder.
// -------------------------------------------------------------------------

type ScriptEntry =
  | { kind: "value"; value: unknown }
  | { kind: "error"; message: string }
  | { kind: "delay"; ms: number; value: unknown }
  | { kind: "match"; match: (params: unknown[]) => boolean; value: unknown };

function makeScriptedTransport(scripts: Record<string, ScriptEntry[]>): Transport {
  const cursors: Record<string, number> = {};
  return async (url: string, _method: string, params: unknown[]) => {
    const script = scripts[url];
    if (!script) throw new Error(`no script for url ${url}`);
    const idx = cursors[url] ?? 0;
    cursors[url] = idx + 1;
    if (idx >= script.length) throw new Error(`script exhausted for ${url}`);
    const entry = script[idx];
    switch (entry.kind) {
      case "value":
        return entry.value;
      case "error":
        throw new Error(entry.message);
      case "delay":
        await new Promise(r => setTimeout(r, entry.ms));
        return entry.value;
      case "match":
        if (entry.match(params)) return entry.value;
        throw new Error(`match failed for ${url}`);
    }
  };
}

const EPS: RpcEndpoint[] = [
  { id: "alpha", url: "https://alpha.example", priority: 100, provider: "Alchemy" },
  { id: "beta",  url: "https://beta.example",  priority:  90, provider: "Infura" },
  { id: "gamma", url: "https://gamma.example", priority:  80, provider: "QuickNode" },
];

async function main(): Promise<void> {
  console.log("\n=== H1.1 — RPC Resilience Test Suite ===\n");

  // =====================================================================
  // A. Quorum
  // =====================================================================

  console.log("  [A1] Quorum read succeeds when 3/3 endpoints agree...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "value", value: "0x1" }],
      "https://beta.example":  [{ kind: "value", value: "0x1" }],
      "https://gamma.example": [{ kind: "value", value: "0x1" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.quorumRead<string>("eth_blockNumber", []);
    assert(r.ok && r.value === "0x1", `expected ok=true value=0x1; got ${JSON.stringify(r)}`);
    assert(r.agreed.length === 3, `expected 3 agreed; got ${r.agreed.length}`);
    assert(r.disagreed.length === 0, `expected 0 disagreed; got ${r.disagreed.length}`);
  }

  console.log("  [A2] Quorum read succeeds when 2/3 endpoints agree (majority)...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "value", value: "0x1" }],
      "https://beta.example":  [{ kind: "value", value: "0x1" }],
      "https://gamma.example": [{ kind: "value", value: "0x2" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.quorumRead<string>("eth_blockNumber", []);
    assert(r.ok && r.value === "0x1", `expected ok=true value=0x1; got ${JSON.stringify(r)}`);
    assert(r.agreed.length === 2, `expected 2 agreed; got ${r.agreed.length}`);
    assert(r.disagreed.length === 1 && r.disagreed[0] === "gamma", `expected disagreed=[gamma]; got ${JSON.stringify(r.disagreed)}`);
  }

  console.log("  [A3] Quorum read FAILS when only 1 healthy endpoint (quorum impossible)...");
  {
    const oneEp = [EPS[0]];
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "value", value: "0x1" }],
    });
    const client = new QuorumRpcClient({ endpoints: oneEp, transport });
    const r = await client.quorumRead<string>("eth_blockNumber", []);
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.error?.includes("quorum impossible"), `expected 'quorum impossible' error; got ${r.error}`);
  }

  console.log("  [A4] Quorum read FAILS when all 3 endpoints return different values...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "value", value: "0x1" }],
      "https://beta.example":  [{ kind: "value", value: "0x2" }],
      "https://gamma.example": [{ kind: "value", value: "0x3" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.quorumRead<string>("eth_blockNumber", []);
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.error?.includes("quorum not reached"), `expected 'quorum not reached' error; got ${r.error}`);
  }

  console.log("  [A5] Quorum read FAILS when all endpoints error...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "error", message: "503" }],
      "https://beta.example":  [{ kind: "error", message: "timeout" }],
      "https://gamma.example": [{ kind: "error", message: "dns" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.quorumRead<string>("eth_blockNumber", []);
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.error?.includes("all endpoints errored"), `expected 'all endpoints errored'; got ${r.error}`);
  }

  // =====================================================================
  // B. Failover
  // =====================================================================

  console.log("  [B1] readWithFailover returns the primary's value on first try...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "value", value: "0xabc" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.readWithFailover<string>("eth_blockNumber", []);
    assert(r.ok && r.value === "0xabc", `expected ok=true value=0xabc; got ${JSON.stringify(r)}`);
    assert(r.primaryUsed === "alpha", `expected primaryUsed=alpha; got ${r.primaryUsed}`);
    assert(!r.failedOver, `expected failedOver=false; got ${r.failedOver}`);
  }

  console.log("  [B2] readWithFailover fails over to the secondary when primary errors...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "error", message: "503" }],
      "https://beta.example":  [{ kind: "value", value: "0xdef" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.readWithFailover<string>("eth_blockNumber", []);
    assert(r.ok && r.value === "0xdef", `expected ok=true value=0xdef; got ${JSON.stringify(r)}`);
    assert(r.primaryUsed === "beta", `expected primaryUsed=beta; got ${r.primaryUsed}`);
    assert(r.failedOver, `expected failedOver=true; got ${r.failedOver}`);
    assert(r.queried.length === 2, `expected 2 queried; got ${r.queried.length}`);
  }

  console.log("  [B3] readWithFailover fails over to the tertiary when primary+secondary error...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "error", message: "503" }],
      "https://beta.example":  [{ kind: "error", message: "timeout" }],
      "https://gamma.example": [{ kind: "value", value: "0xghi" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.readWithFailover<string>("eth_blockNumber", []);
    assert(r.ok && r.value === "0xghi", `expected ok=true value=0xghi; got ${JSON.stringify(r)}`);
    assert(r.primaryUsed === "gamma", `expected primaryUsed=gamma; got ${r.primaryUsed}`);
    assert(r.queried.length === 3, `expected 3 queried; got ${r.queried.length}`);
  }

  console.log("  [B4] readWithFailover returns ok=false when all endpoints error...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "error", message: "503" }],
      "https://beta.example":  [{ kind: "error", message: "timeout" }],
      "https://gamma.example": [{ kind: "error", message: "dns" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.readWithFailover<string>("eth_blockNumber", []);
    assert(!r.ok, `expected ok=false; got ${JSON.stringify(r)}`);
    assert(r.queried.length === 3, `expected 3 queried; got ${r.queried.length}`);
  }

  // =====================================================================
  // C. Circuit breaker
  // =====================================================================

  console.log("  [C1] Breaker opens after N consecutive failures (default 5)...");
  {
    // Use a small healthLossOnFailure so alpha stays above the health
    // floor across 5 failures — we want to exercise the BREAKER in
    // isolation, not the health-floor mechanism (that's tested in D).
    const transport = makeScriptedTransport({
      "https://alpha.example": Array.from({ length: 5 }, () => ({ kind: "error", message: "500" }) as ScriptEntry),
      "https://beta.example":  Array.from({ length: 5 }, () => ({ kind: "value", value: "0x1" }) as ScriptEntry),
      "https://gamma.example": Array.from({ length: 5 }, () => ({ kind: "value", value: "0x1" }) as ScriptEntry),
    });
    const client = new QuorumRpcClient({
      endpoints: EPS, transport,
      healthLossOnFailure: 0.05,  // 5 failures = -0.25 health; stays well above 0.2 floor
    });
    for (let i = 0; i < 5; i++) {
      await client.readWithFailover("eth_blockNumber", []);
    }
    const snap = client.healthSnapshot();
    assert(snap.alpha.breakerOpen === true, `expected alpha breaker open; got ${JSON.stringify(snap.alpha)}`);
    assert(snap.alpha.consecutiveFailures === 5, `expected 5 consecutive failures; got ${snap.alpha.consecutiveFailures}`);
    assert(snap.alpha.health < 1.0, `expected health<1.0; got ${snap.alpha.health}`);
    assert(snap.beta.health === 1.0, `expected beta health=1.0; got ${snap.beta.health}`);
    assert(snap.gamma.health === 1.0, `expected gamma health=1.0; got ${snap.gamma.health}`);
  }

  console.log("  [C2] Open breaker excludes the endpoint from the healthy pool...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": Array.from({ length: 4 }, () => ({ kind: "error", message: "500" }) as ScriptEntry),
      "https://beta.example":  Array.from({ length: 4 }, () => ({ kind: "value", value: "0x1" }) as ScriptEntry),
    });
    const client = new QuorumRpcClient({
      endpoints: [EPS[0], EPS[1]],
      transport,
      breakerThreshold: 3,
      breakerCooldownMs: 60_000,
      healthLossOnFailure: 0.05,
    });
    for (let i = 0; i < 3; i++) {
      await client.readWithFailover("eth_blockNumber", []);
    }
    // Next call: alpha should be skipped (breaker open), beta succeeds first try.
    const r = await client.readWithFailover<string>("eth_blockNumber", []);
    assert(r.ok && r.value === "0x1", `expected ok=true value=0x1; got ${JSON.stringify(r)}`);
    assert(r.primaryUsed === "beta", `expected primaryUsed=beta (alpha skipped); got ${r.primaryUsed}`);
    assert(!r.failedOver, `expected failedOver=false (alpha skipped, beta succeeded); got ${r.failedOver}`);
  }

  console.log("  [C3] Breaker closes after a successful call (post-cooldown)...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [
        { kind: "error", message: "500" },
        { kind: "error", message: "500" },
        { kind: "error", message: "500" },
        { kind: "value", value: "0xrecovered" },
      ],
      "https://beta.example": [{ kind: "value", value: "0x1" }],
    });
    const client = new QuorumRpcClient({
      endpoints: [EPS[0], EPS[1]],
      transport,
      breakerThreshold: 3,
      breakerCooldownMs: 50,
      healthLossOnFailure: 0.05,  // alpha stays above floor across 3 failures
    });
    for (let i = 0; i < 3; i++) {
      await client.readWithFailover("eth_blockNumber", []);
    }
    await new Promise(r => setTimeout(r, 80));
    const r = await client.readWithFailover<string>("eth_blockNumber", []);
    assert(r.ok && r.value === "0xrecovered", `expected ok=true value=0xrecovered; got ${JSON.stringify(r)}`);
    assert(r.primaryUsed === "alpha", `expected primaryUsed=alpha (recovered); got ${r.primaryUsed}`);
    const snap = client.healthSnapshot();
    assert(!snap.alpha.breakerOpen, `expected alpha breaker closed; got ${JSON.stringify(snap.alpha)}`);
  }

  // =====================================================================
  // D. Adversarial — the permanent principle
  // =====================================================================

  console.log("  [D1] ADVERSARIAL: malicious endpoint returning wrong chain id is detected (quorum blocks)...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "value", value: "0x2105" }],
      "https://beta.example":  [{ kind: "value", value: "0x2105" }],
      "https://gamma.example": [{ kind: "value", value: "0x1" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.quorumRead<string>("eth_chainId", []);
    assert(r.ok && r.value === "0x2105", `expected ok=true value=0x2105; got ${JSON.stringify(r)}`);
    assert(r.disagreed.includes("gamma"), `expected gamma in disagreed; got ${JSON.stringify(r.disagreed)}`);
  }

  console.log("  [D2] ADVERSARIAL: malicious endpoint returning stale block number is detected...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "value", value: "0x64" }],
      "https://beta.example":  [{ kind: "value", value: "0x64" }],
      "https://gamma.example": [{ kind: "value", value: "0x32" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.quorumRead<string>("eth_blockNumber", []);
    assert(r.ok && r.value === "0x64", `expected ok=true value=0x64; got ${JSON.stringify(r)}`);
    assert(r.disagreed.includes("gamma"), `expected gamma in disagreed; got ${JSON.stringify(r.disagreed)}`);
  }

  console.log("  [D3] ADVERSARIAL: malicious endpoint returning wrong balance is detected...");
  {
    const transport = makeScriptedTransport({
      "https://alpha.example": [{ kind: "value", value: "0x100" }],
      "https://beta.example":  [{ kind: "value", value: "0x100" }],
      "https://gamma.example": [{ kind: "value", value: "0xffffffff" }],
    });
    const client = new QuorumRpcClient({ endpoints: EPS, transport });
    const r = await client.quorumRead<string>("eth_getBalance", ["0xaddr", "latest"]);
    assert(r.ok && r.value === "0x100", `expected ok=true value=0x100; got ${JSON.stringify(r)}`);
    assert(r.disagreed.includes("gamma"), `expected gamma in disagreed; got ${JSON.stringify(r.disagreed)}`);
  }

  console.log("  [D4] ADVERSARIAL: serializeForQuorum is stable + sensitive (the quorum comparison property)...");
  {
    // Same content, different key order -> equal.
    const a = { chainId: "0x2105", blockNumber: "0x64" };
    const b = { blockNumber: "0x64", chainId: "0x2105" };
    assert(serializeForQuorum(a) === serializeForQuorum(b),
      `expected stable serialization; got a=${serializeForQuorum(a)} b=${serializeForQuorum(b)}`);

    // Single field change -> different.
    const c = { chainId: "0x2105", blockNumber: "0x64" };
    const d = { chainId: "0x2105", blockNumber: "0x65" };
    assert(serializeForQuorum(c) !== serializeForQuorum(d),
      `expected different serialization for different values; got c=${serializeForQuorum(c)} d=${serializeForQuorum(d)}`);

    // Nested objects sorted.
    const e = { outer: { z: 1, a: 2 } };
    const f = { outer: { a: 2, z: 1 } };
    assert(serializeForQuorum(e) === serializeForQuorum(f),
      `expected stable nested serialization; got e=${serializeForQuorum(e)} f=${serializeForQuorum(f)}`);

    // Nested single field change -> different.
    const g = { outer: { z: 1, a: 2 } };
    const h = { outer: { z: 99, a: 2 } };
    assert(serializeForQuorum(g) !== serializeForQuorum(h),
      `expected different nested serialization; got g=${serializeForQuorum(g)} h=${serializeForQuorum(h)}`);

    // Arrays preserve order (NOT sorted).
    const arr1 = [1, 2, 3];
    const arr2 = [3, 2, 1];
    assert(serializeForQuorum(arr1) !== serializeForQuorum(arr2),
      `expected arrays to preserve order; got arr1=${serializeForQuorum(arr1)} arr2=${serializeForQuorum(arr2)}`);
  }

  console.log(`\n=== H1.1 summary: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
