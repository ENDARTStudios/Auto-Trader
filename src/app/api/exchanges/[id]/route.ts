import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { requirePermission } from "@/lib/auth/session";
import { withUserRls } from "@/lib/auth/rls-context";
import { handleApiError } from "@/lib/api/error-handler";

// PATCH /api/exchanges/[id] — activate/deactivate an exchange
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission("exchanges:manage")(req);
    const { id } = await params;
    const body = await req.json();
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "Missing 'active' boolean field" }, { status: 400 });
    }
    // RLS nativo: transação com app.user_id/app.rls_bypass.
    await withUserRls(session, async (tx) => {
      if (body.active) {
        await tx.exchangeConnection.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }
      await tx.exchangeConnection.update({
        where: { id },
        data: { isActive: body.active, lastUsedAt: new Date() },
      });
    });
    logger.info("wallet", `Exchange ${id} ${body.active ? "activated" : "deactivated"}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") {
      return handleApiError(err, "PATCH /api/exchanges/[id]");
    }
    logger.error("api", `Erro ativando exchange: ${String(err)}`);
    return NextResponse.json({ error: "Failed to update exchange" }, { status: 500 });
  }
}

// DELETE /api/exchanges/[id] — delete an exchange connection
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission("exchanges:manage")(req);
    const { id } = await params;
    await withUserRls(session, (tx) => tx.exchangeConnection.delete({ where: { id } }));
    logger.info("wallet", `Exchange ${id} deleted`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") {
      return handleApiError(err, "DELETE /api/exchanges/[id]");
    }
    logger.error("api", `Erro deletando exchange: ${String(err)}`);
    return NextResponse.json({ error: "Failed to delete exchange" }, { status: 500 });
  }
}
