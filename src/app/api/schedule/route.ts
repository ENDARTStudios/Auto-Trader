import { NextResponse } from "next/server";
import { getSchedule, updateSchedule, getScheduleStatus } from "@/lib/trading/schedule";
import { logger } from "@/lib/trading/logger";
import type { TradingSchedule } from "@/lib/trading/schedule";

export async function GET() {
  const [schedule, status] = await Promise.all([
    getSchedule(),
    getScheduleStatus(),
  ]);
  return NextResponse.json({ schedule, status });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<TradingSchedule>;
  // Sanity-validate daysOfWeek if provided
  if (body.daysOfWeek !== undefined) {
    if (!Array.isArray(body.daysOfWeek)) {
      return NextResponse.json({ error: "daysOfWeek deve ser array" }, { status: 400 });
    }
    for (const d of body.daysOfWeek) {
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        return NextResponse.json(
          { error: `dayOfWeek inválido: ${d} (esperado 0-6)` },
          { status: 400 }
        );
      }
    }
  }
  try {
    const updated = await updateSchedule(body);
    logger.info("api", "Schedule atualizada", { patch: body });
    const status = await getScheduleStatus();
    return NextResponse.json({ schedule: updated, status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
