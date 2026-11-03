// src/lib/chain/signer-transport.ts — REAL transport for the signer process.
//
// The signer (src/signer/main.ts) listens on a Unix domain socket and speaks
// newline-delimited JSON-RPC 2.0 (see src/lib/signer-protocol.ts). This module
// implements the `SignerTransport` interface from signer-adapter.ts:
//
//   1. Open ONE connection per RPC call (open → write frame → read ONE line →
//      parse → close). No connection pooling, no persistence.
//   2. Enforce a connect timeout and a per-request timeout.
//   3. Bound the response frame size (a signer bug / hostile peer cannot make
//      the web process allocate unbounded memory).
//   4. NEVER retry, NEVER fall back to another signer, NEVER cache. Those are
//      explicit non-goals of the M3.1 contract (see signer-adapter.ts header)
//      and are enforced by the test suite.
//
// SECURITY / TRUST MODEL
// ----------------------
// - Production uses a Unix socket (filesystem permissions 0600 restrict who
//   can connect; only the same user as the signer process).
// - `tcp://host:port` is supported ONLY for tests/dev (documented here + in
//   the round-2 report); it must not be used in production because
//   any local process could talk to the signer. `makeSignerAdapterFromEnv`
//   accepts it solely so integration tests can exercise the real wire format
//   without AF_UNIX (Windows CI).
// - No secrets ever pass through this module in logs: only method names and
//   error codes are logged, never params/results.

import { randomUUID } from "node:crypto";
import net, { type Socket } from "node:net";
import { JSONRPC_VERSION, SIGNER_PROTOCOL_VERSION } from "@/lib/signer-protocol";
import {
  SignerAdapter,
  type RpcResponse,
  type SignerTransport,
} from "./signer-adapter";

/** Error-code prefixes thrown by this transport (the adapter classifies them). */
export const SIGNER_TRANSPORT_ERROR = {
  TIMEOUT: "SIGNER_TIMEOUT",
  UNAVAILABLE: "SIGNER_UNAVAILABLE",
  INVALID_RESPONSE: "SIGNER_INVALID_RESPONSE",
} as const;

export type SignerTransportErrorCode =
  (typeof SIGNER_TRANSPORT_ERROR)[keyof typeof SIGNER_TRANSPORT_ERROR];

export type SignerTransportLog = (
  level: "info" | "warn" | "error",
  msg: string,
  fields?: Record<string, unknown>,
) => void;

/** Minimal socket options passed to the injectable connection factory. */
export interface SignerSocketTarget {
  path?: string;
  host?: string;
  port?: number;
}

/** Injectable for tests; defaults to `net.createConnection`. */
export type SignerConnectionFactory = (target: SignerSocketTarget) => Socket;

export interface UnixSocketSignerTransportOptions {
  /**
   * Unix socket path (production), or `tcp://host:port` for tests/dev.
   * `SIGNER_SOCKET_PATH` in production.
   */
  socketPath: string;
  /** Default: inferred from the socketPath prefix (`tcp://` → tcp, else unix). */
  protocol?: "unix" | "tcp";
  /** Connect timeout. Default: min(2000, request timeout). */
  connectTimeoutMs?: number;
  /** Hard cap on a single response frame (bytes). Default: 1 MiB. */
  maxFrameBytes?: number;
  /** Observability only — never pass secrets. */
  log?: SignerTransportLog;
  /** Test seam: replace `net.createConnection`. */
  createConnection?: SignerConnectionFactory;
}

const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_CONNECT_TIMEOUT_MS = 2000;

function makeError(code: SignerTransportErrorCode, message: string): Error {
  const err = new Error(`${code}: ${message}`);
  err.name = "SignerTransportError";
  (err as Error & { signerCode?: string }).signerCode = code;
  return err;
}

function parseTcpTarget(socketPath: string): { host: string; port: number } {
  let url: URL;
  try {
    url = new URL(socketPath);
  } catch {
    throw makeError(SIGNER_TRANSPORT_ERROR.UNAVAILABLE, "invalid tcp:// socket path");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw makeError(SIGNER_TRANSPORT_ERROR.UNAVAILABLE, "tcp:// socket path has invalid port");
  }
  return { host: url.hostname || "127.0.0.1", port };
}

/**
 * `SignerTransport` backed by a Unix domain socket (or TCP for tests).
 *
 * One connection per `rpc()` call — mandated by the M3.1 contract (no
 * reconnection, no retry, no pooling).
 */
