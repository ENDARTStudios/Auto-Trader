import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { getDiversificationSnapshot } from "@/lib/trading/diversification";
import { getConfig } from "@/lib/trading/config";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

// GET /api/diversification — current diversification snapshot + caps
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/diversification");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const [snapshot, cfg] = await Promise.all([
      getDiversificationSnapshot(),
      getConfig(),
    ]);
    return NextResponse.json({
      snapshot,
      caps: {
        maxPositionsPerSymbol: cfg.maxPositionsPerSymbol,
        maxPositionsPerChain: cfg.maxPositionsPerChain,
        maxPositionsPerStrategy: cfg.maxPositionsPerStrategy,
        maxPositionsPerRound: cfg.maxPositionsPerRound,
      },
      enabledStrategies: cfg.enabledStrategies,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/diversification");
  }
}
