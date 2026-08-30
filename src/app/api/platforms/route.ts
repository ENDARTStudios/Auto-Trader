import { NextResponse } from "next/server";
import { z } from "zod";
import {
  PLATFORM_REGISTRY,
  scanAllPlatforms,
  scanPlatform,
  getCachedPlatformScan,
  getApprovedPlatformIds,
} from "@/lib/trading/platform-scanner";
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

export const dynamic = "force-dynamic";

const postSchema = z.object({
  platformId: z.string().optional(),
  action: z.enum(["scan_one", "scan_all"]).optional(),
  force: z.boolean().optional(),
});

// GET /api/platforms
//   ?refresh=1   → force fresh audit on every platform (slow — ~2-3 min)
//   ?approved=1  → return just the set of approved platform IDs
// Default: return cached scan results (instant).
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/platforms");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "1";
    const approvedOnly = url.searchParams.get("approved") === "1";

    if (approvedOnly) {
      const ids = await getApprovedPlatformIds();
      return NextResponse.json({
        approved: Array.from(ids),
        count: ids.size,
      });
    }

    if (refresh) {
      const summary = await scanAllPlatforms({ force: true, concurrency: 4 });
      return NextResponse.json(summary);
    }

    const summary = await getCachedPlatformScan();
    return NextResponse.json(summary);
  } catch (err) {
    return handleApiError(err, "GET /api/platforms");
  }
}

// POST /api/platforms
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/platforms");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    if (body.action === "scan_one" && body.platformId) {
      const result = await scanPlatform(body.platformId, { force: body.force ?? true });
      return NextResponse.json(result);
    }

    const summary = await scanAllPlatforms({ force: body.force ?? false, concurrency: 3 });
    return NextResponse.json(summary);
  } catch (err) {
    return handleApiError(err, "POST /api/platforms");
  }
}
