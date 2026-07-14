// src/signer/sign-methods.ts
//
// M3.2 — Signer RPC handlers for the three sign methods
// (signTransaction, signTypedData, signMessage).
//
// SCOPE (operator-directed, closed):
//   Each handler implements exactly 5 steps:
//     1. validate protocol (done by dispatchRpc — per-request check)
//     2. verify vault is unlocked
//     3. validate preconditions (writer lease — M4 seam, currently no-op)
//     4. sign with the wallet key
//     5. return the result
//
// WHAT THE HANDLERS DO NOT DO (per operator's M3.2 scope):
//   - NO broadcast (M3.3 — Broadcaster)
//   - NO nonce management (M3.3 / M4)
//   - NO RPC submission to a chain node (M3.3)
//   - NO retries (M4 — writer lease serializes access)
//   - NO queues (M4)
//   - NO failover (single-signer architecture, forever)
//   - NO execution logic (the handlers sign what they're given; the
//     pipeline upstream already verified safety via H0/H1/H2/H2.6)
//
// CONTRACT (from signer-protocol.ts MethodHandler):
//   - Application errors (vault locked, wallet not found, payload hash
//     mismatch, malformed envelope, unauthorized) are RETURNED as
//     `{ ok: false, ... }` objects. The dispatcher never sees them.
//   - UNEXPECTED exceptions (TypeError, OOM, DB connection lost, ethers
//     internal error) PROPAGATE out of the handler → dispatcher →
//     readline 'line' listener → uncaughtException → crash-logger.ts →
//     process exits + restarts.
//
// The distinction: "vault is locked" is a normal application error
// (return -32008); "ethers threw a TypeError on a valid key" is a bug
// (let it propagate).
//
// WALLET LOOKUP
// -------------
// The frozen pipeline.ts sends `tx.from` (an address) in SignerRequest.
// The frozen wallet-crypto.ts WalletVault stores keys in a Map<walletId,
// privateKey> — there is NO public address→key lookup. We must NOT
// modify wallet-crypto.ts (it's in REG-009's frozen list under H0).
//
// Resolution: the sign handler queries the DB for WalletConnection rows
// matching `address = tx.from` (case-insensitive JS comparison — works
// on both SQLite test DB and PostgreSQL production DB), then calls
// `walletVault.getWalletKey(walletId)` for each match. The returned key
// is verified to derive the expected address (defense in depth —
// catches DB corruption where a row claims address=X but the key is for
// address=Y).
//
// PAYLOAD INTEGRITY
// -----------------
// The M3.1 adapter computes `payloadHash = SHA-256(canonical JSON of
// payload)` and sends it in the wire envelope. The signer recomputes
// the hash from the received payload and rejects on mismatch — this
// catches payload corruption in transit (e.g., a buggy transport that
// truncates or rewrites fields). This is DEFENSE IN DEPTH: the adapter
// already verified the hash on its side; the signer re-verifies on
// receipt because the trust boundary is at the signer, not the adapter.
//
// ADVERSARIAL TEST MATRIX (per operator's M3.2 directive)
// -------------------------------------------------------
// The M3.2 test suite (scripts/test-m3-signer-handlers.ts) covers:
//   - vault locked              → VAULT_LOCKED
//   - payload altered           → SIGNER_PAYLOAD_CORRUPTED (hash mismatch)
//   - incompatible protocol     → SIGNER_PROTOCOL_MISMATCH (dispatcher)
//   - invalid format            → INVALID_PARAMS
//   - unauthorized (no wallet)  → SIGNER_UNAUTHORIZED
//   - repeated signing          → same payload → same signature (RFC 6979)
//   - internal signer error     → exception propagates (LAYER 2)
//   - exact payload preservation → bytes signed match bytes sent

import { createHash } from "node:crypto";
import { Wallet } from "ethers";

import { walletVault } from "@/lib/trading/wallet-crypto";
import {
  RPC_ERROR_CODES,
  SIGNER_PROTOCOL_VERSION,
  type MethodHandlerResult,
  type SignHandlerParams,
  type SignHandlerResult,
  type SignPayload,
} from "@/lib/signer-protocol";
import { auditEvent } from "@/signer/audit";

