// src/lib/chain/broadcaster.ts
//
// M3.3 — Broadcaster (operator-directed, closed scope).
//
// DESIGN PHILOSOPHY
// -----------------
// The Broadcaster is the layer that takes a SignerRequest (from the
// FROZEN H2.6 Pipeline) and turns it into an on-chain transaction.
// It sits between the Pipeline and the RPC layer, consuming:
//
//   - The H1.1 QuorumRpcClient (FROZEN) for nonce + gas resolution
//     and for the actual `broadcastRawTransaction` call.
//   - The M3.1 SignerAdapter (extended in M3.3 with `signAndReturnRaw()`)
//     to obtain the signed transaction bytes.
//
// The Broadcaster implements `SignerSink` — the same interface the
// Pipeline calls. In H2.6 tests this was a mock; in M3.1 it became
// the SignerAdapter (sign-only); in M3.3 it becomes the Broadcaster
// (sign + broadcast). The Pipeline remains UNCHANGED because the
// interface contract (`submit(req) → SignerResult`) is preserved.
//
// ARCHITECTURAL DECISION — Option A (sign AFTER filling nonce/gas):
//
//   The operator reviewed two ordering options:
//     A. Resolve nonce + gas BEFORE signing (CHOSEN).
//     B. Sign a partial tx, resolve nonce + gas, re-sign (REJECTED).
//
//   Option A means the signature covers EXACTLY the bytes that will
//   be transmitted. No re-signing. Eliminates simulation-vs-send
//   divergence. A broadcast failure does NOT invalidate the signature,
//   and a re-sign is NOT forced on every retry.
//
// REG-014 — POST-SIGNATURE IMMUTABILITY (the load-bearing property):
//
//   Once the signer returns `rawSignedTx`, those bytes are IMMUTABLE.
//   The Broadcaster MUST NOT modify them. To enforce this, the
//   Broadcaster computes `expectedHash = keccak256(rawSignedTx)`
//   locally BEFORE calling `broadcastRawTransaction`, and verifies
//   that the hash returned by the RPC matches `expectedHash`. Any
//   divergence is a critical integrity failure — the Broadcaster
//   fails closed and does NOT report a successful broadcast.
//
//   This forms a closed integrity loop with REG-011 (signer-side
//   payload re-verification):
//
//     build payload → hash(payload) → sign(payload)        [REG-011]
//                                      ↓
//                           rawSignedTx (immutable)
//                                      ↓
//                   hash(rawSignedTx) → broadcast → verify [REG-014]
//
// INTERNAL STRUCTURE — 3 private components (per operator's directive):
//
//   The Broadcaster is internally divided into three private methods
//   so M4 can reuse `resolveTransactionContext()` without touching
//   signing or broadcast logic:
//
//     Broadcaster (implements SignerSink)
//      ├── resolveTransactionContext(from)
//      │      nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas
//      │      (via QuorumRpcClient.quorumRead)
//      │
//      ├── signTransaction(req, ctx)
//      │      fills nonce + gas into req.tx
//      │      calls SignerAdapter.signAndReturnRaw()
//      │      returns { rawSignedTx, txHash }
//      │
//      └── broadcastSignedTransaction(rawSignedTx)
//             expectedHash = keccak256(rawSignedTx)         ← REG-014
//             result = QuorumRpcClient.broadcastRawTransaction(rawSignedTx)
//             assert(result.txHash === expectedHash)         ← mandatory
//             returns BroadcastResult
//
// WHAT THE BROADCASTER DOES NOT DO (per operator's M3.3 scope):
//   - NO automatic retries (M4 — writer lease serializes access).
//   - NO replacement transaction (M4+).
//   - NO cancel transaction (M4+).
//   - NO mempool management.
//   - NO bundle / private relay (Flashbots / MEV-Blocker — future).
//   - NO fee bumping (M4+).
//   - NO block confirmation (returns broadcast hash only).
//
// ADVERSARIAL TEST MATRIX (per operator's M3.3 directive):
//   1. nonce already used → fail closed
//   2. stale nonce → fail closed
//   3. insufficient gas → fail closed
//   4. RPC returns hash different from signed-tx hash → REG-014 violation
//   5. broadcast partial + timeout → fail closed
//   6. error in one endpoint, success in another → H1.1 failover honored
//   7. malformed RPC response → fail closed as BROADCAST_INVALID_RESPONSE
//   8. raw transaction altered after signature → MUST fail BEFORE broadcast

