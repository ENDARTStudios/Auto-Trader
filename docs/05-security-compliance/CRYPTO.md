# Cryptographic Guarantees — H0 Foundational Hardening Review

**Status:** H0.1–H0.4 implemented + tested. H0.5 is this document.
**Date:** 2026-07-14
**Scope:** The signer-isolated wallet/exchange credential storage system (`src/lib/trading/wallet-crypto.ts`, `src/lib/trading/kdf.ts`, `src/lib/trading/key-rotation.ts`, `src/lib/audit/audit-log.ts`, `src/signer/`).

---

## 1. Cryptographic primitives in use

### 1.1 Key derivation (KDF)

| Parameter | Value | Justification |
|-----------|-------|---------------|
| Algorithm | PBKDF2-HMAC-SHA256 | OWASP 2023 recommendation for PBKDF2. Argon2id is preferred (memory-hard, GPU-resistant) but requires a native dependency — deferred to a future H0.x patch. The versioned KDF architecture (H0.1) makes this migration possible without breaking existing blobs. |
| Iterations | 600,000 | OWASP 2023 minimum for PBKDF2-SHA256. At this count, a single derivation takes ~0.3s on typical hardware — acceptable for the signer (unlock is a rare event). |
| Key length | 32 bytes (256 bits) | Matches AES-256 key size. |
| Salt length | 16 bytes (128 bits) | NIST SP 800-132 minimum. Generated via `crypto.randomBytes` (CSPRNG). |
| Salt uniqueness | Per-blob random | A fresh salt is generated for every encryption via `generateSalt()`. No salt reuse across blobs. |

**Versioning (H0.1):** Each `EncryptedBlob` includes `kdfAlgo` (e.g. `"pbkdf2-sha256"`) and `kdfVersion` (currently `1`). Pre-H0 blobs lack these fields and default to `"pbkdf2-sha256"` v1 via `resolveKdfAlgo()`. The `deriveKey()` function dispatches on `kdfAlgo` — future algorithms (argon2id) plug in here.

### 1.2 Encryption

