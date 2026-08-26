import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { listWallets, createWallet } from "@/lib/trading/wallet-manager";
import { getVaultStatus } from "@/lib/trading/wallet-manager";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { handleApiError } from "@/lib/api/error-handler";
import { checkRateLimit } from "@/lib/rate-limit";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

// GET /api/wallets — list all wallet connections (RLS)
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/wallets");
    if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, "wallets:read")) throw new ForbiddenError("wallets:read");
    const isSuper = session.role === "super_admin";
    const [wallets, vaultStatus] = await Promise.all([listWallets(session.userId, isSuper), Promise.resolve(getVaultStatus())]);
    return NextResponse.json({ wallets, vaultStatus });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") return handleApiError(err, "GET /api/wallets");
    logger.error("api", `Erro listando wallets: ${String(err)}`);
    return handleApiError(err, "GET /api/wallets");
  }
}

// POST /api/wallets — create a new wallet connection
// Body: { label, type, address, chain?, readOnly?, publicKey?, privateKey?, passphrase? }
// If privateKey is provided, passphrase is REQUIRED (used to encrypt).
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/wallets");
    if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, "wallets:write")) throw new ForbiddenError("wallets:write");
    const body = await req.json();
    if (!body.label || !body.type || !body.address) {
      return NextResponse.json(
        { error: "Missing required fields: label, type, address" },
        { status: 400 }
      );
    }
    if (body.privateKey && !body.passphrase) {
      return NextResponse.json(
        { error: "Passphrase required when privateKey is provided" },
        { status: 400 }
      );
    }
    const wallet = await createWallet({
      label: String(body.label),
      type: String(body.type),
      address: String(body.address),
      chain: body.chain ? String(body.chain) : undefined,
      readOnly: body.readOnly ?? false,
      publicKey: body.publicKey ? String(body.publicKey) : undefined,
      privateKey: body.privateKey ? String(body.privateKey) : undefined,
      passphrase: body.passphrase ? String(body.passphrase) : undefined,
      ownerId: session.userId,
    });
    return NextResponse.json({ wallet });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") return handleApiError(err, "POST /api/wallets");
    logger.error("api", `Erro criando wallet: ${String(err)}`);
    return handleApiError(err, "POST /api/wallets");
  }
}
