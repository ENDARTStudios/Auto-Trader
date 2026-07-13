// /api/backtest — list recent backtests (GET) or run a new one (POST).
import { NextRequest, NextResponse } from "next/server";
import {
  runBacktest,
  listRecentBacktests,
  getBacktestById,
  type BacktestParams,
} from "@/lib/trading/backtest";

// GET /api/backtest?limit=20  → list recent
// GET /api/backtest?id=42     → get single backtest with equity curve + trades
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const idParam = url.searchParams.get("id");
  const limitParam = url.searchParams.get("limit") ?? "20";

  try {
    if (idParam) {
      const id = parseInt(idParam, 10);
      if (isNaN(id)) {
        return NextResponse.json(
          { error: "id inválido" },
          { status: 400 }
        );
      }
      const result = await getBacktestById(id);
      if (!result) {
        return NextResponse.json(
          { error: "Backtest não encontrado" },
          { status: 404 }
        );
      }
      return NextResponse.json(result);
    }

    const limit = Math.min(parseInt(limitParam, 10) || 20, 100);
    const rows = await listRecentBacktests(limit);
    return NextResponse.json({ backtests: rows });
  } catch (err) {
    return NextResponse.json(
      { error: `Erro ao listar backtests: ${String(err)}` },
      { status: 500 }
    );
  }
}

// POST /api/backtest  → run a new backtest
// Body: BacktestParams
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<BacktestParams>;
    // Validate
    if (!body.symbols || !Array.isArray(body.symbols) || body.symbols.length === 0) {
      return NextResponse.json(
        { error: "symbols deve ser um array não-vazio" },
        { status: 400 }
      );
    }
    if (body.symbols.length > 20) {
      return NextResponse.json(
        { error: "Máximo de 20 símbolos por backtest" },
        { status: 400 }
      );
    }
    if (!body.interval || typeof body.interval !== "string") {
      return NextResponse.json(
        { error: "interval inválido" },
        { status: 400 }
      );
    }
    const periodDays = Math.max(1, Math.min(365, body.periodDays ?? 30));
    const initialCapitalUsd = Math.max(100, Math.min(1_000_000, body.initialCapitalUsd ?? 1000));
    const perTradeUsd = Math.max(10, Math.min(100_000, body.perTradeUsd ?? 150));
    const takeProfitPct = Math.max(0.001, Math.min(1, body.takeProfitPct ?? 0.05));
    const stopLossPct = Math.max(0.001, Math.min(1, body.stopLossPct ?? 0.04));
    const maxHoldBars = Math.max(1, Math.min(5000, body.maxHoldBars ?? 48));
    const rsiEntryMax = Math.max(0, Math.min(100, body.rsiEntryMax ?? 70));
    const rsiExitMin = Math.max(0, Math.min(100, body.rsiExitMin ?? 75));

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
    return NextResponse.json(
      { error: `Erro ao executar backtest: ${String(err)}` },
      { status: 500 }
    );
  }
}
