/**
 * H0.3 — Hash-chained append-only audit log.
 *
 * WHY THIS EXISTS:
 *   Before H0.3, the signer wrote audit entries to a flat file via
 *   `appendFileSync` — each line was a JSON object with no integrity
 *   protection. An attacker with filesystem access could:
 *     - Modify an entry (e.g. change "vault_zeroized_on_disconnect" to
 *       "vault_no_op") without detection.
 *     - Delete an entry (e.g. remove evidence of a failed unlock attempt).
 *     - Insert a forged entry (e.g. add a fake "vault_unlocked" event
 *       to make it look like the operator unlocked the vault).
 *
 *   This module adds a SHA-256 hash chain: each entry's `hash` field
 *   is the SHA-256 of the entry's canonical JSON (excluding `hash`).
 *   The next entry's `prevHash` field is the previous entry's `hash`.
 *   Tampering with any entry breaks the chain at the next entry —
 *   `verifyAuditLog(path)` detects this.
 *
 * THREAT MODEL:
 *   - Tamper DETECTION, not tamper PREVENTION. An attacker with write
 *     access to the audit log file can still modify it — but they must
 *     recompute every subsequent hash, which requires knowing the hash
 *     chain algorithm (this module). The defense is that the operator
 *     can run `verifyAuditLog` at any time and detect tampering.
 *   - For tamper PREVENTION, the operator should mirror the audit log
 *     to an append-only store (e.g. a syslog server with restricted
 *     write access) — out of scope for this module.
 *   - The hash chain does NOT protect against an attacker who deletes
 *     the ENTIRE file (the file just disappears). The operator should
 *     mirror the file off-host.
 *
 * DESIGN:
 *   - Each entry is a single line of canonical JSON (sorted keys, no
 *     whitespace) terminated by `\n`. This makes the file grep-able
 *     and diff-able.
 *   - The `hash` field is the SHA-256 hex of the entry's JSON WITHOUT
 *     the `hash` field. This prevents self-reference.
 *   - The `prevHash` field is the previous entry's `hash` (null for
 *     the genesis entry, seq=1).
 *   - The `seq` field is a monotonic counter starting at 1. Gaps in
 *     seq indicate deleted entries.
 *   - `init()` reads the existing file at boot to seed `lastHash` +
 *     `lastSeq`. If the file doesn't exist, it's created on the first
 *     `append()`.
 *   - `append()` is synchronous (uses appendFileSync) to guarantee
 *     the entry is flushed to disk before the function returns. This
 *     is critical for the zeroize-on-disconnect audit entry — if the
 *     process exits immediately after, an async write might be lost.
 *
 * PERFORMANCE:
 *   - append() is O(1) — it only reads the last line of the file (via
 *     `init()` caching lastHash + lastSeq) and appends one line.
 *   - verify() is O(N) — it reads the entire file. Intended for
 *     periodic offline verification, not per-request.
 */

import { createHash } from "crypto";
import { appendFileSync, existsSync, readFileSync, openSync, readSync, closeSync, statSync } from "node:fs";

export interface AuditEntry {
  seq: number;
  timestamp: string; // ISO 8601
  event: string;
  payload: Record<string, unknown>;
  prevHash: string | null; // null for genesis (seq=1)
  hash: string; // SHA-256 hex of this entry's canonical JSON (excluding hash)
}

export type VerifyResult =
  | { ok: true; entries: number; tailHash: string | null }
  | { ok: false; brokenAtSeq: number | null; reason: string; entries: number };

/**
 * Compute the SHA-256 hash of an audit entry's canonical JSON (excluding
 * the `hash` field). The canonical form uses sorted top-level keys and no
 * whitespace so the hash is deterministic across JSON serializers.
 *
 * CRITICAL: we must NOT use `JSON.stringify(entry, sortedKeys)` with a
 * replacer array — the replacer array form filters keys at ALL levels of
 * the object, not just the top level. That would drop nested keys inside
 * `payload` (e.g. `{ n: 1 }` would become `{}`), making the hash
 * independent of the payload content. Instead, we build a new top-level
 * object with sorted keys and serialize it normally (no replacer), so
 * nested objects are fully included in the hash.
 */
function computeEntryHash(entry: Omit<AuditEntry, "hash">): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(entry).sort()) {
    sorted[key] = (entry as Record<string, unknown>)[key];
  }
  const canonical = JSON.stringify(sorted);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Serialize an AuditEntry to a canonical JSON line (sorted top-level keys,
 * nested objects fully included). Used for writing to the file so that
 * the on-disk format matches the hash computation.
 */
function serializeEntry(entry: AuditEntry): string {
  const sorted: Record<string, unknown> = {};
  const record = entry as unknown as Record<string, unknown>;
  for (const key of Object.keys(entry).sort()) {
    sorted[key] = record[key];
  }
  return JSON.stringify(sorted);
}

/**
 * Read the last line of a file efficiently (without reading the whole
 * file into memory). Used at boot to seed lastHash + lastSeq.
 *
 * Returns null if the file is empty or doesn't exist.
 */
function readLastLine(path: string): string | null {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  if (stat.size === 0) return null;

  // Read the last 8KB — audit entries are small (< 1KB typically).
  // If the last line is longer than 8KB, fall back to reading the
  // whole file (rare for audit entries).
  const chunkSize = Math.min(8192, stat.size);
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(chunkSize);
    readSync(fd, buf, 0, chunkSize, stat.size - chunkSize);
    const content = buf.toString("utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) {
      // The last 8KB had no complete lines — fall back to full read.
      const full = readFileSync(path, "utf8");
      const fullLines = full.split("\n").filter((l) => l.length > 0);
      return fullLines.length > 0 ? fullLines[fullLines.length - 1] : null;
    }
    return lines[lines.length - 1];
  } finally {
    closeSync(fd);
  }
}