export class UnixSocketSignerTransport implements SignerTransport {
  private readonly socketPath: string;
  private readonly protocol: "unix" | "tcp";
  private readonly connectTimeoutMs: number;
  private readonly maxFrameBytes: number;
  private readonly log: SignerTransportLog;
  private readonly createConnection: SignerConnectionFactory;

  constructor(options: UnixSocketSignerTransportOptions) {
    if (!options || typeof options.socketPath !== "string" || options.socketPath.trim() === "") {
      throw new Error("UnixSocketSignerTransport requires a non-empty socketPath");
    }
    this.socketPath = options.socketPath;
    this.protocol = options.protocol ?? (options.socketPath.startsWith("tcp://") ? "tcp" : "unix");
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.log = options.log ?? (() => {});
    this.createConnection =
      options.createConnection ??
      ((target) =>
        target.path !== undefined
          ? net.createConnection({ path: target.path })
          : net.createConnection({ host: target.host ?? "127.0.0.1", port: target.port ?? 0 }));
  }

  /** Exposed for diagnostics/tests; never includes a secret. */
  getSocketPath(): string {
    return this.socketPath;
  }

  getProtocol(): "unix" | "tcp" {
    return this.protocol;
  }

  async rpc(method: string, params: unknown, timeoutMs: number): Promise<RpcResponse> {
    // One attempt only. There is deliberately no retry loop here.
    return new Promise<RpcResponse>((resolve, reject) => {
      const requestId = randomUUID();
      let settled = false;
      let buffer = "";
      let socket: Socket | null = null;
      let connectTimer: ReturnType<typeof setTimeout> | null = null;
      let requestTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (connectTimer) clearTimeout(connectTimer);
        if (requestTimer) clearTimeout(requestTimer);
        connectTimer = null;
        requestTimer = null;
        if (socket) {
          const s = socket;
          socket = null;
          s.removeAllListeners();
          s.destroy();
        }
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.log("warn", "signer rpc failed", {
          method,
          code: (err as Error & { signerCode?: string }).signerCode ?? "SIGNER_UNAVAILABLE",
        });
        reject(err);
      };

      const succeed = (resp: RpcResponse) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(resp);
      };

      const finishFromFrame = (line: string) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          fail(makeError(SIGNER_TRANSPORT_ERROR.INVALID_RESPONSE, "response frame is not valid JSON"));
          return;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          fail(makeError(SIGNER_TRANSPORT_ERROR.INVALID_RESPONSE, "response frame is not a JSON-RPC object"));
          return;
        }
        const obj = parsed as {
          jsonrpc?: unknown;
          id?: unknown;
          result?: unknown;
          error?: { code?: unknown; message?: unknown; data?: unknown };
        };
        if (obj.jsonrpc !== JSONRPC_VERSION) {
          fail(makeError(SIGNER_TRANSPORT_ERROR.INVALID_RESPONSE, "response jsonrpc version mismatch"));
          return;
        }
        if (obj.id !== requestId) {
          fail(makeError(SIGNER_TRANSPORT_ERROR.INVALID_RESPONSE, "response id does not match request id"));
          return;
        }
        if (obj.error !== undefined) {
          const code = typeof obj.error?.code === "number" ? obj.error.code : -32603;
          const message = typeof obj.error?.message === "string" ? obj.error.message : "signer rpc error";
          succeed({ ok: false, error: { code, message, data: obj.error?.data } });
          return;
        }
        if (!("result" in obj)) {
          fail(makeError(SIGNER_TRANSPORT_ERROR.INVALID_RESPONSE, "response has neither result nor error"));
          return;
        }
        succeed({ ok: true, result: obj.result });
      };

      const onData = (chunk: Buffer) => {
        if (settled) return;
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline === -1) {
          if (buffer.length > this.maxFrameBytes) {
            fail(
              makeError(
                SIGNER_TRANSPORT_ERROR.INVALID_RESPONSE,
                `response frame exceeds maxFrameBytes (${this.maxFrameBytes})`,
              ),
            );
          }
          return;
        }
        const line = buffer.slice(0, newline);
        if (line.length > this.maxFrameBytes) {
          fail(
            makeError(
              SIGNER_TRANSPORT_ERROR.INVALID_RESPONSE,
              `response frame exceeds maxFrameBytes (${this.maxFrameBytes})`,
            ),
          );
          return;
        }
        finishFromFrame(line);
      };

      let target: SignerSocketTarget;
      try {
        target = this.protocol === "tcp" ? parseTcpTarget(this.socketPath) : { path: this.socketPath };
      } catch (err) {
        fail(err as Error);
        return;
      }

      const connectTimeoutMs = Math.min(this.connectTimeoutMs, Math.max(1, timeoutMs));
      connectTimer = setTimeout(() => {
        fail(makeError(SIGNER_TRANSPORT_ERROR.UNAVAILABLE, "connect timeout to signer socket"));
      }, connectTimeoutMs);

      // Overall request timeout (write + read). Independent from connect timeout.
      requestTimer = setTimeout(() => {
        fail(makeError(SIGNER_TRANSPORT_ERROR.TIMEOUT, `no response within ${timeoutMs}ms`));
      }, Math.max(1, timeoutMs));

      try {
        socket = this.createConnection(target);
      } catch (err) {
        fail(makeError(SIGNER_TRANSPORT_ERROR.UNAVAILABLE, `cannot open signer socket: ${(err as Error).message}`));
        return;
      }

      socket.once("connect", () => {
        if (settled) return;
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        const frameRecord: Record<string, unknown> = {
          jsonrpc: JSONRPC_VERSION,
          method,
          id: requestId,
        };
        // JSON-RPC 2.0: omit `params` entirely for no-param methods.
        if (params !== undefined) frameRecord.params = params;
        try {
          socket?.write(JSON.stringify(frameRecord) + "\n");
        } catch (err) {
          fail(makeError(SIGNER_TRANSPORT_ERROR.UNAVAILABLE, `write failed: ${(err as Error).message}`));
        }
      });

      socket.on("data", onData);

      socket.once("error", (err: Error) => {
        fail(makeError(SIGNER_TRANSPORT_ERROR.UNAVAILABLE, `socket error: ${err.message}`));
      });

      socket.once("close", () => {
        if (settled) return;
        fail(makeError(SIGNER_TRANSPORT_ERROR.UNAVAILABLE, "signer closed connection before a complete response"));
      });
    });
  }
}

