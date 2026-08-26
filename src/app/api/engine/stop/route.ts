import { NextResponse } from "next/server";
import { engine } from "@/lib/trading/engine";
import { eventBus } from "@/lib/trading/event-bus";
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

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/engine/stop");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "engine:control")) throw new ForbiddenError("engine:control");
    await engine.stop();
  eventBus.push({
    type: "engine",
    level: "warn",
    source: "engine",
    title: "Engine parada",
    message: "Engine de trading interrompida manualmente. Posições abertas não são monitoradas.",
  });
    return NextResponse.json({ ok: true, running: engine.isRunning() });
  } catch (err) {
    return handleApiError(err, "POST /api/engine/stop");
  }
}
