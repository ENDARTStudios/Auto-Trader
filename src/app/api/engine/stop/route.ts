import { NextResponse } from "next/server";
import { engine } from "@/lib/trading/engine";
import { logger } from "@/lib/trading/logger";

export async function POST() {
  await engine.stop();
  return NextResponse.json({ ok: true, running: engine.isRunning() });
}