// ---------------------------------------------------------------------------
// Constants — error code prefixes returned in `error` field.
// ---------------------------------------------------------------------------

/**
 * Error code prefixes for sign-method application errors. These appear as
 * the prefix of the `error` string in the SignHandlerResultFailure shape.
 * The caller can branch on the prefix.
 *
 * NOTE: these are application-level errors returned with `ok: false` in
 * the result — NOT RPC-level errors. RPC-level errors (vault locked,
 * protocol mismatch) use the JSON-RPC error codes from RPC_ERROR_CODES.
 */
export const SignHandlerError = {
  PAYLOAD_CORRUPTED: "SIGNER_PAYLOAD_CORRUPTED",
  UNAUTHORIZED: "SIGNER_UNAUTHORIZED",
  INVALID_PARAMS: "SIGNER_INVALID_PARAMS",
  PRECONDITION_FAILED: "SIGNER_PRECONDITION_FAILED",
  SIGN_FAILED: "SIGNER_SIGN_FAILED",
} as const;

// ---------------------------------------------------------------------------
// Chain name → chainId mapping.
// ---------------------------------------------------------------------------

/**
 * Map wallet `chain` field (from the DB) to a numeric chainId for EIP-155
 * signing. The wallet's chain is set at wallet-creation time; the signer
 * uses it to sign with the correct chainId.
 *
 * If the chain is unknown (not in this map), the signer refuses to sign —
 * better to fail closed than to sign with a wrong chainId that would make
 * the signature replayable on a different chain.
 *
 * Adding new chains here is a config change, not a code change — but it
 * does require a signer restart (the map is frozen at module load).
 */
const CHAIN_ID_BY_NAME: Record<string, number> = {
  mainnet: 1,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  // Test chains — used by integration tests that need a known chainId
  // without depending on a specific production chain.
  sepolia: 11155111,
  baseSepolia: 84532,
  hardhat: 31337,
};

// ---------------------------------------------------------------------------
// Public dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch a sign RPC to the appropriate handler.
 *
 * The `method` parameter is assumed to be in SIGNER_METHOD_ALLOWLIST (the
 * caller — `dispatchRpc` in main.ts — verifies this before calling).
 *
 * Returns the handler's result object. If the handler THROWS, the exception
 * propagates out of this function — the caller (dispatcher) MUST NOT catch
 * it (see LAYER 2 discipline in main.ts).
 *
 * CRITICAL: this function is LAYER 2 — the handler invocation is DOWNSTREAM
 * code. The dispatcher's Note 1 discipline applies: application errors are
 * returned as `{ ok: false, ... }`; unexpected exceptions propagate.
 */
export async function handleSignMethod(
  method: string,
  params: unknown
): Promise<MethodHandlerResult> {
  switch (method) {
    case "signTransaction":
      return await handleSignTransaction(params);
    case "signTypedData":
      return await handleSignTypedData(params);
    case "signMessage":
      return await handleSignMessage(params);
    default:
      // Should never happen — the caller verified the method is in the
      // allowlist. If it does, it's a programming error; throw so
      // crash-logger captures it (LAYER 2 discipline).
      throw new Error(
        `handleSignMethod called with non-sign method "${method}" — dispatcher routing bug`
      );
  }
}

/**
 * Check if a method name is one of the sign methods handled by this module.
 */
export function isSignMethod(method: string): boolean {
  return (
    method === "signTransaction" ||
    method === "signTypedData" ||
    method === "signMessage"
  );
}

// ---------------------------------------------------------------------------
// Common 5-step guard — shared by all three handlers.
// ---------------------------------------------------------------------------

/**
 * Result of validating the envelope + vault + preconditions. The actual
 * signing happens AFTER this returns ok — the handler then performs the
 * operation-specific sign call.
 *
 * On failure, `failure` contains the SignHandlerResult to return to the
 * caller (with the appropriate error code + echo fields populated).
 */
