import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { getVaultStatus } from "@/lib/trading/wallet-manager";
import { walletVault } from "@/lib/trading/wallet-crypto";
import { extractTrustedClientIp } from "@/lib/trading/proxy-trust";

// v19.3.1 HOTFIX (refined in v19.3.2): extractSourceIp() was replaced by
// extractTrustedClientIp() from src/lib/trading/proxy-trust.ts. The old
// function blindly trusted the `x-forwarded-for` header, which is
// client-writable — an attacker could rotate a fake XFF value per request
// and bypass the per-IP rate limiter entirely.
//
// v19.3.2: the fallback (no proxy secret configured) is now the TCP socket
// peer address from `connection().peer.address` (next/headers), NOT a
// shared "direct-untrusted" sentinel. The sentinel was a single shared
// bucket that recreated the original self-DoS bug for this project's
// actual deployment topology (bind 127.0.0.1, no reverse proxy since v18).
// See src/lib/trading/proxy-trust.ts for the full trust model and the
// known NAT/Docker userland-proxy edge case (runbook §13.7).

// GET /api/vault — vault status (unlocked? how many keys loaded? auto-lock countdown?)
export async function GET() {
  try {
    return NextResponse.json(getVaultStatus());
  } catch (err) {
    logger.error("api", `Erro lendo vault status: ${String(err)}`);
    return NextResponse.json({ error: "Failed to fetch vault status" }, { status: 500 });
  }
}

// POST /api/vault — unlock / lock the vault
// Body: { action: "unlock"|"lock", passphrase?: string }
//
// v17: unlock now ACTUALLY loads + decrypts every wallet + exchange credential
// from the DB into process memory. If the passphrase is wrong for any blob,
// the unlock fails (HTTP 401) and a failed attempt is recorded — 5 failures
// in 60s triggers a 5min cooldown (HTTP 429).
//
// v19.2: source IP extracted from request headers is passed to the vault
// for audit logging.
//
// v19.3.1 HOTFIX: source IP extraction now goes through the trusted-proxy
// model (see proxy-trust.ts). XFF is no longer trusted blindly.
//
// v19.3.2 HOTFIX-FIX: extractTrustedClientIp is now async — it calls
// `connection()` from next/headers to read the TCP socket peer address
// (the App Router equivalent of Pages Router's `req.socket.remoteAddress`).
// The fallback when no trusted proxy is configured is the socket peer
// address itself, NOT a shared "direct-untrusted" sentinel — that
// sentinel was a single shared bucket that recreated the original
// self-DoS bug for the actual deployment topology (bind 127.0.0.1,
// no reverse proxy). See proxy-trust.ts for the full trust model.
export async function POST(req: Request) {
  const sourceIp = await extractTrustedClientIp(req);
  try {
    const body = await req.json();
    if (body.action === "lock") {
      walletVault.lock("manual via API", sourceIp);
      return NextResponse.json({ ok: true, status: getVaultStatus() });
    }
    if (body.action === "unlock") {
      if (!body.passphrase) {
        return NextResponse.json({ error: "Passphrase required" }, { status: 400 });
      }
      try {
        const result = await walletVault.unlockAsync(String(body.passphrase), sourceIp);
        return NextResponse.json({ ok: true, loaded: result, status: getVaultStatus() });
      } catch (err) {
        const msg = String(err instanceof Error ? err.message : err);
        // Distinguish three failure modes for the client:
        //   1. Rate limited → 429 (cooldown active, try again later)
        //   2. Empty vault → 409 Conflict (vault has no wallets to validate
        //      the passphrase against — operator must add wallets first.
        //      v19.3 fix for the bonus finding from v19.2.)
        //   3. Wrong passphrase / corrupt blob → 401 (the normal failure)
        if (msg.startsWith("Rate limited")) {
          return NextResponse.json(
            { error: msg, rateLimited: true, status: getVaultStatus() },
            { status: 429 }
          );
        }
        if (msg.startsWith("Vault vazio")) {
          return NextResponse.json(
            { error: msg, emptyVault: true, status: getVaultStatus() },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: msg, status: getVaultStatus() },
          { status: 401 }
        );
      }
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    logger.error("api", `Erro operando vault: ${String(err)}`, { sourceIp });
    return NextResponse.json({ error: "Failed to operate vault" }, { status: 500 });
  }
}
