import { NextResponse } from "next/server";
import { triggerKillSwitch, clearKillSwitch } from "@/lib/trading/risk-manager";
import { logger } from "@/lib/trading/logger";
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

// POST /api/kill-switch  { active: true, reason: "..." }   -> activate
// POST /api/kill-switch  { active: false }                 -> deactivate
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/kill-switch");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "engine:kill")) throw new ForbiddenError("engine:kill");
    const body = (await req.json()) as { active?: boolean; reason?: string };
  if (body.active) {
    const reason = body.reason || "Manual kill via dashboard";
    await triggerKillSwitch(reason);
    logger.warn("api", `Kill switch ativado: ${reason}`);
    eventBus.push({
      type: "kill_switch",
      level: "critical",
      source: "risk",
      title: "KILL SWITCH ATIVADO",
      message: `Trading interrompido: ${reason}. Posições abertas serão force-exitadas no próximo tick.`,
      context: { reason, triggeredBy: "manual" },
    });
    return NextResponse.json({ ok: true, active: true, reason });
  } else {
    await clearKillSwitch();
    logger.info("api", "Kill switch desativado");
    eventBus.push({
      type: "engine",
      level: "info",
      source: "risk",
      title: "Kill switch desativado",
      message: "Kill switch desativado manualmente. Engine pode ser reiniciada.",
      context: { triggeredBy: "manual" },
    });
    return NextResponse.json({ ok: true, active: false });
    }
  } catch (err) {
    return handleApiError(err, "POST /api/kill-switch");
  }
}