interface GuardResult {
  ok: true;
  envelope: SignHandlerParams;
  receivedPayloadHash: string;
  wallet: Wallet;
  walletId: string;
}

interface GuardFailure {
  failure: SignHandlerResult;
  /** Whether to write an audit entry for this failure. */
  auditEventName: string | null;
  auditPayload: Record<string, unknown> | null;
}

/**
 * Run the 5-step guard:
 *   1. Validate envelope structure (SignHandlerParams shape).
 *   2. Verify vault is unlocked.
 *   3. Validate preconditions (writer lease — M4 seam, no-op for now).
 *   4. Verify payloadHash (defense in depth).
 *   5. Look up wallet by `tx.from` address + get key + verify address match.
 *
 * Returns either the validated envelope + wallet (ready to sign) or the
 * failure result to return to the caller.
 *
 * The `signerAddress` is `payload.tx.from` — used for wallet lookup. All
 * three handlers use this same field as the signer address.
 */
async function runSignGuard(
  params: unknown,
  operation: "signTransaction" | "signTypedData" | "signMessage"
): Promise<GuardResult | GuardFailure> {
  // --- Step 1: Validate envelope structure ---
  const envelopeErr = validateEnvelope(params, operation);
  if (envelopeErr !== null) {
    // Can't echo requestId/receivedPayloadHash because we don't trust
    // the envelope — return a zeroed echo.
    const failure: SignHandlerResult = {
      ok: false,
      error: envelopeErr,
      requestId: "(invalid-envelope)",
      receivedPayloadHash: "(invalid-envelope)",
      signerVersion: SIGNER_PROTOCOL_VERSION,
    };
    return {
      failure,
      auditEventName: "sign_invalid_envelope",
      auditPayload: { operation, reason: envelopeErr },
    };
  }
  const envelope = params as SignHandlerParams;
  const receivedPayloadHash = sha256Canonical(envelope.payload);

  // Helper to build a failure with correct echo fields.
  const failWith = (error: string): SignHandlerResult => ({
    ok: false,
    error,
    requestId: envelope.requestId,
    receivedPayloadHash,
    signerVersion: SIGNER_PROTOCOL_VERSION,
  });

  // --- Step 2: Verify vault is unlocked ---
  if (!walletVault.isUnlocked()) {
    return {
      failure: failWith("SIGNER_VAULT_LOCKED: vault is locked — unlock required before signing"),
      auditEventName: "sign_vault_locked",
      auditPayload: { operation, requestId: envelope.requestId },
    };
  }

  // --- Step 3: Validate preconditions (writer lease — M4 seam) ---
  //
  // Writer lease is M4. For M3.2, this check is a no-op (always passes).
  // The structure is here so M4 can replace `checkWriterLease()` with a
  // real implementation without touching the handler bodies.
  //
  // When M4 lands, the lease check will verify that the current signer
  // process holds the writer lease for the wallet's chain. If not, it
  // returns WRITER_LEASE_NOT_HELD (-32009). For M3.2, the lease doesn't
  // exist yet, so we always pass.
  const preconditionErr = checkWriterLease();
  if (preconditionErr !== null) {
    return {
      failure: failWith(`${SignHandlerError.PRECONDITION_FAILED}: ${preconditionErr}`),
      auditEventName: "sign_precondition_failed",
      auditPayload: { operation, requestId: envelope.requestId, reason: preconditionErr },
    };
  }

  // --- Step 4: Verify payloadHash (defense in depth) ---
  //
  // The adapter computed the hash on its side; we recompute on receipt.
  // A mismatch means the payload was corrupted in transit (transport
  // bug) OR the adapter has a bug (sent the wrong hash). Either way,
  // refuse to sign — never sign a payload whose hash doesn't match.
  if (receivedPayloadHash !== envelope.payloadHash) {
    return {
      failure: failWith(
        `${SignHandlerError.PAYLOAD_CORRUPTED}: payload hash mismatch (envelope claims ${envelope.payloadHash}, recomputed ${receivedPayloadHash}) — refusing to sign corrupted payload`
      ),
      auditEventName: "sign_payload_corrupted",
      auditPayload: {
        operation,
        requestId: envelope.requestId,
        expectedHash: envelope.payloadHash,
        recomputedHash: receivedPayloadHash,
      },
    };
  }

  // --- Step 5: Look up wallet by `tx.from` address ---
  const signerAddress = envelope.payload.tx.from;
  const walletLookup = await findSignableWalletForAddress(signerAddress);
  if (walletLookup === null) {
    return {
      failure: failWith(
        `${SignHandlerError.UNAUTHORIZED}: no unlocked wallet with signing capability matches address ${signerAddress}`
      ),
      auditEventName: "sign_unauthorized",
      auditPayload: { operation, requestId: envelope.requestId, signerAddress },
    };
  }

  return {
    ok: true,
    envelope,
    receivedPayloadHash,
    wallet: walletLookup.wallet,
    walletId: walletLookup.walletId,
  };
}

