import { NextResponse } from "next/server";
import { getConfig, updateConfig, EngineConfig } from "@/lib/trading/config";
import { logger } from "@/lib/trading/logger";

export async function GET() {
  const cfg = await getConfig();
  return NextResponse.json(cfg);
}

export async function POST(req: Request) {
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
}
