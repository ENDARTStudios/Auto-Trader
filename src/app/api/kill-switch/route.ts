import { NextResponse } from "next/server";
import { triggerKillSwitch, clearKillSwitch } from "@/lib/trading/risk-manager";
import { logger } from "@/lib/trading/logger";

// POST /api/kill-switch  { active: true, reason: "..." }   -> activate
// POST /api/kill-switch  { active: false }                 -> deactivate
export async function POST(req: Request) {
  const body = (await req.json()) as { active?: boolean; reason?: string };
  if (body.active) {
    const reason = body.reason || "Manual kill via dashboard";
    await triggerKillSwitch(reason);
    logger.warn("api", `Kill switch ativado: ${reason}`);
    return NextResponse.json({ ok: true, active: true, reason });
  } else {
    await clearKillSwitch();
    logger.info("api", "Kill switch desativado");
    return NextResponse.json({ ok: true, active: false });
  }
}