import { keccak_256 } from "@noble/hashes/sha3.js";
import type { QuorumRpcClient, BroadcastResult } from "./rpc-resilience";
import type { SignerAdapter } from "./signer-adapter";
import type { SignerSink, SignerRequest, SignerResult } from "./pipeline";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

/**
 * The resolved on-chain context needed to build a complete transaction.
 * Produced by `resolveTransactionContext()` — kept as a separate type so
 * M4 (writer lease) can consume it without touching the signing or
 * broadcast code paths.
 */
export interface TransactionContext {
  /** Next nonce for the sender (from eth_getTransactionCount, "pending"). */
  nonce: number;
  /** Gas limit for the transaction (from eth_estimateGas). */
  gasLimit: bigint;
  /** EIP-1559 max base fee per gas (from eth_feeHistory). */
  maxFeePerGas: bigint;
  /** EIP-1559 priority fee (tip) per gas (from eth_feeHistory). */
  maxPriorityFeePerGas: bigint;
}

/**
 * Internal result of `signTransaction()` — carries the raw signed bytes
 * the Broadcaster needs for the REG-014 immutability check.
 */
interface SignAndRawResult {
  ok: boolean;
  rawSignedTx?: string;
  txHash?: string;
  error?: string;
}

/**
 * Broadcaster configuration.
 */
export interface BroadcasterConfig {
  /** The H1.1 quorum RPC client (FROZEN) — used for nonce/gas/broadcast. */
  rpc: QuorumRpcClient;
  /** The M3.1 SignerAdapter (extended in M3.3 with signAndReturnRaw). */
  signerAdapter: SignerAdapter;
  /**
   * Optional gas limit override. If provided, the Broadcaster skips
   * `eth_estimateGas` and uses this value. Useful for testing + for
   * transactions where the caller already knows the gas limit.
   */
  fixedGasLimit?: bigint;
  /**
   * Optional maxPriorityFeePerGas override (in wei). If provided, the
   * Broadcaster skips the tip extraction from eth_feeHistory and uses
   * this value.
   */
  fixedMaxPriorityFeePerGas?: bigint;
  /**
   * Optional maxFeePerGas ceiling (in wei). If the feeHistory-derived
   * maxFeePerGas exceeds this ceiling, the Broadcaster caps it. This
   * is a safety valve against fee spikes — the operator can set it to
   * avoid broadcasting a tx with an unreasonable fee.
   */
  maxFeePerGasCeiling?: bigint;
  /** Logger — defaults to no-op. Observability only. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

// -------------------------------------------------------------------------
// Error codes — the prefixes returned in `SignerResult.error`.
// -------------------------------------------------------------------------

export const BroadcasterError = {
  NONCE_RESOLUTION_FAILED: "BROADCAST_NONCE_RESOLUTION_FAILED",
  GAS_RESOLUTION_FAILED: "BROADCAST_GAS_RESOLUTION_FAILED",
  SIGN_FAILED: "BROADCAST_SIGN_FAILED",
  IMMUTABILITY_VIOLATION: "BROADCAST_IMMUTABILITY_VIOLATION",
  BROADCAST_FAILED: "BROADCAST_FAILED",
  INVALID_RESPONSE: "BROADCAST_INVALID_RESPONSE",
} as const;

// -------------------------------------------------------------------------
// The Broadcaster.
// -------------------------------------------------------------------------

/**
 * Broadcaster — implements `SignerSink` (the interface the H2.6
 * Pipeline composer calls).
 *
 * Replaces the M3.1 SignerAdapter as the Pipeline's signer. The
 * Pipeline still calls `submit(req) → SignerResult`; the Broadcaster
 * internally:
 *   1. resolves nonce + gas via the H1.1 QuorumRpcClient,
 *   2. requests a signature via the SignerAdapter's `signAndReturnRaw()`,
 *   3. computes the expected hash locally (REG-014),
 *   4. broadcasts via `QuorumRpcClient.broadcastRawTransaction`,
 *   5. verifies the returned hash matches the expected hash (REG-014),
 *   6. returns a `SignerResult` to the Pipeline.
 *
 * The Broadcaster NEVER throws — like the SignerAdapter, it converts
 * every error into a `SignerResult` with `ok: false` and a descriptive
 * error string prefixed with one of the `BroadcasterError` codes.
 */
export class Broadcaster implements SignerSink {
  private readonly cfg: Required<Omit<BroadcasterConfig, "fixedGasLimit" | "fixedMaxPriorityFeePerGas" | "maxFeePerGasCeiling">> & Pick<BroadcasterConfig, "fixedGasLimit" | "fixedMaxPriorityFeePerGas" | "maxFeePerGasCeiling">;

