/**
 * M3.2 — Signer RPC handler test suite (signTransaction / signTypedData / signMessage).
 *
 * This file proves the three sign handlers (src/signer/sign-methods.ts)
 * honor the operator's M3.2 closed scope:
 *
 *   1. validate protocol (done by dispatchRpc — covered indirectly)
 *   2. verify vault is unlocked
 *   3. validate preconditions (writer lease — M4 seam, no-op)
 *   4. sign with the wallet key
 *   5. return the result
 *
 * Adversarial test matrix (per operator's M3.2 directive):
 *   - vault locked              → SIGNER_VAULT_LOCKED
 *   - payload altered           → SIGNER_PAYLOAD_CORRUPTED (hash mismatch)
 *   - incompatible protocol     → SIGNER_PROTOCOL_MISMATCH (dispatcher)
 *   - invalid format            → SIGNER_INVALID_PARAMS
 *   - unauthorized (no wallet)  → SIGNER_UNAUTHORIZED
 *   - repeated signing          → same payload → same signature (RFC 6979)
 *   - internal signer error     → exception propagates (LAYER 2)
 *   - exact payload preservation → bytes signed match bytes sent
 *
 * The tests spawn a REAL signer process + use a REAL Unix socket + seed
 * a REAL test wallet into the DB. No mocks for the signer-side code —
 * only the adapter side is mocked where needed.
 *
 * Run: npx tsx scripts/test-m3-signer-handlers.ts
 */

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { randomBytes, createHash, randomUUID } from "node:crypto";

import { Wallet, Transaction, verifyMessage, verifyTypedData } from "ethers";

import {
  SIGNER_PROTOCOL_VERSION,
  type SignHandlerParams,
} from "../src/lib/signer-protocol";
import { SignHandlerError } from "../src/signer/sign-methods";

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  \u2713 PASS`);
    pass++;
  } else {
    console.log(`  \u2717 FAIL: ${msg}`);
    fail++;
    process.exitCode = 1;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok = actual === expected;
  if (ok) {
    console.log(`  \u2713 PASS — ${label}`);
    pass++;
  } else {
    console.log(`  \u2717 FAIL — ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    fail++;
    process.exitCode = 1;
  }
}

function assertStartsWith(actual: string, prefix: string, label: string): void {
  if (actual.startsWith(prefix)) {
    console.log(`  \u2713 PASS — ${label}`);
    pass++;
  } else {
    console.log(`  \u2717 FAIL — ${label}: expected prefix "${prefix}", got ${JSON.stringify(actual)}`);
    fail++;
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Real signer process fixture
// ---------------------------------------------------------------------------

interface SignerHandle {
  child: ChildProcess;
  socketPath: string;
  pid: number;
  auditLogPath: string;
}

async function spawnSigner(auditLogPath: string): Promise<SignerHandle> {
  const socketPath = `/tmp/signer-m3-handlers-${process.pid}-${Date.now()}.sock`;
  try {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  } catch { /* ignore */ }

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
        DISABLE_CRASH_HANDLERS: "1",
      },
    },
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
          resolve({ child, socketPath: msg.socketPath, pid: msg.pid, auditLogPath });
        }
      } catch { /* not JSON */ }
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`signer exited before SIGNER_READY (code=${code}, signal=${signal})`));
    });
  });
}

