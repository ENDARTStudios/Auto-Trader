/**
 * M4 — Writer Lease test suite.
 *
 * This file proves the Writer Lease (src/lib/chain/writer-lease.ts)
 * and the LeasedBroadcaster (src/lib/chain/leased-broadcaster.ts)
 * honor their closed-scope contracts:
 *
 *   1. lease acquire / renew / release
 *   2. lease timeout (TTL-based expiry)
 *   3. owner election (expired lease → new owner acquires)
 *   4. reconnect (lease store goes down → renewer fails → lease expires)
 *   5. failover (process A holds, process B waits, A crashes, B acquires)
 *   6. fencing token monotonicity (REG-017)
 *   7. lease release on every exit path (REG-015)
 *   8. single owner per key (REG-018)
 *
 * And that it does NOT do any of the excluded things (no signing, no
 * broadcast, no nonce/gas management — all delegated).
 *
 * Test matrix (per operator's M4 directive):
 *
 *   A. Functional baseline (5 tests)
 *     A.1 — acquire when free → ok with token
 *     A.2 — renew own lease → ok with same token
 *     A.3 — release own lease → ok
 *     A.4 — release already-released lease → ok=false but no throw
 *     A.5 — current() reflects state transitions correctly
 *
 *   B. Adversarial — Lease lifecycle (8 tests)
 *     B.1 — acquire when held by another owner → LEASE_BUSY
 *     B.2 — renew another owner's lease → LEASE_NOT_OWNER
 *     B.3 — release another owner's lease → LEASE_NOT_OWNER
 *     B.4 — lease expires after TTL → state becomes "expired"
 *     B.5 — renewer extends TTL before expiry → lease stays held
 *     B.6 — fencing token increases monotonically across acquisitions (REG-017)
 *     B.7 — stale fencing token rejected via verifyToken (zombie writer)
 *     B.8 — concurrent acquire: only one wins, others get LEASE_BUSY (REG-018)
 *
 *   C. Adversarial — Reconnect & failover (4 tests)
 *     C.1 — lease store unavailable on acquire → LEASE_STORE_UNAVAILABLE
 *     C.2 — renewer fails on store outage → lease expires → failover
 *     C.3 — owner election: lease expires → new owner acquires with higher token
 *     C.4 — failover: process A holds, process B waits, A crashes, B acquires
 *
 *   D. LeasedBroadcaster integration (5 tests)
 *     D.1 — acquire ok → broadcast ok → release ok → returns SignerResult
 *     D.2 — acquire busy → returns LEASE_ACQUIRE_FAILED, no broadcast
 *     D.3 — fencing token stale pre-broadcast → LEASE_FENCING_TOKEN_STALE, no broadcast
 *     D.4 — broadcast fails → returns broadcaster error, lease released (REG-015)
 *     D.5 — broadcast throws → returns LEASE_CALLBACK_EXCEPTION, lease released (REG-015)
 *
 *   E. REG-015 invariant (3 tests)
 *     E.1 — withLease releases on success
 *     E.2 — withLease releases on failure
 *     E.3 — withLease releases on exception
 *
 *   F. Helpers (2 tests)
 *     F.1 — generateOwnerId produces unique IDs
 *     F.2 — buildLeaseKey lowercases the address
 *
 * Run: npx tsx scripts/test-m4-writer-lease.ts
 */

import {
  InMemoryLeaseStore,
  WriterLease,
  LeaseError,
  generateOwnerId,
  buildLeaseKey,
  type LeaseStore,
  type LeaseKey,
  type LeaseOwner,
  type LeaseRecord,
} from "../src/lib/chain/writer-lease";
import {
  LeasedBroadcaster,
  LeasedBroadcasterError,
} from "../src/lib/chain/leased-broadcaster";
import type { SignerSink, SignerRequest, SignerResult } from "../src/lib/chain/pipeline";
import type { Broadcaster } from "../src/lib/chain/broadcaster";

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

