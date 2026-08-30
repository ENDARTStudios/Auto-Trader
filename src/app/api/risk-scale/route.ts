import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { getCurrentRiskScale, RISK_SCALE_BANDS } from "@/lib/trading/risk-scaling";
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

// GET /api/risk-scale — current risk scale assessment + band table
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/risk-scale");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const [assessment, bands] = await Promise.all([
      getCurrentRiskScale(),
      Promise.resolve(RISK_SCALE_BANDS),
    ]);
    return NextResponse.json({ assessment, bands });
  } catch (err) {
    return handleApiError(err, "GET /api/risk-scale");
  }
}