// ---------------------------------------------------------------------------
// Handler: signTransaction
// ---------------------------------------------------------------------------

/**
 * `signTransaction` — sign an EVM transaction with the wallet's key.
 *
 * The payload.tx field provides { from, to, value, data }. The signer
 * fills in placeholder values for chainId (from the wallet's chain DB
 * field), nonce (0), gasLimit (21000), and EIP-1559 fee fields (1 gwei).
 * The signed tx is structurally valid but NOT broadcastable — M3.3
 * (Broadcaster) will replace placeholders with real values before
 * broadcasting.
 *
 * Optional payload fields (forward-compatible): chainId, nonce, gasLimit,
 * maxFeePerGas, maxPriorityFeePerGas, type. If present, they override
 * the placeholders.
 *
 * On success, returns `{ ok: true, txHash, rawSignedTx, requestId,
 * receivedPayloadHash, signerVersion }`.
 */
async function handleSignTransaction(params: unknown): Promise<MethodHandlerResult> {
  const guard = await runSignGuard(params, "signTransaction");
  if (!("ok" in guard)) {
    if (guard.auditEventName) {
      auditEvent(guard.auditEventName, guard.auditPayload ?? {});
    }
    return { ok: true, result: guard.failure };
  }

  const { envelope, receivedPayloadHash, wallet, walletId } = guard;
  const payload = envelope.payload;

  // Determine chainId: payload override > wallet's chain DB field > fail.
  let chainId: number;
  if (typeof payload.chainId === "number") {
    chainId = payload.chainId;
  } else {
    const chainFromDb = await getWalletChainFromDb(walletId);
    if (chainFromDb === null) {
      // Wallet row missing or chain field null — can't determine chainId.
      const failure: SignHandlerResult = {
        ok: false,
        error: `${SignHandlerError.INVALID_PARAMS}: wallet ${walletId} has no chain field — cannot determine chainId for signing (pass payload.chainId explicitly)`,
        requestId: envelope.requestId,
        receivedPayloadHash,
        signerVersion: SIGNER_PROTOCOL_VERSION,
      };
      auditEvent("sign_transaction_failed_no_chain", {
        requestId: envelope.requestId,
        walletId,
        signerAddress: payload.tx.from,
      });
      return { ok: true, result: failure };
    }
    const mapped = CHAIN_ID_BY_NAME[chainFromDb.toLowerCase()];
    if (mapped === undefined) {
      const failure: SignHandlerResult = {
        ok: false,
        error: `${SignHandlerError.INVALID_PARAMS}: wallet chain "${chainFromDb}" is not in the CHAIN_ID_BY_NAME map — refusing to sign with an unknown chainId (would be replayable)`,
        requestId: envelope.requestId,
        receivedPayloadHash,
        signerVersion: SIGNER_PROTOCOL_VERSION,
      };
      auditEvent("sign_transaction_failed_unknown_chain", {
        requestId: envelope.requestId,
        walletId,
        chain: chainFromDb,
      });
      return { ok: true, result: failure };
    }
    chainId = mapped;
  }

  // Build the transaction object. Placeholders are used for fields the
  // adapter (frozen) doesn't send. M3.3 will replace them with real
  // values before broadcasting.
  const tx = {
    to: payload.tx.to,
    value: payload.tx.value,
    data: payload.tx.data,
    type: payload.type ?? 2, // EIP-1559
    chainId,
    nonce: payload.nonce ?? 0,
    gasLimit: payload.gasLimit ?? 21000,
    maxFeePerGas: payload.maxFeePerGas ?? "1000000000", // 1 gwei
    maxPriorityFeePerGas: payload.maxPriorityFeePerGas ?? "1000000000",
  };

  // Sign. If ethers throws on a structurally-valid input, that's a bug —
  // let it propagate (LAYER 2 discipline).
  const rawSignedTx = await wallet.signTransaction(tx);
  // Compute the tx hash. ethers v6: Transaction.from(rawSignedTx).hash
  // is the canonical hash. We use a simpler approach: keccak of the
  // raw signed tx bytes.
  const { keccak256, Transaction } = await import("ethers");
  const parsed = Transaction.from(rawSignedTx);
  const txHash = parsed.hash ?? keccak256(rawSignedTx);

  auditEvent("sign_transaction_succeeded", {
    requestId: envelope.requestId,
    walletId,
    signerAddress: payload.tx.from,
    to: payload.tx.to,
    chainId,
    txHash,
  });

  const result: SignHandlerResult = {
    ok: true,
    txHash,
    rawSignedTx,
    requestId: envelope.requestId,
    receivedPayloadHash,
    signerVersion: SIGNER_PROTOCOL_VERSION,
  };
  return { ok: true, result };
}