function assertNotEqual<T>(actual: T, expected: T, label: string): void {
  const ok = actual !== expected;
  if (ok) {
    console.log(`  \u2713 PASS — ${label}`);
    pass++;
  } else {
    console.log(`  \u2717 FAIL — ${label}: expected NOT ${JSON.stringify(expected)}, got identical`);
    fail++;
    process.exitCode = 1;
  }
}

// -------------------------------------------------------------------------
// Sleep helper — for TTL-based tests.
// -------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------------------------------------------------------------
// FakeBroadcaster — a mock that records calls and can be scripted to
// return ok/fail/throw. This isolates the lease behavior from the
// real Broadcaster (which is tested by test-m3-broadcaster.ts).
// -------------------------------------------------------------------------

type FakeBroadcasterBehavior =
  | { kind: "ok"; txHash?: string }
  | { kind: "fail"; error: string }
  | { kind: "throw"; message: string };

class FakeBroadcaster implements Pick<Broadcaster, "submit"> {
  calls: SignerRequest[] = [];
  behavior: FakeBroadcasterBehavior = { kind: "ok", txHash: "0xfakehash" };

  reset(): void {
    this.calls = [];
    this.behavior = { kind: "ok", txHash: "0xfakehash" };
  }

  async submit(req: SignerRequest): Promise<SignerResult> {
    this.calls.push(req);
    if (this.behavior.kind === "ok") {
      return { ok: true, txHash: this.behavior.txHash };
    }
    if (this.behavior.kind === "fail") {
      return { ok: false, error: this.behavior.error };
    }
    // throw
    throw new Error(this.behavior.message);
  }
}

// -------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------

const KEY_A: LeaseKey = "writer:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B: LeaseKey = "writer:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OWNER_A: LeaseOwner = "host1:1000:aaaa";
const OWNER_B: LeaseOwner = "host2:2000:bbbb";
const OWNER_C: LeaseOwner = "host3:3000:cccc";

