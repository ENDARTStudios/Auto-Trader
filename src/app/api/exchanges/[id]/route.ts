import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { deleteExchange, setExchangeActive } from "@/lib/trading/wallet-manager";

// PATCH /api/exchanges/[id] — activate/deactivate an exchange
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "Missing 'active' boolean field" }, { status: 400 });
    }
    await setExchangeActive(id, body.active);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("api", `Erro ativando exchange: ${String(err)}`);
    return NextResponse.json({ error: "Failed to update exchange" }, { status: 500 });
  }
}

// DELETE /api/exchanges/[id] — delete an exchange connection
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteExchange(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("api", `Erro deletando exchange: ${String(err)}`);
    return NextResponse.json({ error: "Failed to delete exchange" }, { status: 500 });
  }
}
