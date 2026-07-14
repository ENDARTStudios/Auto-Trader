/**
 * H0.4 — Key rotation + versioning.
 *
 * WHY THIS EXISTS:
 *   Before H0.4, there was no way to:
 *     - Change the operator passphrase without manually re-encrypting
 *       every wallet + exchange row.
 *     - Upgrade KDF parameters (e.g. bump iterations from 600k to 1M,
 *       or migrate from PBKDF2 to argon2id) without breaking existing
 *       blobs.
 *     - Detect which blobs are using legacy parameters and need rotation.
 *
 *   H0.1/H0.2 added the `kdfAlgo`/`kdfVersion`/`encAlgo`/`encVersion`
 *   fields to EncryptedBlob. H0.4 builds the rotation logic on top:
 *
 *     - rotatePassphrase(oldPass, newPass): decrypt every blob with the
 *       old passphrase, re-encrypt with the new passphrase using current
 *       KDF/encryption parameters. Returns a map of { id → newEncryptedJson }.
 *     - rotateKdfParams(passphrase): decrypt every blob, re-encrypt with
 *       the CURRENT KDF/encryption parameters (even if the passphrase is
 *       unchanged). Used after bumping KDF_ITERATIONS or migrating to a
 *       new algorithm. Blobs that are already on the current version are
 *       skipped (idempotent).
 *     - auditBlobVersions(blobs): returns a summary of how many blobs
 *       are on each KDF/encryption version — used to detect stale blobs
 *       that need rotation.
 *
 * SECURITY:
 *   - Rotation is a server-side operation — it requires the passphrase
 *     (to decrypt) and produces new encrypted blobs (to persist). The
 *     plaintext is held in memory only during the rotation; the old
 *     blobs are NOT zeroized from the DB (the caller must decide when
 *     to overwrite the DB rows — typically immediately after rotation).
 *   - If rotation fails midway (e.g. wrong passphrase for one blob),
 *     the caller is informed which blobs succeeded and which failed.
 *     The caller should NOT persist a partial rotation — either all
 *     blobs rotate or none do (atomicity is the caller's responsibility).
 *   - Rotation does NOT change the salt or IV — it generates fresh ones
 *     for each re-encrypted blob. This ensures the new blobs are
 *     cryptographically independent of the old ones even if the plaintext
 *     is the same.
 *
 * DESIGN:
 *   - rotatePassphrase and rotateKdfParams are PURE functions: they take
 *     a list of { id, encryptedJson } and return a list of
 *     { id, encryptedJson, rotated, error? }. They do NOT touch the DB.
 *     The caller (wallet-manager.ts or a CLI script) is responsible for
 *     reading the DB rows before rotation and writing the new blobs after.
 *   - This separation makes the rotation logic testable without a DB
 *     and allows the caller to implement atomicity (e.g. write all new
 *     blobs in a single transaction).
 */

import { encryptSecret, decryptSecret, EncryptedBlob } from "./wallet-crypto";
import {
  resolveKdfAlgo,
  resolveEncAlgo,
  CURRENT_KDF_ALGO,
  CURRENT_KDF_VERSION,
  CURRENT_ENC_ALGO,
  CURRENT_ENC_VERSION,
} from "./kdf";

export interface BlobInput {
  id: string;
  encryptedJson: string;
}

export interface RotationResult {
  id: string;
  /** true if the blob was re-encrypted; false if it was skipped or failed. */
  rotated: boolean;
  /** The new encrypted JSON (only present if rotated=true). */
  newEncryptedJson?: string;
  /** Error message (only present if rotation failed for this blob). */
  error?: string;
  /** The KDF/enc algo+version BEFORE rotation (for diagnostics). */
  before?: { kdfAlgo: string; kdfVersion: number; encAlgo: string; encVersion: number };
  /** Whether the blob was already on the current version (skip reason). */
  alreadyCurrent?: boolean;
}

/**
 * Inspect a blob's KDF + encryption version. Returns the resolved algo +
 * version (defaults for legacy blobs without the fields).
 */
