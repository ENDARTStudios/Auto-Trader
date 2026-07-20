/**
 * H0.4 — Key rotation + versioning test suite.
 *
 * Tests the rotation logic in src/lib/trading/key-rotation.ts.
 *
 * 9 scenarios:
 *   1. rotatePassphrase: all blobs rotate successfully with correct old pass.
 *   2. rotatePassphrase: wrong old passphrase → all blobs fail (no partial rotation).
 *   3. rotatePassphrase: new blobs decrypt with the NEW passphrase, not the old.
 *   4. rotatePassphrase: new blobs have fresh salt+IV (different from old).
 *   5. rotateKdfParams: current blobs are skipped (alreadyCurrent=true).
 *   6. rotateKdfParams: legacy blobs are re-encrypted to current version.
 *   7. rotateKdfParams: idempotent — running twice is a no-op the second time.
 *   8. auditBlobVersions: mixed current + legacy blobs are counted correctly.
 *   9. inspectBlobVersion: legacy blob (no version fields) resolves to defaults.
 *
 * Run: npx tsx scripts/test-h0-key-rotation.ts
 */

import {
  rotatePassphrase,
  rotateKdfParams,
  auditBlobVersions,
  inspectBlobVersion,
  isBlobCurrent,
  BlobInput,
  RotationResult,
} from "../src/lib/trading/key-rotation";
import { encryptSecret, decryptSecret, EncryptedBlob } from "../src/lib/trading/wallet-crypto";
import {
  CURRENT_KDF_ALGO,
  CURRENT_KDF_VERSION,
  CURRENT_ENC_ALGO,
  CURRENT_ENC_VERSION,
} from "../src/lib/trading/kdf";
import { pbkdf2Sync, createCipheriv, randomBytes } from "crypto";

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

/**
 * Create a legacy blob (pre-H0, no kdfAlgo/encAlgo fields) for testing
 * backward compatibility + rotation.
 */
