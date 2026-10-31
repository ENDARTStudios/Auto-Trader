import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/trading/logger";
import {
  listWatchlist,
  addWatchlist,
} from "@/lib/trading/watchlist";
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

const postSchema = z
  .object({
    symbol: z.string().min(2).max(40),
    source: z.enum(["cex", "dex"]).optional(),
    chain: z.string().optional(),
    tokenId: z.string().optional(),
    notes: z.string().optional(),
    alertThresholdPct: z.number().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.source === "dex") {
        return !!data.chain && !!data.tokenId;
      }
      return true;
    },
    { message: "DEX tokens require both chain and tokenId" },
  );

// GET /api/watchlist — list all watchlist tokens
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/watchlist");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "watchlist:manage")) throw new ForbiddenError("watchlist:manage");

    const tokens = await listWatchlist();
    return NextResponse.json({ tokens });
  } catch (err) {
    return handleApiError(err, "GET /api/watchlist");
  }
}

// POST /api/watchlist — add new token to watchlist
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/watchlist");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "watchlist:manage")) throw new ForbiddenError("watchlist:manage");

    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    const created = await addWatchlist({
      symbol: body.symbol,
      source: body.source ?? "cex",
      chain: body.chain ?? null,
      tokenId: body.tokenId ?? null,
      notes: body.notes ?? null,
      alertThresholdPct: body.alertThresholdPct ?? 10,
      enabled: body.enabled ?? true,
    });

    return NextResponse.json({ token: created });
  } catch (err) {
    return handleApiError(err, "POST /api/watchlist");
  }
}
