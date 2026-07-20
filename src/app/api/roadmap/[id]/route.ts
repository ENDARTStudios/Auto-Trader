import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { updateStrategicCapability, type CapabilityStatus } from "@/lib/trading/strategic-roadmap";

// PATCH /api/roadmap/[id] — update a capability's status / completion / notes
// Body: { status?: "planned"|"in_progress"|"shipped"|"blocked", completionPct?: number, notes?: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const patch: {
      status?: CapabilityStatus;
      completionPct?: number;
      notes?: string;
    } = {};
    if (body.status !== undefined) patch.status = body.status as CapabilityStatus;
    if (body.completionPct !== undefined) {
      const n = parseInt(body.completionPct, 10);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json({ error: "completionPct must be 0-100" }, { status: 400 });
      }
      patch.completionPct = n;
    }
    if (body.notes !== undefined) patch.notes = String(body.notes);
    await updateStrategicCapability(id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("api", `Erro atualizando capability: ${String(err)}`);
    return NextResponse.json({ error: "Failed to update capability" }, { status: 500 });
  }
}