// ---------------------------------------------------------------------------
// Handler: signTypedData (EIP-712)
// ---------------------------------------------------------------------------

/**
 * `signTypedData` — sign EIP-712 typed data with the wallet's key.
 *
 * Payload requires:
 *   - tx.from = signer address
 *   - typedData = { domain, types, primaryType, message }
 *
 * The signer signs with ethers v6's `wallet.signTypedData(domain, types,
 * value)`. The signature is the EIP-712 hash signed with the wallet's
 * private key, in r||s||v format (65 bytes).
 *
 * On success, returns `{ ok: true, signature, requestId, receivedPayloadHash,
 * signerVersion }`.
 */
async function handleSignTypedData(params: unknown): Promise<MethodHandlerResult> {
  const guard = await runSignGuard(params, "signTypedData");
  if (!("ok" in guard)) {
    if (guard.auditEventName) {
      auditEvent(guard.auditEventName, guard.auditPayload ?? {});
    }
    return { ok: true, result: guard.failure };
  }

  const { envelope, receivedPayloadHash, wallet, walletId } = guard;
  const payload = envelope.payload;

  // Validate typedData presence + structure.
  const tdErr = validateTypedData(payload);
  if (tdErr !== null) {
    const failure: SignHandlerResult = {
      ok: false,
      error: `${SignHandlerError.INVALID_PARAMS}: ${tdErr}`,
      requestId: envelope.requestId,
      receivedPayloadHash,
      signerVersion: SIGNER_PROTOCOL_VERSION,
    };
    auditEvent("sign_typed_data_invalid", {
      requestId: envelope.requestId,
      walletId,
      reason: tdErr,
    });
    return { ok: true, result: failure };
  }

  const td = payload.typedData!;
  // ethers v6: wallet.signTypedData(domain, types, value).
  // Note: ethers' types field expects the SAME shape as the EIP-712
  // TypedData types — a Record<string, Array<{ name, type }>>.
  // EIP-712 also requires the EIP712Domain type to be present; ethers
  // will inject it if missing. We pass through whatever the caller sent.
  const signature = await wallet.signTypedData(
    td.domain as Parameters<typeof wallet.signTypedData>[0],
    td.types as Parameters<typeof wallet.signTypedData>[1],
    td.message as Parameters<typeof wallet.signTypedData>[2],
  );

  auditEvent("sign_typed_data_succeeded", {
    requestId: envelope.requestId,
    walletId,
    signerAddress: payload.tx.from,
    primaryType: td.primaryType,
  });

  const result: SignHandlerResult = {
    ok: true,
    signature,
    requestId: envelope.requestId,
    receivedPayloadHash,
    signerVersion: SIGNER_PROTOCOL_VERSION,
  };
  return { ok: true, result };
}

