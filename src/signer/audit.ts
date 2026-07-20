// src/signer/audit.ts
//
// H0.3: Signer-side hash-chained audit log singleton.
//
// The signer writes security-critical events (unlock, lock, zeroize) to a
// hash-chained append-only file. The hash chain makes tampering detectable:
// each entry's `hash` field is SHA-256 of the entry's canonical JSON, and
// the next entry's `prevHash` references it. An attacker with filesystem
// access who modifies or deletes an entry breaks the chain at the next
// entry — `AuditLog.verify()` detects this.
//
// This is SEPARATE from the AppLog (DB) channel used by the web process.
// The AppLog is for operational visibility (dashboard feed, queryable);
// the file-based audit log is for tamper-evident security audit. Key
// security events are written to BOTH channels.
//
// The audit log path is provided by the parent process via the
// SIGNER_AUDIT_LOG env var. If unset, the signer skips file-based audit
// (the DB channel still works). This is intentional — dev environments
// don't need the file-based audit log, but production deployments MUST
// set the env var.

import { AuditLog, type VerifyResult } from "@/lib/audit/audit-log";
import { SIGNER_ENV } from "@/lib/signer-protocol";

let signerAudit: AuditLog | null = null;
let initResult: { initialized: boolean; path: string | null; verify: VerifyResult | null } = {
  initialized: false,
  path: null,
  verify: null,
};

/**
 * Initialize the signer's audit log. Reads the existing file to seed the
 * hash chain, then verifies the chain integrity. If the chain is broken,
 * logs loudly to stderr (but still boots — the operator needs to
 * investigate, and blocking boot would prevent the signer from starting
 * at all, which is worse).
 *
 * Called once at signer boot from main.ts.
 */
export function initSignerAuditLog(): void {
  if (initResult.initialized) return;
  const path = process.env[SIGNER_ENV.AUDIT_LOG_PATH];
  if (!path) {
    // No audit log configured — dev mode. Skip.
    initResult = { initialized: true, path: null, verify: null };
    return;
  }

  const log = new AuditLog(path);
  const { entries, tailHash } = log.init();

  // Verify the chain integrity.
  const verifyResult = AuditLog.verify(path);
  if (!verifyResult.ok) {
    process.stderr.write(
      `[signer] CRITICAL: audit log chain BROKEN at seq=${verifyResult.brokenAtSeq} — ${verifyResult.reason}. The log may have been tampered with. INVESTIGATE before proceeding.\n`
    );
  } else {
    process.stderr.write(
      `[signer] audit log initialized — ${entries} entries, tail=${tailHash?.slice(0, 16) ?? "null"}…\n`
    );
  }

  signerAudit = log;
  initResult = { initialized: true, path, verify: verifyResult };
}

/**
 * Get the signer's audit log instance. Returns null if no audit log is
 * configured (dev mode) or if init() hasn't been called yet.
 */
export function getSignerAuditLog(): AuditLog | null {
  return signerAudit;
}

/**
 * Append an audit entry. No-op if no audit log is configured.
 */
export function auditEvent(
  event: string,
  payload: Record<string, unknown>
): void {
  if (!signerAudit) return;
  try {
    signerAudit.append(event, payload);
  } catch (err) {
    // Audit log write failure is a CRITICAL security event — the operator
    // must investigate. We log to stderr but do NOT crash the signer
    // (crashing would prevent the zeroize-on-disconnect entry from being
    // written, which is worse).
    process.stderr.write(
      `[signer] CRITICAL: audit log write FAILED for event "${event}" — ${String(err)}. INVESTIGATE.\n`
    );
  }
}

/**
 * Get the init result (for diagnostics + tests).
 */
export function getAuditInitResult(): typeof initResult {
  return initResult;
}