/**
 * Hash-chained append-only audit log.
 *
 * Usage:
 *   const log = new AuditLog("/path/to/audit.log");
 *   log.init(); // read existing file to seed lastHash + lastSeq
 *   log.append("vault_unlocked", { sourceIp: "127.0.0.1", walletCount: 3 });
 *   log.append("vault_locked", { reason: "manual", sourceIp: "127.0.0.1" });
 *   const result = AuditLog.verify("/path/to/audit.log");
 *   if (!result.ok) { console.error("AUDIT LOG TAMPERED:", result.reason); }
 */
export class AuditLog {
  private readonly path: string;
  private lastHash: string | null = null;
  private lastSeq: number = 0;
  private initialized = false;

  constructor(path: string) {
    this.path = path;
  }

  /**
   * Read the existing audit log file to seed lastHash + lastSeq.
   * MUST be called before append(). If the file doesn't exist, the
   * first append() will create it (with seq=1, prevHash=null).
   *
   * Returns { entries, tailHash } for informational purposes.
   */
  init(): { entries: number; tailHash: string | null } {
    const lastLine = readLastLine(this.path);
    if (lastLine) {
      try {
        const lastEntry = JSON.parse(lastLine) as AuditEntry;
        this.lastHash = lastEntry.hash;
        this.lastSeq = lastEntry.seq;
      } catch {
        // Corrupt last line — treat as fresh log to avoid breaking the
        // signer boot. The operator should run verify() to investigate.
        this.lastHash = null;
        this.lastSeq = 0;
      }
    }
    this.initialized = true;
    return { entries: this.lastSeq, tailHash: this.lastHash };
  }

  /**
   * Append a new audit entry. Computes the hash, writes the line
   * synchronously (flushed to disk before return).
   *
   * @param event   Event type string (e.g. "vault_unlocked").
   * @param payload Event-specific data (any JSON-serializable object).
   * @returns The full AuditEntry that was written.
   */
  append(event: string, payload: Record<string, unknown>): AuditEntry {
    if (!this.initialized) {
      throw new Error("AuditLog.append() called before init()");
    }
    const seq = this.lastSeq + 1;
    const entry: Omit<AuditEntry, "hash"> = {
      seq,
      timestamp: new Date().toISOString(),
      event,
      payload,
      prevHash: this.lastHash,
    };
    const hash = computeEntryHash(entry);
    const fullEntry: AuditEntry = { ...entry, hash };
    const line = serializeEntry(fullEntry) + "\n";
    appendFileSync(this.path, line, { encoding: "utf8" });
    this.lastHash = hash;
    this.lastSeq = seq;
    return fullEntry;
  }

  /**
   * Verify the integrity of an audit log file. Reads the entire file
   * and checks:
   *   1. Every line is valid JSON with the required fields.
   *   2. seq is monotonic starting at 1 (no gaps).
   *   3. prevHash matches the previous entry's hash.
   *   4. hash matches SHA-256 of the entry's canonical JSON (excluding hash).
   *
   * Returns { ok: true, entries, tailHash } if the chain is intact,
   * or { ok: false, brokenAtSeq, reason, entries } if tampering is
   * detected.
   */
  static verify(path: string): VerifyResult {
    if (!existsSync(path)) {
      return { ok: true, entries: 0, tailHash: null };
    }
    const content = readFileSync(path, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    let prevHash: string | null = null;
    let expectedSeq = 1;
    let entries = 0;
    let tailHash: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let entry: AuditEntry;
      try {
        entry = JSON.parse(line) as AuditEntry;
      } catch (err) {
        return {
          ok: false,
          brokenAtSeq: expectedSeq,
          reason: `line ${i + 1}: invalid JSON — ${String(err)}`,
          entries,
        };
      }
      // Check required fields.
      const required: (keyof AuditEntry)[] = ["seq", "timestamp", "event", "payload", "prevHash", "hash"];
      for (const field of required) {
        if (entry[field] === undefined) {
          return {
            ok: false,
            brokenAtSeq: entry.seq ?? expectedSeq,
            reason: `line ${i + 1}: missing field "${field}"`,
            entries,
          };
        }
      }
      // Check seq.
      if (entry.seq !== expectedSeq) {
        return {
          ok: false,
          brokenAtSeq: entry.seq,
          reason: `line ${i + 1}: expected seq=${expectedSeq}, got seq=${entry.seq} (gap or out-of-order)`,
          entries,
        };
      }
      // Check prevHash.
      if (entry.prevHash !== prevHash) {
        return {
          ok: false,
          brokenAtSeq: entry.seq,
          reason: `line ${i + 1}: prevHash mismatch (expected ${prevHash?.slice(0, 16) ?? "null"}…, got ${entry.prevHash?.slice(0, 16) ?? "null"}…) — chain broken by modification, deletion, or insertion`,
          entries,
        };
      }
      // Check hash.
      const { hash, ...entryWithoutHash } = entry;
      const recomputed = computeEntryHash(entryWithoutHash);
      if (recomputed !== hash) {
        return {
          ok: false,
          brokenAtSeq: entry.seq,
          reason: `line ${i + 1}: hash mismatch (expected ${recomputed.slice(0, 16)}…, got ${hash.slice(0, 16)}…) — entry was modified after writing`,
          entries,
        };
      }
      prevHash = hash;
      tailHash = hash;
      expectedSeq++;
      entries++;
    }

    return { ok: true, entries, tailHash };
  }
}