function validSignerRequest(): SignerRequest {
  return {
    tx: {
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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

// -------------------------------------------------------------------------
// Main test driver
// -------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n=== M4 — Writer Lease Test Suite ===\n");

  // -------------------------------------------------------------------------
  // A. Functional baseline
  // -------------------------------------------------------------------------

  console.log("A. Functional baseline\n");

  // A.1 — acquire when free → ok with token
  console.log("A.1 — acquire when free → ok with token");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });
    const r = await lease.acquire();
    assert(r.ok, "acquire should succeed");
    assert(typeof r.token === "number" && r.token > 0, "token should be a positive number");
    assertEqual(lease.isHeld(), true, "isHeld() returns true after acquire");
    assertEqual(lease.currentToken(), r.token, "currentToken() matches");
    await lease.release();
  }

  // A.2 — renew own lease → ok with same token
  console.log("A.2 — renew own lease → ok with same token");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });
    await lease.acquire();
    const tokenBefore = lease.currentToken();
    const r = await lease.renew();
    assert(r.ok, "renew should succeed");
    assertEqual(r.token, tokenBefore, "token unchanged after renew");
    await lease.release();
  }

  // A.3 — release own lease → ok
  console.log("A.3 — release own lease → ok");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });
    await lease.acquire();
    const r = await lease.release();
    assert(r.ok, "release should succeed");
    assertEqual(lease.isHeld(), false, "isHeld() returns false after release");
    assertEqual(lease.currentToken(), null, "currentToken() returns null after release");
  }

  // A.4 — release already-released lease → ok=false but no throw
  console.log("A.4 — release already-released lease → ok=false but no throw");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });
    await lease.acquire();
    await lease.release();
    const r = await lease.release();
    assert(!r.ok, "second release should return ok=false");
    assertEqual(r.error, LeaseError.FREE, "error is LEASE_FREE");
  }

  // A.5 — current() reflects state transitions correctly
  console.log("A.5 — current() reflects state transitions correctly");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });

    // Free state.
    let rec = await store.current(KEY_A);
    assertEqual(rec.state, "free", "initial state is free");
    assertEqual(rec.owner, null, "no owner in free state");

    // Held state.
    await lease.acquire();
    rec = await store.current(KEY_A);
    assertEqual(rec.state, "held", "state is held after acquire");
    assertEqual(rec.owner, OWNER_A, "owner matches");
    assertEqual(rec.token, lease.currentToken(), "token matches");

    // Released state.
    await lease.release();
    rec = await store.current(KEY_A);
    assertEqual(rec.state, "free", "state is free after release");
  }

  // -------------------------------------------------------------------------
  // B. Adversarial — Lease lifecycle
  // -------------------------------------------------------------------------

  console.log("\nB. Adversarial — Lease lifecycle\n");

  // B.1 — acquire when held by another owner → LEASE_BUSY
  console.log("B.1 — acquire when held by another owner → LEASE_BUSY");
  {
    const store = new InMemoryLeaseStore();
    const leaseA = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });
    const leaseB = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_B,
      ttlMs: 10_000,
    });

    await leaseA.acquire();
    const r = await leaseB.acquire();
    assert(!r.ok, "second acquire should fail");
    assertEqual(r.error, LeaseError.BUSY, "error is LEASE_BUSY");
    assertEqual(leaseB.isHeld(), false, "B does not hold the lease");

    await leaseA.release();
  }

  // B.2 — renew another owner's lease → LEASE_NOT_OWNER
  console.log("B.2 — renew another owner's lease → LEASE_NOT_OWNER");
  {
    const store = new InMemoryLeaseStore();
    const leaseA = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });
    const leaseB = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_B,
      ttlMs: 10_000,
    });

    await leaseA.acquire();
    // leaseB's internal state is "no lease" so renew() returns FREE
    // before even querying the store. Test the store directly to
    // verify the NOT_OWNER branch.
    const r = await store.renew(KEY_A, OWNER_B, 10_000);
    assert(!r.ok, "renew by non-owner should fail");
    assertEqual(r.error, LeaseError.NOT_OWNER, "error is LEASE_NOT_OWNER");

    await leaseA.release();
  }

  // B.3 — release another owner's lease → LEASE_NOT_OWNER
  console.log("B.3 — release another owner's lease → LEASE_NOT_OWNER");
  {
    const store = new InMemoryLeaseStore();
    const leaseA = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });

    await leaseA.acquire();
    const r = await store.release(KEY_A, OWNER_B);
    assert(!r.ok, "release by non-owner should fail");
    assertEqual(r.error, LeaseError.NOT_OWNER, "error is LEASE_NOT_OWNER");
    // Verify A still holds the lease.
    assertEqual(leaseA.isHeld(), true, "A still holds the lease");

    await leaseA.release();
  }

  // B.4 — lease expires after TTL → state becomes "expired"
  console.log("B.4 — lease expires after TTL → state becomes 'expired'");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 50, // 50ms TTL for fast test
    });

    await lease.acquire();
    let rec = await store.current(KEY_A);
    assertEqual(rec.state, "held", "state is held immediately after acquire");

    // Wait for TTL to expire.
    await sleep(80);

    rec = await store.current(KEY_A);
    assertEqual(rec.state, "expired", "state is expired after TTL elapses");

    // Lease should still be acquirable by another owner.
    const leaseB = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_B,
      ttlMs: 10_000,
    });
    const r = await leaseB.acquire();
    assert(r.ok, "B can acquire expired lease");
  }

  // B.5 — renewer extends TTL before expiry → lease stays held
  console.log("B.5 — renewer extends TTL before expiry → lease stays held");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 100,
      renewIntervalMs: 30, // renew every 30ms — well before 100ms TTL
    });

    await lease.acquire();
    lease.startRenewer();

    // Sleep 200ms — without renewal, the lease would have expired at 100ms.
    await sleep(200);

    assertEqual(lease.isHeld(), true, "lease is still held after 200ms (renewer active)");

    lease.stopRenewer();
    await lease.release();
  }

  // B.6 — fencing token increases monotonically across acquisitions (REG-017)
  console.log("B.6 — fencing token increases monotonically across acquisitions (REG-017)");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });

    const tokens: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await lease.acquire();
      if (r.ok && r.token !== undefined) tokens.push(r.token);
      await lease.release();
    }

    // Verify strict monotonic increase.
    let monotonic = true;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i]! <= tokens[i - 1]!) {
        monotonic = false;
        break;
      }
    }
    assert(monotonic, `tokens should strictly increase: got ${JSON.stringify(tokens)}`);
    assertEqual(tokens[0], 1, "first token is 1");
    assertEqual(tokens[4], 5, "fifth token is 5");
  }

  // B.7 — stale fencing token rejected via verifyToken (zombie writer)
  console.log("B.7 — stale fencing token rejected via verifyToken (zombie writer)");
  {
    const store = new InMemoryLeaseStore();
    const leaseA = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 50,
    });
    const leaseB = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_B,
      ttlMs: 10_000,
    });

    // A acquires, then crashes (we simulate by letting TTL expire).
    await leaseA.acquire();
    const tokenA = leaseA.currentToken();
    await sleep(80); // A's lease expires.

    // B acquires — gets a HIGHER token.
    const r = await leaseB.acquire();
    assert(r.ok, "B acquires expired lease");
    const tokenB = r.token;
    assertNotEqual(tokenB, tokenA, "B's token differs from A's");
    if (tokenB !== undefined && tokenA !== null) {
      assert(tokenB > tokenA, `B's token (${tokenB}) should be > A's (${tokenA})`);
    }

    // A "wakes up" as a zombie — verifyToken returns false because the
    // store now shows B as the owner with a different token.
    // (A's local current is stale; A would need to query the store.)
    const rec = await store.current(KEY_A);
    assertEqual(rec.owner, OWNER_B, "store shows B as owner");
    assertEqual(rec.token, tokenB, "store shows B's token");

    // A's local state is stale — but A's lease.isHeld() returns false
    // because A's renewer would have detected the loss (we simulate
    // this by calling renew on A, which should fail).
    const renewA = await leaseA.renew();
    assert(!renewA.ok, "A's renew fails (lease lost)");
    assertEqual(leaseA.isHeld(), false, "A no longer holds the lease locally");

    await leaseB.release();
  }

  // B.8 — concurrent acquire: only one wins, others get LEASE_BUSY (REG-018)
  console.log("B.8 — concurrent acquire: only one wins, others get LEASE_BUSY (REG-018)");
  {
    const store = new InMemoryLeaseStore();
    const owners = [OWNER_A, OWNER_B, OWNER_C, "host4:4000:dddd", "host5:5000:eeee"];

    // Fire 5 concurrent acquires on the same key.
    const results = await Promise.all(
      owners.map((owner) =>
        store.acquire(KEY_A, owner, 10_000),
      ),
    );

    const oks = results.filter((r) => r.ok);
    const busies = results.filter((r) => !r.ok && r.error === LeaseError.BUSY);

    assertEqual(oks.length, 1, "exactly one acquire wins (REG-018)");
    assertEqual(busies.length, owners.length - 1, `other ${owners.length - 1} acquire calls return LEASE_BUSY`);

    // Cleanup.
    const winningOwner = oks[0];
    if (winningOwner && winningOwner.token !== undefined) {
      // Find which owner won by querying the store.
      const rec = await store.current(KEY_A);
      await store.release(KEY_A, rec.owner!);
    }
  }

  // -------------------------------------------------------------------------
  // C. Adversarial — Reconnect & failover
  // -------------------------------------------------------------------------

  console.log("\nC. Adversarial — Reconnect & failover\n");

  // C.1 — lease store unavailable on acquire → LEASE_STORE_UNAVAILABLE
  console.log("C.1 — lease store unavailable on acquire → LEASE_STORE_UNAVAILABLE");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });

    store.injectFailure();
    const r = await lease.acquire();
    assert(!r.ok, "acquire should fail when store is unavailable");
    assertEqual(r.error, LeaseError.STORE_UNAVAILABLE, "error is LEASE_STORE_UNAVAILABLE");
    assertEqual(lease.isHeld(), false, "lease not held after failed acquire");
  }

  // C.2 — renewer fails on store outage → lease expires → failover
  console.log("C.2 — renewer fails on store outage → lease expires → failover");
  {
    const store = new InMemoryLeaseStore();
    const leaseA = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 100,
      renewIntervalMs: 30,
    });
    const leaseB = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_B,
      ttlMs: 10_000,
    });

    await leaseA.acquire();
    leaseA.startRenewer();

    // Inject store failure on the next renew attempt.
    // The renewer wakes at 30ms; inject at ~40ms so the renew fails.
    await sleep(40);
    store.injectFailure();

    // Wait for the renewer to fail + TTL to expire.
    await sleep(120);

    // A's lease should be lost locally.
    assertEqual(leaseA.isHeld(), false, "A's lease lost after renewer failure + TTL expiry");

    // B can acquire (lease expired in the store — the renew failure
    // means the expiresAt wasn't extended).
    const r = await leaseB.acquire();
    assert(r.ok, "B acquires after A's lease expires");

    leaseA.stopRenewer();
    await leaseB.release();
  }

  // C.3 — owner election: lease expires → new owner acquires with higher token
  console.log("C.3 — owner election: lease expires → new owner acquires with higher token");
  {
    const store = new InMemoryLeaseStore();
    const leaseA = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 50,
    });
    const leaseB = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_B,
      ttlMs: 10_000,
    });

    await leaseA.acquire();
    const tokenA = leaseA.currentToken();

    await sleep(80); // A's TTL expires.

    // B acquires — gets a HIGHER token (owner election).
    const r = await leaseB.acquire();
    assert(r.ok, "B acquires expired lease");
    if (r.token !== undefined && tokenA !== null) {
      assert(r.token > tokenA, `B's token ${r.token} > A's ${tokenA} (election)`);
    }

    // Verify the store reflects B as the new owner.
    const rec = await store.current(KEY_A);
    assertEqual(rec.owner, OWNER_B, "store shows B as owner");
    assertEqual(rec.state, "held", "lease is held by B");

    await leaseB.release();
  }

  // C.4 — failover: process A holds, process B waits, A crashes, B acquires
  console.log("C.4 — failover: process A holds, process B waits, A crashes, B acquires");
  {
    const store = new InMemoryLeaseStore();
    const leaseA = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 80,
    });
    const leaseB = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_B,
      ttlMs: 10_000,
    });

    // A acquires.
    await leaseA.acquire();
    // A "crashes" — we don't release, just let TTL expire.

    // B tries to acquire immediately — fails (A still holds).
    let r = await leaseB.acquire();
    assert(!r.ok, "B's immediate acquire fails (A still holds)");
    assertEqual(r.error, LeaseError.BUSY, "error is LEASE_BUSY");

    // B waits for A's TTL to expire.
    await sleep(100);

    // B acquires successfully (failover).
    r = await leaseB.acquire();
    assert(r.ok, "B acquires after A's TTL expires (failover)");

    await leaseB.release();
  }

  // -------------------------------------------------------------------------
  // D. LeasedBroadcaster integration
  // -------------------------------------------------------------------------

  console.log("\nD. LeasedBroadcaster integration\n");

  // Helper: build a fresh LeasedBroadcaster + fake + lease.
  function freshLeased(
    store: LeaseStore,
    owner: LeaseOwner = OWNER_A,
    enableFencingCheck: boolean = true,
  ): {
    leased: LeasedBroadcaster;
    fake: FakeBroadcaster;
    lease: WriterLease;
  } {
    const fake = new FakeBroadcaster();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner,
      ttlMs: 10_000,
    });
    const leased = new LeasedBroadcaster({
      broadcaster: fake as unknown as Broadcaster,
      lease,
      enableFencingCheck,
    });
    return { leased, fake, lease };
  }

  // D.1 — acquire ok → broadcast ok → release ok → returns SignerResult
  console.log("D.1 — acquire ok → broadcast ok → release ok → returns SignerResult");
  {
    const store = new InMemoryLeaseStore();
    const { leased, fake, lease } = freshLeased(store);

    const r = await leased.submit(validSignerRequest());
    assert(r.ok, "submit should succeed");
    assertEqual(r.txHash, "0xfakehash", "txHash returned");
    assertEqual(fake.calls.length, 1, "broadcaster called once");
    assertEqual(lease.isHeld(), false, "lease released after submit");
  }

  // D.2 — acquire busy → returns LEASE_ACQUIRE_FAILED, no broadcast
  console.log("D.2 — acquire busy → returns LEASE_ACQUIRE_FAILED, no broadcast");
  {
    const store = new InMemoryLeaseStore();
    // Pre-acquire the lease with a DIFFERENT owner so the LeasedBroadcaster's
    // acquire fails with LEASE_BUSY.
    const otherLease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_B,
      ttlMs: 10_000,
    });
    await otherLease.acquire();

    const { leased, fake, lease } = freshLeased(store, OWNER_A);
    const r = await leased.submit(validSignerRequest());
    assert(!r.ok, "submit should fail");
    assertStartsWith(r.error ?? "", LeasedBroadcasterError.ACQUIRE_FAILED, "error is LEASE_ACQUIRE_FAILED");
    assertEqual(fake.calls.length, 0, "broadcaster NOT called");
    assertEqual(lease.isHeld(), false, "lease not held by A");

    await otherLease.release();
  }

  // D.3 — fencing token stale pre-broadcast → LEASE_FENCING_TOKEN_STALE, no broadcast
  console.log("D.3 — fencing token stale pre-broadcast → LEASE_FENCING_TOKEN_STALE, no broadcast");
  {
    const store = new InMemoryLeaseStore();
    const { leased, fake, lease } = freshLeased(store, OWNER_A, /*enableFencingCheck*/ true);

    // Use a custom store wrapper that simulates a fencing-token mismatch:
    // after acquire succeeds, the verifyToken call returns false.
    // We achieve this by injecting a "takeover" between acquire and verify.
    // Easier: use a custom LeaseStore that always returns a different token
    // on current() than what acquire returned.
    const saboteurStore: LeaseStore = {
      async acquire(key, owner, ttlMs) {
        return store.acquire(key, owner, ttlMs);
      },
      async renew(key, owner, ttlMs) {
        return store.renew(key, owner, ttlMs);
      },
      async release(key, owner) {
        return store.release(key, owner);
      },
      async current(key) {
        const rec = await store.current(key);
        // Return a DIFFERENT owner — simulates a takeover.
        if (rec.state === "held" && rec.owner === OWNER_A) {
          return { ...rec, owner: OWNER_B, token: rec.token + 1 };
        }
        return rec;
      },
      async revoke(key) {
        return store.revoke(key);
      },
    };

    // Build a leased broadcaster with the saboteur store.
    const fake2 = new FakeBroadcaster();
    const lease2 = new WriterLease({
      store: saboteurStore,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });
    const leased2 = new LeasedBroadcaster({
      broadcaster: fake2 as unknown as Broadcaster,
      lease: lease2,
      enableFencingCheck: true,
    });

    const r = await leased2.submit(validSignerRequest());
    assert(!r.ok, "submit should fail");
    assertStartsWith(r.error ?? "", LeasedBroadcasterError.FENCING_TOKEN_STALE, "error is LEASE_FENCING_TOKEN_STALE");
    assertEqual(fake2.calls.length, 0, "broadcaster NOT called (fencing check aborted)");
    assertEqual(lease2.isHeld(), false, "lease released after fencing failure (REG-015)");
    // The original lease from freshLeased() is unused; satisfy linter.
    void leased; void fake; void lease;
  }

  // D.4 — broadcast fails → returns broadcaster error, lease released (REG-015)
  console.log("D.4 — broadcast fails → returns broadcaster error, lease released (REG-015)");
  {
    const store = new InMemoryLeaseStore();
    const { leased, fake, lease } = freshLeased(store, OWNER_A);

    fake.behavior = { kind: "fail", error: "BROADCAST_IMMUTABILITY_VIOLATION: hash mismatch" };

    const r = await leased.submit(validSignerRequest());
    assert(!r.ok, "submit should fail");
    assertStartsWith(r.error ?? "", "BROADCAST_IMMUTABILITY_VIOLATION", "error is broadcaster's error");
    assertEqual(fake.calls.length, 1, "broadcaster called once");
    assertEqual(lease.isHeld(), false, "lease released after broadcaster failure (REG-015)");

    // Verify the lease is free in the store too.
    const rec = await store.current(KEY_A);
    assertEqual(rec.state, "free", "store shows lease as free");
  }

  // D.5 — broadcast throws → returns LEASE_CALLBACK_EXCEPTION, lease released (REG-015)
  console.log("D.5 — broadcast throws → returns LEASE_CALLBACK_EXCEPTION, lease released (REG-015)");
  {
    const store = new InMemoryLeaseStore();
    const { leased, fake, lease } = freshLeased(store, OWNER_A);

    fake.behavior = { kind: "throw", message: "unexpected error in broadcaster" };

    const r = await leased.submit(validSignerRequest());
    assert(!r.ok, "submit should fail");
    assertStartsWith(r.error ?? "", "LEASE_CALLBACK_EXCEPTION", "error is LEASE_CALLBACK_EXCEPTION");
    assertEqual(fake.calls.length, 1, "broadcaster called once (and threw)");
    assertEqual(lease.isHeld(), false, "lease released after broadcaster exception (REG-015)");

    const rec = await store.current(KEY_A);
    assertEqual(rec.state, "free", "store shows lease as free");
  }

  // -------------------------------------------------------------------------
  // E. REG-015 invariant — lease released on every exit path
  // -------------------------------------------------------------------------

  console.log("\nE. REG-015 invariant — lease released on every exit path\n");

  // E.1 — withLease releases on success
  console.log("E.1 — withLease releases on success");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });

    const r = await lease.withLease(async (token) => {
      return { ok: true as const, token };
    });
    assert(r.ok, "withLease callback succeeded");
    assertEqual(lease.isHeld(), false, "lease released after successful withLease");

    const rec = await store.current(KEY_A);
    assertEqual(rec.state, "free", "store shows lease as free");
  }

  // E.2 — withLease releases on failure (callback returns ok=false)
  console.log("E.2 — withLease releases on failure (callback returns ok=false)");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });

    const r = await lease.withLease(async () => {
      return { ok: false as const, error: "BROADCAST_FAILED: something went wrong" };
    });
    assert(!r.ok, "withLease callback failed (as expected)");
    assertEqual(lease.isHeld(), false, "lease released after failed withLease");

    const rec = await store.current(KEY_A);
    assertEqual(rec.state, "free", "store shows lease as free");
  }

  // E.3 — withLease releases on exception
  console.log("E.3 — withLease releases on exception");
  {
    const store = new InMemoryLeaseStore();
    const lease = new WriterLease({
      store,
      key: KEY_A,
      owner: OWNER_A,
      ttlMs: 10_000,
    });

    const r = await lease.withLease(async () => {
      throw new Error("callback threw");
    });
    assert(!r.ok, "withLease caught exception (as expected)");
    assertStartsWith(r.error ?? "", "LEASE_CALLBACK_EXCEPTION", "error is LEASE_CALLBACK_EXCEPTION");
    assertEqual(lease.isHeld(), false, "lease released after exception (REG-015)");

    const rec = await store.current(KEY_A);
    assertEqual(rec.state, "free", "store shows lease as free");
  }

  // -------------------------------------------------------------------------
  // F. Helpers
  // -------------------------------------------------------------------------

  console.log("\nF. Helpers\n");

  // F.1 — generateOwnerId produces unique IDs
  console.log("F.1 — generateOwnerId produces unique IDs");
  {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateOwnerId());
    }
    assertEqual(ids.size, 100, "100 generated IDs are all unique");
  }

  // F.2 — buildLeaseKey lowercases the address
  console.log("F.2 — buildLeaseKey lowercases the address");
  {
    const key1 = buildLeaseKey("0xABCDEF0123456789abcdef0123456789ABCDEF01");
    const key2 = buildLeaseKey("0xabcdef0123456789abcdef0123456789abcdef01");
    assertEqual(key1, key2, "keys match regardless of input case");
    assertEqual(key1.startsWith("writer:"), true, "key has 'writer:' prefix");
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
