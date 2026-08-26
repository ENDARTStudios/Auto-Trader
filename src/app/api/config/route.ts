import { NextResponse } from "next/server";
import { getConfig, updateConfig, EngineConfig } from "@/lib/trading/config";
import { logger } from "@/lib/trading/logger";
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

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/config");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "config:read")) throw new ForbiddenError("config:read");
    const cfg = await getConfig();
    return NextResponse.json(cfg);
  } catch (err) {
    return handleApiError(err, "GET /api/config");
  }
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/config");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "config:write")) throw new ForbiddenError("config:write");
    const body = (await req.json()) as Partial<EngineConfig>;
  // Sanitize: never allow setting killSwitchActive, engineRunning, paperCyclesPassed,
  // graduatedToLive via this endpoint — those have dedicated endpoints.
  const forbidden: (keyof EngineConfig)[] = [
    "killSwitchActive",
    "killSwitchReason",
    "killSwitchAt",
    "engineRunning",
    "paperCyclesPassed",
    "graduatedToLive",
  ];
  for (const k of forbidden) delete body[k];

  // Validate numeric ranges
  if (body.takeProfitPct !== undefined && body.takeProfitPct <= 0) {
    return NextResponse.json({ error: "takeProfitPct deve ser > 0" }, { status: 400 });
  }
  if (body.stopLossPct !== undefined && body.stopLossPct <= 0) {
    return NextResponse.json({ error: "stopLossPct deve ser > 0" }, { status: 400 });
  }
  if (body.scamScoreMin !== undefined && (body.scamScoreMin < 0 || body.scamScoreMin > 100)) {
    return NextResponse.json({ error: "scamScoreMin deve estar entre 0 e 100" }, { status: 400 });
  }
  if (
    body.reservePct !== undefined &&
    body.reinvestPct !== undefined &&
    Math.abs(body.reservePct + body.reinvestPct - 100) > 0.01
  ) {
    return NextResponse.json({ error: "reservePct + reinvestPct deve somar 100" }, { status: 400 });
  }

    const updated = await updateConfig(body);
    logger.info("api", "Config atualizada", { patch: body });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err, "POST /api/config");
  }
}
