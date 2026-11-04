import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/trading/logger";
import { listExchanges, createExchange } from "@/lib/trading/wallet-manager";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { withUserRls } from "@/lib/auth/rls-context";
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

    // ExchangeConnection é STRICT (round 7): listagem exige contexto RLS.
    // withUserRls filtra pelo owner (super_admin = app.rls_bypass='on').
    const exchanges = await withUserRls(session, (tx) => listExchanges(tx));
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

    // STRICT: INSERT sem contexto é negado; o ownerId precisa ser o da sessão
    // (a policy WITH CHECK exige ownerId = app.user_id).
    const exchange = await withUserRls(session, (tx) =>
      createExchange(
        {
          label: body.label,
          exchange: body.exchange,
          apiKey: body.apiKey,
          apiSecret: body.apiSecret,
          apiPassphrase: body.apiPassphrase,
          passphrase: body.passphrase,
          testnet: body.testnet ?? false,
          ipWhitelistConfigured: body.ipWhitelistConfigured ?? false,
          ownerId: session.userId,
        },
        tx,
      ),
    );
    return NextResponse.json({ exchange });
  } catch (err) {
    return handleApiError(err, "POST /api/exchanges");
  }
}