async function stopSigner(handle: SignerHandle): Promise<void> {
  if (handle.child.stdin && !handle.child.stdin.destroyed) {
    handle.child.stdin.end();
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try { handle.child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve();
    }, 3000);
    handle.child.on("exit", () => { clearTimeout(timeout); resolve(); });
  });
  try { if (fs.existsSync(handle.socketPath)) fs.unlinkSync(handle.socketPath); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Real Unix-socket RPC client
// ---------------------------------------------------------------------------

async function sendRpc(
  socketPath: string,
  method: string,
  params?: unknown,
  timeoutMs = 5000,
): Promise<{ jsonrpc: string; result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown }; id: number | string | null }> {
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

// ---------------------------------------------------------------------------
// DB seed helper — creates a real wallet with a real private key
// ---------------------------------------------------------------------------

interface TestWallet {
  walletId: string;
  address: string;
  privateKey: string;
  chain: string;
}

async function seedTestWallet(
  passphrase: string,
  chain: string = "base",
): Promise<TestWallet> {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const { db } = await import("../src/lib/db");
  const { encryptSecret } = await import("../src/lib/trading/wallet-crypto");

  // Generate a real keypair using ethers.
  const wallet = Wallet.createRandom();
  const privateKey = wallet.privateKey;
  const address = wallet.address;

  const encrypted = encryptSecret(privateKey, passphrase);

  await db.walletConnection.deleteMany({});
  await db.exchangeConnection.deleteMany({});

  const row = await db.walletConnection.create({
    data: {
      label: "test-m3-handlers",
      type: "evm",
      address,
      chain,
      privateKeyEncrypted: encrypted,
      isActive: false,
      readOnly: false,
    },
  });

  return { walletId: row.id, address, privateKey, chain };
}

async function cleanupTestWallets(): Promise<void> {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const { db } = await import("../src/lib/db");
  await db.walletConnection.deleteMany({});
  await db.exchangeConnection.deleteMany({});
}

// ---------------------------------------------------------------------------
// Wire envelope builders
// ---------------------------------------------------------------------------

function sha256Canonical(obj: unknown): string {
  const canonical = JSON.stringify(obj);
  return "0x" + createHash("sha256").update(canonical, "utf8").digest("hex");
}

function buildSignEnvelope(
  operation: "signTransaction" | "signTypedData" | "signMessage",
  payload: Record<string, unknown>,
): SignHandlerParams {
  // The frozen adapter payload fields must always be present (the
  // signer's validateEnvelope requires them).
  const fullPayload = {
    tx: payload.tx ?? { from: "0x0", to: "0x0", value: "0", data: "0x" },
    expectedDiff: payload.expectedDiff ?? { changes: [] },
    approvedAmount: payload.approvedAmount ?? "0",
    slippageLimitBps: payload.slippageLimitBps ?? 0,
    sandwichScore: payload.sandwichScore ?? 0,
    ...payload,
  };
  return {
    protocolVersion: SIGNER_PROTOCOL_VERSION,
    requestId: randomUUID(),
    operation,
    payload: fullPayload as SignHandlerParams["payload"],
    payloadHash: sha256Canonical(fullPayload),
  };
}

function buildValidSignTransactionEnvelope(signerAddress: string): SignHandlerParams {
  return buildSignEnvelope("signTransaction", {
    tx: {
      from: signerAddress,
      to: "0x0000000000000000000000000000000000000002",
      value: "0",
      data: "0x",
    },
  });
}

function buildValidSignMessageEnvelope(signerAddress: string, message: string): SignHandlerParams {
  return buildSignEnvelope("signMessage", {
    tx: { from: signerAddress, to: "0x0", value: "0", data: "0x" },
    message,
  });
}

function buildValidSignTypedDataEnvelope(signerAddress: string): SignHandlerParams {
  return buildSignEnvelope("signTypedData", {
    tx: { from: signerAddress, to: "0x0", value: "0", data: "0x" },
    typedData: {
      domain: {
        name: "TestApp",
        version: "1",
        chainId: 8453,
        verifyingContract: "0x0000000000000000000000000000000000000001",
      },
      types: {
        TestMessage: [{ name: "content", type: "string" }],
      },
      primaryType: "TestMessage",
      message: { content: "hello world" },
    },
  });
}

// =========================================================================
// Tests
// =========================================================================

async function main(): Promise<void> {
  console.log("=== M3.2 — Signer RPC Handler Test Suite ===\n");
  console.log("  (real signer process, real socket, real DB-backed wallet)\n");

  const passphrase = "m3-handlers-test-passphrase-67890";
  const auditLogPath = `/tmp/signer-m3-handlers-audit-${process.pid}-${Date.now()}.log`;

  // Seed the wallet BEFORE spawning the signer (so unlock can find it).
  const wallet = await seedTestWallet(passphrase, "base");
  console.log(`  (seeded wallet ${wallet.walletId} address=${wallet.address} chain=${wallet.chain})`);

  let handle: SignerHandle | null = null;
  try {
    handle = await spawnSigner(auditLogPath);
    console.log(`  (spawned signer pid=${handle.pid}, socket=${handle.socketPath})\n`);

    // Unlock the vault so signing can proceed.
    const unlockResp = await sendRpc(handle.socketPath, "unlock", {
      passphrase,
      sourceIp: "127.0.0.1",
    });
    if (unlockResp.error) {
      console.log(`  FATAL: unlock failed — ${JSON.stringify(unlockResp.error)}`);
      process.exit(1);
    }
    console.log(`  (vault unlocked, walletCount=${unlockResp.result?.walletCount})\n`);

    // -------------------------------------------------------------------------
    // A. FUNCTIONAL BASELINE — happy paths
    // -------------------------------------------------------------------------

    console.log("A.1 — signTransaction with unlocked vault → ok=true, txHash + rawSignedTx");
    {
      const env = buildValidSignTransactionEnvelope(wallet.address);
      const resp = await sendRpc(handle.socketPath, "signTransaction", env);
      assert(!resp.error, `A.1: no RPC error (got ${JSON.stringify(resp.error)})`);
      const result = resp.result as { ok: boolean; txHash?: string; rawSignedTx?: string; requestId: string; receivedPayloadHash: string; signerVersion: string };
      assertEqual(result.ok, true, "A.1: result.ok is true");
      assert(typeof result.txHash === "string" && result.txHash.startsWith("0x") && result.txHash.length === 66, "A.1: txHash is a 32-byte hex string");
      assert(typeof result.rawSignedTx === "string" && result.rawSignedTx.startsWith("0x"), "A.1: rawSignedTx is a hex string");
      assertEqual(result.requestId, env.requestId, "A.1: requestId echoed correctly");
      assertEqual(result.receivedPayloadHash, env.payloadHash, "A.1: receivedPayloadHash matches envelope's payloadHash");
      assertEqual(result.signerVersion, SIGNER_PROTOCOL_VERSION, "A.1: signerVersion matches");

      // Verify the signed tx is parseable + recovers the wallet address.
      const parsed = Transaction.from(result.rawSignedTx!);
      assertEqual((parsed.from ?? "").toLowerCase(), wallet.address.toLowerCase(), "A.1: signed tx recovers wallet address");
      assertEqual(parsed.hash, result.txHash, "A.1: parsed.hash matches returned txHash");
    }

    console.log("\nA.2 — signTypedData with unlocked vault → ok=true, signature");
    {
      const env = buildValidSignTypedDataEnvelope(wallet.address);
      const resp = await sendRpc(handle.socketPath, "signTypedData", env);
      assert(!resp.error, `A.2: no RPC error (got ${JSON.stringify(resp.error)})`);
      const result = resp.result as { ok: boolean; signature?: string; requestId: string; receivedPayloadHash: string };
      assertEqual(result.ok, true, "A.2: result.ok is true");
      assert(typeof result.signature === "string" && result.signature.startsWith("0x") && result.signature.length === 132, "A.2: signature is a 65-byte hex string");
      assertEqual(result.requestId, env.requestId, "A.2: requestId echoed correctly");
      assertEqual(result.receivedPayloadHash, env.payloadHash, "A.2: receivedPayloadHash matches");

      // Verify the signature with ethers' verifyTypedData.
      const td = env.payload.typedData!;
      const recovered = verifyTypedData(
        td.domain as Parameters<typeof verifyTypedData>[0],
        td.types as Parameters<typeof verifyTypedData>[1],
        td.message as Parameters<typeof verifyTypedData>[2],
        result.signature!,
      );
      assertEqual(recovered.toLowerCase(), wallet.address.toLowerCase(), "A.2: verifyTypedData recovers wallet address");
    }

    console.log("\nA.3 — signMessage with unlocked vault → ok=true, signature");
    {
      const message = "hello m3.2 signMessage test";
      const env = buildValidSignMessageEnvelope(wallet.address, message);
      const resp = await sendRpc(handle.socketPath, "signMessage", env);
      assert(!resp.error, `A.3: no RPC error (got ${JSON.stringify(resp.error)})`);
      const result = resp.result as { ok: boolean; signature?: string; requestId: string; receivedPayloadHash: string };
      assertEqual(result.ok, true, "A.3: result.ok is true");
      assert(typeof result.signature === "string" && result.signature.startsWith("0x") && result.signature.length === 132, "A.3: signature is a 65-byte hex string");
      assertEqual(result.requestId, env.requestId, "A.3: requestId echoed correctly");
      assertEqual(result.receivedPayloadHash, env.payloadHash, "A.3: receivedPayloadHash matches");

      // Verify with ethers' verifyMessage (EIP-191 personal_sign).
      const recovered = verifyMessage(message, result.signature!);
      assertEqual(recovered.toLowerCase(), wallet.address.toLowerCase(), "A.3: verifyMessage recovers wallet address");
    }

    // -------------------------------------------------------------------------
    // B. ADVERSARIAL — per operator's M3.2 directive
    // -------------------------------------------------------------------------

    console.log("\nB.1 — vault locked → SIGNER_VAULT_LOCKED for all three operations");
    {
      // Lock the vault.
      await sendRpc(handle.socketPath, "lock", { reason: "test-b1", sourceIp: "127.0.0.1" });

      const env1 = buildValidSignTransactionEnvelope(wallet.address);
      const r1 = await sendRpc(handle.socketPath, "signTransaction", env1);
      const res1 = r1.result as { ok: boolean; error?: string };
      assertEqual(res1.ok, false, "B.1.a: signTransaction with locked vault → ok=false");
      assert(res1.error !== undefined && res1.error.includes("SIGNER_VAULT_LOCKED"), "B.1.a: error mentions SIGNER_VAULT_LOCKED");

      const env2 = buildValidSignTypedDataEnvelope(wallet.address);
      const r2 = await sendRpc(handle.socketPath, "signTypedData", env2);
      const res2 = r2.result as { ok: boolean; error?: string };
      assertEqual(res2.ok, false, "B.1.b: signTypedData with locked vault → ok=false");
      assert(res2.error !== undefined && res2.error.includes("SIGNER_VAULT_LOCKED"), "B.1.b: error mentions SIGNER_VAULT_LOCKED");

      const env3 = buildValidSignMessageEnvelope(wallet.address, "test");
      const r3 = await sendRpc(handle.socketPath, "signMessage", env3);
      const res3 = r3.result as { ok: boolean; error?: string };
      assertEqual(res3.ok, false, "B.1.c: signMessage with locked vault → ok=false");
      assert(res3.error !== undefined && res3.error.includes("SIGNER_VAULT_LOCKED"), "B.1.c: error mentions SIGNER_VAULT_LOCKED");

      // Re-unlock for subsequent tests.
      await sendRpc(handle.socketPath, "unlock", { passphrase, sourceIp: "127.0.0.1" });
    }

    console.log("\nB.2 — payload altered (payloadHash mismatch) → SIGNER_PAYLOAD_CORRUPTED");
    {
      const env = buildValidSignTransactionEnvelope(wallet.address);
      // Tamper with the payload's value AFTER the hash was computed.
      const tampered: SignHandlerParams = {
        ...env,
        payload: { ...env.payload, tx: { ...env.payload.tx, value: "9999999999999999999" } },
      };
      const resp = await sendRpc(handle.socketPath, "signTransaction", tampered);
      assert(!resp.error, `B.2: no RPC error (got ${JSON.stringify(resp.error)})`);
      const result = resp.result as { ok: boolean; error?: string; requestId: string; receivedPayloadHash: string };
      assertEqual(result.ok, false, "B.2: result.ok is false (payload corrupted)");
      assert(result.error !== undefined && result.error.startsWith(SignHandlerError.PAYLOAD_CORRUPTED), `B.2: error starts with ${SignHandlerError.PAYLOAD_CORRUPTED}`);
      assertEqual(result.requestId, env.requestId, "B.2: requestId still echoed (even on failure)");
      // receivedPayloadHash should be the recomputed hash of the TAMPERED payload,
      // NOT the original envelope's payloadHash — the signer detected the mismatch.
      assert(result.receivedPayloadHash !== env.payloadHash, "B.2: receivedPayloadHash differs from envelope's payloadHash (signer recomputed)");
    }

    console.log("\nB.3 — incompatible protocol → SIGNER_PROTOCOL_MISMATCH (dispatcher)");
    {
      const env = buildValidSignTransactionEnvelope(wallet.address);
      const bad: SignHandlerParams = { ...env, protocolVersion: "0.0.0-bad-version" };
      const resp = await sendRpc(handle.socketPath, "signTransaction", bad);
      // The dispatcher rejects with POLICY_VIOLATION (-32006) + SIGNER_PROTOCOL_MISMATCH in the message.
      assert(resp.error !== undefined, "B.3: RPC error returned (dispatcher rejection)");
      assertEqual(resp.error?.code, -32006, "B.3: error code is POLICY_VIOLATION (-32006)");
      assert(resp.error?.message.includes("SIGNER_PROTOCOL_MISMATCH"), "B.3: error message includes SIGNER_PROTOCOL_MISMATCH");
    }

    console.log("\nB.4 — invalid format (malformed envelope) → SIGNER_INVALID_PARAMS");
    {
      // Case B.4.a: not an object.
      const r1 = await sendRpc(handle.socketPath, "signTransaction", "not-an-object");
      const res1 = r1.result as { ok: boolean; error?: string };
      assertEqual(res1.ok, false, "B.4.a: non-object envelope → ok=false");
      assert(res1.error !== undefined && res1.error.includes(SignHandlerError.INVALID_PARAMS), "B.4.a: error mentions SIGNER_INVALID_PARAMS");

      // Case B.4.b: missing requestId.
      const env2 = buildValidSignTransactionEnvelope(wallet.address);
      const bad2 = { ...env2, requestId: undefined } as unknown as SignHandlerParams;
      const r2 = await sendRpc(handle.socketPath, "signTransaction", bad2);
      const res2 = r2.result as { ok: boolean; error?: string };
      assertEqual(res2.ok, false, "B.4.b: missing requestId → ok=false");
      assert(res2.error !== undefined && res2.error.includes(SignHandlerError.INVALID_PARAMS), "B.4.b: error mentions SIGNER_INVALID_PARAMS");

      // Case B.4.c: operation field mismatch (envelope says signTypedData but method is signTransaction).
      const env3 = buildValidSignTypedDataEnvelope(wallet.address);
      const r3 = await sendRpc(handle.socketPath, "signTransaction", env3);
      const res3 = r3.result as { ok: boolean; error?: string };
      assertEqual(res3.ok, false, "B.4.c: operation mismatch → ok=false");
      assert(res3.error !== undefined && res3.error.includes(SignHandlerError.INVALID_PARAMS), "B.4.c: error mentions SIGNER_INVALID_PARAMS");

      // Case B.4.d: signTypedData without typedData field.
      const env4 = buildSignEnvelope("signTypedData", {
        tx: { from: wallet.address, to: "0x0", value: "0", data: "0x" },
        // no typedData!
      });
      const r4 = await sendRpc(handle.socketPath, "signTypedData", env4);
      const res4 = r4.result as { ok: boolean; error?: string };
      assertEqual(res4.ok, false, "B.4.d: signTypedData without typedData → ok=false");
      assert(res4.error !== undefined && res4.error.includes(SignHandlerError.INVALID_PARAMS), "B.4.d: error mentions SIGNER_INVALID_PARAMS");

      // Case B.4.e: signMessage without message field.
      const env5 = buildSignEnvelope("signMessage", {
        tx: { from: wallet.address, to: "0x0", value: "0", data: "0x" },
        // no message!
      });
      const r5 = await sendRpc(handle.socketPath, "signMessage", env5);
      const res5 = r5.result as { ok: boolean; error?: string };
      assertEqual(res5.ok, false, "B.4.e: signMessage without message → ok=false");
      assert(res5.error !== undefined && res5.error.includes(SignHandlerError.INVALID_PARAMS), "B.4.e: error mentions SIGNER_INVALID_PARAMS");
    }

    console.log("\nB.5 — unauthorized (no wallet matches tx.from) → SIGNER_UNAUTHORIZED");
    {
      // Use a random address that doesn't match any wallet in the vault.
      const randomAddress = "0x" + randomBytes(20).toString("hex");
      const env = buildValidSignTransactionEnvelope(randomAddress);
      const resp = await sendRpc(handle.socketPath, "signTransaction", env);
      assert(!resp.error, `B.5: no RPC error (got ${JSON.stringify(resp.error)})`);
      const result = resp.result as { ok: boolean; error?: string; requestId: string };
      assertEqual(result.ok, false, "B.5: result.ok is false (unauthorized)");
      assert(result.error !== undefined && result.error.startsWith(SignHandlerError.UNAUTHORIZED), `B.5: error starts with ${SignHandlerError.UNAUTHORIZED}`);
      assert(result.error !== undefined && result.error.includes(randomAddress.toLowerCase()) || (result.error?.includes(randomAddress)), "B.5: error mentions the unauthorized address");
      assertEqual(result.requestId, env.requestId, "B.5: requestId echoed even on unauthorized");
    }

    console.log("\nB.6 — repeated signing → same payload produces same signature (RFC 6979 deterministic ECDSA)");
    {
      // signMessage is deterministic per RFC 6979 (ethers uses this).
      // Same payload → same signature. This is a security property: an
      // attacker observing two signatures from the same payload cannot
      // extract the private key (because the nonce is deterministic, not
      // random — eliminates the Sony PS3 / Android Bitcoin wallet nonce
      // reuse vulnerability class).
      const message = "repeated-signing-test-message";
      const env = buildValidSignMessageEnvelope(wallet.address, message);

      const r1 = await sendRpc(handle.socketPath, "signMessage", env);
      const r2 = await sendRpc(handle.socketPath, "signMessage", env);

      const sig1 = (r1.result as { signature: string }).signature;
      const sig2 = (r2.result as { signature: string }).signature;

      assert(typeof sig1 === "string" && sig1.startsWith("0x"), "B.6: first signature is hex");
      assert(typeof sig2 === "string" && sig2.startsWith("0x"), "B.6: second signature is hex");
      assertEqual(sig1, sig2, "B.6: two signatures over the same payload are identical (RFC 6979)");

      // Cross-verify: ethers.Wallet.signMessage produces the same signature.
      const direct = await new Wallet(wallet.privateKey).signMessage(message);
      assertEqual(sig1, direct, "B.6: signer's signature matches direct ethers.Wallet.signMessage");
    }

    console.log("\nB.7 — internal signer error → exception propagates (LAYER 2 discipline)");
    {
      // We can't easily trigger a real internal error without modifying
      // the signer. Instead, we verify the LAYER 2 discipline is
      // structurally present: the dispatcher does NOT catch handler
      // exceptions. We do this by sending a request that triggers a
      // handler-internal TypeError (passing a payload with a numeric
      // value where a string is expected in a way the runtime will
      // throw on, but the envelope validator doesn't catch).
      //
      // Actually, our validator is strict — it catches most malformed
      // inputs. The realistic internal error scenario is: a wallet key
      // is corrupted (decrypted to garbage) and ethers throws on
      // `new Wallet(garbage)`. We can't easily simulate this without
      // modifying the vault.
      //
      // Instead, we rely on the structural test already in
      // test-signer-dispatcher-structural.ts which proves the LAYER 2
      // discipline via the __test_throw hook. For M3.2, we verify that
      // the sign-methods.ts file does NOT wrap the sign call in a
      // try/catch — by inspecting the source code (静态 check).
      //
      // This is a documented gap in the M3.2 test suite — the
      // structural LAYER 2 test already covers the dispatcher, and
      // sign-methods.ts follows the same discipline (no top-level
      // try/catch in handleSignTransaction / handleSignTypedData /
      // handleSignMessage).
      const signMethodsSrc = fs.readFileSync(
        path.join(__dirname, "..", "src", "signer", "sign-methods.ts"),
        "utf8",
      );
      // The handlers must NOT have a top-level try/catch around the
      // wallet.signTransaction / wallet.signTypedData / wallet.signMessage
      // calls. (Inner try/catch around specific EXPECTED errors is OK;
      // a top-level catch that swallows exceptions is NOT.)
      const hasTopLevelCatch = /async function handleSign(Transaction|TypedData|Message)[\s\S]*?catch\s*\(/.test(signMethodsSrc);
      assert(!hasTopLevelCatch, "B.7: sign-methods.ts handlers do NOT wrap sign calls in try/catch (LAYER 2 discipline)");
      // The dispatcher in main.ts also must not catch handler exceptions.
      // We check that the `handleSignMethod(method, _params)` call is NOT
      // immediately followed by a `.catch()` — i.e., the dispatcher
      // returns the promise directly without attaching a catch handler.
      const mainSrc = fs.readFileSync(
        path.join(__dirname, "..", "src", "signer", "main.ts"),
        "utf8",
      );
      // Extract the dispatchRpc function body (from "function dispatchRpc"
      // to the next "^}" at column 0).
      const dispatchMatch = mainSrc.match(/function dispatchRpc\([\s\S]*?\n\}/);
      assert(dispatchMatch !== null, "B.7: found dispatchRpc function body in main.ts");
      const dispatchBody = dispatchMatch![0];
      const signMethodCallHasCatch = /isSignMethod[\s\S]*?handleSignMethod[\s\S]*?\.catch\s*\(/.test(dispatchBody);
      assert(!signMethodCallHasCatch, "B.7: dispatchRpc does NOT .catch() sign-method rejections (LAYER 2 discipline)");
      // Also explicitly verify the call shape is `return handleSignMethod(method, _params);`
      // with no .then().catch() chain.
      const hasDirectReturn = /return handleSignMethod\(method, _params\);/.test(dispatchBody);
      assert(hasDirectReturn, "B.7: dispatchRpc returns handleSignMethod promise directly (no .then/.catch chain)");
    }

    console.log("\nB.8 — exact preservation of signed payload (signMessage signs EXACTLY the bytes sent)");
    {
      // The signer must sign the EXACT bytes of payload.message — no
      // trimming, no re-encoding, no transformation. We verify by
      // cross-checking against ethers.Wallet.signMessage(payload.message)
      // computed independently in the test process.
      const message = "exact-payload-preservation-test-12345";
      const env = buildValidSignMessageEnvelope(wallet.address, message);

      const resp = await sendRpc(handle.socketPath, "signMessage", env);
      const result = resp.result as { ok: boolean; signature?: string };
      assertEqual(result.ok, true, "B.8: signMessage succeeded");

      // Independent computation: ethers.Wallet.signMessage in the test process.
      const directSig = await new Wallet(wallet.privateKey).signMessage(message);
      assertEqual(result.signature, directSig, "B.8: signer's signature matches direct ethers computation (exact payload preservation)");

      // Also verify with a non-ASCII message (multibyte UTF-8) to catch
      // encoding bugs.
      const unicodeMessage = "héllo wörld — 日本語 test 🚀";
      const env2 = buildValidSignMessageEnvelope(wallet.address, unicodeMessage);
      const resp2 = await sendRpc(handle.socketPath, "signMessage", env2);
      const result2 = resp2.result as { ok: boolean; signature?: string };
      assertEqual(result2.ok, true, "B.8.b: signMessage with unicode succeeded");
      const directSig2 = await new Wallet(wallet.privateKey).signMessage(unicodeMessage);
      assertEqual(result2.signature, directSig2, "B.8.b: unicode signature matches direct computation");
    }

    // -------------------------------------------------------------------------
    // C. INTEGRITY — echo fields are correct
    // -------------------------------------------------------------------------

    console.log("\nC.1 — requestId echo is correct (catches response confusion)");
    {
      const env = buildValidSignTransactionEnvelope(wallet.address);
      const resp = await sendRpc(handle.socketPath, "signTransaction", env);
      const result = resp.result as { requestId: string };
      assertEqual(result.requestId, env.requestId, "C.1: requestId echoed correctly");
    }

    console.log("\nC.2 — receivedPayloadHash echo is correct (catches payload corruption)");
    {
      const env = buildValidSignTransactionEnvelope(wallet.address);
      const resp = await sendRpc(handle.socketPath, "signTransaction", env);
      const result = resp.result as { receivedPayloadHash: string };
      assertEqual(result.receivedPayloadHash, env.payloadHash, "C.2: receivedPayloadHash matches envelope's payloadHash");
    }

    console.log("\nC.3 — signerVersion echo is correct");
    {
      const env = buildValidSignTransactionEnvelope(wallet.address);
      const resp = await sendRpc(handle.socketPath, "signTransaction", env);
      const result = resp.result as { signerVersion: string };
      assertEqual(result.signerVersion, SIGNER_PROTOCOL_VERSION, "C.3: signerVersion matches SIGNER_PROTOCOL_VERSION");
    }

    // -------------------------------------------------------------------------
    // D. PROTOCOL MISMATCH AT SIGNER (defense in depth)
    // -------------------------------------------------------------------------

    console.log("\nD.1 — signer-side protocol validation catches mismatch even when adapter would have allowed it");
    {
      // Simulate a direct RPC call (bypassing the adapter) with a wrong
      // protocolVersion. The signer's dispatchRpc must reject it.
      const env = buildValidSignTransactionEnvelope(wallet.address);
      const bad: SignHandlerParams = { ...env, protocolVersion: "99.99.99-future" };
      const resp = await sendRpc(handle.socketPath, "signTransaction", bad);
      assert(resp.error !== undefined, "D.1: RPC error returned");
      assertEqual(resp.error?.code, -32006, "D.1: error code is POLICY_VIOLATION");
      assert(resp.error?.message.includes("SIGNER_PROTOCOL_MISMATCH"), "D.1: message includes SIGNER_PROTOCOL_MISMATCH");
      assert(resp.error?.message.includes("99.99.99-future"), "D.1: message mentions the bad version");
      assert(resp.error?.message.includes(SIGNER_PROTOCOL_VERSION), "D.1: message mentions the signer's version");
    }

    // -------------------------------------------------------------------------
    // E. READONLY WALLET REJECTED
    // -------------------------------------------------------------------------

    console.log("\nE.1 — readOnly wallet cannot sign (defense in depth)");
    {
      // Save the original wallet's address so we can restore it after
      // this test (E.1 re-seeds the DB, which changes the walletId +
      // address — subsequent tests would fail if we don't restore).
      const originalAddress = wallet.address;
      const originalPrivateKey = wallet.privateKey;

      // Re-seed with a wallet, then mark it readOnly.
      await cleanupTestWallets();
      const roWallet = await seedTestWallet(passphrase, "base");
      process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
      const { db } = await import("../src/lib/db");
      await db.walletConnection.update({
        where: { id: roWallet.walletId },
        data: { readOnly: true },
      });

      // Lock + re-unlock to reload the vault.
      await sendRpc(handle.socketPath, "lock", { reason: "test-e1", sourceIp: "127.0.0.1" });
      await sendRpc(handle.socketPath, "unlock", { passphrase, sourceIp: "127.0.0.1" });

      const env = buildValidSignTransactionEnvelope(roWallet.address);
      const resp = await sendRpc(handle.socketPath, "signTransaction", env);
      const result = resp.result as { ok: boolean; error?: string };
      assertEqual(result.ok, false, "E.1: readOnly wallet → ok=false");
      assert(result.error !== undefined && result.error.startsWith(SignHandlerError.UNAUTHORIZED), `E.1: error starts with ${SignHandlerError.UNAUTHORIZED}`);

      // Restore the original (non-readonly) wallet for subsequent tests.
      // We re-seed with the ORIGINAL address + key so F.1+ can use
      // `wallet.address` (the variable captured at the top of main()).
      await cleanupTestWallets();
      process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
      const { db: db2 } = await import("../src/lib/db");
      const { encryptSecret } = await import("../src/lib/trading/wallet-crypto");
      await db2.walletConnection.create({
        data: {
          label: "test-m3-handlers-restored",
          type: "evm",
          address: originalAddress,
          chain: "base",
          privateKeyEncrypted: encryptSecret(originalPrivateKey, passphrase),
          isActive: false,
          readOnly: false,
        },
      });
      await sendRpc(handle.socketPath, "lock", { reason: "restore", sourceIp: "127.0.0.1" });
      const restoreUnlock = await sendRpc(handle.socketPath, "unlock", { passphrase, sourceIp: "127.0.0.1" });
      assertEqual(restoreUnlock.result?.unlocked, true, "E.1: vault re-unlocked after restore");
      assertEqual(restoreUnlock.result?.walletCount, 1, "E.1: original wallet restored");
    }

    // -------------------------------------------------------------------------
    // F. SIGNTRANSACTION WITH EXPLICIT CHAINID OVERRIDE
    // -------------------------------------------------------------------------

    console.log("\nF.1 — signTransaction with explicit payload.chainId override");
    {
      const env = buildSignEnvelope("signTransaction", {
        tx: {
          from: wallet.address,
          to: "0x0000000000000000000000000000000000000002",
          value: "0",
          data: "0x",
        },
        chainId: 1, // mainnet, override the wallet's "base" (8453)
      });
      const resp = await sendRpc(handle.socketPath, "signTransaction", env);
      const result = resp.result as { ok: boolean; rawSignedTx?: string; txHash?: string; error?: string };
      assertEqual(result.ok, true, `F.1: signTransaction with explicit chainId succeeded (error=${result.error ?? "none"})`);
      const parsed = Transaction.from(result.rawSignedTx!);
      // ethers v6 returns chainId as bigint — convert to Number for comparison.
      assertEqual(Number(parsed.chainId), 1, "F.1: signed tx has chainId=1 (overridden)");
    }

    // -------------------------------------------------------------------------
    // G. AUDIT LOG — sign events are recorded
    // -------------------------------------------------------------------------

    console.log("\nG.1 — audit log records sign_transaction_succeeded event");
    {
      // Read the audit log file. Look for the sign_transaction_succeeded entry.
      const auditContent = fs.readFileSync(handle.auditLogPath, "utf8");
      assert(auditContent.includes("sign_transaction_succeeded"), "G.1: audit log contains sign_transaction_succeeded");
      assert(auditContent.includes("sign_message_succeeded"), "G.1: audit log contains sign_message_succeeded");
      assert(auditContent.includes("sign_typed_data_succeeded"), "G.1: audit log contains sign_typed_data_succeeded");
      // Adversarial events should also be audited.
      assert(auditContent.includes("sign_vault_locked") || auditContent.includes("sign_payload_corrupted"), "G.1: audit log contains an adversarial event");
    }

  } finally {
    if (handle) await stopSigner(handle);
    await cleanupTestWallets();
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  console.log(`\n=== M3.2 Signer Handler Test Suite: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