// ---------------------------------------------------------------------------
// Handler: signMessage (EIP-191 / personal_sign)
// ---------------------------------------------------------------------------

/**
 * `signMessage` — sign a raw message with the wallet's key (personal_sign).
 *
 * Payload requires:
 *   - tx.from = signer address
 *   - message = string (UTF-8)
 *
 * The signer applies the EIP-191 personal_sign prefix
 * ("\x19Ethereum Signed Message:\n" + length) and signs the keccak256
 * hash. ethers v6's `wallet.signMessage(message)` handles this.
 *
 * On success, returns `{ ok: true, signature, requestId, receivedPayloadHash,
 * signerVersion }`.
 */
async function handleSignMessage(params: unknown): Promise<MethodHandlerResult> {
  const guard = await runSignGuard(params, "signMessage");
  if (!("ok" in guard)) {
    if (guard.auditEventName) {
      auditEvent(guard.auditEventName, guard.auditPayload ?? {});
    }
    return { ok: true, result: guard.failure };
  }

  const { envelope, receivedPayloadHash, wallet, walletId } = guard;
  const payload = envelope.payload;

  // Validate message presence.
  if (typeof payload.message !== "string") {
    const failure: SignHandlerResult = {
      ok: false,
      error: `${SignHandlerError.INVALID_PARAMS}: payload.message must be a string (got ${typeof payload.message})`,
      requestId: envelope.requestId,
      receivedPayloadHash,
      signerVersion: SIGNER_PROTOCOL_VERSION,
    };
    auditEvent("sign_message_invalid", {
      requestId: envelope.requestId,
      walletId,
      reason: "message missing or not a string",
    });
    return { ok: true, result: failure };
  }

  // Sign with EIP-191 personal_sign. ethers handles the prefix.
  const signature = await wallet.signMessage(payload.message);

  auditEvent("sign_message_succeeded", {
    requestId: envelope.requestId,
    walletId,
    signerAddress: payload.tx.from,
    messageLength: payload.message.length,
  });

  const result: SignHandlerResult = {
    ok: true,
    signature,
    requestId: envelope.requestId,
    receivedPayloadHash,
    signerVersion: SIGNER_PROTOCOL_VERSION,
  };
  return { ok: true, result };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate the wire envelope structure. Returns null if valid, or a
 * human-readable error string if invalid.
 *
 * This is a DEFENSIVE check — the adapter already constructs a well-formed
 * envelope. The signer checks again so a future caller that bypasses the
 * adapter cannot send a malformed request.
 */
function validateEnvelope(
  params: unknown,
  expectedOperation: "signTransaction" | "signTypedData" | "signMessage"
): string | null {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return `${SignHandlerError.INVALID_PARAMS}: envelope must be an object`;
  }
  const p = params as Partial<SignHandlerParams>;

  if (typeof p.protocolVersion !== "string") {
    return `${SignHandlerError.INVALID_PARAMS}: envelope.protocolVersion must be a string`;
  }
  // Note: the actual version match is checked by dispatchRpc's
  // validateProtocolVersion. We only check structural type here.
  if (typeof p.requestId !== "string" || p.requestId.length === 0) {
    return `${SignHandlerError.INVALID_PARAMS}: envelope.requestId must be a non-empty string`;
  }
  if (p.operation !== expectedOperation) {
    return `${SignHandlerError.INVALID_PARAMS}: envelope.operation must be "${expectedOperation}" (got ${JSON.stringify(p.operation)})`;
  }
  if (p.payload === null || typeof p.payload !== "object" || Array.isArray(p.payload)) {
    return `${SignHandlerError.INVALID_PARAMS}: envelope.payload must be an object`;
  }
  if (typeof p.payloadHash !== "string" || p.payloadHash.length === 0) {
    return `${SignHandlerError.INVALID_PARAMS}: envelope.payloadHash must be a non-empty string`;
  }

  // Validate payload.tx (required for all three operations — `from` is
  // the signer address).
  const payload = p.payload as Partial<SignPayload>;
  if (
    payload.tx === null ||
    typeof payload.tx !== "object" ||
    Array.isArray(payload.tx)
  ) {
    return `${SignHandlerError.INVALID_PARAMS}: payload.tx must be an object`;
  }
  if (typeof payload.tx.from !== "string" || !payload.tx.from.startsWith("0x")) {
    return `${SignHandlerError.INVALID_PARAMS}: payload.tx.from must be a 0x-prefixed hex string`;
  }
  // signTransaction also requires tx.to/value/data (the adapter always
  // sends them; direct callers should too).
  if (expectedOperation === "signTransaction") {
    if (typeof payload.tx.to !== "string" || !payload.tx.to.startsWith("0x")) {
      return `${SignHandlerError.INVALID_PARAMS}: payload.tx.to must be a 0x-prefixed hex string`;
    }
    if (typeof payload.tx.value !== "string") {
      return `${SignHandlerError.INVALID_PARAMS}: payload.tx.value must be a string`;
    }
    if (typeof payload.tx.data !== "string" || !payload.tx.data.startsWith("0x")) {
      return `${SignHandlerError.INVALID_PARAMS}: payload.tx.data must be a 0x-prefixed hex string`;
    }
  }

  // Validate the frozen adapter payload fields (approvedAmount,
  // slippageLimitBps, sandwichScore) — they're required by the adapter
  // even if the operation isn't signTransaction. The adapter always
  // sends them; direct callers should too. If they're missing, we still
  // accept the request (forward-compat) but warn.
  //
  // Actually: be strict. The wire envelope contract requires these
  // fields. If they're missing, the request is malformed.
  if (typeof payload.approvedAmount !== "string") {
    return `${SignHandlerError.INVALID_PARAMS}: payload.approvedAmount must be a string`;
  }
  if (typeof payload.slippageLimitBps !== "number" || Number.isNaN(payload.slippageLimitBps)) {
    return `${SignHandlerError.INVALID_PARAMS}: payload.slippageLimitBps must be a number`;
  }
  if (typeof payload.sandwichScore !== "number" || Number.isNaN(payload.sandwichScore)) {
    return `${SignHandlerError.INVALID_PARAMS}: payload.sandwichScore must be a number`;
  }

  return null;
}

