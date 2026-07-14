import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import {
  listWatchlist,
  addWatchlist,
  type WatchlistTokenInput,
} from "@/lib/trading/watchlist";

// GET /api/watchlist — list all watchlist tokens
export async function GET() {
  try {
    const tokens = await listWatchlist();
    return NextResponse.json({ tokens });
  } catch (err) {
    logger.error("api", `Erro listando watchlist: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to list watchlist" },
      { status: 500 }
    );
  }
}

// POST /api/watchlist — add new token to watchlist
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<WatchlistTokenInput>;
    if (!body.symbol || typeof body.symbol !== "string") {
      return NextResponse.json(
        { error: "Missing required field: symbol" },
        { status: 400 }
      );
    }
    const source = body.source === "dex" ? "dex" : "cex";
    if (source === "dex" && (!body.chain || !body.tokenId)) {
      return NextResponse.json(
        { error: "DEX tokens require both chain and tokenId" },
        { status: 400 }
      );
    }
    // Basic symbol format check
    const sym = body.symbol.trim();
    if (sym.length < 2 || sym.length > 40) {
      return NextResponse.json(
        { error: "Symbol must be 2-40 chars" },
        { status: 400 }
      );
    }

    const created = await addWatchlist({
      symbol: sym,
      source,
      chain: body.chain ?? null,
      tokenId: body.tokenId ?? null,
      notes: body.notes ?? null,
      alertThresholdPct: body.alertThresholdPct ?? 10,
      enabled: body.enabled ?? true,
    });

    return NextResponse.json({ token: created });
  } catch (err) {
    logger.error("api", `Erro criando watchlist token: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to create watchlist token" },
      { status: 500 }
    );
  }
}
