import { NextResponse } from "next/server";
import { z } from "zod";
import { getSchedule, updateSchedule, getScheduleStatus } from "@/lib/trading/schedule";
import { logger } from "@/lib/trading/logger";
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

const postSchema = z.object({
  enabled: z.boolean().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().optional(),
  forceCloseAtEnd: z.boolean().optional(),
});

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/schedule");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "schedule:manage")) throw new ForbiddenError("schedule:manage");

    const [schedule, status] = await Promise.all([
      getSchedule(),
      getScheduleStatus(),
    ]);
    return NextResponse.json({ schedule, status });
  } catch (err) {
    return handleApiError(err, "GET /api/schedule");
  }
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/schedule");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "schedule:manage")) throw new ForbiddenError("schedule:manage");

    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }

    const updated = await updateSchedule(parsed.data);
    logger.info("api", "Schedule atualizada", { patch: parsed.data });
    const status = await getScheduleStatus();
    return NextResponse.json({ schedule: updated, status });
  } catch (err) {
    return handleApiError(err, "POST /api/schedule");
  }
}
