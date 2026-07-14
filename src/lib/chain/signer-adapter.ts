// src/lib/chain/signer-adapter.ts
//
// M3.1 — SignerAdapter (operator-directed, closed scope).
//
// DESIGN PHILOSOPHY
// -----------------
// The H2.6 Pipeline composer (FROZEN) calls `signer.submit(req)` as its
// final gate. In H2.6 tests, `signer` was a mock. M3.1 replaces that
// mock with a real adapter that forwards the request to the signer
// process over a Unix socket.
//
// The adapter is a THIN LAYER. It has exactly three responsibilities,
// per the operator's M3.1 directive:
//
//   1. MAPPING — translate the application-level `SignerRequest` (from
//      pipeline.ts, FROZEN) into a wire-level `SignerWireRequest`
//      envelope (protocolVersion + requestId + operation + payload +
//      payloadHash).
//
//   2. PROTOCOL VALIDATION — verify the signer speaks the expected
//      protocol version BEFORE forwarding the sign request. Done via a
//      `health_check` probe on first use; cached for subsequent calls.
//      If the signer's reported version doesn't match
//      `expectedProtocolVersion`, the adapter returns
//      `SIGNER_PROTOCOL_MISMATCH` without ever sending the sign request.
//
//   3. RPC SERIALIZATION — JSON-RPC 2.0 envelope construction, timeout
//      enforcement, response parsing, structural validation.
//
// WHAT THE ADAPTER DOES NOT DO (per operator's M3.1 scope)
// ---------------------------------------------------------
//   - NO broadcast (M4 — Broadcaster sits downstream of signer)
//   - NO nonce management (M4)
//   - NO writer lease (M4)
//   - NO multi-signer / signer selection (out of scope forever —
//     single-signer architecture)
//   - NO key rotation (H0.4 — already handled inside the signer process)
//   - NO real signing (M3.2 — adds signTransaction/signTypedData/
//     signMessage handlers to the signer process)
//   - NO async queue (M4 — writer lease serializes access)
//   - NO persistence (signer-side only)
//   - NO retry / fallback / version negotiation (explicit fail)
//   - NO reconnection (M4 — writer lease owns the lifecycle)
//
// ADVERSARIAL SCOPE (per permanent principle)
// -------------------------------------------
// The M3.1 test suite (scripts/test-m3-signer-adapter.ts) attempts to
// break each promised property:
//
//   CONTRACT:
//     A.1 — valid request → forwarded, signer accepts
//     A.2 — invalid protocolVersion → SIGNER_PROTOCOL_MISMATCH
//     A.3 — missing required field → SIGNER_INVALID_REQUEST
//     A.4 — payload altered mid-flight → SIGNER_PAYLOAD_CORRUPTED
//
//   TRANSPORT:
//     B.1 — signer offline → SIGNER_UNAVAILABLE
//     B.2 — timeout → SIGNER_TIMEOUT
//     B.3 — invalid response → SIGNER_INVALID_RESPONSE
//     B.4 — response with incompatible version → SIGNER_PROTOCOL_MISMATCH
//
//   SECURITY:
//     C.1 — adapter does not modify payload (byte-identical forward)
//     C.2 — adapter does not ignore errors (propagates as ok=false)
//     C.3 — adapter does not fallback (no retry, no version fallback)
//
// TWO-POINT PROTOCOL VALIDATION
// -----------------------------
// Per operator's directive, protocol version is validated at TWO points:
//
//   1. ADAPTER (this file) — pre-flight `health_check` probe. If the
//      signer's reported version doesn't match `expectedProtocolVersion`,
//      the adapter refuses to forward. This protects the internal
//      system from sending requests to an incompatible signer.
//
//   2. SIGNER (src/signer/main.ts dispatchRpc) — per-request check of
//      `params.protocolVersion`. If the field is present and doesn't
//      match `SIGNER_PROTOCOL_VERSION`, the dispatcher returns
//      POLICY_VIOLATION with `SIGNER_PROTOCOL_MISMATCH` in the message.
//      This protects the trust boundary — even a non-adapter client
//      cannot bypass the version check.
//
// Both checks are needed: the adapter's pre-flight catches mismatch
// early (before constructing the sign request); the signer's per-request
// check catches the case where the signer was upgraded between the
// adapter's pre-flight and the actual sign request.

import { createHash, randomUUID } from "node:crypto";
import type { SignerSink, SignerRequest, SignerResult } from "./pipeline";
import {
  SIGNER_PROTOCOL_VERSION,
  JSONRPC_VERSION,
  RPC_ERROR_CODES,
} from "@/lib/signer-protocol";