export function inspectBlobVersion(encryptedJson: string): {
  kdfAlgo: string;
  kdfVersion: number;
  encAlgo: string;
  encVersion: number;
} | null {
  try {
    const blob = JSON.parse(encryptedJson) as EncryptedBlob;
    const kdf = resolveKdfAlgo(blob);
    const enc = resolveEncAlgo(blob);
    return {
      kdfAlgo: kdf.algo,
      kdfVersion: kdf.version,
      encAlgo: enc.algo,
      encVersion: enc.version,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a blob is on the current KDF + encryption version.
 *
 * CRITICAL: this checks the RAW fields on the blob, NOT the resolved
 * defaults. A legacy blob (pre-H0, no explicit kdfAlgo/encAlgo fields)
 * resolves to the current defaults via resolveKdfAlgo/resolveEncAlgo,
 * but it is NOT "current" — it lacks the explicit version fields and
 * should be rotated to add them. This ensures rotateKdfParams migrates
 * legacy blobs to the explicit-field format even when the algorithm
 * hasn't changed.
 */
export function isBlobCurrent(encryptedJson: string): boolean {
  try {
    const blob = JSON.parse(encryptedJson) as EncryptedBlob;
    return (
      blob.kdfAlgo === CURRENT_KDF_ALGO &&
      blob.kdfVersion === CURRENT_KDF_VERSION &&
      blob.encAlgo === CURRENT_ENC_ALGO &&
      blob.encVersion === CURRENT_ENC_VERSION
    );
  } catch {
    return false;
  }
}

/**
 * Rotate the passphrase for a set of blobs.
 *
 * For each blob:
 *   1. Decrypt with oldPassphrase.
 *   2. If decryption fails, record an error (the blob is NOT modified).
 *   3. Re-encrypt the plaintext with newPassphrase using current KDF/enc.
 *   4. Return the new encrypted JSON.
 *
 * The caller is responsible for persisting the new blobs to the DB.
 * If ANY blob fails to decrypt (wrong passphrase), the caller should
 * NOT persist any of the results (atomicity).
 *
 * @param blobs         Array of { id, encryptedJson }.
 * @param oldPassphrase The current passphrase (to decrypt).
 * @param newPassphrase The new passphrase (to re-encrypt).
 * @returns Array of RotationResult, one per input blob.
 */
export function rotatePassphrase(
  blobs: BlobInput[],
  oldPassphrase: string,
  newPassphrase: string
): RotationResult[] {
  return blobs.map((blob) => {
    const before = inspectBlobVersion(blob.encryptedJson);
    const plaintext = decryptSecret(blob.encryptedJson, oldPassphrase);
    if (plaintext === null) {
      return {
        id: blob.id,
        rotated: false,
        error: "decryption failed — wrong passphrase or corrupt blob",
        before: before ?? undefined,
      };
    }
    const newEncryptedJson = encryptSecret(plaintext, newPassphrase);
    return {
      id: blob.id,
      rotated: true,
      newEncryptedJson,
      before: before ?? undefined,
    };
  });
}

/**
 * Rotate KDF + encryption parameters for a set of blobs (passphrase
 * unchanged). Blobs that are already on the current version are skipped
 * (idempotent). Blobs on a legacy version are re-encrypted with the
 * current parameters.
 *
 * Use this after bumping KDF_ITERATIONS or migrating to a new algorithm
 * (e.g. argon2id). The blobs that need rotation are detected via
 * isBlobCurrent() — if all blobs are current, this is a no-op.
 *
 * @param blobs      Array of { id, encryptedJson }.
 * @param passphrase The current passphrase (unchanged).
 * @returns Array of RotationResult, one per input blob.
 */
export function rotateKdfParams(
  blobs: BlobInput[],
  passphrase: string
): RotationResult[] {
  return blobs.map((blob) => {
    const before = inspectBlobVersion(blob.encryptedJson);
    if (isBlobCurrent(blob.encryptedJson)) {
      return {
        id: blob.id,
        rotated: false,
        alreadyCurrent: true,
        before: before ?? undefined,
      };
    }
    const plaintext = decryptSecret(blob.encryptedJson, passphrase);
    if (plaintext === null) {
      return {
        id: blob.id,
        rotated: false,
        error: "decryption failed — wrong passphrase or corrupt blob",
        before: before ?? undefined,
      };
    }
    // Re-encrypt with the current parameters (fresh salt + IV).
    const newEncryptedJson = encryptSecret(plaintext, passphrase);
    return {
      id: blob.id,
      rotated: true,
      newEncryptedJson,
      before: before ?? undefined,
    };
  });
}

/**
 * Audit the KDF + encryption versions of a set of blobs. Returns a
 * summary of how many blobs are on each version combination.
 *
 * Use this to detect stale blobs that need rotation (e.g. after a
 * KDF parameter bump, run this to see how many blobs are still on
 * the old version).
 */
export function auditBlobVersions(blobs: BlobInput[]): {
  total: number;
  current: number;
  stale: number;
  failed: number;
  byVersion: Record<string, number>;
} {
  let current = 0;
  let stale = 0;
  let failed = 0;
  const byVersion: Record<string, number> = {};

  for (const blob of blobs) {
    const v = inspectBlobVersion(blob.encryptedJson);
    if (!v) {
      failed++;
      continue;
    }
    const key = `${v.kdfAlgo}v${v.kdfVersion}/${v.encAlgo}v${v.encVersion}`;
    byVersion[key] = (byVersion[key] ?? 0) + 1;
    // Use isBlobCurrent (raw field check) so legacy blobs that lack
    // explicit version fields are counted as stale, even though they
    // resolve to the current defaults.
    if (isBlobCurrent(blob.encryptedJson)) {
      current++;
    } else {
      stale++;
    }
  }

  return {
    total: blobs.length,
    current,
    stale,
    failed,
    byVersion,
  };
}
