import { NextResponse } from "next/server";
import { triggerKillSwitch, clearKillSwitch } from "@/lib/trading/risk-manager";
import { logger } from "@/lib/trading/logger";
import { eventBus } from "@/lib/trading/event-bus";

// POST /api/kill-switch  { active: true, reason: "..." }   -> activate
// POST /api/kill-switch  { active: false }                 -> deactivate
export async function POST(req: Request) {
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
}