/**
 * Validate the typedData field for signTypedData. Returns null if valid,
 * or a human-readable error string.
 */
function validateTypedData(payload: SignPayload): string | null {
  const td = payload.typedData;
  if (td === undefined || td === null) {
    return "payload.typedData is required for signTypedData";
  }
  if (typeof td !== "object" || Array.isArray(td)) {
    return "payload.typedData must be an object";
  }
  if (td.domain === undefined || typeof td.domain !== "object" || Array.isArray(td.domain)) {
    return "payload.typedData.domain must be an object";
  }
  if (td.types === undefined || typeof td.types !== "object" || Array.isArray(td.types)) {
    return "payload.typedData.types must be an object";
  }
  if (typeof td.primaryType !== "string" || td.primaryType.length === 0) {
    return "payload.typedData.primaryType must be a non-empty string";
  }
  if (td.message === undefined || typeof td.message !== "object" || Array.isArray(td.message)) {
    return "payload.typedData.message must be an object";
  }
  // Validate each type entry shape.
  for (const [typeName, fields] of Object.entries(td.types)) {
    if (!Array.isArray(fields)) {
      return `payload.typedData.types["${typeName}"] must be an array`;
    }
    for (const f of fields) {
      if (
        f === null ||
        typeof f !== "object" ||
        typeof (f as { name?: unknown }).name !== "string" ||
        typeof (f as { type?: unknown }).type !== "string"
      ) {
        return `payload.typedData.types["${typeName}"] entries must each be { name: string, type: string }`;
      }
    }
  }
  return null;
}

