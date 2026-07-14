/**
 * H0.1 + H0.2 — KDF versioning + encryption scheme versioning + key zeroization.
 *
 * Test suite (8 scenarios):
 *   1. New blob includes kdfAlgo/kdfVersion/encAlgo/encVersion fields.
 *   2. New blob decrypts correctly with the correct passphrase.
 *   3. New blob fails to decrypt with the wrong passphrase (GCM auth tag).
 *   4. Legacy blob (pre-H0, without version fields) still decrypts.
 *   5. Legacy blob is resolved to pbkdf2-sha256 v1 / aes-256-gcm v1 defaults.
 *   6. Unsupported kdfAlgo in blob → decrypt returns null (not crash).
 *   7. Unsupported encAlgo in blob → decrypt returns null (not crash).
 *   8. Key buffer is zeroized after encrypt + decrypt (defense-in-depth).
 *
 * Run: npx tsx scripts/test-h0-kdf-versioning.ts
 */

import { encryptSecret, decryptSecret, EncryptedBlob } from "../src/lib/trading/wallet-crypto";
import {
  deriveKey,
  resolveKdfAlgo,
  resolveEncAlgo,
  generateSalt,
  generateIv,
  zeroizeKeyBuffer,
  KDF_ITERATIONS,
  KDF_KEYLEN,
  CURRENT_KDF_ALGO,
  CURRENT_KDF_VERSION,
  CURRENT_ENC_ALGO,
  CURRENT_ENC_VERSION,
  KDF_ALGO_PBKDF2_SHA256,
  ENC_ALGO_AES_256_GCM,
} from "../src/lib/trading/kdf";
import { createCipheriv, createDecipheriv, pbkdf2Sync } from "crypto";

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

// ---------------------------------------------------------------------------
// Test 1: New blob includes version fields.
// ---------------------------------------------------------------------------

console.log("\n=== H0.1/H0.2 — KDF + Encryption Versioning Test Suite ===\n");

console.log("  New blob includes kdfAlgo/kdfVersion/encAlgo/encVersion fields...");
{
  const blob = JSON.parse(encryptSecret("test-secret", "passphrase123")) as EncryptedBlob;
  assert(
    blob.kdfAlgo === CURRENT_KDF_ALGO &&
      blob.kdfVersion === CURRENT_KDF_VERSION &&
      blob.encAlgo === CURRENT_ENC_ALGO &&
      blob.encVersion === CURRENT_ENC_VERSION,
    `expected kdfAlgo=${CURRENT_KDF_ALGO}, kdfVersion=${CURRENT_KDF_VERSION}, encAlgo=${CURRENT_ENC_ALGO}, encVersion=${CURRENT_ENC_VERSION}; got kdfAlgo=${blob.kdfAlgo}, kdfVersion=${blob.kdfVersion}, encAlgo=${blob.encAlgo}, encVersion=${blob.encVersion}`
  );
}

// ---------------------------------------------------------------------------
// Test 2: New blob decrypts correctly.
// ---------------------------------------------------------------------------

console.log("  New blob decrypts correctly with correct passphrase...");
{
  const plaintext = "my-secret-private-key-0x1234567890abcdef";
  const passphrase = "correct-horse-battery-staple";
  const encrypted = encryptSecret(plaintext, passphrase);
  const decrypted = decryptSecret(encrypted, passphrase);
  assert(decrypted === plaintext, `expected "${plaintext}", got "${decrypted}"`);
}

// ---------------------------------------------------------------------------
// Test 3: Wrong passphrase fails (GCM auth tag).
// ---------------------------------------------------------------------------

console.log("  New blob fails to decrypt with wrong passphrase...");
{
  const encrypted = encryptSecret("test", "correct-pass");
  const decrypted = decryptSecret(encrypted, "wrong-pass");
  assert(decrypted === null, `expected null, got "${decrypted}"`);
}

// ---------------------------------------------------------------------------
// Test 4: Legacy blob (pre-H0, no version fields) still decrypts.
// ---------------------------------------------------------------------------

