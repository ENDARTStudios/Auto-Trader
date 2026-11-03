// src/app/api/signer/health/route.ts — GET /api/signer/health
//
// Read-only signer reachability/protocol probe for operators + dashboards.
//
// SECURITY:
//   - requirePermission("system:read") — não expõe estado do signer a anônimos.
//   - O caminho completo do socket NUNCA é retornado (só versão mascarada).
//   - Nenhum segredo (chave/passphrase/blob) passa por aqui; só a versão do
//     protocolo reportada pelo signer.
//   - Timeout curto (connect 750ms / request 1500ms): o endpoint é de saúde,
//     não pode pendurar o handler.
//
// FAIL-CLOSED: sem SIGNER_SOCKET_PATH responde configured=false, reachable=false.

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { SIGNER_PROTOCOL_VERSION } from "@/lib/signer-protocol";
import {
  UnixSocketSignerTransport,
  maskSignerSocketPath,
} from "@/lib/chain/signer-transport";

export const dynamic = "force-dynamic";

const CONNECT_TIMEOUT_MS = 750;
const PROBE_TIMEOUT_MS = 1500;

function errorCodeFromMessage(message: string): string {
  const prefix = message.split(":")[0]?.trim() ?? "";
  return prefix.startsWith("SIGNER_") ? prefix : "SIGNER_UNAVAILABLE";
}

export async function GET(req: Request) {
  try {
    await requirePermission("system:read")(req);
  } catch (err) {
    return handleApiError(err, "GET /api/signer/health");
  }

  const socketPath = process.env.SIGNER_SOCKET_PATH?.trim() ?? "";
  const expectedProtocolVersion =
    process.env.SIGNER_PROTOCOL_VERSION?.trim() || SIGNER_PROTOCOL_VERSION;

  const base = {
    configured: socketPath.length > 0,
    reachable: false,
    protocolVersion: null as string | null,
    protocolVersionMatches: false,
    expectedProtocolVersion,
    socketPathMasked: maskSignerSocketPath(socketPath),
    error: null as string | null,
  };

  if (!socketPath) {
    return NextResponse.json(
      { ...base, error: "SIGNER_NOT_CONFIGURED" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const transport = new UnixSocketSignerTransport({
      socketPath,
      protocol: socketPath.startsWith("tcp://") ? "tcp" : "unix",
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
    });
    const resp = await transport.rpc("health_check", undefined, PROBE_TIMEOUT_MS);
    if (!resp.ok) {
      return NextResponse.json(
        { ...base, error: "SIGNER_RPC_ERROR" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const result = resp.result as { version?: unknown } | undefined;
    const protocolVersion =
      result && typeof result === "object" && typeof result.version === "string"
        ? result.version
        : null;
    return NextResponse.json(
      {
        ...base,
        reachable: true,
        protocolVersion,
        protocolVersionMatches: protocolVersion === expectedProtocolVersion,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    // Only the code prefix is surfaced — never the raw message (could contain
    // the socket path or OS details).
    return NextResponse.json(
      { ...base, error: errorCodeFromMessage((err as Error).message ?? "") },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
