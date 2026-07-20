import { NextResponse } from "next/server";
import { engine } from "@/lib/trading/engine";
import { logger } from "@/lib/trading/logger";
import { eventBus } from "@/lib/trading/event-bus";

export async function POST() {
  try {
    await engine.start();
    if (engine.isRunning()) {
      eventBus.push({
        type: "engine",
        level: "info",
        source: "engine",
        title: "Engine iniciada",
        message: "Engine de trading iniciada — entrando em modo SCOUT.",
      });
    }
    return NextResponse.json({ ok: true, running: engine.isRunning() });
  } catch (err) {
    logger.error("api", "Erro iniciando engine", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
