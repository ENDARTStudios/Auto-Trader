import { NextResponse } from "next/server";
import { engine } from "@/lib/trading/engine";
import { logger } from "@/lib/trading/logger";

export async function POST() {
  try {
    await engine.start();
    return NextResponse.json({ ok: true, running: engine.isRunning() });
  } catch (err) {
    logger.error("api", "Erro iniciando engine", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