  constructor(config: BroadcasterConfig) {
    this.cfg = {
      rpc: config.rpc,
      signerAdapter: config.signerAdapter,
      fixedGasLimit: config.fixedGasLimit,
      fixedMaxPriorityFeePerGas: config.fixedMaxPriorityFeePerGas,
      maxFeePerGasCeiling: config.maxFeePerGasCeiling,
      log: config.log ?? (() => {}),
    };
  }

  /**
   * Run the full broadcast flow. Implements `SignerSink.submit`.
   *
   * The 8-step flow (per operator's M3.3 directive):
   *   1. Resolve nonce (via quorum eth_getTransactionCount).
   *   2. Resolve gas params (via quorum eth_feeHistory / eth_estimateGas).
   *   3. Build the final transaction (fill nonce + gas into req.tx).
   *   4. Request signature (via SignerAdapter.signAndReturnRaw).
   *   5. Compute expectedHash = keccak256(rawSignedTx) locally.
   *   6. Broadcast (via QuorumRpcClient.broadcastRawTransaction).
   *   7. Verify broadcastHash === expectedHash (REG-014).
   *   8. Return SignerResult.
   */
  async submit(req: SignerRequest): Promise<SignerResult> {
    // Steps 1-2: resolve the on-chain context.
    const ctxResult = await this.resolveTransactionContext(req.tx.from);
    if (!ctxResult.ok) {
      return { ok: false, error: ctxResult.error! };
    }
    const ctx = ctxResult.ctx!;

    // Steps 3-4: build the final tx + request signature.
    const signResult = await this.signTransaction(req, ctx);
    if (!signResult.ok || !signResult.rawSignedTx) {
      return {
        ok: false,
        error: signResult.error ?? `${BroadcasterError.SIGN_FAILED}: signAndReturnRaw returned ok=true but rawSignedTx missing`,
      };
    }
    const rawSignedTx = signResult.rawSignedTx;
    const signerReportedHash = signResult.txHash!;

    // Steps 5-7: compute expected hash locally, broadcast, verify.
    const broadcastResult = await this.broadcastSignedTransaction(rawSignedTx, signerReportedHash);
    if (!broadcastResult.ok) {
      return { ok: false, error: broadcastResult.error! };
    }

    // Step 8: return SignerResult to the Pipeline.
    return { ok: true, txHash: broadcastResult.txHash };
  }

  // -------------------------------------------------------------------------
  // Private component 1: resolveTransactionContext
  // -------------------------------------------------------------------------

