/**
 * H0.3 — Hash-chained audit log test suite.
 *
 * Tests the AuditLog class directly (not through the signer process —
 * that's covered by the integration tests which now also exercise the
 * hash chain implicitly via the audit file).
 *
 * 8 scenarios:
 *   1. Append + verify: a fresh log with 3 entries verifies clean.
 *   2. Genesis entry has prevHash=null, seq=1.
 *   3. Chain linkage: entry N's prevHash === entry N-1's hash.
 *   4. Tamper detection: modifying an entry's payload breaks verification.
 *   5. Deletion detection: removing an entry breaks verification (seq gap).
 *   6. Hash recomputation: the stored hash matches SHA-256 of canonical JSON.
 *   7. init() seeds lastHash from an existing file (append after init continues the chain).
 *   8. Empty/nonexistent file: verify returns { ok: true, entries: 0 }.
 *
 * Run: npx tsx scripts/test-h0-audit-hashchain.ts
 */

import { AuditLog, AuditEntry } from "../src/lib/audit/audit-log";
import { createHash } from "crypto";
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ PASS`);
    pass++;
  } else {
    console.log(`  ✗ FAIL: ${msg}`);
    fail++;
    process.exitCode = 1;
  }
}

// Create a temp directory for test files.
const tmpDir = mkdtempSync(join(tmpdir(), "h0-audit-test-"));

function tmpPath(name: string): string {
  return join(tmpDir, name);
}

console.log("\n=== H0.3 — Hash-Chained Audit Log Test Suite ===\n");

// ---------------------------------------------------------------------------
// Test 1: Append + verify clean.
// ---------------------------------------------------------------------------

console.log("  Append 3 entries to a fresh log → verify returns ok with 3 entries...");
{
  const path = tmpPath("t1.log");
  const log = new AuditLog(path);
  log.init();
  log.append("vault_unlocked", { sourceIp: "127.0.0.1", walletCount: 3 });
  log.append("vault_locked", { reason: "manual", sourceIp: "127.0.0.1" });
  log.append("vault_zeroized_on_disconnect", { walletsWiped: 3, exchangesWiped: 1 });
  const result = AuditLog.verify(path);
  assert(result.ok && result.entries === 3, `expected ok=true entries=3; got ${JSON.stringify(result)}`);
}

// ---------------------------------------------------------------------------
// Test 2: Genesis entry has prevHash=null, seq=1.
// ---------------------------------------------------------------------------

console.log("  Genesis entry has prevHash=null, seq=1...");
{
  const path = tmpPath("t2.log");
  const log = new AuditLog(path);
  log.init();
  const entry = log.append("test_event", { foo: "bar" });
  assert(
    entry.seq === 1 && entry.prevHash === null,
    `expected seq=1 prevHash=null; got seq=${entry.seq} prevHash=${entry.prevHash}`
  );
}

// ---------------------------------------------------------------------------
// Test 3: Chain linkage — entry N's prevHash === entry N-1's hash.
// ---------------------------------------------------------------------------

console.log("  Chain linkage: entry N's prevHash === entry N-1's hash...");
{
  const path = tmpPath("t3.log");
  const log = new AuditLog(path);
  log.init();
  const e1 = log.append("event_1", { n: 1 });
  const e2 = log.append("event_2", { n: 2 });
  const e3 = log.append("event_3", { n: 3 });
  assert(
    e2.prevHash === e1.hash && e3.prevHash === e2.hash,
    `expected e2.prevHash=e1.hash, e3.prevHash=e2.hash; got e2.prevHash=${e2.prevHash?.slice(0, 8)} e1.hash=${e1.hash.slice(0, 8)} e3.prevHash=${e3.prevHash?.slice(0, 8)} e2.hash=${e2.hash.slice(0, 8)}`
  );
}

// ---------------------------------------------------------------------------
// Test 4: Tamper detection — modifying an entry's payload breaks verification.
// ---------------------------------------------------------------------------

console.log("  Tamper detection: modifying entry 1's payload breaks verification...");
{
  const path = tmpPath("t4.log");
  const log = new AuditLog(path);
  log.init();
  log.append("event_1", { n: 1 });
  log.append("event_2", { n: 2 });
  log.append("event_3", { n: 3 });

  // Read the file, modify the first entry's payload, write back.
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n").filter((l) => l.length > 0);
  const firstEntry = JSON.parse(lines[0]) as AuditEntry;
  firstEntry.payload = { n: 999 }; // TAMPER
  lines[0] = JSON.stringify(firstEntry);
  writeFileSync(path, lines.join("\n") + "\n");

  const result = AuditLog.verify(path);
  assert(
    !result.ok && (result.brokenAtSeq === 1 || result.brokenAtSeq === 2),
    `expected ok=false brokenAtSeq=1 (hash mismatch) or 2 (prevHash mismatch); got ${JSON.stringify(result)}`
  );
}

// ---------------------------------------------------------------------------
// Test 5: Deletion detection — removing an entry breaks verification.
// ---------------------------------------------------------------------------

console.log("  Deletion detection: removing entry 2 breaks verification (seq gap)...");
{
  const path = tmpPath("t5.log");
  const log = new AuditLog(path);
  log.init();
  log.append("event_1", { n: 1 });
  log.append("event_2", { n: 2 });
  log.append("event_3", { n: 3 });

  // Read the file, delete the second entry, write back.
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n").filter((l) => l.length > 0);
  // Remove line index 1 (entry 2).
  lines.splice(1, 1);
  writeFileSync(path, lines.join("\n") + "\n");

  const result = AuditLog.verify(path);
  assert(
    !result.ok,
    `expected ok=false (seq gap or prevHash mismatch); got ${JSON.stringify(result)}`
  );
}

// ---------------------------------------------------------------------------
// Test 6: Hash recomputation — stored hash matches SHA-256 of canonical JSON.
// ---------------------------------------------------------------------------

console.log("  Hash recomputation: stored hash matches SHA-256 of canonical JSON...");
{
  const path = tmpPath("t6.log");
  const log = new AuditLog(path);
  log.init();
  const entry = log.append("test_event", { foo: "bar", baz: 42 });

  // Manually recompute the hash (using the same canonical form as computeEntryHash:
  // sorted top-level keys, nested objects fully included, no replacer array).
  const { hash, ...entryWithoutHash } = entry;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(entryWithoutHash).sort()) {
    sorted[key] = (entryWithoutHash as Record<string, unknown>)[key];
  }
  const canonical = JSON.stringify(sorted);
  const expected = createHash("sha256").update(canonical, "utf8").digest("hex");
  assert(
    hash === expected,
    `expected hash=${expected.slice(0, 16)}…; got hash=${hash.slice(0, 16)}…`
  );
}

// ---------------------------------------------------------------------------
// Test 7: init() seeds lastHash from an existing file.
// ---------------------------------------------------------------------------

console.log("  init() seeds lastHash — append after init continues the chain...");
{
  const path = tmpPath("t7.log");

  // First session: write 2 entries.
  const log1 = new AuditLog(path);
  log1.init();
  const e1 = log1.append("session1_event1", { n: 1 });
  const e2 = log1.append("session1_event2", { n: 2 });

  // Second session: init from the existing file, append 1 more entry.
  const log2 = new AuditLog(path);
  const initResult = log2.init();
  const e3 = log2.append("session2_event1", { n: 3 });

  assert(
    initResult.entries === 2 && initResult.tailHash === e2.hash && e3.prevHash === e2.hash && e3.seq === 3,
    `expected init.entries=2, init.tailHash=e2.hash, e3.prevHash=e2.hash, e3.seq=3; got init.entries=${initResult.entries}, e3.prevHash=${e3.prevHash?.slice(0, 8)}, e2.hash=${e2.hash.slice(0, 8)}, e3.seq=${e3.seq}`
  );

  // Verify the whole chain is intact.
  const result = AuditLog.verify(path);
  assert(result.ok && result.entries === 3, `expected ok=true entries=3; got ${JSON.stringify(result)}`);
}

// ---------------------------------------------------------------------------
// Test 8: Empty/nonexistent file — verify returns ok with 0 entries.
// ---------------------------------------------------------------------------

console.log("  Empty/nonexistent file → verify returns ok with 0 entries...");
{
  const path = tmpPath("t8-nonexistent.log");
  const result = AuditLog.verify(path);
  assert(
    result.ok && result.entries === 0 && result.tailHash === null,
    `expected ok=true entries=0 tailHash=null; got ${JSON.stringify(result)}`
  );
}

// ---------------------------------------------------------------------------
// Test 9: Hash-chained audit entries persist across signer restarts (integration).
// This simulates: signer boots → writes entries → exits → boots again →
// writes more entries → the full chain verifies.
// ---------------------------------------------------------------------------

console.log("  Cross-session chain integrity: 2 sessions × 2 entries = 4 entries, all verify...");
{
  const path = tmpPath("t9.log");

  // Session 1.
  const log1 = new AuditLog(path);
  log1.init();
  log1.append("vault_unlocked", { sourceIp: "127.0.0.1", walletCount: 2 });
  log1.append("vault_locked", { reason: "manual" });

  // Session 2 (simulates signer restart — init reads the existing chain).
  const log2 = new AuditLog(path);
  log2.init();
  log2.append("vault_unlocked", { sourceIp: "127.0.0.1", walletCount: 2 });
  log2.append("vault_zeroized_on_disconnect", { walletsWiped: 2 });

  const result = AuditLog.verify(path);
  assert(
    result.ok && result.entries === 4 && result.tailHash !== null,
    `expected ok=true entries=4 tailHash!=null; got ${JSON.stringify(result)}`
  );
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

try {
  rmSync(tmpDir, { recursive: true, force: true });
} catch {
  // Best-effort.
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