// -------------------------------------------------------------------------
// Wire-level types — what goes over the Unix socket.
// -------------------------------------------------------------------------

/**
 * The operation the signer is asked to perform. M3.1 only uses
 * `signTransaction` (M3.2 will add `signTypedData` and `signMessage`).
 * The adapter always sends exactly one operation per request — no
 * batching, no chaining.
 */
export type SignOperation = "signTransaction" | "signTypedData" | "signMessage";

/**
 * The payload the signer signs. This is the application-level
 * `SignerRequest` (from pipeline.ts) serialized as a plain JSON object.
 * The adapter does NOT transform the payload — it forwards the fields
 * verbatim, then computes a SHA-256 hash so the signer can verify
 * integrity on receipt.
 */
export interface SignerPayload {
  tx: { from: string; to: string; value: string; data: string };
  expectedDiff: unknown;
  approvedAmount: string;
  slippageLimitBps: number;
  sandwichScore: number;
}

/**
 * The wire-level envelope. Sent as the `params` field of a JSON-RPC 2.0
 * request whose `method` is the `operation` (e.g. "signTransaction").
 *
 * Fields:
 *   - `protocolVersion` — the adapter's expected version; the signer
 *     validates this matches its own `SIGNER_PROTOCOL_VERSION`.
 *   - `requestId` — UUID v4, used to match response to request and to
 *     detect confusion if the signer returns a response for a different
 *     request.
 *   - `operation` — the RPC method name (mirrors the JSON-RPC `method`
 *     field; included in the envelope so the signer's per-request
 *     validation has full context).
 *   - `payload` — the SignerPayload (application-level request).
 *   - `payloadHash` — SHA-256 hex of the canonical JSON of `payload`.
 *     The signer recomputes this on receipt and rejects if mismatch —
 *     catches payload corruption in transit.
 */
export interface SignerWireRequest {
  protocolVersion: string;
  requestId: string;
  operation: SignOperation;
  payload: SignerPayload;
  payloadHash: string;
}

/**
 * The wire-level response from the signer. Returned as the `result`
 * field of a JSON-RPC 2.0 success response.
 *
 * Fields:
 *   - `ok` — true iff the signer accepted + signed.
 *   - `txHash` — present iff ok=true; the signed transaction hash.
 *   - `error` — present iff ok=false; the signer's rejection reason.
 *   - `requestId` — echoed back from the request; the adapter verifies
 *     it matches. Catches response confusion.
 *   - `receivedPayloadHash` — echoed back from the request; the adapter
 *     verifies it matches. Catches payload corruption.
 *   - `signerVersion` — the signer's protocol version, for observability.
 */
export interface SignerWireResponse {
  ok: boolean;
  txHash?: string;
  error?: string;
  requestId: string;
  receivedPayloadHash: string;
  signerVersion: string;
}

// -------------------------------------------------------------------------
// Transport abstraction — lets tests inject a mock; production uses
// UnixSocketSignerTransport (to be added in M3.2 when the sign methods
// exist on the real signer).
// -------------------------------------------------------------------------

/**
 * A JSON-RPC 2.0 response from the signer.
 *
 * `ok=true` means the RPC succeeded (the `result` field is present).
 * `ok=false` means the RPC failed (the `error` field is present).
 *
 * The transport is responsible for:
 *   - Serializing the JSON-RPC request envelope.
 *   - Sending it over the wire (Unix socket in production).
 *   - Awaiting the response with timeout.
 *   - Parsing the JSON-RPC response envelope.
 *   - Returning a structured result.
 *
 * The transport is NOT responsible for:
 *   - Validating the response's payload (the adapter does that).
 *   - Retrying on failure (no retry — explicit fail).
 *   - Reconnection (M4 — writer lease owns lifecycle).
 */
