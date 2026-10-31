// /api/backtest — list recent backtests (GET) or run a new one (POST).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  runBacktest,
  listRecentBacktests,
  getBacktestById,
  type BacktestParams,
} from "@/lib/trading/backtest";
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
  symbols: z.array(z.string().min(1)).min(1).max(20),
  interval: z.string().min(1),
  periodDays: z.number().int().min(1).max(365).optional(),
  initialCapitalUsd: z.number().positive().optional(),
  perTradeUsd: z.number().positive().optional(),
  takeProfitPct: z.number().positive().max(1).optional(),
  stopLossPct: z.number().positive().max(1).optional(),
  maxHoldBars: z.number().int().positive().max(5000).optional(),
  rsiEntryMax: z.number().min(0).max(100).optional(),
  rsiExitMin: z.number().min(0).max(100).optional(),
});

// GET /api/backtest?limit=20  → list recent
// GET /api/backtest?id=42     → get single backtest with equity curve + trades
export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/backtest");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "backtest:run")) throw new ForbiddenError("backtest:run");

    const url = new URL(req.url);
    const idParam = url.searchParams.get("id");
    const limitParam = url.searchParams.get("limit") ?? "20";

    if (idParam) {
      const id = parseInt(idParam, 10);
      if (isNaN(id)) {
        return NextResponse.json({ error: "id inválido" }, { status: 400 });
      }
      const result = await getBacktestById(id);
      if (!result) {
        return NextResponse.json({ error: "Backtest não encontrado" }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    const limit = Math.min(parseInt(limitParam, 10) || 20, 100);
    const rows = await listRecentBacktests(limit);
    return NextResponse.json({ backtests: rows });
  } catch (err) {
    return handleApiError(err, "GET /api/backtest");
  }
}

// POST /api/backtest  → run a new backtest
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/backtest");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "backtest:run")) throw new ForbiddenError("backtest:run");

    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    const periodDays = body.periodDays ?? 30;
    const initialCapitalUsd = Math.max(100, Math.min(1_000_000, body.initialCapitalUsd ?? 1000));
    const perTradeUsd = Math.max(10, Math.min(100_000, body.perTradeUsd ?? 150));
    const takeProfitPct = body.takeProfitPct ?? 0.05;
    const stopLossPct = body.stopLossPct ?? 0.04;
    const maxHoldBars = body.maxHoldBars ?? 48;
    const rsiEntryMax = body.rsiEntryMax ?? 70;
    const rsiExitMin = body.rsiExitMin ?? 75;

    const params: BacktestParams = {
      symbols: body.symbols,
      interval: body.interval,
      periodDays,
      initialCapitalUsd,
      perTradeUsd,
      takeProfitPct,
      stopLossPct,
      maxHoldBars,
      rsiEntryMax,
      rsiExitMin,
    };

    const result = await runBacktest(params);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err, "POST /api/backtest");
  }
}
