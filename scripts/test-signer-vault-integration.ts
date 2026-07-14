// scripts/test-signer-vault-integration.ts
//
// Phase 1 / M2.3: Real integration test for the unlock/lock/
// zeroize-on-disconnect cycle.
//
// This is M2.3 acceptance criterion 2: a REAL integration test against
// a live signer process + real Unix socket that exercises the full
// vault lifecycle:
//
//   1. Seed a test wallet (encrypted with a known passphrase) into the DB.
//   2. Spawn the signer with SIGNER_TEST_HOOKS=1 + SIGNER_AUDIT_LOG set.
//   3. __test_inspect_vault → verify vault starts locked, 0 wallets.
//   4. getVaultStatus → verify unlocked=false.
//   5. unlock with correct passphrase → verify success (walletCount=1).
//   6. __test_inspect_vault → verify vault now unlocked, 1 wallet.
//   7. getVaultStatus → verify unlocked=true.
//   8. lock → verify unlocked=false.
//   9. __test_inspect_vault → verify vault locked, 0 wallets (memory wiped).
//  10. unlock again (re-unlock after explicit lock).
//  11. Close stdin → trigger parent-disconnect handler.
//  12. Verify signer exits with code 0.
//  13. Read SIGNER_AUDIT_LOG → verify vault_zeroized_on_disconnect entry
//      with walletsWiped=1.
//
// This is NOT a unit test — it spawns the real signer process, opens a
// real Unix socket, and sends real JSON-RPC frames. The audit log file
// is the post-mortem proof that zeroization happened (we can't inspect
// the dead process's memory directly).
//
// Run with: npx tsx scripts/test-signer-vault-integration.ts

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERT FAILED: ${msg}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`
    );
  }
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log("✓ PASS");
    passed++;
  } catch (err) {
    console.log("✗ FAIL");
    console.log(`    ${String(err instanceof Error ? err.message : err)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Signer process fixture
// ---------------------------------------------------------------------------

interface SignerHandle {
  child: ChildProcess;
  socketPath: string;
  pid: number;
  auditLogPath: string;
}

async function spawnSignerForVaultTest(auditLogPath: string): Promise<SignerHandle> {
  const socketPath = `/tmp/signer-vault-${process.pid}-${Date.now()}.sock`;
  try {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  } catch {
    // ignore
  }

  const child = spawn(
    "npx",
    ["tsx", path.join(__dirname, "..", "src", "signer", "main.ts")],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        SIGNER_SOCKET_PATH: socketPath,
        SIGNER_TEST_HOOKS: "1",
        SIGNER_AUDIT_LOG: auditLogPath,
        // Disable crash handlers' process.exit so we can inspect state after
        // unexpected errors during test development. The audit log is still
        // written by our own code (zeroizeVaultForDisconnect).
        DISABLE_CRASH_HANDLERS: "1",
      },
    }
  );

  const stdoutRl = createInterface({ input: child.stdout! });

  return new Promise<SignerHandle>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`signer did not send SIGNER_READY within 10s`));
    }, 10000);

    stdoutRl.on("line", (line: string) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "SIGNER_READY") {
          clearTimeout(timeout);
          resolve({
            child,
            socketPath: msg.socketPath,
            pid: msg.pid,
            auditLogPath,
          });
        }
      } catch {
        // Not JSON — ignore.
      }
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(`signer exited before SIGNER_READY (code=${code}, signal=${signal})`)
      );
    });
  });
}

