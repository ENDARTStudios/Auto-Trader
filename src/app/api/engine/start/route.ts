import { NextResponse } from "next/server";
import { engine } from "@/lib/trading/engine";
import { logger } from "@/lib/trading/logger";
import { eventBus } from "@/lib/trading/event-bus";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";

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
    const rl = checkRateLimit(ip, "/api/engine/start");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }
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
    return handleApiError(err, "POST /api/engine/start");
  }
}
