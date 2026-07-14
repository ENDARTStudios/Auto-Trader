import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { deleteWallet, setWalletActive } from "@/lib/trading/wallet-manager";

// PATCH /api/wallets/[id] — activate/deactivate a wallet
// Body: { active: boolean }
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
    await setWalletActive(id, body.active);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("api", `Erro ativando wallet: ${String(err)}`);
    return NextResponse.json({ error: "Failed to update wallet" }, { status: 500 });
  }
}

// DELETE /api/wallets/[id] — delete a wallet connection
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteWallet(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("api", `Erro deletando wallet: ${String(err)}`);
    return NextResponse.json({ error: "Failed to delete wallet" }, { status: 500 });
  }
}
