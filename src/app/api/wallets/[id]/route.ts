import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { assertOwner } from "@/lib/auth/rls";
import { withUserRls } from "@/lib/auth/rls-context";
import { handleApiError } from "@/lib/api/error-handler";

// PATCH /api/wallets/[id] — activate/deactivate a wallet
// Body: { active: boolean }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession(req);
    if (!hasPermission(session.role, "wallets:write")) throw new ForbiddenError("wallets:write");
    const { id } = await params;
    // RLS/IDOR: owner only (super_admin bypass) — see src/lib/auth/rls.ts.
    await assertOwner(session, "walletConnection", id);
    const body = await req.json();
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "Missing 'active' boolean field" }, { status: 400 });
    }
    // RLS nativo: update/updateMany na MESMA transação com app.user_id —
    // um trader só ativa/desativa as próprias wallets (super_admin = bypass).
    await withUserRls(session, async (tx) => {
      if (body.active) {
        await tx.walletConnection.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }
      await tx.walletConnection.update({
        where: { id },
        data: { isActive: body.active, lastUsedAt: new Date() },
      });
    });
    logger.info("wallet", `Wallet ${id} ${body.active ? "activated" : "deactivated"}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") {
      return handleApiError(err, "PATCH /api/wallets/[id]");
    }
    logger.error("api", `Erro ativando wallet: ${String(err)}`);
    return NextResponse.json({ error: "Failed to update wallet" }, { status: 500 });
  }
}

// DELETE /api/wallets/[id] — delete a wallet connection
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession(req);
    if (!hasPermission(session.role, "wallets:write")) throw new ForbiddenError("wallets:write");
    const { id } = await params;
    await assertOwner(session, "walletConnection", id);
    await withUserRls(session, (tx) => tx.walletConnection.delete({ where: { id } }));
    logger.info("wallet", `Wallet ${id} deleted`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") {
      return handleApiError(err, "DELETE /api/wallets/[id]");
    }
    logger.error("api", `Erro deletando wallet: ${String(err)}`);
    return NextResponse.json({ error: "Failed to delete wallet" }, { status: 500 });
  }
}