function createLegacyBlob(plaintext: string, passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(passphrase, salt, 600_000, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob: EncryptedBlob = {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
    salt: salt.toString("base64"),
    kdfIters: 600_000,
    // NOTE: no kdfAlgo/kdfVersion/encAlgo/encVersion — simulates pre-H0 blob.
  };
  return JSON.stringify(blob);
}

console.log("\n=== H0.4 — Key Rotation + Versioning Test Suite ===\n");

// ---------------------------------------------------------------------------
// Test 1: rotatePassphrase — all blobs rotate with correct old passphrase.
// ---------------------------------------------------------------------------

console.log("  rotatePassphrase: all blobs rotate with correct old passphrase...");
{
  const oldPass = "old-pass-123";
  const newPass = "new-pass-456";
  const blobs: BlobInput[] = [
    { id: "w1", encryptedJson: encryptSecret("wallet-key-1", oldPass) },
    { id: "w2", encryptedJson: encryptSecret("wallet-key-2", oldPass) },
    { id: "e1", encryptedJson: encryptSecret("api-secret-1", oldPass) },
  ];
  const results = rotatePassphrase(blobs, oldPass, newPass);
  const allRotated = results.every((r) => r.rotated && r.newEncryptedJson && !r.error);
  assert(allRotated, `expected all 3 blobs to rotate; got ${JSON.stringify(results.map((r) => ({ id: r.id, rotated: r.rotated, error: r.error })))}`);
}

// ---------------------------------------------------------------------------
// Test 2: rotatePassphrase — wrong old passphrase → all fail.
// ---------------------------------------------------------------------------

console.log("  rotatePassphrase: wrong old passphrase → all blobs fail (no partial rotation)...");
{
  const oldPass = "correct-old-pass";
  const wrongPass = "wrong-old-pass";
  const newPass = "new-pass";
  const blobs: BlobInput[] = [
    { id: "w1", encryptedJson: encryptSecret("key-1", oldPass) },
    { id: "w2", encryptedJson: encryptSecret("key-2", oldPass) },
  ];
  const results = rotatePassphrase(blobs, wrongPass, newPass);
  const allFailed = results.every((r) => !r.rotated && r.error && !r.newEncryptedJson);
  assert(allFailed, `expected all 2 blobs to fail; got ${JSON.stringify(results.map((r) => ({ id: r.id, rotated: r.rotated, error: r.error })))}`);
}

// ---------------------------------------------------------------------------
// Test 3: rotatePassphrase — new blobs decrypt with NEW passphrase, not old.
// ---------------------------------------------------------------------------

console.log("  rotatePassphrase: new blobs decrypt with NEW passphrase, not old...");
{
  const oldPass = "old-pass";
  const newPass = "new-pass";
  const plaintext = "secret-key-content";
  const blobs: BlobInput[] = [
    { id: "w1", encryptedJson: encryptSecret(plaintext, oldPass) },
  ];
  const results = rotatePassphrase(blobs, oldPass, newPass);
  const newJson = results[0].newEncryptedJson!;
  // New blob should decrypt with newPass.
  const decryptedNew = decryptSecret(newJson, newPass);
  // New blob should NOT decrypt with oldPass.
  const decryptedOld = decryptSecret(newJson, oldPass);
  assert(
    decryptedNew === plaintext && decryptedOld === null,
    `expected new blob to decrypt with newPass (got "${decryptedNew}") and fail with oldPass (got "${decryptedOld}")`
  );
}

// ---------------------------------------------------------------------------
// Test 4: rotatePassphrase — new blobs have fresh salt+IV.
// ---------------------------------------------------------------------------

console.log("  rotatePassphrase: new blobs have fresh salt+IV (different from old)...");
{
  const oldPass = "old-pass";
  const newPass = "new-pass";
  const blobs: BlobInput[] = [
    { id: "w1", encryptedJson: encryptSecret("same-plaintext", oldPass) },
  ];
  const oldBlob = JSON.parse(blobs[0].encryptedJson) as EncryptedBlob;
  const results = rotatePassphrase(blobs, oldPass, newPass);
  const newBlob = JSON.parse(results[0].newEncryptedJson!) as EncryptedBlob;
  assert(
    oldBlob.salt !== newBlob.salt && oldBlob.iv !== newBlob.iv,
    `expected different salt+IV; oldSalt=${oldBlob.salt.slice(0, 8)} newSalt=${newBlob.salt.slice(0, 8)}`
  );
}

// ---------------------------------------------------------------------------
// Test 5: rotateKdfParams — current blobs are skipped.
// ---------------------------------------------------------------------------

console.log("  rotateKdfParams: current-version blobs are skipped (alreadyCurrent=true)...");
{
  const pass = "test-pass";
  const blobs: BlobInput[] = [
    { id: "w1", encryptedJson: encryptSecret("key-1", pass) },
    { id: "w2", encryptedJson: encryptSecret("key-2", pass) },
  ];
  const results = rotateKdfParams(blobs, pass);
  const allSkipped = results.every((r) => !r.rotated && r.alreadyCurrent && !r.newEncryptedJson);
  assert(allSkipped, `expected all 2 blobs to be skipped as alreadyCurrent; got ${JSON.stringify(results.map((r) => ({ id: r.id, rotated: r.rotated, alreadyCurrent: r.alreadyCurrent })))}`);
}

// ---------------------------------------------------------------------------
// Test 6: rotateKdfParams — legacy blobs are re-encrypted to current version.
// ---------------------------------------------------------------------------

console.log("  rotateKdfParams: legacy blobs are re-encrypted to current version...");
{
  const pass = "test-pass";
  const plaintext = "legacy-key-content";
  const blobs: BlobInput[] = [
    { id: "w1", encryptedJson: createLegacyBlob(plaintext, pass) },
  ];
  // Confirm the legacy blob is NOT current.
  assert(!isBlobCurrent(blobs[0].encryptedJson), "legacy blob should NOT be current before rotation");
  const results = rotateKdfParams(blobs, pass);
  const r = results[0];
  assert(
    r.rotated && r.newEncryptedJson !== undefined,
    `expected legacy blob to be rotated; got rotated=${r.rotated}, error=${r.error}`
  );
  // The new blob should be current.
  assert(isBlobCurrent(r.newEncryptedJson!), "new blob should be current version after rotation");
  // The new blob should decrypt to the same plaintext.
  const decrypted = decryptSecret(r.newEncryptedJson!, pass);
  assert(decrypted === plaintext, `expected decrypted="${plaintext}", got "${decrypted}"`);
}

// ---------------------------------------------------------------------------
// Test 7: rotateKdfParams — idempotent (second run is a no-op).
// ---------------------------------------------------------------------------

console.log("  rotateKdfParams: idempotent — second run skips all blobs...");
{
  const pass = "test-pass";
  const blobs: BlobInput[] = [
    { id: "w1", encryptedJson: createLegacyBlob("key-1", pass) },
    { id: "w2", encryptedJson: createLegacyBlob("key-2", pass) },
  ];
  // First rotation: both should be rotated.
  const results1 = rotateKdfParams(blobs, pass);
  const rotated1 = results1.filter((r) => r.rotated).length;
  assert(rotated1 === 2, `expected 2 blobs rotated on first run; got ${rotated1}`);
  // Second rotation: both should be skipped (already current).
  const currentBlobs: BlobInput[] = results1.map((r) => ({
    id: r.id,
    encryptedJson: r.newEncryptedJson!,
  }));
  const results2 = rotateKdfParams(currentBlobs, pass);
  const skipped2 = results2.filter((r) => r.alreadyCurrent).length;
  assert(skipped2 === 2, `expected 2 blobs skipped on second run; got ${skipped2}`);
}

// ---------------------------------------------------------------------------
// Test 8: auditBlobVersions — mixed current + legacy blobs.
// ---------------------------------------------------------------------------

console.log("  auditBlobVersions: mixed current + legacy blobs counted correctly...");
{
  const pass = "test-pass";
  const blobs: BlobInput[] = [
    { id: "w1", encryptedJson: encryptSecret("key-1", pass) }, // current
    { id: "w2", encryptedJson: encryptSecret("key-2", pass) }, // current
    { id: "w3", encryptedJson: createLegacyBlob("key-3", pass) }, // legacy
    { id: "w4", encryptedJson: createLegacyBlob("key-4", pass) }, // legacy
    { id: "w5", encryptedJson: "not-valid-json" }, // failed
  ];
  const audit = auditBlobVersions(blobs);
  assert(
    audit.total === 5 && audit.current === 2 && audit.stale === 2 && audit.failed === 1,
    `expected total=5 current=2 stale=2 failed=1; got ${JSON.stringify(audit)}`
  );
  // byVersion uses RESOLVED versions (for human-readable reporting), so both
  // current and legacy blobs appear under the same key. The current/stale
  // split (above) is the actionable metric — it uses raw field checks.
  const currentKey = `${CURRENT_KDF_ALGO}v${CURRENT_KDF_VERSION}/${CURRENT_ENC_ALGO}v${CURRENT_ENC_VERSION}`;
  assert(
    audit.byVersion[currentKey] === 4,
    `expected byVersion[${currentKey}]=4 (2 current + 2 legacy both resolve to this); got ${audit.byVersion[currentKey]}`
  );
}

// ---------------------------------------------------------------------------
// Test 9: inspectBlobVersion — legacy blob resolves to defaults.
// ---------------------------------------------------------------------------

console.log("  inspectBlobVersion: legacy blob (no version fields) resolves to defaults...");
{
  const pass = "test-pass";
  const legacyJson = createLegacyBlob("key", pass);
  const v = inspectBlobVersion(legacyJson);
  assert(
    v !== null &&
      v.kdfAlgo === "pbkdf2-sha256" &&
      v.kdfVersion === 1 &&
      v.encAlgo === "aes-256-gcm" &&
      v.encVersion === 1,
    `expected legacy blob to resolve to pbkdf2-sha256v1/aes-256-gcmv1; got ${JSON.stringify(v)}`
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
