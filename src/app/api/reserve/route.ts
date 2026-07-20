import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withdrawReserve } from "@/lib/trading/portfolio";
import { logger } from "@/lib/trading/logger";

export async function GET() {
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
}

// POST /api/reserve  { action: "withdraw", amountUsd: 100 }
export async function POST(req: Request) {
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
  logger.warn("api", `Saque manual de reserva: $${body.amountUsd}`);
  return NextResponse.json({ ok: true });
}
