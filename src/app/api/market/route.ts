import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getFearGreedIndex, getTrendingTokens, analyzeMarket } from "@/lib/trading/market-analysis";
import { selectCandidates } from "@/lib/trading/token-selector";
import { getConfig } from "@/lib/trading/config";
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
  symbol: z.string().min(1),
  source: z.enum(["cex", "dex"]),
  chain: z.string().optional(),
  tokenId: z.string().optional(),
  priceUsd: z.number().optional(),
  volume24hUsd: z.number().optional(),
  liquidityUsd: z.number().optional(),
});

// GET /api/market — returns latest market snapshots + global sentiment
// POST /api/market — body: { symbol, source, chain?, tokenId? } — runs analysis on-demand

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/market");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

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
  } catch (err) {
    return handleApiError(err, "GET /api/market");
  }
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/market");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

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
    return handleApiError(err, "POST /api/market");
  }
}
