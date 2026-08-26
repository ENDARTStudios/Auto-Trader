import { NextResponse } from "next/server";
import { getEngineSnapshot } from "@/lib/trading/engine";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";

function getClientIp(req: Request): string {
  const h = (req.headers as unknown as { get: (k: string) => string | null }).get?.bind(req.headers);
  // NextRequest headers
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = (req.headers as unknown as Headers).get?.("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/status");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");
    const snapshot = await getEngineSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    return handleApiError(err, "GET /api/status");
  }
}
