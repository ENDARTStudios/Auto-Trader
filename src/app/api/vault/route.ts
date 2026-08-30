import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/trading/logger";
import { getVaultStatus } from "@/lib/trading/wallet-manager";
import { walletVault } from "@/lib/trading/wallet-crypto";
import { extractTrustedClientIp } from "@/lib/trading/proxy-trust";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

const postSchema = z.object({
  action: z.enum(["unlock", "lock"]),
  passphrase: z.string().optional(),
});

// GET /api/vault — vault status
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/vault");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "wallets:read")) throw new ForbiddenError("wallets:read");

    return NextResponse.json(getVaultStatus());
  } catch (err) {
    return handleApiError(err, "GET /api/vault");
  }
}

// POST /api/vault — unlock / lock the vault
export async function POST(req: Request) {
  const sourceIp = await extractTrustedClientIp(req);
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/vault");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "wallets:read")) throw new ForbiddenError("wallets:read");

    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    if (body.action === "lock") {
      walletVault.lock("manual via API", sourceIp);
      return NextResponse.json({ ok: true, status: getVaultStatus() });
    }
    if (body.action === "unlock") {
      if (!body.passphrase) {
        return NextResponse.json({ error: "Passphrase required" }, { status: 400 });
      }
      try {
        const result = await walletVault.unlockAsync(body.passphrase, sourceIp);
        return NextResponse.json({ ok: true, loaded: result, status: getVaultStatus() });
      } catch (err) {
        const msg = String(err instanceof Error ? err.message : err);
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
    return handleApiError(err, "POST /api/vault");
  }
}
