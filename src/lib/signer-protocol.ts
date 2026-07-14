// src/lib/signer-protocol.ts
//
// Phase 1 (M1): protocol constants shared between the signer process
// (src/signer/main.ts) and the web process's RPC client (to be created
// in M6 as src/lib/trading/signer-client.ts).
//
// This module is deliberately side-effect-free and dependency-free —
// it's imported by BOTH the signer process and the web process, so it
// must not pull in any Node-only or Next-only APIs.
//
// JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
//
// We implement a SUBSET of JSON-RPC 2.0:
//   - Request objects: { jsonrpc: "2.0", method: string, params?: any, id: number|string }
//   - Success response: { jsonrpc: "2.0", result: any, id: number|string }
//   - Error response: { jsonrpc: "2.0", error: { code: number, message: string, data?: any }, id: number|string }
//   - Notifications (no id): NOT supported in M1 — every request gets a response.
//   - Batch requests: NOT supported in M1 — one request per message frame.
//
// Transport: newline-delimited JSON over a Unix socket. Each frame is a
// single JSON object followed by \n. This is simpler than length-prefix
// framing and sufficient for the signer's low RPC volume (signs per
// trade, not per HTTP request).

/**
 * JSON-RPC 2.0 protocol version string. Every request and response
 * includes this field — the dispatcher verifies it on incoming requests.
 */
export const JSONRPC_VERSION = "2.0" as const;

/**
 * Method allowlist. The signer's JSON-RPC dispatcher REJECTS any method
 * not in this list with error code -32601 (Method not found).
 *
 * M1: only `health_check` is implemented. The wallet methods (unlock,
 * lock, getVaultStatus, etc.) are added in M2; the signing methods
 * (sign, sign_typed_data) in M3; the writer-lease methods
 * (acquire_writer, renew_writer) in M4.
 *
 * The allowlist is the FIRST layer of the trust boundary: even if the
 * web process is compromised and tries to call an internal method, the
 * signer rejects it. This is why the allowlist is a frozen const, not
 * a runtime-configurable list — the set of allowed methods is a design
 * decision, not an operational one.
 *
 * M2.1 NOTE: the M2 method NAMES + their param/result schemas are
 * defined below (see `SignerMethodName`, `UnlockParams`,
 * `UnlockResult`, etc.). The allowlist itself is NOT yet expanded to
 * include them — that happens in M2.3, when the actual handlers land
 * in the same change. This keeps Test 2 of `test-signer-process.ts`
 * ("unlock returns -32601 Method not found") valid through M2.1/M2.2:
 * the method is rejected by the allowlist, not by a "not yet
 * implemented" fallback in the dispatcher. Expanding the allowlist
 * without the handlers would create a confusing transitional state
 * where the same -32601 code means two different things ("unknown to
 * the allowlist" vs "allowlisted but not yet wired up"). The discipline
 * is: allowlist + handlers ship together, in one change, per milestone.
 */
export const SIGNER_METHOD_ALLOWLIST = [
  "health_check",
  // M2 (wallet): unlock, lock, getVaultStatus, clearRateLimit, getRateLimitStatus
  //   — added to the allowlist in M2.3, alongside their handlers.
  // M3 (signing): sign, sign_typed_data
  // M4 (writer lease): acquire_writer, renew_writer
] as const;

export type SignerMethod = (typeof SIGNER_METHOD_ALLOWLIST)[number];

/**
 * Standard JSON-RPC 2.0 error codes. The signer uses these for protocol-
 * level errors (parse, method not found, invalid params). Application-
 * level errors (policy violations, rate limits) use the -32000 custom
 * range defined below.
 *
 * See: https://www.jsonrpc.org/specification#error_object
 */
export const RPC_ERROR_CODES = {
  PARSE_ERROR: -32700, // Invalid JSON was received
  INVALID_REQUEST: -32600, // The JSON sent is not a valid Request object
  METHOD_NOT_FOUND: -32601, // The method does not exist or is not available
  INVALID_PARAMS: -32602, // Invalid method parameter(s)
  INTERNAL_ERROR: -32603, // Internal JSON-RPC error
  // Custom range -32000 to -32099 (reserved for implementation-defined errors)
  POLICY_VIOLATION: -32006, // Signer-side authorization policy rejected the RPC (§7.3)
  RATE_LIMITED: -32007, // Unlock rate limit (per-IP or global) blocked the RPC (§7.3.7)
  VAULT_LOCKED: -32008, // Vault is locked; unlock required before this method
  WRITER_LEASE_NOT_HELD: -32009, // Writer lease not held; acquire_writer required (§9.4)
  PRICE_FEED_STALE: -32010, // Price feed data is stale or unavailable; sign rejected (§7.3.1)
} as const;

