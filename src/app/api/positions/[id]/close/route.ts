import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/trading/config";
import { closePosition } from "@/lib/trading/portfolio";
import { fetchPricesBatch } from "@/lib/trading/price-feed";
import { logger } from "@/lib/trading/logger";
import { notifyEvent } from "@/lib/trading/notifier";
import { eventBus } from "@/lib/trading/event-bus";

// POST /api/positions/[id]/close — manually close an open position at current
// market price. Reason is recorded as "manual".
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const operatorNote = String(body.note ?? "").slice(0, 500);

  const position = await db.position.findUnique({ where: { id } });
  if (!position) {
    return NextResponse.json({ error: "Posição não encontrada" }, { status: 404 });
  }
  if (position.status !== "open") {
    return NextResponse.json(
      { error: `Posição já está fechada (status: ${position.status})` },
      { status: 400 }
    );
  }

  // Fetch current price
  const prices = await fetchPricesBatch([
    {
      id: position.id,
      symbol: position.symbol,
      source: position.source as "cex" | "dex",
      chain: position.chain,
      tokenId: position.tokenId,
    },
  ]);
  const currentPrice = prices.get(position.id) ?? 0;
  if (currentPrice <= 0) {
    return NextResponse.json(
      { error: "Não foi possível obter preço atual — tente novamente" },
      { status: 503 }
    );
  }

  const cfg = await getConfig();
  const closed = await closePosition(cfg, id, currentPrice, "manual");
  if (!closed) {
    return NextResponse.json(
      { error: "Falha ao executar fechamento (closePosition retornou null)" },
      { status: 500 }
    );
  }

  logger.info("api", `Posição ${position.symbol} fechada manualmente`, {
    positionId: id,
    exitPrice: currentPrice,
    pnlUsd: closed.pnlUsd,
    operatorNote,
  });

  // Emit SSE event
  eventBus.push({
    type: "log",
    level: "info",
    source: "api",
    title: `Posição ${position.symbol} fechada manualmente`,
    message: `@ $${currentPrice.toFixed(6)} (P&L $${closed.pnlUsd?.toFixed(2) ?? "?"})`,
    context: { positionId: id, symbol: position.symbol, exitPrice: currentPrice },
  });

  // External notification
  notifyEvent({
    eventType: "position_closed",
    title: "🔵 Posição Fechada Manualmente",
    message: `*${position.symbol}* fechada manualmente via dashboard.\nPreço saída: $${currentPrice.toFixed(6)}\nP&L: $${closed.pnlUsd?.toFixed(2) ?? "?"} (${closed.pnlPct?.toFixed(2) ?? "?"}%)\n${operatorNote ? `Nota: ${operatorNote}` : ""}`,
    context: {
      positionId: id,
      symbol: position.symbol,
      source: position.source,
      exitPrice: currentPrice,
      pnlUsd: closed.pnlUsd,
      pnlPct: closed.pnlPct,
      reason: "manual",
      operatorNote,
    },
  }).catch(() => {
    /* fire-and-forget */
  });

  return NextResponse.json({
    ok: true,
    position: closed,
    exitPrice: currentPrice,
    note: operatorNote,
  });
}
