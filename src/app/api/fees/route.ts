import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { getFeeStats } from "@/lib/trading/fee-model";
import { computeRoundTripCost } from "@/lib/trading/fee-model";
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

// GET /api/fees — fee statistics + round-trip cost preview
// Query params: ?days=7 (default 7) — time window for stats
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/fees");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") ?? "7", 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [stats, cfg] = await Promise.all([
      getFeeStats({ since }),
      getConfig(),
    ]);

    const previewSizes = [50, 100, 250, 500, 1000];
    const roundTripPreview = previewSizes.map((size) => {
      const rtc = computeRoundTripCost(size, cfg.feeBps, cfg.slippageBps);
      return { positionSizeUsd: size, ...rtc };
    });

    return NextResponse.json({
      stats,
      config: {
        feeBps: cfg.feeBps,
        slippageBps: cfg.slippageBps,
        feePct: cfg.feeBps / 100,
        slippagePct: cfg.slippageBps / 100,
      },
      roundTripPreview,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/fees");
  }
}