/**
 * SIGNER_READY message: the signer process writes this single line to
 * stdout once the Unix socket is listening. The parent process (web)
 * reads this line and knows it can connect.
 *
 * Format: a single JSON object on one line, followed by \n.
 *
 * The parent process MUST wait for this line before attempting to
 * connect to the socket — the socket file may not exist yet if the
 * parent races ahead.
 *
 * The parent process MUST verify that `socketPath` in the message
 * matches the expected path (derived from the child's PID or an agreed-
 * upon env var). This prevents a malicious process from pre-creating a
 * socket at the expected path and intercepting the connection.
 */
export interface SignerReadyMessage {
  type: "SIGNER_READY";
  pid: number;
  socketPath: string;
  version: string; // signer protocol version, for compatibility checks
}

/**
 * Signer protocol version. Incremented when the wire protocol changes
 * in a backwards-incompatible way. The web process's RPC client checks
 * this on startup and refuses to connect if the version doesn't match.
 *
 * M1: version "1.0.0-m1" — only health_check is implemented.
 */
export const SIGNER_PROTOCOL_VERSION = "1.0.0-m1";

/**
 * Default Unix socket path template. The signer replaces ${pid} with
 * the process's PID. The parent process reads the actual path from
 * the SIGNER_READY message.
 *
 * The socket is created in /tmp because:
 *   1. It's world-writable (so the signer can create the file).
 *   2. The socket file is removed on process exit (we register a
 *      cleanup handler).
 *   3. Filesystem permissions on the socket file itself (0600) prevent
 *      unauthorized connections — only processes running as the same
 *      user as the signer can connect.
 *
 * For production, the operator may want to set SIGNER_SOCKET_PATH to a
 * locked-down directory (e.g., /run/signer/ with 0700 permissions).
 */
export const DEFAULT_SOCKET_PATH_TEMPLATE = "/tmp/signer-${pid}.sock";

/**
 * Environment variable overrides. The signer reads these at boot — they
 * are NOT RPC parameters, so a compromised web process cannot override
 * them at runtime.
 */
export const SIGNER_ENV = {
  SOCKET_PATH: "SIGNER_SOCKET_PATH",
  AUDIT_LOG_PATH: "SIGNER_AUDIT_LOG", // §7.3.4
  MAX_TX_USD: "SIGNER_MAX_TX_USD", // §7.3.1
  MAX_WINDOW_USD: "SIGNER_MAX_WINDOW_USD", // §7.3.2
  WINDOW_SEC: "SIGNER_WINDOW_SEC", // §7.3.2
  DEST_ALLOWLIST: "SIGNER_DEST_ALLOWLIST", // §7.3.3
  PRICE_FEED_BINANCE_URL: "SIGNER_PRICE_FEED_BINANCE_URL", // §7.3.1
  PRICE_FEED_DEXSCREENER_URL: "SIGNER_PRICE_FEED_DEXSCREENER_URL", // §7.3.1
  PRICE_FEED_STALE_SEC: "SIGNER_PRICE_FEED_STALE_SEC", // §7.3.1
  WRITER_LEASE_TTL_SEC: "SIGNER_WRITER_LEASE_TTL_SEC", // §9.4
  WRITER_LEASE_RENEW_SEC: "SIGNER_WRITER_LEASE_RENEW_SEC", // §9.4
} as const;

/**
 * Type guard: is the given method name in the allowlist?
 */
export function isAllowedSignerMethod(method: string): method is SignerMethod {
  return (SIGNER_METHOD_ALLOWLIST as readonly string[]).includes(method);
}

/**
 * Construct a JSON-RPC success response.
 */
export function rpcSuccess(id: number | string, result: unknown): string {
  return JSON.stringify({ jsonrpc: JSONRPC_VERSION, result, id }) + "\n";
}

/**
 * Construct a JSON-RPC error response.
 */
export function rpcError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown
): string {
  const error: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) error.data = data;
  return JSON.stringify({ jsonrpc: JSONRPC_VERSION, error, id }) + "\n";
}

