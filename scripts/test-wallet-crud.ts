// Wallet CRUD structural test suite — Phase 1 / REG-006.
//
// Closes the test-coverage gap that hid the missing-fields bug in the
// reconstructed prisma/schema.prisma. The vault test suite (test-vault.ts)
// writes wallet rows directly via db.walletConnection.create() with a minimal
// field set; it does NOT exercise the wallet-manager.ts CRUD layer that the
// /api/wallets and /api/exchanges routes call. As a result, the schema
// reconstruction (which dropped 8 fields: chain, publicKey, lastUsedAt for
// WalletConnection; apiKeyPublicPrefix, permissions, testnet,
// ipWhitelistConfigured, lastUsedAt for ExchangeConnection) passed 29/29
// tests while the API layer was broken at runtime.
//
// This suite exercises the REAL wallet-manager.ts functions:
//   - createWallet / listWallets / setWalletActive / deleteWallet
//   - createExchange / listExchanges / setExchangeActive / deleteExchange
//
// Acceptance: every function must succeed end-to-end against the real SQLite
// DB, AND the row read back must contain the expected fields (not undefined).
// If a field is missing from the schema, the Prisma client will reject the
// write with a validation error and the test will fail.
//
// Run with:  npx tsx scripts/test-wallet-crud.ts
//
// Exit code: 0 = all pass, 1 = any fail.

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "file:./prisma/dev.db";

let walletManager: any;
let db: any;

