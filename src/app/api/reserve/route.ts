import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withdrawReserve } from "@/lib/trading/portfolio";
import { logger } from "@/lib/trading/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = (req.headers as unknown as Headers).get?.("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/reserve");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");
    const reserve = await db.reserve.findUnique({ where: { id: "singleton" } });
    if (!reserve) {
      return NextResponse.json({ balanceUsd: 0, totalDepositedUsd: 0, totalWithdrawnUsd: 0 });
    }
    return NextResponse.json({
      asset: reserve.asset,
      balanceUsd: reserve.balanceUsd,
      totalDepositedUsd: reserve.totalDepositedUsd,
      totalWithdrawnUsd: reserve.totalWithdrawnUsd,
      updatedAt: reserve.updatedAt.toISOString(),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/reserve");
  }
}

// POST /api/reserve  { action: "withdraw", amountUsd: 100 }
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/reserve");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "reserve:manage")) throw new ForbiddenError("reserve:manage");
    const body = (await req.json()) as { action?: string; amountUsd?: number };
    if (body.action !== "withdraw") {
      return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    }
    if (!body.amountUsd || body.amountUsd <= 0) {
      return NextResponse.json({ error: "amountUsd inválido" }, { status: 400 });
    }
    const ok = await withdrawReserve(body.amountUsd);
    if (!ok) {
      return NextResponse.json({ error: "Saldo insuficiente na reserva" }, { status: 400 });
    }
    logger.warn("api", `Saque manual de reserva: $${body.amountUsd} por ${session.email}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "POST /api/reserve");
  }
}
