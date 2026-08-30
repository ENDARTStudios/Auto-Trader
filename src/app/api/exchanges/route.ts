import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/trading/logger";
import { listExchanges, createExchange } from "@/lib/trading/wallet-manager";
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
  label: z.string().min(1),
  exchange: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  apiPassphrase: z.string().optional(),
  passphrase: z.string().min(1),
  testnet: z.boolean().optional(),
  ipWhitelistConfigured: z.boolean().optional(),
});

// GET /api/exchanges — list all exchange connections
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/exchanges");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "exchanges:manage")) throw new ForbiddenError("exchanges:manage");

    const exchanges = await listExchanges();
    return NextResponse.json({ exchanges });
  } catch (err) {
    return handleApiError(err, "GET /api/exchanges");
  }
}

// POST /api/exchanges — create a new exchange connection
// SECURITY: passphrase is REQUIRED to encrypt the API credentials.
//          withdraw permission is hardcoded to false.
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/exchanges");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "exchanges:manage")) throw new ForbiddenError("exchanges:manage");

    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    const exchange = await createExchange({
      label: body.label,
      exchange: body.exchange,
      apiKey: body.apiKey,
      apiSecret: body.apiSecret,
      apiPassphrase: body.apiPassphrase,
      passphrase: body.passphrase,
      testnet: body.testnet ?? false,
      ipWhitelistConfigured: body.ipWhitelistConfigured ?? false,
    });
    return NextResponse.json({ exchange });
  } catch (err) {
    return handleApiError(err, "POST /api/exchanges");
  }
}