/**
 * Parse a JSON-RPC request frame. Returns the parsed request or an
 * error code + message if the frame is invalid.
 *
 * This is a pure function — exported so the test suite can call it
 * directly without going through the socket transport.
 */
export function parseRpcFrame(
  frame: string
):
  | { ok: true; method: string; id: number | string; params?: unknown }
  | { ok: false; code: number; message: string; id: number | string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    return { ok: false, code: RPC_ERROR_CODES.PARSE_ERROR, message: "Parse error", id: null };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return { ok: false, code: RPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid Request", id: null };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.jsonrpc !== JSONRPC_VERSION) {
    return { ok: false, code: RPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid Request: jsonrpc must be '2.0'", id: typeof obj.id === "number" || typeof obj.id === "string" ? obj.id : null };
  }

  if (typeof obj.method !== "string") {
    return { ok: false, code: RPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid Request: method must be a string", id: typeof obj.id === "number" || typeof obj.id === "string" ? obj.id : null };
  }

  // id is required (notifications not supported in M1)
  if (typeof obj.id !== "number" && typeof obj.id !== "string") {
    return { ok: false, code: RPC_ERROR_CODES.INVALID_REQUEST, message: "Invalid Request: id must be number or string (notifications not supported)", id: null };
  }

  return { ok: true, method: obj.method, id: obj.id, params: obj.params };
}

// ---------------------------------------------------------------------------
// M2 method schemas (wallet RPCs)
// ---------------------------------------------------------------------------
//
// These types define the param/result shapes for the wallet RPCs that will
// be added in M2.3. They are defined here (in the protocol module) so both
// the signer's dispatcher and the web-side client (M6) share the same
// contract.
//
// The allowlist is NOT yet expanded to include these methods — see the
// M2.1 NOTE on SIGNER_METHOD_ALLOWLIST above. The types are forward
// declarations: they exist so that when M2.3 lands the handlers + the
// allowlist expansion + the dispatcher wiring can all reference a single
// source of truth for the param/result shapes.
//
// DESIGN CHOICE: params are passed as positional elements of a JSON array
// OR as a named-element JSON object. JSON-RPC 2.0 permits both; we
// standardize on OBJECT params (named) for all M2+ methods, because:
//   - Object params are self-documenting at the wire level (a log of the
//     request shows what each field means without consulting the schema).
//   - Object params are forward-compatible (adding a new optional field
//     doesn't break existing callers).
//   - Positional params are brittle (reordering or inserting a field
//     silently breaks every caller).
//
// The `health_check` method (M1) takes no params — its request object
// omits the `params` field entirely, per JSON-RPC 2.0.

/**
 * Union of all method names that will be in the allowlist once M2 lands.
 * M1's allowlist contains only `health_check`; M2 adds the wallet methods
 * below. This union is the type-level projection of the future allowlist.
 */
export type SignerMethodName =
  | "health_check"
  | "unlock"
  | "lock"
  | "getVaultStatus"
  | "clearRateLimit"
  | "getRateLimitStatus";

/**
 * `unlock` params.
 *
 * NOTE: the `sourceIp` field is the trusted-client IP of the originating
 * HTTP request (resolved by `proxy-trust.ts` on the web side and passed
 * through the RPC). The signer uses it for the per-IP rate-limit bucket
 * (§7.3.7) and for the audit-log entry (§7.3.4). The signer does NOT
 * trust this field for security decisions beyond rate-limiting — the
 * actual trust validation happened on the web side, and a compromised
 * web process could lie about the IP. The defense-in-depth here is that
 * the signer ALSO enforces the global aggregate rate limit, which a
 * compromised web process cannot rotate around.
 *
 * Passphrase is required. The signer derives the PBKDF2 key + attempts
 * to decrypt every wallet/exchange blob from the DB; if ANY blob fails,
 * the whole unlock aborts (atomicity — never a partial vault state).
 */
export interface UnlockParams {
  passphrase: string;
  sourceIp: string;
}

/**
 * `unlock` result. Returned on successful unlock — the operator can
 * verify how many wallets/exchanges were loaded. On failure, an RPC
 * error is returned instead (with code -32007 RATE_LIMITED,
 * -32008 VAULT_LOCKED, or a generic -32000 for wrong passphrase).
 */
export interface UnlockResult {
  unlocked: boolean;
  walletCount: number;
  exchangeCount: number;
  unlockTime: string; // ISO 8601
}

/**
 * `lock` params. The `reason` field is for the audit log (e.g. "manual",
 * "auto-lock", "engine-stop"). The `sourceIp` field is the originating
 * request's trusted IP, same as `unlock`.
 */
export interface LockParams {
  reason: string;
  sourceIp: string;
}

/**
 * `lock` result. Confirms the vault is now locked.
 */
export interface LockResult {
  unlocked: boolean;
}

/**
 * `getVaultStatus` result. Returned for `getVaultStatus` (no params).
 *
 * This mirrors the shape returned by `walletVault.stats()` in
 * `wallet-crypto.ts`, with all `Date` fields serialized to ISO 8601
 * strings (JSON has no Date type). The web-side `wallet-manager.ts`
 * `getVaultStatus()` function currently consumes this shape directly;
 * in M6 it will consume it via the RPC response instead.
 */
export interface VaultStatusResult {
  unlocked: boolean;
  walletCount: number;
  exchangeCount: number;
  unlockTime: string | null; // ISO 8601
  lastKeyAccessAt: string | null; // ISO 8601
  autoLockInSec: number | null;
  cooldownUntil: string | null; // ISO 8601, per-IP (the requesting IP's bucket)
  recentFailures: number; // per-IP (the requesting IP's bucket)
  globalCooldownUntil: string | null; // ISO 8601
  globalRecentFailures: number;
  trackedIpCount: number;
}

/**
 * `clearRateLimit` params. Operator-only operation — clears the per-IP
 * rate-limit state for a specific IP (or all IPs if `ip === "*"`). Used
 * when an operator fat-fingered the passphrase and locked themselves out.
 *
 * SECURITY: this method is allowlisted (M2) but the signer SHOULD
 * additionally enforce that the request comes from a trusted source
 * (e.g., a local control socket, or an operator-authenticated session).
 * In M2 we rely on the allowlist + the Unix socket's 0600 permissions
 * (only the same user can connect). A future hardening (M3 or later)
 * may add an operator-auth token to this RPC.
 */
export interface ClearRateLimitParams {
  ip: string; // specific IP, or "*" for all
}

/**
 * `clearRateLimit` result. Confirms how many rate-limit entries were
 * cleared.
 */
export interface ClearRateLimitResult {
  cleared: number;
}

/**
 * `getRateLimitStatus` params. Returns the rate-limit state for a
 * specific IP (the requesting IP, normally). Operator can pass any IP
 * to inspect it.
 */
export interface GetRateLimitStatusParams {
  ip: string;
}

/**
 * `getRateLimitStatus` result. Mirrors the per-IP fields of
 * `VaultStatusResult` for a specific IP, plus the global state.
 */
export interface GetRateLimitStatusResult {
  ip: string;
  recentFailures: number;
  cooldownUntil: string | null; // ISO 8601
  globalRecentFailures: number;
  globalCooldownUntil: string | null; // ISO 8601
  trackedIpCount: number;
}

/**
 * A method handler is a pure function: takes the parsed `params` (or
 * `undefined` for no-param methods like `health_check`), returns either
 * a success result or an application-level RPC error (with a JSON-RPC
 * error code + message + optional data).
 *
 * CRITICAL (operator's Note 1 from the §7.3.7 final sign-off): a method
 * handler that THROWS (rather than returning `{ ok: false, ... }`) is
 * signaling an UNEXPECTED exception — not a normal application error.
 * The dispatcher MUST let such exceptions propagate to Node's
 * `uncaughtException` handler so `crash-logger.ts` writes the stack
 * trace and the process exits + restarts. The dispatcher MUST NOT
 * catch handler exceptions and convert them to -32603 Internal Error
 * responses — that would silently swallow bugs in the handler, which
 * is exactly the "silent failure without log" pattern this project's
 * crash investigation exists to eliminate.
 *
 * Application errors (wrong passphrase, rate limited, vault locked,
 * policy violation) are returned as `{ ok: false, ... }` objects, not
 * thrown. The distinction: "the operator typed the wrong passphrase"
 * is a normal application error (return -32000); "the vault's Map
 * access threw a TypeError" is a bug (let it propagate).
 *
 * This contract is enforced by the dispatcher's structure — see the
 * comment block at `dispatchRpc` in `src/signer/main.ts`.
 */
export type MethodHandlerResult =
  | { ok: true; result: unknown }
  | { ok: false; code: number; message: string; data?: unknown };

export type MethodHandler = (params: unknown) => MethodHandlerResult | Promise<MethodHandlerResult>;
