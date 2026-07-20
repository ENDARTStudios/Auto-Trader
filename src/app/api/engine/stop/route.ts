import { NextResponse } from "next/server";
import { engine } from "@/lib/trading/engine";
import { eventBus } from "@/lib/trading/event-bus";

export async function POST() {
  await engine.stop();
  eventBus.push({
    type: "engine",
    level: "warn",
    source: "engine",
    title: "Engine parada",
    message: "Engine de trading interrompida manualmente. Posições abertas não são monitoradas.",
  });
  return NextResponse.json({ ok: true, running: engine.isRunning() });
}