export interface RpcResponse {
  ok: boolean;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface SignerTransport {
  /**
   * Send a JSON-RPC 2.0 request and await the response.
   *
   * Implementations MUST:
   *   - Enforce the timeout (reject with a timeout-shaped error if
   *     the response doesn't arrive in time).
   *   - Reject with a connection-shaped error if the signer is offline.
   *   - Parse the JSON-RPC envelope and return a structured RpcResponse.
   *
   * Implementations MUST NOT:
   *   - Retry the request.
   *   - Fallback to a different signer.
   *   - Cache responses.
   */
  rpc(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<RpcResponse>;
}

// -------------------------------------------------------------------------
// Adapter configuration.
// -------------------------------------------------------------------------

export interface SignerAdapterConfig {
  /** The transport — production uses UnixSocketSignerTransport; tests inject a mock. */
  transport: SignerTransport;
  /**
   * The protocol version the adapter expects the signer to speak. The
   * adapter sends `health_check` on first use and compares the signer's
   * reported version against this. If mismatch, the adapter refuses to
   * forward any sign request.
   */
  expectedProtocolVersion: string;
  /** Per-request timeout in milliseconds. Default: 5000. */
  requestTimeoutMs?: number;
  /** Health-check probe timeout in milliseconds. Default: 2000. */
  probeTimeoutMs?: number;
  /** Logger — defaults to no-op. Observability only; does not affect decisions. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

// -------------------------------------------------------------------------
// Error codes — the strings returned in `SignerResult.error`.
// -------------------------------------------------------------------------

/**
 * The set of error codes the adapter can return. The error string is
 * always prefixed with one of these codes, followed by a colon and a
 * detail message. The caller can branch on the prefix.
 *
 * The adapter does NOT throw — it always returns a `SignerResult`. This
 * is consistent with the SignerSink contract: the Pipeline's signer gate
 * expects a result, not a throw.
 */
export const SignerAdapterError = {
  PROTOCOL_MISMATCH: "SIGNER_PROTOCOL_MISMATCH",
  UNAVAILABLE: "SIGNER_UNAVAILABLE",
  TIMEOUT: "SIGNER_TIMEOUT",
  INVALID_RESPONSE: "SIGNER_INVALID_RESPONSE",
  INVALID_REQUEST: "SIGNER_INVALID_REQUEST",
  PAYLOAD_CORRUPTED: "SIGNER_PAYLOAD_CORRUPTED",
  RPC_ERROR: "SIGNER_RPC_ERROR",
} as const;

// -------------------------------------------------------------------------
// The adapter.
// -------------------------------------------------------------------------

/**
 * SignerAdapter — implements `SignerSink` (the interface the H2.6
 * Pipeline composer calls). Translates the application-level
 * `SignerRequest` into a wire-level `SignerWireRequest`, sends it over
 * the configured transport, parses the response, and returns a
 * `SignerResult`.
 *
 * The adapter is STATEFUL only for the cached protocol-version
 * verification. Once `verifyProtocol()` succeeds, subsequent `submit()`
 * calls skip the health_check probe. If the signer is ever restarted
 * (e.g., upgraded to a new version), the adapter must be re-constructed
 * — the cached verification is not re-checked. M4's writer lease will
 * own the signer-lifecycle concerns; M3.1 keeps it simple.
 */
export class SignerAdapter implements SignerSink {
  private readonly cfg: Required<SignerAdapterConfig>;
  private protocolVerified = false;

  constructor(config: SignerAdapterConfig) {
    this.cfg = {
      transport: config.transport,
      expectedProtocolVersion: config.expectedProtocolVersion,
      requestTimeoutMs: config.requestTimeoutMs ?? 5000,
      probeTimeoutMs: config.probeTimeoutMs ?? 2000,
      log: config.log ?? (() => {}),
    };
  }

  /**
   * Pre-flight: probe the signer's protocol version via `health_check`.
   * Caches the result — subsequent calls within the same adapter
   * instance skip the probe.
   *
   * Returns true if the signer's version matches `expectedProtocolVersion`.
   * Returns false (with a reason) if the signer is unreachable, the
   * response is malformed, or the version doesn't match.
   *
   * This is the ADAPTER-SIDE half of the two-point protocol validation.
   * The SIGNER-SIDE half is in `src/signer/main.ts`'s `dispatchRpc`.
   */
  async verifyProtocol(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.protocolVerified) return { ok: true };

    let probeResp: RpcResponse;
    try {
      probeResp = await this.cfg.transport.rpc("health_check", undefined, this.cfg.probeTimeoutMs);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      return { ok: false, reason: classifyTransportError(msg, "health_check probe failed") };
    }

    if (!probeResp.ok) {
      const code = probeResp.error?.code;
      const msg = probeResp.error?.message ?? "(no message)";
      return {
        ok: false,
        reason: `${SignerAdapterError.RPC_ERROR}: health_check returned ${code} ${msg}`,
      };
    }

    const result = probeResp.result as { version?: unknown } | undefined;
    if (!result || typeof result !== "object") {
      return { ok: false, reason: `${SignerAdapterError.INVALID_RESPONSE}: health_check result is not an object` };
    }

    const signerVersion = result.version;
    if (typeof signerVersion !== "string") {
      return { ok: false, reason: `${SignerAdapterError.INVALID_RESPONSE}: health_check result.version is not a string` };
    }

    if (signerVersion !== this.cfg.expectedProtocolVersion) {
      return {
        ok: false,
        reason: `${SignerAdapterError.PROTOCOL_MISMATCH}: adapter expected ${this.cfg.expectedProtocolVersion}, signer reports ${signerVersion}`,
      };
    }

    this.protocolVerified = true;
    this.cfg.log("info", "signer protocol verified", { version: signerVersion });
    return { ok: true };
  }

  /**
   * Submit a sign request to the signer. Implements `SignerSink.submit`.
   *
   * Flow:
   *   1. Validate required fields on the incoming SignerRequest (defensive).
   *   2. Verify protocol version (cached; probes on first call).
   *   3. Build the wire envelope (SignerWireRequest).
   *   4. Send via transport with timeout.
   *   5. Parse response, verify structural validity.
   *   6. Verify requestId echo (catches response confusion).
   *   7. Verify receivedPayloadHash echo (catches payload corruption).
   *   8. Map to SignerResult and return.
   *
   * The adapter NEVER throws. Any error (transport, timeout, parse,
   * integrity) is converted into a `SignerResult` with `ok: false` and
   * a descriptive `error` string.
   */
  async submit(req: SignerRequest): Promise<SignerResult> {
    // 1. Validate required fields (adapter-side defense — the Pipeline
    //    already constructs a well-formed SignerRequest, but the adapter
    //    checks again so a future caller that bypasses the Pipeline
    //    cannot send a malformed request to the signer).
    const fieldErr = validateSignerRequest(req);
    if (fieldErr !== null) {
      return { ok: false, error: `${SignerAdapterError.INVALID_REQUEST}: ${fieldErr}` };
    }

    // 2. Verify protocol version (pre-flight). On mismatch, fail closed.
    const probe = await this.verifyProtocol();
    if (!probe.ok) {
      return { ok: false, error: probe.reason };
    }

    // 3. Build the wire envelope.
    const payload: SignerPayload = {
      tx: req.tx,
      expectedDiff: req.expectedDiff,
      approvedAmount: req.approvedAmount,
      slippageLimitBps: req.slippageLimitBps,
      sandwichScore: req.sandwichScore,
    };
    const payloadHash = sha256Canonical(payload);
    const wireReq: SignerWireRequest = {
      protocolVersion: this.cfg.expectedProtocolVersion,
      requestId: randomUUID(),
      operation: "signTransaction", // M3.1: only signTransaction. M3.2 adds the others.
      payload,
      payloadHash,
    };

    // 4. Send via transport with timeout.
    let rpcResp: RpcResponse;
    try {
      rpcResp = await this.cfg.transport.rpc(
        wireReq.operation,
        wireReq,
        this.cfg.requestTimeoutMs,
      );
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      return { ok: false, error: classifyTransportError(msg) };
    }

    // 5. Parse response — RPC-level error?
    if (!rpcResp.ok) {
      const errCode = rpcResp.error?.code;
      const errMsg = rpcResp.error?.message ?? "(no message)";

      // Signer-side protocol mismatch (the per-request validation in
      // dispatchRpc caught a version mismatch). Surface as
      // PROTOCOL_MISMATCH rather than a generic RPC error so the
      // caller can distinguish "wrong signer version" from "signer
      // rejected for an application reason".
      if (
        errCode === RPC_ERROR_CODES.POLICY_VIOLATION &&
        errMsg.includes(SignerAdapterError.PROTOCOL_MISMATCH)
      ) {
        return {
          ok: false,
          error: `${SignerAdapterError.PROTOCOL_MISMATCH}: signer rejected — ${errMsg}`,
        };
      }

      // All other RPC errors (including METHOD_NOT_FOUND, which is the
      // expected response from a real signer in M3.1 since signTransaction
      // isn't wired yet — M3.2 adds it). Include the numeric code in the
      // error string so the caller can branch on it.
      return {
        ok: false,
        error: `${SignerAdapterError.RPC_ERROR}: ${errCode} ${errMsg}`,
      };
    }

    // 6. Validate response structure.
    const result = rpcResp.result as Partial<SignerWireResponse> | undefined;
    if (!result || typeof result !== "object") {
      return {
        ok: false,
        error: `${SignerAdapterError.INVALID_RESPONSE}: result is not an object`,
      };
    }

    // 7. Verify requestId echo (catches response confusion).
    if (result.requestId !== wireReq.requestId) {
      return {
        ok: false,
        error: `${SignerAdapterError.INVALID_RESPONSE}: requestId mismatch (sent ${wireReq.requestId}, got ${result.requestId ?? "(missing)"})`,
      };
    }

    // 8. Verify payload hash echo (catches payload corruption in transit).
    if (result.receivedPayloadHash !== wireReq.payloadHash) {
      return {
        ok: false,
        error: `${SignerAdapterError.PAYLOAD_CORRUPTED}: payload hash mismatch (sent ${wireReq.payloadHash}, signer received ${result.receivedPayloadHash ?? "(missing)"})`,
      };
    }

    // 9. Map to SignerResult.
    if (result.ok === true) {
      if (typeof result.txHash !== "string" || result.txHash.length === 0) {
        return {
          ok: false,
          error: `${SignerAdapterError.INVALID_RESPONSE}: signer returned ok=true but txHash missing or empty`,
        };
      }
      return { ok: true, txHash: result.txHash };
    }

    // Signer returned an application-level rejection (ok=false with
    // echoed integrity fields). Propagate the signer's error verbatim.
    return {
      ok: false,
      error: result.error ?? "SIGNER_REJECTED: no error detail provided by signer",
    };
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Validate the application-level SignerRequest has all required fields.
 * Returns null if valid, or a human-readable error string if invalid.
 *
 * This is a DEFENSIVE check — the Pipeline already constructs a
 * well-formed request. The adapter checks again so a future caller
 * that bypasses the Pipeline cannot send a malformed request to the
 * signer.
 */
function validateSignerRequest(req: SignerRequest): string | null {
  if (req === null || typeof req !== "object") {
    return "request is not an object";
  }
  const { tx, expectedDiff, approvedAmount, slippageLimitBps, sandwichScore } = req as Partial<SignerRequest>;

  if (
    tx === undefined ||
    tx === null ||
    typeof tx !== "object" ||
    typeof tx.from !== "string" ||
    typeof tx.to !== "string" ||
    typeof tx.value !== "string" ||
    typeof tx.data !== "string"
  ) {
    return "tx field missing or malformed (expected { from, to, value, data } all strings)";
  }
  if (expectedDiff === undefined || expectedDiff === null || typeof expectedDiff !== "object") {
    return "expectedDiff field missing or not an object";
  }
  if (typeof approvedAmount !== "string") {
    return "approvedAmount field missing or not a string";
  }
  if (typeof slippageLimitBps !== "number" || Number.isNaN(slippageLimitBps)) {
    return "slippageLimitBps field missing or NaN";
  }
  if (typeof sandwichScore !== "number" || Number.isNaN(sandwichScore)) {
    return "sandwichScore field missing or NaN";
  }
  return null;
}

/**
 * Compute the SHA-256 hash of a value's canonical JSON serialization.
 * Used for payload integrity verification — the signer recomputes this
 * on receipt and rejects if the hash doesn't match.
 *
 * Canonical form: JSON.stringify with no whitespace. Key order is
 * preserved as insertion order (deterministic for objects constructed
 * by the adapter; the signer recomputes from the JSON it receives, so
 * insertion order is preserved end-to-end).
 */
function sha256Canonical(obj: unknown): string {
  const canonical = JSON.stringify(obj);
  return "0x" + createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Convenience constructor: build a SignerAdapter for the current
 * protocol version. The expected version is read from
 * `SIGNER_PROTOCOL_VERSION` in signer-protocol.ts, so when the
 * protocol version bumps (e.g., "1.2.0-m3" in M3.2), the adapter
 * automatically expects the new version.
 */
export function makeSignerAdapter(transport: SignerTransport): SignerAdapter {
  return new SignerAdapter({
    transport,
    expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
  });
}

/**
 * Classify a transport-thrown error into TIMEOUT vs UNAVAILABLE.
 * Used by both `verifyProtocol()` and `submit()` so the
 * classification is consistent.
 *
 * The classification is heuristic (regex on the error message) because
 * Node's socket errors don't have a structured type. The patterns are
 * conservative: anything that mentions "timeout" / "timed out" →
 * TIMEOUT; anything that mentions connection-shaped failures →
 * UNAVAILABLE; unknown errors → UNAVAILABLE (fail closed).
 *
 * `context` is an optional suffix appended to the error string for
 * diagnostic clarity (e.g., "health_check probe failed").
 */
function classifyTransportError(msg: string, context?: string): string {
  let code: string;
  if (/timeout|timed out/i.test(msg)) {
    code = SignerAdapterError.TIMEOUT;
  } else if (/ECONNREFUSED|ENOTFOUND|EPIPE|connect|offline|unavailable/i.test(msg)) {
    code = SignerAdapterError.UNAVAILABLE;
  } else {
    // Unknown transport error — fail closed as UNAVAILABLE.
    code = SignerAdapterError.UNAVAILABLE;
  }
  const suffix = context ? ` — ${context}` : "";
  return `${code}: ${msg}${suffix}`;
}