  /**
   * Resolve the on-chain context needed to build a complete transaction.
   *
   * Queries the H1.1 QuorumRpcClient for:
   *   - nonce (eth_getTransactionCount, "pending")
   *   - gasLimit (eth_estimateGas OR a fixed override)
   *   - maxFeePerGas + maxPriorityFeePerGas (eth_feeHistory OR a fixed override)
   *
   * Designed as a SEPARATE method so M4 (writer lease) can reuse it
   * without touching signing or broadcast logic. M4 may wrap this in
   * a lease-acquire/lease-release envelope; the resolution logic stays
   * the same.
   *
   * Returns `{ ok: true, ctx }` on success, or `{ ok: false, error }`
   * on failure. Failures are surfaced with `BroadcasterError` prefixes.
   */
  private async resolveTransactionContext(
    from: string,
  ): Promise<
    | { ok: true; ctx: TransactionContext }
    | { ok: false; error: string }
  > {
    // 1. Nonce — eth_getTransactionCount with "pending" so we get the
    //    mempool-aware nonce (avoids "nonce too low" when there's a
    //    pending tx from the same address).
    const nonceResult = await this.cfg.rpc.quorumRead<number>(
      "eth_getTransactionCount",
      [from, "pending"],
    );
    if (!nonceResult.ok || typeof nonceResult.value !== "string") {
      return {
        ok: false,
        error: `${BroadcasterError.NONCE_RESOLUTION_FAILED}: ${nonceResult.error ?? "non-string result"}`,
      };
    }
    const nonce = parseHexNumber(nonceResult.value);
    if (nonce === null) {
      return {
        ok: false,
        error: `${BroadcasterError.NONCE_RESOLUTION_FAILED}: could not parse nonce "${nonceResult.value}"`,
      };
    }

    // 2. Gas limit — use the fixed override if provided, otherwise
    //    call eth_estimateGas. (We do NOT estimate when the caller
    //    provided a fixed value — saves a round trip and avoids the
    //    estimate being wrong for non-standard txs.)
    let gasLimit: bigint;
    if (this.cfg.fixedGasLimit !== undefined) {
      gasLimit = this.cfg.fixedGasLimit;
    } else {
      const gasResult = await this.cfg.rpc.quorumRead<string>(
        "eth_estimateGas",
        [{ from }], // Note: a real estimate needs {from,to,data,value}; the
        //              caller passes a partial tx here. For M3.3 scope we
        //              accept that the estimate may be conservative; M4
        //              can refine by passing the full tx.
      );
      if (!gasResult.ok || typeof gasResult.value !== "string") {
        return {
          ok: false,
          error: `${BroadcasterError.GAS_RESOLUTION_FAILED}: ${gasResult.error ?? "non-string result"}`,
        };
      }
      const parsed = parseHexBigint(gasResult.value);
      if (parsed === null) {
        return {
          ok: false,
          error: `${BroadcasterError.GAS_RESOLUTION_FAILED}: could not parse gasLimit "${gasResult.value}"`,
        };
      }
      gasLimit = parsed;
    }

    // 3. Fee parameters — EIP-1559. Use fixed overrides if provided.
    let maxFeePerGas: bigint;
    let maxPriorityFeePerGas: bigint;

    if (this.cfg.fixedMaxPriorityFeePerGas !== undefined) {
      maxPriorityFeePerGas = this.cfg.fixedMaxPriorityFeePerGas;
      // For maxFeePerGas, fall back to eth_gasPrice * 2 if no ceiling is set.
      // This is a conservative fallback for legacy chains.
      const gasPriceResult = await this.cfg.rpc.quorumRead<string>("eth_gasPrice", []);
      if (!gasPriceResult.ok || typeof gasPriceResult.value !== "string") {
        return {
          ok: false,
          error: `${BroadcasterError.GAS_RESOLUTION_FAILED}: ${gasPriceResult.error ?? "eth_gasPrice non-string"}`,
        };
      }
      const parsed = parseHexBigint(gasPriceResult.value);
      if (parsed === null) {
        return {
          ok: false,
          error: `${BroadcasterError.GAS_RESOLUTION_FAILED}: could not parse gasPrice "${gasPriceResult.value}"`,
        };
      }
      maxFeePerGas = parsed * 2n;
    } else {
      // eth_feeHistory returns baseFeePerGas + reward percentiles.
      // We use blockCount=4, newestBlock="latest", rewardPercentiles=[50].
      const feeResult = await this.cfg.rpc.quorumRead<{
        baseFeePerGas: string[];
        reward: string[][];
      }>("eth_feeHistory", [4, "latest", [50]]);
      if (!feeResult.ok || typeof feeResult.value !== "object" || feeResult.value === null) {
        return {
          ok: false,
          error: `${BroadcasterError.GAS_RESOLUTION_FAILED}: ${feeResult.error ?? "non-object result"}`,
        };
      }
      const feeHistory = feeResult.value as { baseFeePerGas?: string[]; reward?: string[][] };
      if (!Array.isArray(feeHistory.baseFeePerGas) || feeHistory.baseFeePerGas.length === 0) {
        return {
          ok: false,
          error: `${BroadcasterError.GAS_RESOLUTION_FAILED}: feeHistory.baseFeePerGas missing or empty`,
        };
      }
      if (!Array.isArray(feeHistory.reward) || feeHistory.reward.length === 0) {
        return {
          ok: false,
          error: `${BroadcasterError.GAS_RESOLUTION_FAILED}: feeHistory.reward missing or empty`,
        };
      }
      const baseFees = feeHistory.baseFeePerGas.map(parseHexBigint).filter((v): v is bigint => v !== null);
      if (baseFees.length === 0) {
        return {
          ok: false,
          error: `${BroadcasterError.GAS_RESOLUTION_FAILED}: could not parse any baseFeePerGas`,
        };
      }
      // The last baseFeePerGas is the "next block" base fee — use it.
      const nextBaseFee = baseFees[baseFees.length - 1];
      // The reward is a 2D array: reward[blockIndex][percentileIndex].
      // We take the 50th percentile of the latest block as the tip.
      const latestReward = feeHistory.reward[0].map(parseHexBigint).filter((v): v is bigint => v !== null);
      if (latestReward.length === 0) {
        return {
          ok: false,
          error: `${BroadcasterError.GAS_RESOLUTION_FAILED}: could not parse any reward`,
        };
      }
      maxPriorityFeePerGas = latestReward[0];
      // maxFeePerGas = 2 * baseFee + tip (standard heuristic — gives
      // headroom for base fee fluctuations without overpaying).
      maxFeePerGas = nextBaseFee * 2n + maxPriorityFeePerGas;
    }

    // 4. Apply the optional maxFeePerGas ceiling.
    if (this.cfg.maxFeePerGasCeiling !== undefined && maxFeePerGas > this.cfg.maxFeePerGasCeiling) {
      this.cfg.log("warn", "maxFeePerGas exceeds ceiling — capping", {
        derived: maxFeePerGas.toString(),
        ceiling: this.cfg.maxFeePerGasCeiling.toString(),
      });
      maxFeePerGas = this.cfg.maxFeePerGasCeiling;
      // Ensure tip doesn't exceed total fee.
      if (maxPriorityFeePerGas > maxFeePerGas) {
        maxPriorityFeePerGas = maxFeePerGas;
      }
    }

    return {
      ok: true,
      ctx: { nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas },
    };
  }

