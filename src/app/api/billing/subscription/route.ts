import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";
import { logger } from "@/lib/trading/logger";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  action: z.enum(["upgrade", "downgrade", "cancel"]),
  plan: z.enum(["free", "pro", "elite"]).optional(),
});

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

// GET /api/billing/subscription — returns the current subscription for the session user
export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/billing/subscription");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const sub = await db.featureFlag
      .findFirst({ where: { key: `subscription:${session.userId}` } })
      .catch(() => null);

    return NextResponse.json({
      userId: session.userId,
      email: session.email,
      role: session.role,
      plan: sub?.description ?? "free",
      enabled: sub?.enabled ?? true,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/billing/subscription");
  }
}

// POST /api/billing/subscription — upgrade / downgrade / cancel
// Requires `users:manage` (admin only in MVP)
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/billing/subscription");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "users:manage")) throw new ForbiddenError("users:manage");

    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    const existing = await db.featureFlag
      .findFirst({ where: { key: `subscription:${session.userId}` } })
      .catch(() => null);

    const newPlan = body.action === "cancel" ? "free" : body.plan ?? "pro";

    if (existing) {
      await db.featureFlag.update({
        where: { id: existing.id },
        data: { description: newPlan, enabled: body.action !== "cancel" },
      });
    } else {
      await db.featureFlag.create({
        data: {
          key: `subscription:${session.userId}`,
          description: newPlan,
          enabled: body.action !== "cancel",
          rolloutPct: 100,
        },
      });
    }

    logger.info("api", "Subscription updated", { userId: session.userId, action: body.action, plan: newPlan });

    return NextResponse.json({
      ok: true,
      action: body.action,
      plan: newPlan,
      prorate: body.action === "upgrade" || body.action === "downgrade",
    });
  } catch (err) {
    return handleApiError(err, "POST /api/billing/subscription");
  }
}