type TestFn = () => Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`ASSERT FAILED: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Setup + teardown
// ---------------------------------------------------------------------------

async function cleanupAll() {
  // Wipe any leftover rows from previous runs so tests are idempotent.
  await db.walletConnection.deleteMany({});
  await db.exchangeConnection.deleteMany({});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("createWallet with full field set — all 8 WalletConnection columns are populated", async () => {
  await cleanupAll();
  const w = await walletManager.createWallet({
    label: "test-evm-full",
    type: "evm",
    address: "0xabc0000000000000000000000000000000000001",
    chain: "base",
    publicKey: "0xpub11111",
    privateKey: "0xdeadbeef".repeat(8),
    passphrase: "test-passphrase-12345",
    readOnly: false,
  });
  assertEq(w.label, "test-evm-full", "label round-trip");
  assertEq(w.type, "evm", "type round-trip");
  assertEq(w.address, "0xabc0000000000000000000000000000000000001", "address round-trip");
  assertEq(w.chain, "base", "chain round-trip — RECON REG-006 field");
  assertEq(w.publicKey, "0xpub11111", "publicKey round-trip — RECON REG-006 field");
  assertEq(w.isActive, false, "isActive defaults to false");
  assertEq(w.readOnly, false, "readOnly round-trip");
  assert(w.hasPrivateKey === true, "hasPrivateKey derived true when privateKeyEncrypted set");
  assert(w.lastUsedAt === null, "lastUsedAt starts null — RECON REG-006 field");
  assert(w.createdAt && w.updatedAt, "timestamps populated");
});

test("createWallet read-only watch-only (no privateKey) — hasPrivateKey is false", async () => {
  const w = await walletManager.createWallet({
    label: "test-watch-only",
    type: "evm",
    address: "0xabc0000000000000000000000000000000000002",
    chain: "arbitrum",
    readOnly: true,
  });
  assertEq(w.hasPrivateKey, false, "hasPrivateKey false when no privateKey");
  assertEq(w.readOnly, true, "readOnly true");
});

test("listWallets returns created rows with all fields", async () => {
  const rows = await walletManager.listWallets();
  assertEq(rows.length, 2, "two wallets created so far");
  // Verify the reconstructed fields are present in the listed rows.
  for (const r of rows) {
    assert(r.chain !== undefined, `chain must not be undefined for ${r.label}`);
    assert(r.publicKey !== undefined, `publicKey must not be undefined for ${r.label}`);
    assert(r.lastUsedAt !== undefined, `lastUsedAt must not be undefined for ${r.label}`);
  }
});

test("setWalletActive flips isActive AND writes lastUsedAt", async () => {
  const rows = await walletManager.listWallets();
  const target = rows[0];
  await walletManager.setWalletActive(target.id, true);
  const after = await db.walletConnection.findUnique({ where: { id: target.id } });
  assertEq(after.isActive, true, "isActive true after activation");
  assert(after.lastUsedAt !== null, "lastUsedAt populated after activation — RECON REG-006 field");
  // Deactivate — lastUsedAt should still be touched.
  await walletManager.setWalletActive(target.id, false);
  const after2 = await db.walletConnection.findUnique({ where: { id: target.id } });
  assertEq(after2.isActive, false, "isActive false after deactivation");
});

test("setWalletActive(true) deactivates all others — only one active at a time", async () => {
  const rows = await walletManager.listWallets();
  // Activate row 0, then row 1 — row 0 should auto-deactivate.
  await walletManager.setWalletActive(rows[0].id, true);
  await walletManager.setWalletActive(rows[1].id, true);
  const active = await db.walletConnection.findMany({ where: { isActive: true } });
  assertEq(active.length, 1, "exactly one wallet active after mutual activation");
  assertEq(active[0].id, rows[1].id, "the most recently activated wallet is the one that's active");
});

test("deleteWallet removes the row", async () => {
  const before = (await walletManager.listWallets()).length;
  const target = (await walletManager.listWallets())[0];
  await walletManager.deleteWallet(target.id);
  const after = (await walletManager.listWallets()).length;
  assertEq(after, before - 1, "row count decreased by 1 after delete");
});

test("createExchange with full field set — all 8 ExchangeConnection columns are populated", async () => {
  await cleanupAll();
  const ex = await walletManager.createExchange({
    label: "test-binance",
    exchange: "binance",
    apiKey: "AXBTKEY1234567890",
    apiSecret: "secret000000000000000000000000000000000000000000000000000000000",
    passphrase: "encryption-pass",
    testnet: true,
    ipWhitelistConfigured: true,
  });
  assertEq(ex.label, "test-binance", "label round-trip");
  assertEq(ex.exchange, "binance", "exchange round-trip");
  assert(ex.apiKeyPrefix !== null && ex.apiKeyPrefix !== undefined, "apiKeyPrefix populated — RECON REG-006 field");
  assert(ex.apiKeyPrefix.includes("AXBT"), "apiKeyPrefix contains prefix chars");
  assert(ex.permissions !== null, "permissions populated — RECON REG-006 field");
  assertEq(ex.permissions?.read, true, "permissions.read hardcoded true");
  assertEq(ex.permissions?.trade, true, "permissions.trade hardcoded true");
  assertEq(ex.permissions?.withdraw, false, "permissions.withdraw hardcoded FALSE (security)");
  assertEq(ex.testnet, true, "testnet round-trip — RECON REG-006 field");
  assertEq(ex.ipWhitelistConfigured, true, "ipWhitelistConfigured round-trip — RECON REG-006 field");
  assertEq(ex.isActive, false, "isActive defaults false");
  assert(ex.lastUsedAt === null, "lastUsedAt starts null — RECON REG-006 field");
});

test("createExchange without optional fields — defaults are applied", async () => {
  const ex = await walletManager.createExchange({
    label: "test-kraken-defaults",
    exchange: "kraken",
    apiKey: "KRAKENKEY5678",
    apiSecret: "krakensecret",
    passphrase: "encryption-pass",
  });
  assertEq(ex.testnet, false, "testnet defaults false");
  assertEq(ex.ipWhitelistConfigured, false, "ipWhitelistConfigured defaults false");
  assertEq(ex.permissions?.withdraw, false, "withdraw still hardcoded false");
});

test("listExchanges returns rows with all reconstructed fields", async () => {
  const rows = await walletManager.listExchanges();
  assertEq(rows.length, 2, "two exchanges created");
  for (const r of rows) {
    assert(r.apiKeyPrefix !== undefined, `apiKeyPrefix must not be undefined for ${r.label}`);
    assert(r.permissions !== undefined, `permissions must not be undefined for ${r.label}`);
    assert(r.testnet !== undefined, `testnet must not be undefined for ${r.label}`);
    assert(r.ipWhitelistConfigured !== undefined, `ipWhitelistConfigured must not be undefined for ${r.label}`);
    assert(r.lastUsedAt !== undefined, `lastUsedAt must not be undefined for ${r.label}`);
  }
});

test("setExchangeActive writes lastUsedAt and deactivates others", async () => {
  const rows = await walletManager.listExchanges();
  await walletManager.setExchangeActive(rows[0].id, true);
  await walletManager.setExchangeActive(rows[1].id, true);
  const active = await db.exchangeConnection.findMany({ where: { isActive: true } });
  assertEq(active.length, 1, "exactly one exchange active");
  assertEq(active[0].id, rows[1].id, "the most recently activated is the active one");
  assert(active[0].lastUsedAt !== null, "lastUsedAt populated after activation");
});

test("deleteExchange removes the row", async () => {
  const before = (await walletManager.listExchanges()).length;
  const target = (await walletManager.listExchanges())[0];
  await walletManager.deleteExchange(target.id);
  const after = (await walletManager.listExchanges()).length;
  assertEq(after, before - 1, "row count decreased by 1 after delete");
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  // Lazy-load so DATABASE_URL is set before @/lib/db reads it.
  const wm = await import("../src/lib/trading/wallet-manager");
  walletManager = wm;
  const { db: dbInstance } = await import("../src/lib/db");
  db = dbInstance;

  await cleanupAll();

  console.log("=== Wallet CRUD Structural Test Suite (Phase 1 / REG-006) ===");
  console.log("");
  console.log("  (exercises the REAL wallet-manager.ts CRUD layer against the real SQLite DB)");
  console.log("");

  for (const t of tests) {
    process.stdout.write(`  ${t.name}... `);
    try {
      await t.fn();
      console.log("✓ PASS");
      passed++;
    } catch (err: any) {
      console.log(`✗ FAIL`);
      console.log(`    ${err?.message ?? err}`);
      failed++;
    }
  }

  console.log("");
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);

  await cleanupAll();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