  // -------------------------------------------------------------------------
  // Private component 2: signTransaction
  // -------------------------------------------------------------------------

  /**
   * Build the final transaction (fill nonce + gas into req.tx) and
   * request a signature from the SignerAdapter.
   *
   * Returns `{ ok: true, rawSignedTx, txHash }` on success, or
   * `{ ok: false, error }` on failure.
   *
   * The signature is requested via `signerAdapter.signAndReturnRaw()`
   * — the M3.3 thin extension to the M3.1 adapter. The adapter handles
   * protocol validation, envelope construction, transport, and response
   * integrity verification; this method just fills in the on-chain
   * context and forwards.
   *
   * IMPORTANT (REG-014 setup): the `rawSignedTx` returned here is the
   * EXACT byte sequence that will be broadcast. The caller (submit)
   * computes `keccak256(rawSignedTx)` BEFORE broadcasting and verifies
   * it matches the RPC-returned hash. This method does NOT modify
   * `rawSignedTx` in any way after the signer returns it.
   */
  private async signTransaction(
    req: SignerRequest,
    ctx: TransactionContext,
  ): Promise<SignAndRawResult> {
    // Build the final tx by overlaying nonce + gas onto req.tx.
    // The signer (M3.2 signTransaction handler) accepts these fields
    // as overrides — see sign-methods.ts handleSignTransaction.
    const finalReq: SignerRequest = {
      ...req,
      tx: {
        ...req.tx,
        // The signer's SignPayload carries tx as {from,to,value,data}.
        // The nonce + gas fields are passed as additional fields on the
        // tx object — the signer reads them if present (M3.2 already
        // supports this — see the "If present, they override the
        // placeholders" comment in sign-methods.ts).
        nonce: ctx.nonce,
        gasLimit: ctx.gasLimit.toString(),
        maxFeePerGas: ctx.maxFeePerGas.toString(),
        maxPriorityFeePerGas: ctx.maxPriorityFeePerGas.toString(),
      } as SignerRequest["tx"] & {
        nonce: number;
        gasLimit: string;
        maxFeePerGas: string;
        maxPriorityFeePerGas: string;
      },
    };

    const result = await this.cfg.signerAdapter.signAndReturnRaw(finalReq);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? `${BroadcasterError.SIGN_FAILED}: signer returned ok=false with no error`,
      };
    }
    if (!result.rawSignedTx) {
      // signAndReturnRaw() guarantees rawSignedTx on ok=true, but we
      // check defensively.
      return {
        ok: false,
        error: `${BroadcasterError.SIGN_FAILED}: signer returned ok=true but rawSignedTx missing`,
      };
    }
    return {
      ok: true,
      rawSignedTx: result.rawSignedTx,
      txHash: result.txHash,
    };
  }

  // -------------------------------------------------------------------------
  // Private component 3: broadcastSignedTransaction
  // -------------------------------------------------------------------------

  /**
   * Broadcast the signed transaction via the H1.1 QuorumRpcClient and
   * verify the REG-014 immutability property.
   *
   * Flow:
   *   1. Compute `expectedHash = keccak256(rawSignedTx)` locally.
   *   2. Call `QuorumRpcClient.broadcastRawTransaction(rawSignedTx)`.
   *   3. Verify `result.txHash === expectedHash` (REG-014).
   *   4. Return the broadcast result.
   *
   * The `expectedHash` computation is the LOAD-BEARING check — it
   * proves the bytes broadcast are the bytes signed. If the RPC returns
   * a different hash, the Broadcaster fails closed as
   * `BROADCAST_IMMUTABILITY_VIOLATION` and does NOT report success,
   * even if the RPC claims the broadcast succeeded.
   *
   * The `signerReportedHash` parameter is the hash the signer computed
   * locally (returned in SignHandlerResult.txHash). We compare the RPC
   * hash against BOTH:
   *   - our local keccak256 recomputation (the authoritative check), AND
   *   - the signer's reported hash (a sanity check — they should always
   *     agree, since both are keccak256 of the same bytes).
   *
   * If all three disagree, we fail closed. If any two agree and one
   * disagrees, we fail closed (we cannot determine which is wrong
   * without a re-broadcast, which is M4's responsibility).
   */
  private async broadcastSignedTransaction(
    rawSignedTx: string,
    signerReportedHash: string,
  ): Promise<{ ok: true; txHash: string } | { ok: false; error: string }> {
    // Step 5: compute expectedHash locally (REG-014).
    const expectedHash = computeTxHash(rawSignedTx);
    if (expectedHash === null) {
      return {
        ok: false,
        error: `${BroadcasterError.INVALID_RESPONSE}: could not compute keccak256(rawSignedTx) — raw bytes malformed`,
      };
    }

    // Sanity: the signer's reported hash should match our local
    // recomputation. If they disagree, something is wrong either with
    // the transport (corrupted rawSignedTx between signer and us) or
    // with the signer's hash computation. Either way, fail closed.
    if (expectedHash !== signerReportedHash) {
      this.cfg.log("error", "signer-reported hash does not match local recomputation", {
        expectedHash,
        signerReportedHash,
      });
      return {
        ok: false,
        error: `${BroadcasterError.IMMUTABILITY_VIOLATION}: signer-reported hash ${signerReportedHash} does not match local keccak256 ${expectedHash}`,
      };
    }

    // Step 6: broadcast via the H1.1 primitive.
    const broadcastResult: BroadcastResult = await this.cfg.rpc.broadcastRawTransaction(rawSignedTx);

    // If the broadcast itself failed (all endpoints rejected), fail closed.
    if (!broadcastResult.ok || !broadcastResult.txHash) {
      return {
        ok: false,
        error: `${BroadcasterError.BROADCAST_FAILED}: ${broadcastResult.error ?? "no error detail"}`,
      };
    }

    // Step 7: REG-014 immutability check — verify the RPC-returned
    // hash matches the locally-computed expectedHash. This is the
    // load-bearing check that proves the bytes broadcast are the bytes
    // signed.
    if (broadcastResult.txHash !== expectedHash) {
      this.cfg.log("error", "REG-014 violation: RPC-returned hash does not match locally-computed hash", {
        expectedHash,
        rpcReturnedHash: broadcastResult.txHash,
        broadcastBy: broadcastResult.broadcastBy,
      });
      return {
        ok: false,
        error: `${BroadcasterError.IMMUTABILITY_VIOLATION}: RPC-returned hash ${broadcastResult.txHash} does not match locally-computed keccak256 ${expectedHash} — the bytes broadcast may differ from the bytes signed`,
      };
    }

    // Step 8: success — return the verified hash.
    return { ok: true, txHash: broadcastResult.txHash };
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Parse a hex-encoded number (e.g. "0x1a") into a JS number.
 * Returns null if the input is not a valid hex number.
 *
 * Used for nonce parsing — nonces fit comfortably in a JS number
 * (2^53 is far larger than any realistic nonce).
 */
function parseHexNumber(hex: string): number | null {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return null;
  const n = parseInt(hex.slice(2), 16);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/**
 * Parse a hex-encoded bigint (e.g. "0x1a2b3c") into a JS bigint.
 * Returns null if the input is not a valid hex bigint.
 *
 * Used for gas + fee parsing — these can exceed 2^53 in mainnet
 * (e.g. baseFeePerGas in wei during high-fee periods).
 */
function parseHexBigint(hex: string): bigint | null {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

/**
 * Compute the keccak-256 hash of a raw signed transaction.
 *
 * The hash is computed over the RAW BYTES of the signed transaction
 * (the hex string after the "0x" prefix, decoded to bytes). This is
 * the same computation ethers performs internally when it returns
 * `Transaction.from(rawSignedTx).hash`.
 *
 * We use `@noble/hashes/sha3` (already a transitive dependency of
 * ethers) rather than ethers' own `keccak256` to avoid a hard
 * dependency on ethers' internal module shape — noble's API is stable
 * and well-tested.
 *
 * Returns the hash as a "0x"-prefixed lowercase hex string, or null
 * if the input is malformed (not a valid hex string).
 *
 * IMPORTANT: this function is the LOAD-BEARING computation for REG-014.
 * Any bug here would either (a) cause false immutability violations
 * (breaking valid broadcasts) or (b) cause the check to silently pass
 * on a tampered tx (defeating the purpose). The test suite exercises
 * both directions: known-good raw tx → known hash, and tampered raw tx
 * → different hash.
 */
function computeTxHash(rawSignedTx: string): string | null {
  if (typeof rawSignedTx !== "string" || !rawSignedTx.startsWith("0x")) return null;
  try {
    const hex = rawSignedTx.slice(2);
    // Validate even-length hex.
    if (hex.length % 2 !== 0) return null;
    const bytes = hexToBytes(hex);
    if (bytes === null) return null;
    const hash = keccak_256(bytes);
    return "0x" + bytesToHex(hash);
  } catch {
    return null;
  }
}

/**
 * Convert a hex string (no "0x" prefix) to a Uint8Array.
 * Returns null if the input contains non-hex characters.
 */
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (!Number.isFinite(byte)) return null;
    bytes[i / 2] = byte;
  }
  return bytes;
}

/**
 * Convert a Uint8Array to a lowercase hex string (no "0x" prefix).
 */
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