/**
 * Look up a signable wallet by address.
 *
 * Queries the DB for WalletConnection rows with `privateKeyEncrypted` not
 * null AND `readOnly = false`. Filters in JS for case-insensitive address
 * match (works on both SQLite and PostgreSQL). For each match, calls
 * `walletVault.getWalletKey(walletId)` to get the decrypted key, then
 * verifies the key derives the expected address (defense in depth).
 *
 * Returns the wallet + walletId on success, or null if no match.
 *
 * SECURITY: the address verification is critical — a DB row could claim
 * `address=0xABC` but actually contain a key for `0xDEF` (corrupted data
 * or a compromised DB). Deriving the address from the key and comparing
 * is the only way to be sure we're signing with the right key.
 */
async function findSignableWalletForAddress(
  address: string
): Promise<{ wallet: Wallet; walletId: string } | null> {
  if (!walletVault.isUnlocked()) return null;

  // Lazy-load DB to avoid circular import issues at module load time.
  const { db } = await import("@/lib/db");

  const rows = await db.walletConnection.findMany({
    where: { privateKeyEncrypted: { not: null }, readOnly: false },
    select: { id: true, address: true },
  });

  const target = address.toLowerCase();
  const matches = rows.filter((r) => r.address.toLowerCase() === target);
  if (matches.length === 0) return null;

  // For each match, get the key + verify it derives the expected address.
  for (const m of matches) {
    const key = walletVault.getWalletKey(m.id);
    if (key === null) continue; // wallet not loaded in vault (shouldn't happen if unlocked)
    try {
      const wallet = new Wallet(key);
      if (wallet.address.toLowerCase() === target) {
        return { wallet, walletId: m.id };
      }
    } catch {
      // Invalid key format — skip. This shouldn't happen because
      // unlockAsync already decrypted successfully, but defense in depth.
      continue;
    }
  }

  return null;
}

/**
 * Read the wallet's `chain` field from the DB. Used to determine the
 * chainId for EIP-155 signing when the payload doesn't include chainId.
 */
async function getWalletChainFromDb(walletId: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const row = await db.walletConnection.findUnique({
    where: { id: walletId },
    select: { chain: true },
  });
  return row?.chain ?? null;
}

/**
 * Writer lease precondition check — M4 SEAM.
 *
 * For M3.2, this is a no-op (always returns null = "precondition OK").
 * When M4 lands, this function will be replaced with a real check that
 * verifies the current signer process holds the writer lease for the
 * target chain. If not, it returns a non-null error string and the
 * handler returns PRECONDITION_FAILED.
 *
 * The seam is here (rather than inlined) so M4's implementation can
 * land as a single function replacement — no handler body changes.
 *
 * SECURITY: when M4 implements this, the lease check MUST be a hard
 * precondition — there is no "soft" mode where signing proceeds without
 * the lease. The whole point of the writer lease is to serialize sign
 * access so a stale signer process can't race a fresh one.
 */
function checkWriterLease(): string | null {
  // M3.2: no writer lease yet — pass through.
  // M4: replace with `return writerLeaseHolder.isHeldFor(chainId) ? null : "writer lease not held"`.
  return null;
}

/**
 * Compute the SHA-256 hash of a value's canonical JSON serialization.
 * MUST match the adapter's `sha256Canonical` exactly — same canonical
 * form (JSON.stringify with no whitespace, key order preserved as
 * insertion order).
 *
 * The signer recomputes this from the received payload and compares
 * with the envelope's `payloadHash`. A mismatch means the payload was
 * corrupted in transit OR the adapter computed a different hash (bug).
 * Either way, refuse to sign.
 */
function sha256Canonical(obj: unknown): string {
  const canonical = JSON.stringify(obj);
  return "0x" + createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Exports for testing (read-only inspection — no security impact).
// ---------------------------------------------------------------------------

/**
 * Inspect the chain map — used by tests to verify the chainId mapping
 * is correct. Read-only.
 */
export function getChainIdForName(name: string): number | undefined {
  return CHAIN_ID_BY_NAME[name.toLowerCase()];
}
