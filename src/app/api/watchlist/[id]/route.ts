import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import {
  updateWatchlist,
  removeWatchlist,
  resetAlert,
} from "@/lib/trading/watchlist";

// PATCH /api/watchlist/[id] — update notes / threshold / enabled
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      notes?: string | null;
      alertThresholdPct?: number;
      enabled?: boolean;
    };
    const updated = await updateWatchlist(id, body);
    if (!updated) {
      return NextResponse.json(
        { error: "Watchlist token não encontrado" },
        { status: 404 }
      );
    }
    return NextResponse.json({ token: updated });
  } catch (err) {
    logger.error("api", `Erro atualizando watchlist token: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to update watchlist token" },
      { status: 500 }
    );
  }
}

// DELETE /api/watchlist/[id] — remove token from watchlist
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ok = await removeWatchlist(id);
    if (!ok) {
      return NextResponse.json(
        { error: "Watchlist token não encontrado" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("api", `Erro removendo watchlist token: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to remove watchlist token" },
      { status: 500 }
    );
  }
}

// POST /api/watchlist/[id] with body { action: "reset_alert" } — reset alert baseline
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action === "reset_alert") {
      await resetAlert(id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      { error: "Unknown action. Use { action: 'reset_alert' }" },
      { status: 400 }
    );
  } catch (err) {
    logger.error("api", `Erro em watchlist action: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to perform action" },
      { status: 500 }
    );
  }
}
