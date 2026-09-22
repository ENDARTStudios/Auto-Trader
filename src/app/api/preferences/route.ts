import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";
import { db } from "@/lib/db";
import { preferencesSchema, parsePreferences, serializePreferences } from "@/lib/preferences";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

// GET /api/preferences — current user's onboarding preferences
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/preferences");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }

    const session = await requireSession(req);
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { onboardedAt: true, preferences: true },
    });

    if (!user) {
      return NextResponse.json({ onboarded: false, preferences: {} });
    }

    return NextResponse.json({
      onboarded: user.onboardedAt !== null,
      onboardedAt: user.onboardedAt?.toISOString() ?? null,
      preferences: parsePreferences(user.preferences),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/preferences");
  }
}

// PUT /api/preferences — save preferences (marks onboarded when complete)
export async function PUT(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/preferences");
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
      );
    }

    const session = await requireSession(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const validated = preferencesSchema.parse(body);
    const serialized = serializePreferences(validated);
    const onboarded = typeof body.onboarded === "boolean" ? body.onboarded : true;

    const user = await db.user.update({
      where: { id: session.userId },
      data: {
        preferences: serialized,
        ...(onboarded ? { onboardedAt: new Date() } : {}),
      },
      select: { onboardedAt: true, preferences: true },
    });

    return NextResponse.json({
      ok: true,
      onboarded: user.onboardedAt !== null,
      onboardedAt: user.onboardedAt?.toISOString() ?? null,
      preferences: parsePreferences(user.preferences),
    });
  } catch (err) {
    return handleApiError(err, "PUT /api/preferences");
  }
}