| Parameter | Value | Justification |
|-----------|-------|---------------|
| Algorithm | AES-256-GCM | Authenticated encryption (confidentiality + integrity). NIST-approved. Available in Node.js `crypto` module (OpenSSL-backed). |
| Key length | 256 bits | AES-256. |
| IV length | 12 bytes (96 bits) | NIST SP 800-38D recommendation for GCM. |
| IV uniqueness | Per-encryption random | Fresh IV via `generateIv()` for every encryption. 96-bit random IV gives negligible collision probability (< 2^-32 after 2^32 encryptions — far beyond this system's lifetime). |
| Auth tag | 128 bits | GCM default. Stored in the blob. |
| Tag verification | `decipher.setAuthTag(tag)` + `decipher.final()` | Throws if the tag doesn't match (wrong passphrase or tampered ciphertext). |

**Versioning (H0.2):** Each `EncryptedBlob` includes `encAlgo` (e.g. `"aes-256-gcm"`) and `encVersion` (currently `1`). Pre-H0 blobs default to `"aes-256-gcm"` v1 via `resolveEncAlgo()`. `decryptSecret()` validates `encAlgo`/`encVersion` against the current values and rejects unsupported algorithms.

### 1.3 Hash chain (audit log)

| Parameter | Value | Justification |
|-----------|-------|---------------|
| Hash function | SHA-256 | NIST-approved. 256-bit output. |
| Chain structure | Each entry's `hash` = SHA-256(canonical JSON of entry excluding `hash`); next entry's `prevHash` = previous entry's `hash`. | Standard hash-chain construction. Tampering with any entry breaks the chain at the next entry. |
| Canonical JSON | Sorted top-level keys, nested objects fully included, no whitespace. | Deterministic serialization. **CRITICAL:** must NOT use `JSON.stringify(entry, sortedKeysArray)` — the replacer array form filters keys at ALL levels, dropping nested payload keys. Build a sorted-key object and serialize normally. (This bug was caught by the H0.3 tamper detection test.) |
| Genesis entry | `seq=1`, `prevHash=null`. | First entry in a fresh log. |

---

## 2. Guarantees provided

### 2.1 Confidentiality
- **At rest:** Wallet private keys and exchange API secrets are encrypted with AES-256-GCM. The ciphertext, IV, salt, and auth tag are stored in the DB. The passphrase is NEVER persisted — the operator enters it at engine start, and it lives only in the signer process's memory.
- **In transit (signer ↔ web):** The signer communicates over a Unix socket (`0600` permissions). Only the same user as the signer can connect. No network exposure.
- **In memory (signer):** Decrypted keys live in the signer's `WalletVault` Maps. They are wiped on lock, auto-lock (30 min idle), and parent-disconnect (zeroize-on-disconnect, M2.3). The derived KDF key is zeroized after each encrypt/decrypt operation (H0.2).

### 2.2 Integrity
- **Blob integrity:** AES-256-GCM provides authenticated encryption — any modification of the ciphertext or IV causes `decipher.final()` to throw (auth tag mismatch). This detects tampering at the blob level.
- **Audit log integrity:** The SHA-256 hash chain (H0.3) makes any modification, deletion, or insertion of audit entries detectable via `AuditLog.verify()`. The chain is verified at signer boot (logs loudly if broken).

### 2.3 Key derivation strength
- PBKDF2 with 600,000 iterations provides ~19 bits of additional entropy over the passphrase's raw entropy. For a 12-character passphrase with ~64 bits of entropy, the effective brute-force cost is ~2^83 operations — beyond practical attack.
- Per-blob salt prevents rainbow table attacks and ensures that two blobs encrypted with the same passphrase have different derived keys.

### 2.4 Forward migration path
- The versioned KDF + encryption scheme (H0.1/H0.2) allows migrating to stronger algorithms (argon2id, ChaCha20-Poly1305) without breaking existing blobs. The rotation logic (H0.4) decrypts legacy blobs with their original algorithm and re-encrypts with the current algorithm.
- KDF parameter bumps (e.g. iterations 600k → 1M) are handled by `rotateKdfParams()` — legacy blobs are detected and upgraded automatically.

---

## 3. Guarantees NOT provided (limitations)

### 3.1 No forward secrecy
If the operator's passphrase is compromised, ALL blobs encrypted with that passphrase are compromised. There is no per-message ephemeral key agreement (this is not a messaging protocol). Mitigation: rotate the passphrase immediately if compromise is suspected (`rotatePassphrase()`).

### 3.2 No key escrow / passphrase recovery
If the operator forgets the passphrase, all encrypted blobs are unrecoverable. This is intentional — key escrow would introduce a backdoor. Mitigation: the operator must maintain a secure offline backup of the passphrase.

### 3.3 No HSM support
Keys are derived in software (PBKDF2 in Node.js `crypto`). An attacker with process-memory access (e.g. via a memory dump exploit) can extract the derived key. Mitigation: the signer process is isolated (Phase 1) and runs with minimal privileges. Future: HSM integration via PKCS#11 or a cloud KMS would move key derivation out of process memory.

### 3.4 No constant-time passphrase comparison at the API level
`verifyPassphrase()` returns `decryptSecret(...) !== null`. The GCM auth tag verification inside OpenSSL is constant-time, but the overall function's timing could theoretically leak whether the failure was "parse error" vs "auth tag mismatch". In practice, this is not exploitable because (a) the rate limiter dominates timing, and (b) the attacker doesn't get direct timing feedback through the JSON-RPC API. Mitigation: the rate limiter (5 failures/60s per IP, 50 failures/hour global) makes brute-force timing attacks infeasible.

### 3.5 Audit log: tamper DETECTION, not tamper PREVENTION
An attacker with filesystem write access to the audit log can still modify it — but they must recompute every subsequent hash, which `AuditLog.verify()` detects. For tamper PREVENTION, the operator should mirror the audit log to an append-only store (e.g. a syslog server with restricted write access) — out of scope for this module.

### 3.6 Audit log: no protection against full-file deletion
If an attacker deletes the entire audit log file, `AuditLog.verify()` returns `{ ok: true, entries: 0 }` (treats it as a fresh log). Mitigation: mirror the audit log off-host. The signer logs the file path at boot, so the operator knows where to mirror.

### 3.7 No protection against DB-level tampering
The `AppLog` table (DB) is NOT hash-chained — only the file-based `SIGNER_AUDIT_LOG` is. An attacker with DB write access could modify AppLog entries without detection. The file-based audit log is the tamper-evident channel; the DB is for operational visibility (dashboard feed).

---

## 4. Key rotation procedures

### 4.1 Change the operator passphrase

```
1. Operator decides to change the passphrase.
2. System loads all encrypted blobs from the DB.
3. Call rotatePassphrase(allBlobs, oldPass, newPass).
4. If any blob fails (wrong old passphrase), ABORT — do not persist.
5. If all blobs succeed, persist the new encrypted blobs to the DB
   in a single transaction (atomicity).
6. The old passphrase no longer works; the new passphrase is required
   for the next unlock.
```

### 4.2 Upgrade KDF parameters (e.g. bump iterations)

```
1. Update KDF_ITERATIONS in src/lib/trading/kdf.ts (e.g. 600_000 → 1_000_000).
2. Bump CURRENT_KDF_VERSION (e.g. 1 → 2) if the parameter change is
   not captured by kdfIters alone.
3. Deploy the new code. The signer boots; existing blobs are still
   decryptable (the kdfIters field in each blob tells deriveKey how
   many iterations to use).
4. Call rotateKdfParams(allBlobs, passphrase) — blobs on the old
   version are re-encrypted with the new parameters.
5. Persist the new blobs to the DB.
6. Call auditBlobVersions(allBlobs) to confirm all blobs are current.
```

### 4.3 Migrate to a new KDF algorithm (e.g. PBKDF2 → argon2id)

```
1. Add the argon2id branch to deriveKey() in kdf.ts.
2. Bump CURRENT_KDF_ALGO to "argon2id" and CURRENT_KDF_VERSION to 1.
3. Deploy. Existing PBKDF2 blobs are still decryptable (deriveKey
   dispatches on kdfAlgo).
4. Call rotateKdfParams(allBlobs, passphrase) — PBKDF2 blobs are
   re-encrypted with argon2id.
5. Persist + audit.
```

---

## 5. Test coverage

| Test file | Scenarios | What it verifies |
|-----------|-----------|------------------|
| `test-h0-kdf-versioning.ts` | 9 | New blob has version fields; correct/wrong passphrase; legacy blob backward compat; unsupported algo rejected; key buffer zeroized; salt+IV randomness. |
| `test-h0-audit-hashchain.ts` | 10 | Append + verify clean; genesis prevHash=null; chain linkage; tamper detection (payload modification); deletion detection (seq gap); hash recomputation; init() seeding; empty file; cross-session chain integrity. |
| `test-h0-key-rotation.ts` | 14 | rotatePassphrase (correct/wrong pass, new-pass decrypt, fresh salt+IV); rotateKdfParams (skip current, rotate legacy, idempotent); auditBlobVersions (mixed current/legacy/failed); inspectBlobVersion (legacy defaults). |
| `test-signer-vault-integration.ts` | 3 | Real signer process: unlock/lock/zeroize cycle; audit log hash chain verifies intact; audit entry payload structure correct. |

**Total H0 tests:** 36 new assertions across 3 test files, plus the integration test updated to verify the hash chain end-to-end.

**CI gate:** 9 files / 78 checks (was 6 files / 48 checks before H0).

---

## 6. Future work (post-H0)

- **Argon2id migration:** Add the argon2id branch to `deriveKey()`. Requires a native dependency (`argon2` npm package). The versioned KDF architecture makes this a drop-in change.
- **HSM integration:** Move key derivation to a hardware security module (PKCS#11) or cloud KMS. This would require restructuring `deriveKey()` to call the HSM API instead of computing locally.
- **Audit log mirroring:** Mirror the file-based audit log to a remote syslog server (RFC 5424) for tamper prevention (not just detection).
- **AppLog hash chain:** Extend the hash chain to the DB-level AppLog table. This requires a schema change (adding `prevHash` + `hash` columns to `AppLog`) and a migration.
- **Constant-time comparison audit:** Audit all passphrase/key comparison paths for timing leaks. The current rate limiter makes this low-priority, but a formal audit would close the gap.

---

## 7. References

- OWASP Password Storage Cheat Sheet (2023): https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- NIST SP 800-132: Recommendation for Password-Based Key Derivation
- NIST SP 800-38D: Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC
- RFC 6234: US Secure Hash Algorithms (SHA-224, SHA-256, SHA-384, SHA-512)
- JSON-RPC 2.0 Specification: https://www.jsonrpc.org/specification