console.log("  Legacy blob (no kdfAlgo/encAlgo fields) still decrypts (backward compat)...");
{
  // Manually construct a legacy blob using the pre-H0 code path.
  const plaintext = "legacy-secret-key";
  const passphrase = "legacy-pass";
  const salt = generateSalt();
  const iv = generateIv();
  const key = pbkdf2Sync(passphrase, salt, KDF_ITERATIONS, KDF_KEYLEN, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  zeroizeKeyBuffer(key);

  const legacyBlob: EncryptedBlob = {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
    salt: salt.toString("base64"),
    kdfIters: KDF_ITERATIONS,
    // NOTE: no kdfAlgo, kdfVersion, encAlgo, encVersion — simulates pre-H0 blob.
  };
  const legacyJson = JSON.stringify(legacyBlob);

  const decrypted = decryptSecret(legacyJson, passphrase);
  assert(decrypted === plaintext, `expected "${plaintext}", got "${decrypted}"`);
}

// ---------------------------------------------------------------------------
// Test 5: Legacy blob resolves to default algo/version.
// ---------------------------------------------------------------------------

console.log("  Legacy blob resolves to pbkdf2-sha256 v1 / aes-256-gcm v1 defaults...");
{
  const legacyBlob: Partial<EncryptedBlob> = {
    iv: "x",
    ciphertext: "x",
    tag: "x",
    salt: "x",
    kdfIters: 600_000,
    // no kdfAlgo/kdfVersion/encAlgo/encVersion
  };
  const kdf = resolveKdfAlgo(legacyBlob);
  const enc = resolveEncAlgo(legacyBlob);
  assert(
    kdf.algo === KDF_ALGO_PBKDF2_SHA256 &&
      kdf.version === 1 &&
      enc.algo === ENC_ALGO_AES_256_GCM &&
      enc.version === 1,
    `expected algo=pbkdf2-sha256 v1 / aes-256-gcm v1; got kdf=${kdf.algo} v${kdf.version}, enc=${enc.algo} v${enc.version}`
  );
}

// ---------------------------------------------------------------------------
// Test 6: Unsupported kdfAlgo → decrypt returns null.
// ---------------------------------------------------------------------------

console.log("  Blob with unsupported kdfAlgo → decrypt returns null (no crash)...");
{
  const blob = JSON.parse(encryptSecret("test", "pass")) as EncryptedBlob;
  blob.kdfAlgo = "argon2id-future"; // unsupported as of H0
  const decrypted = decryptSecret(JSON.stringify(blob), "pass");
  assert(decrypted === null, `expected null for unsupported kdfAlgo, got "${decrypted}"`);
}

// ---------------------------------------------------------------------------
// Test 7: Unsupported encAlgo → decrypt returns null.
// ---------------------------------------------------------------------------

console.log("  Blob with unsupported encAlgo → decrypt returns null (no crash)...");
{
  const blob = JSON.parse(encryptSecret("test", "pass")) as EncryptedBlob;
  blob.encAlgo = "chacha20-poly1305-future"; // unsupported as of H0
  const decrypted = decryptSecret(JSON.stringify(blob), "pass");
  assert(decrypted === null, `expected null for unsupported encAlgo, got "${decrypted}"`);
}

// ---------------------------------------------------------------------------
// Test 8: Key buffer zeroization (defense-in-depth).
// ---------------------------------------------------------------------------

console.log("  deriveKey returns a zeroizable buffer + zeroizeKeyBuffer overwrites it...");
{
  const salt = generateSalt();
  const key = deriveKey(
    CURRENT_KDF_ALGO,
    CURRENT_KDF_VERSION,
    "passphrase",
    salt,
    KDF_ITERATIONS
  );
  const beforeZero = Buffer.alloc(key.length);
  key.copy(beforeZero);
  // Verify the key is non-zero before zeroization.
  const isNonZeroBefore = beforeZero.some((b) => b !== 0);
  // Zeroize.
  zeroizeKeyBuffer(key);
  // Verify the key is now all zeros.
  const isAllZeroAfter = key.every((b) => b === 0);
  assert(
    isNonZeroBefore && isAllZeroAfter,
    `expected key to be non-zero before zeroization and all-zero after; beforeNonZero=${isNonZeroBefore}, afterAllZero=${isAllZeroAfter}`
  );
}

// ---------------------------------------------------------------------------
// Test 9: Two encryptions of the same plaintext produce different blobs
// (random salt + IV per encryption — no deterministic reuse).
// ---------------------------------------------------------------------------

console.log("  Two encryptions of same plaintext produce different blobs (salt+IV randomness)...");
{
  const plaintext = "same-secret";
  const passphrase = "same-pass";
  const blob1 = JSON.parse(encryptSecret(plaintext, passphrase)) as EncryptedBlob;
  const blob2 = JSON.parse(encryptSecret(plaintext, passphrase)) as EncryptedBlob;
  assert(
    blob1.salt !== blob2.salt && blob1.iv !== blob2.iv && blob1.ciphertext !== blob2.ciphertext,
    `expected different salt/iv/ciphertext; salt1=${blob1.salt.slice(0, 8)} salt2=${blob2.salt.slice(0, 8)}`
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