/**
 * Factory used by the API routes / engine: builds a SignerAdapter whose
 * transport points at `SIGNER_SOCKET_PATH` and whose expected protocol
 * version is `SIGNER_PROTOCOL_VERSION` (env override honored).
 *
 * FAIL-CLOSED: throws when `SIGNER_SOCKET_PATH` is not configured. Callers
 * that need to report "not configured" (e.g. GET /api/signer/health) must
 * check the env first instead of catching a throw.
 */
export interface MakeSignerAdapterOverrides {
  protocol?: "unix" | "tcp";
  connectTimeoutMs?: number;
  maxFrameBytes?: number;
  requestTimeoutMs?: number;
  probeTimeoutMs?: number;
  log?: SignerTransportLog;
  createConnection?: SignerConnectionFactory;
}

export function makeSignerAdapterFromEnv(overrides: MakeSignerAdapterOverrides = {}): SignerAdapter {
  const socketPath = process.env.SIGNER_SOCKET_PATH?.trim();
  if (!socketPath) {
    throw new Error(
      "SIGNER_SOCKET_PATH is not configured — signer transport unavailable (fail-closed)",
    );
  }
  const expectedProtocolVersion =
    process.env.SIGNER_PROTOCOL_VERSION?.trim() || SIGNER_PROTOCOL_VERSION;
  const protocol =
    overrides.protocol ?? (socketPath.startsWith("tcp://") ? "tcp" : "unix");

  const transport = new UnixSocketSignerTransport({
    socketPath,
    protocol,
    connectTimeoutMs: overrides.connectTimeoutMs,
    maxFrameBytes: overrides.maxFrameBytes,
    log: overrides.log,
    createConnection: overrides.createConnection,
  });

  return new SignerAdapter({
    transport,
    expectedProtocolVersion,
    requestTimeoutMs: overrides.requestTimeoutMs,
    probeTimeoutMs: overrides.probeTimeoutMs,
    log: overrides.log,
  });
}

/**
 * Masks a signer socket path for API responses. The full path is never
 * returned: it can reveal directory layout / key material locations.
 * Examples:
 *   /run/signer/signer-1234.sock → "…/sign***ock"
 *   tcp://127.0.0.1:7654         → "tcp://127.0.0.1:****"
 */
export function maskSignerSocketPath(socketPath: string | null | undefined): string | null {
  if (!socketPath || socketPath.trim() === "") return null;
  const value = socketPath.trim();
  if (value.includes("://")) {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.hostname}:****`;
    } catch {
      return "tcp://****";
    }
  }
  const segments = value.split(/[\\/]/).filter((s) => s.length > 0);
  const basename = segments[segments.length - 1] ?? "signer.sock";
  const masked =
    basename.length <= 8
      ? "*".repeat(Math.max(3, basename.length))
      : `${basename.slice(0, 4)}***${basename.slice(-3)}`;
  return `…/${masked}`;
}
