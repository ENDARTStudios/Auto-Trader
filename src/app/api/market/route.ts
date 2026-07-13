import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getFearGreedIndex, getTrendingTokens, analyzeMarket } from "@/lib/trading/market-analysis";
import { selectCandidates } from "@/lib/trading/token-selector";
import { getConfig } from "@/lib/trading/config";

// GET /api/market — returns latest market snapshots + global sentiment
// POST /api/market — body: { symbol, source, chain?, tokenId? } — runs analysis on-demand

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "30", 10);

  const [snapshots, fearGreed, trending] = await Promise.all([
    db.marketSnapshot.findMany({
      orderBy: { analyzedAt: "desc" },
      take: Math.min(limit, 200),
    }),
    getFearGreedIndex(),
    getTrendingTokens(),
  ]);

  return NextResponse.json({
    snapshots,
    fearGreed,
    trending: trending.slice(0, 10),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      symbol: string;
      source: "cex" | "dex";
      chain?: string;
      tokenId?: string;
      priceUsd?: number;
      volume24hUsd?: number;
      liquidityUsd?: number;
    };

    if (!body.symbol) {
      return NextResponse.json({ error: "symbol é obrigatório" }, { status: 400 });
    }

    const cfg = await getConfig();

    let candidate = {
      symbol: body.symbol,
      source: body.source,
      chain: body.chain,
      tokenId: body.tokenId,
      priceUsd: body.priceUsd ?? 0,
      volume24hUsd: body.volume24hUsd ?? 0,
      liquidityUsd: body.liquidityUsd ?? 0,
      ageHours: undefined as number | undefined,
      holderCount: undefined as number | undefined,
    };

    if (candidate.priceUsd === 0) {
      try {
        const candidates = await selectCandidates(cfg, 30);
        const found = candidates.find(
          (c) => c.symbol.toUpperCase() === body.symbol.toUpperCase()
        );
        if (found) candidate = { ...candidate, ...found };
      } catch (err) {
        // ignore
      }
    }

    const signal = await analyzeMarket(candidate);
    return NextResponse.json(signal);
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
