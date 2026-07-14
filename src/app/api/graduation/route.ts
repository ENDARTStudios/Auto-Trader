import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { evaluateGraduation } from "@/lib/trading/graduation";

// GET /api/graduation — returns current rolling-window evaluation
export async function GET() {
  try {
    const evaluation = await evaluateGraduation();
    return NextResponse.json(evaluation);
  } catch (err) {
    logger.error("api", `Erro avaliando graduation: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to evaluate graduation" },
      { status: 500 }
    );
  }
}
