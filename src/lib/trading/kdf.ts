/**
 * H0.1 — Key Derivation Function (KDF) versioning + dispatch.
 *
 * WHY THIS EXISTS:
 *   Before H0, `wallet-crypto.ts` hardcoded PBKDF2-SHA256 with 600,000
 *   iterations. The iteration count was stored in each EncryptedBlob
 *   (the `kdfIters` field), which allowed forward-compatible iteration-
 *   count bumps. BUT there was no algorithm field — if we ever migrate
 *   to argon2id (memory-hard, GPU-resistant), we'd have no way to tell
 *   which algorithm was used for an existing blob. This module fixes
 *   that by introducing:
 *
 *     - `kdfAlgo`: a string identifier for the KDF algorithm
 *       (currently "pbkdf2-sha256"; future: "argon2id").
 *     - `kdfVersion`: an integer version of the algorithm's parameter
 *       scheme (currently 1). Bumped when the algorithm's parameters
 *       change in a way that's not captured by `kdfIters` alone (e.g.,
 *       argon2id's m/t/p parameters).
 *
 *   Both fields are OPTIONAL in the EncryptedBlob interface — old blobs
 *   (pre-H0) don't have them and default to "pbkdf2-sha256" v1. New
 *   blobs include them explicitly. This is backward-compatible: a
 *   decrypt of an old blob works, and the result is tagged with the
 *   legacy algorithm/version so the rotation logic (H0.4) can detect
 *   and upgrade it.
 *
 * PARAMETER CHOICES (OWASP 2023 / NIST SP 800-132):
 *   - Algorithm: PBKDF2-HMAC-SHA256 (OWASP 2023 recommendation for
 *     PBKDF2; argon2id is preferred but requires a native dependency
 *     — deferred to a future H0.x patch).
 *   - Iterations: 600,000 (OWASP 2023 minimum for PBKDF2-SHA256).
 *   - Key length: 32 bytes (256 bits, for AES-256).
 *   - Salt length: 16 bytes (128 bits, NIST minimum).
 *   - Salt generation: crypto.randomBytes (CSPRNG).
 *
 * SECURITY:
 *   - The derived key is returned as a Buffer. The caller MUST zeroize
 *     it after use via `zeroizeKeyBuffer()`. Node.js does not guarantee
 *     that Buffers are zeroed when they go out of scope — the V8 GC
 *     may retain them in memory indefinitely. Explicit zeroization is
 *     a defense-in-depth measure.
 *   - `pbkdf2Sync` is synchronous and blocks the event loop for ~0.3s
 *     at 600k iterations on typical hardware. This is acceptable for
 *     the signer (single-purpose process, unlock is a rare event). If
 *     unlock frequency increases, switch to `pbkdf2` (async) — but the
 *     sync variant is currently used to avoid race conditions during
 *     the unlock → decrypt → load sequence.
 */

import { pbkdf2Sync, randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Algorithm identifiers + versions
// ---------------------------------------------------------------------------

export const KDF_ALGO_PBKDF2_SHA256 = "pbkdf2-sha256" as const;
export const ENC_ALGO_AES_256_GCM = "aes-256-gcm" as const;

/** Current KDF algorithm + version (used by encryptSecret for new blobs). */
export const CURRENT_KDF_ALGO = KDF_ALGO_PBKDF2_SHA256;
export const CURRENT_KDF_VERSION = 1;

/** Current encryption algorithm + version (used by encryptSecret for new blobs). */
export const CURRENT_ENC_ALGO = ENC_ALGO_AES_256_GCM;
export const CURRENT_ENC_VERSION = 1;

/** Current KDF parameters. */
export const KDF_ITERATIONS = 600_000;
export const KDF_KEYLEN = 32; // 256 bits for AES-256
export const KDF_DIGEST = "sha256";
export const SALT_LEN = 16; // 128 bits
export const IV_LEN = 12; // 96 bits — recommended for GCM

// ---------------------------------------------------------------------------
// KDF dispatch
// ---------------------------------------------------------------------------

/**
 * Derive a key from a passphrase + salt using the specified algorithm.
 *
 * @param algo      The KDF algorithm identifier (e.g. "pbkdf2-sha256").
 * @param version   The KDF parameter-scheme version (currently always 1).
 * @param passphrase The operator's passphrase.
 * @param salt      The per-blob salt (Buffer).
 * @param iters     The iteration count (for PBKDF2; ignored by other algos).
 * @returns A 32-byte derived key Buffer. CALLER MUST zeroize after use.
 * @throws If the algorithm is unknown or the parameters are invalid.
 */
export function deriveKey(
  algo: string,
  _version: number,
  passphrase: string,
  salt: Buffer,
  iters: number
): Buffer {
  if (algo === KDF_ALGO_PBKDF2_SHA256) {
    // _version is currently always 1 for pbkdf2-sha256. When we bump to v2
    // (e.g. to change the digest or add a pepper), this branch will check
    // the version and dispatch accordingly. For now, v1 is the only case.
    if (_version !== 1) {
      throw new Error(
        `deriveKey: unsupported ${algo} version ${_version} (only v1 supported)`
      );
    }
    return pbkdf2Sync(passphrase, salt, iters, KDF_KEYLEN, KDF_DIGEST);
  }
  // Future: argon2id branch goes here.
  // if (algo === "argon2id") { ... }
  throw new Error(`deriveKey: unknown KDF algorithm "${algo}"`);
}

/**
 * Resolve the KDF algorithm + version for a blob that may be missing the
 * fields (pre-H0 blobs). Returns the defaults for legacy blobs.
 */
export function resolveKdfAlgo(blob: {
  kdfAlgo?: string;
  kdfVersion?: number;
}): { algo: string; version: number } {
  return {
    algo: blob.kdfAlgo ?? KDF_ALGO_PBKDF2_SHA256,
    version: blob.kdfVersion ?? 1,
  };
}

/**
 * Resolve the encryption algorithm + version for a blob that may be
 * missing the fields (pre-H0 blobs). Returns the defaults for legacy blobs.
 */
export function resolveEncAlgo(blob: {
  encAlgo?: string;
  encVersion?: number;
}): { algo: string; version: number } {
  return {
    algo: blob.encAlgo ?? ENC_ALGO_AES_256_GCM,
    version: blob.encVersion ?? 1,
  };
}

/**
 * Generate a fresh salt (128 bits) for a new encryption.
 */
export function generateSalt(): Buffer {
  return randomBytes(SALT_LEN);
}

/**
 * Generate a fresh IV (96 bits) for a new AES-256-GCM encryption.
 */
export function generateIv(): Buffer {
  return randomBytes(IV_LEN);
}

/**
 * Zeroize a key buffer in memory. Defense-in-depth — overwrites the
 * Buffer's contents with zeros so the key material is not retained
 * in memory longer than necessary.
 *
 * NOTE: Node.js Buffers may be backed by shared ArrayBuffer pools.
 * `fill(0)` writes to the Buffer's view, which is sufficient for
 * keys derived via pbkdf2Sync (which allocates a new Buffer, not from
 * the pool). Do NOT use this on Buffers created via `Buffer.from(arrayBuffer)`
 * unless you own the entire ArrayBuffer.
 */
export function zeroizeKeyBuffer(key: Buffer): void {
  try {
    key.fill(0);
  } catch {
    // Some Buffers (e.g. read-only) can't be filled. Best-effort.
  }
}
