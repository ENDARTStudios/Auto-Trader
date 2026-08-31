import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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

export const dynamic = "force-dynamic";

// DELETE /api/users/:id — super_admin only, cannot delete self
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/users");
    if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, "users:manage")) throw new ForbiddenError("users:manage");
    const { id } = await params;
    if (id === session.userId) return NextResponse.json({ error: "cannot delete self" }, { status: 400 });
    const user = await db.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
    await db.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "DELETE /api/users/:id");
  }
}