async function sendRpc(
  socketPath: string,
  method: string,
  params?: unknown,
  timeoutMs = 5000
): Promise<{ jsonrpc: string; result?: unknown; error?: { code: number; message: string; data?: unknown }; id: number | string | null }> {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const frame = JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}), id });

    const socket = net.createConnection(socketPath, () => {
      socket.write(frame + "\n");
    });

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`RPC ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const rl = createInterface({ input: socket });
    rl.on("line", (line: string) => {
      clearTimeout(timeout);
      try {
        const resp = JSON.parse(line);
        socket.end();
        resolve(resp);
      } catch (err) {
        socket.destroy();
        reject(new Error(`failed to parse response for ${method}: ${String(err)} (line=${line})`));
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`socket error on ${method}: ${String(err)}`));
    });
  });
}

async function waitForExit(child: ChildProcess, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve(null);
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

// ---------------------------------------------------------------------------
// DB seed helper
// ---------------------------------------------------------------------------

async function seedTestWallet(passphrase: string): Promise<{ walletId: string; address: string }> {
  // Lazy-load DB so DATABASE_URL is set before @/lib/db reads it.
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const { db } = await import("../src/lib/db");
  const { encryptSecret } = await import("../src/lib/trading/wallet-crypto");

  // Generate a random address + private key for the test wallet.
  const address = "0x" + randomBytes(20).toString("hex");
  const privateKey = "0x" + randomBytes(32).toString("hex");
  const encrypted = encryptSecret(privateKey, passphrase);

  // Clean up any leftover rows from previous runs.
  await db.walletConnection.deleteMany({});
  await db.exchangeConnection.deleteMany({});

  const row = await db.walletConnection.create({
    data: {
      label: "test-vault-integration",
      type: "evm",
      address,
      chain: "base",
      privateKeyEncrypted: encrypted,
      isActive: false,
      readOnly: false,
    },
  });

  return { walletId: row.id, address };
}

async function cleanupTestWallets(): Promise<void> {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const { db } = await import("../src/lib/db");
  await db.walletConnection.deleteMany({});
  await db.exchangeConnection.deleteMany({});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Signer Vault Integration Test Suite (Phase 1 / M2.3) ===\n");
  console.log("  (real integration: live signer process, real socket, unlock/lock/zeroize cycle)\n");

  await runTest(
    "REAL INTEGRATION: unlock → lock → unlock → disconnect → vault zeroized (audit log confirms)",
    async () => {
      const passphrase = "integration-test-passphrase-12345";
      const auditLogPath = `/tmp/signer-vault-audit-${process.pid}-${Date.now()}.log`;

      // Pre-seed the wallet in the DB.
      const { walletId, address } = await seedTestWallet(passphrase);

      const handle = await spawnSignerForVaultTest(auditLogPath);

      try {
        // -------------------------------------------------------------
        // Step 3: __test_inspect_vault → vault starts locked, 0 wallets.
        // -------------------------------------------------------------
        const inspect1 = await sendRpc(handle.socketPath, "__test_inspect_vault");
        assert(inspect1.result !== undefined, "inspect1 must return result");
        assertEq(inspect1.result?.unlocked, false, "vault must start locked");
        assertEq(inspect1.result?.walletCount, 0, "vault must start with 0 wallets in memory");

        // -------------------------------------------------------------
        // Step 4: getVaultStatus → unlocked=false.
        // -------------------------------------------------------------
        const status1 = await sendRpc(handle.socketPath, "getVaultStatus");
        assert(status1.result !== undefined, "status1 must return result");
        assertEq(status1.result?.unlocked, false, "getVaultStatus must report unlocked=false");

        // -------------------------------------------------------------
        // Step 5: unlock with correct passphrase → success.
        // -------------------------------------------------------------
        const unlock1 = await sendRpc(handle.socketPath, "unlock", {
          passphrase,
          sourceIp: "127.0.0.1",
        });
        assert(unlock1.result !== undefined, `unlock1 must return result — got error ${JSON.stringify(unlock1.error)}`);
        assertEq(unlock1.result?.unlocked, true, "unlock1 result.unlocked must be true");
        assertEq(unlock1.result?.walletCount, 1, "unlock1 must load exactly 1 wallet");
        assertEq(unlock1.result?.exchangeCount, 0, "unlock1 must load 0 exchanges");

        // -------------------------------------------------------------
        // Step 6: __test_inspect_vault → vault now unlocked, 1 wallet.
        // -------------------------------------------------------------
        const inspect2 = await sendRpc(handle.socketPath, "__test_inspect_vault");
        assertEq(inspect2.result?.unlocked, true, "after unlock, vault must be unlocked");
        assertEq(inspect2.result?.walletCount, 1, "after unlock, vault must have 1 wallet in memory");

        // -------------------------------------------------------------
        // Step 7: getVaultStatus → unlocked=true.
        // -------------------------------------------------------------
        const status2 = await sendRpc(handle.socketPath, "getVaultStatus");
        assertEq(status2.result?.unlocked, true, "getVaultStatus must report unlocked=true after unlock");
        assertEq(status2.result?.walletCount, 1, "getVaultStatus must report walletCount=1");

        // -------------------------------------------------------------
        // Step 8: lock → unlocked=false.
        // -------------------------------------------------------------
        const lock1 = await sendRpc(handle.socketPath, "lock", {
          reason: "manual-test",
          sourceIp: "127.0.0.1",
        });
        assertEq(lock1.result?.unlocked, false, "after lock, result.unlocked must be false");

        // -------------------------------------------------------------
        // Step 9: __test_inspect_vault → vault locked, 0 wallets (wiped).
        // -------------------------------------------------------------
        const inspect3 = await sendRpc(handle.socketPath, "__test_inspect_vault");
        assertEq(inspect3.result?.unlocked, false, "after lock, vault must be locked");
        assertEq(inspect3.result?.walletCount, 0, "after lock, vault must have 0 wallets in memory (wiped)");

        // -------------------------------------------------------------
        // Step 10: unlock again (re-unlock after explicit lock).
        // -------------------------------------------------------------
        const unlock2 = await sendRpc(handle.socketPath, "unlock", {
          passphrase,
          sourceIp: "127.0.0.1",
        });
        assertEq(unlock2.result?.unlocked, true, "re-unlock must succeed");
        assertEq(unlock2.result?.walletCount, 1, "re-unlock must load 1 wallet");

        // -------------------------------------------------------------
        // Step 11: Close stdin → trigger parent-disconnect handler.
        // -------------------------------------------------------------
        const exitPromise = waitForExit(handle.child, 5000);
        handle.child.stdin!.end();

        // -------------------------------------------------------------
        // Step 12: Verify signer exits with code 0.
        // -------------------------------------------------------------
        const exitCode = await exitPromise;
        assertEq(exitCode, 0, `signer must exit with code 0 on parent disconnect — got ${exitCode}`);

        // -------------------------------------------------------------
        // Step 13: Read SIGNER_AUDIT_LOG → verify vault_zeroized entry.
        // -------------------------------------------------------------
        // Give the filesystem a moment to flush.
        await new Promise((r) => setTimeout(r, 100));

        assert(
          fs.existsSync(auditLogPath),
          `audit log file must exist at ${auditLogPath} after disconnect`
        );

        const auditContent = fs.readFileSync(auditLogPath, "utf8");
        const auditLines = auditContent.trim().split("\n").filter(Boolean);

        // Find the vault_zeroized_on_disconnect entry.
        const zeroizeEntries = auditLines
          .map((line) => {
            try { return JSON.parse(line); } catch { return null; }
          })
          .filter((e) => e && e.event === "vault_zeroized_on_disconnect");

        assertEq(
          zeroizeEntries.length,
          1,
          `audit log must contain exactly 1 vault_zeroized_on_disconnect entry — got ${zeroizeEntries.length}`
        );

        const entry = zeroizeEntries[0];
        assertEq(entry.wasUnlocked, true, "audit entry must record wasUnlocked=true (vault was unlocked at disconnect)");
        assertEq(entry.walletsWiped, 1, "audit entry must record walletsWiped=1");
        assertEq(entry.exchangesWiped, 0, "audit entry must record exchangesWiped=0");
        assertEq(entry.unlockedAfter, false, "audit entry must record unlockedAfter=false (vault is locked after zeroize)");
        assertEq(entry.pid, handle.pid, "audit entry must record the signer's pid");
        assert(
          typeof entry.timestamp === "string" && entry.timestamp.length > 0,
          "audit entry must have a timestamp string"
        );

        // Clean up the audit log file.
        try { fs.unlinkSync(auditLogPath); } catch { /* ignore */ }
      } finally {
        // Ensure the child is dead (in case of test failure mid-run).
        try { handle.child.kill("SIGKILL"); } catch { /* ignore */ }
        try {
          if (fs.existsSync(handle.socketPath)) fs.unlinkSync(handle.socketPath);
        } catch { /* ignore */ }
      }
    }
  );

  // ---------------------------------------------------------------------
  // Complementary test: unlock with WRONG passphrase returns an
  // application error (NOT a crash). This verifies the LAYER 2 contract
  // from the other side — application errors are RETURNED, not thrown.
  // ---------------------------------------------------------------------
  await runTest(
    "COMPLEMENTARY: unlock with WRONG passphrase returns application error (does NOT crash)",
    async () => {
      const correctPassphrase = "correct-pass-12345";
      const wrongPassphrase = "wrong-pass-67890";
      const auditLogPath = `/tmp/signer-vault-audit-wrong-${process.pid}-${Date.now()}.log`;

      await seedTestWallet(correctPassphrase);
      const handle = await spawnSignerForVaultTest(auditLogPath);

      try {
        const unlockResp = await sendRpc(handle.socketPath, "unlock", {
          passphrase: wrongPassphrase,
          sourceIp: "127.0.0.1",
        });

        // The response must be an application error, NOT a crash.
        assert(unlockResp.error !== undefined, "wrong passphrase must return an error response");
        assert(
          unlockResp.error!.code === -32000 || unlockResp.error!.code === -32007,
          `wrong passphrase error code must be -32000 (WRONG_PASSPHRASE) or -32007 (RATE_LIMITED) — got ${unlockResp.error!.code}`
        );

        // The signer must STILL BE ALIVE (no crash). Verify with health_check.
        const health = await sendRpc(handle.socketPath, "health_check");
        assertEq(health.result?.status, "ok", "signer must still respond to health_check after wrong passphrase");

        // The vault must still be locked.
        const inspect = await sendRpc(handle.socketPath, "__test_inspect_vault");
        assertEq(inspect.result?.unlocked, false, "vault must remain locked after wrong passphrase");

        // Clean up.
        handle.child.stdin!.end();
        await waitForExit(handle.child, 3000);
        try { fs.unlinkSync(auditLogPath); } catch { /* ignore */ }
      } finally {
        try { handle.child.kill("SIGKILL"); } catch { /* ignore */ }
        try {
          if (fs.existsSync(handle.socketPath)) fs.unlinkSync(handle.socketPath);
        } catch { /* ignore */ }
      }
    }
  );

  // ---------------------------------------------------------------------
  // Complementary test: unlock on EMPTY vault (no wallets) returns an
  // application error (NOT a crash).
  // ---------------------------------------------------------------------
  await runTest(
    "COMPLEMENTARY: unlock on EMPTY vault returns application error (does NOT crash)",
    async () => {
      const auditLogPath = `/tmp/signer-vault-audit-empty-${process.pid}-${Date.now()}.log`;

      // Clean the DB so the vault has 0 wallets.
      await cleanupTestWallets();

      const handle = await spawnSignerForVaultTest(auditLogPath);

      try {
        const unlockResp = await sendRpc(handle.socketPath, "unlock", {
          passphrase: "any-passphrase",
          sourceIp: "127.0.0.1",
        });

        assert(unlockResp.error !== undefined, "empty vault unlock must return an error response");
        assertEq(
          unlockResp.error!.code,
          -32000,
          `empty vault error code must be -32000 — got ${unlockResp.error!.code}`
        );
        assert(
          unlockResp.error!.message.toLowerCase().includes("empty"),
          `empty vault error message must mention "empty" — got ${unlockResp.error!.message}`
        );

        // Signer still alive.
        const health = await sendRpc(handle.socketPath, "health_check");
        assertEq(health.result?.status, "ok", "signer must still respond to health_check after empty-vault unlock");

        handle.child.stdin!.end();
        await waitForExit(handle.child, 3000);
        try { fs.unlinkSync(auditLogPath); } catch { /* ignore */ }
      } finally {
        try { handle.child.kill("SIGKILL"); } catch { /* ignore */ }
        try {
          if (fs.existsSync(handle.socketPath)) fs.unlinkSync(handle.socketPath);
        } catch { /* ignore */ }
      }
    }
  );

  // Cleanup DB.
  await cleanupTestWallets();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
