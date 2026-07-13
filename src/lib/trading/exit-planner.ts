// Exit Planner — AI-driven exit planning for OPEN positions.
//
// The default exit logic in the engine is purely mechanical: TP, SL, timeout.
// This module adds a 4th exit decision-maker that runs when the surveillance
// module flags a position for review.
//
// Decision space:
//   hold          — keep position, no changes (default when alerts are info-only)
//   tighten_sl    — raise stop-loss to lock in profit / reduce downside
//   raise_tp      — extend take-profit if momentum still strong
//   scale_out_50  — sell 50% at market, keep rest with original TP/SL
//   exit_now      — close full position at market
//
// The agent is prompted with:
//   - Position metrics (entry, current price, unrealized PnL %, time held, etc.)
//   - All active surveillance alerts for this position
//   - Latest market signal (RSI, MACD, Bollinger, Fear&Greed)
//   - Latest GoPlus re-scan (if DEX)
//
// Output is parsed + persisted as an AIInsight (agentRole = "exit_planner").
// The engine's exit decision logic then merges: if agent says exit_now AND
// confidence >= 70%, the engine closes the position with reason="manual"
// (logged as AI-driven exit).

import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { logger } from "./logger";
import type { SurveillanceAlert, PositionSurveillanceResult } from "./position-surveillance";
import { analyzeMarket } from "./market-analysis";
import { scanTokenWithGoPlus } from "./goplus-scanner";
import type { AgentRole, AIInsightResult } from "./ai-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ExitAction = "hold" | "tighten_sl" | "raise_tp" | "scale_out_50" | "exit_now";

export interface ExitPlan {
  positionId: string;
  symbol: string;
  action: ExitAction;
  confidence: number; // 0-100
  reasoning: string;
  keySignals: string[];
  suggestedNewSl?: number; // for tighten_sl
  suggestedNewTp?: number; // for raise_tp
  alertCount: number;
  alertSeverity: "info" | "warning" | "critical";
}

// Reuse the ZAI singleton from ai-agent.ts
let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function getZai() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseAction(text: string): ExitAction {
  // Look for explicit ACTION: <X> line first
  const m = text.match(/ACTION:\s*(hold|tighten_sl|raise_tp|scale_out_50|exit_now)/i);
  if (m) {
    const a = m[1].toLowerCase();
    if (["hold", "tighten_sl", "raise_tp", "scale_out_50", "exit_now"].includes(a)) {
      return a as ExitAction;
    }
  }
  // Fallback: keyword scan
  const lower = text.toLowerCase();
  if (/exit now|close immediately|liquidate|risk too high|critical.*exit/.test(lower)) return "exit_now";
  if (/scale out|partial.*exit|sell half|take partial/.test(lower)) return "scale_out_50";
  if (/raise.*tp|extend.*take profit|let profits run|trail/.test(lower)) return "raise_tp";
  if (/tighten.*sl|raise.*stop|lock.*profit|move.*stop/.test(lower)) return "tighten_sl";
  return "hold";
}

function parseConfidence(text: string): number {
  const m = text.match(/confidence[:\s]+(\d{1,3})\s*%?/i);
  if (m) return Math.max(0, Math.min(100, parseInt(m[1], 10)));
  const lower = text.toLowerCase();
  if (/critical|immediate|urgent|high conviction/.test(lower)) return 85;
  if (/strongly recommend|clear sign/.test(lower)) return 75;
  if (/may|could|might|consider/.test(lower)) return 50;
  return 60;
}

function parseNumber(text: string, label: string): number | undefined {
  const re = new RegExp(`${label}[^\\d]{0,20}(\\d+\\.?\\d*)`, "i");
  const m = text.match(re);
  if (m) return parseFloat(m[1]);
  return undefined;
}

function extractSignals(text: string, max = 5): string[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[\s>*\-•]+/, "").trim())
    .filter((l) => l.length > 0 && l.length < 250);
  const keywords = [
    "risk",
    "momentum",
    "stop",
    "profit",
    "exit",
    "hold",
    "tighten",
    "alert",
    "liquidity",
    "holder",
    "tax",
    "rsi",
    "macd",
    "trend",
    "warning",
    "recommend",
    "downside",
    "upside",
  ];
  const scored = lines
    .filter((l) => /[:.!?]/.test(l))
    .map((l) => ({
      line: l,
      score: keywords.reduce((s, k) => s + (l.toLowerCase().includes(k) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.line);
}

// ---------------------------------------------------------------------------
// Build the LLM prompt
// ---------------------------------------------------------------------------
interface ExitPlannerInput {
  positionId: string;
  symbol: string;
  source: "cex" | "dex";
  chain?: string | null;
  tokenId?: string | null;
  entryPriceUsd: number;
  currentPriceUsd: number;
  entryAmountUsd: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  entryAt: Date;
  maxExitAt: Date;
  scamScoreAtEntry: number;
  surveillance: PositionSurveillanceResult;
}

function buildPrompt(input: ExitPlannerInput, marketSnapshot?: unknown): string {
  const now = new Date();
  const minutesHeld = Math.round((now.getTime() - input.entryAt.getTime()) / 60_000);
  const minToExit = Math.round(
    (input.maxExitAt.getTime() - now.getTime()) / 60_000
  );
  const unrealizedPnlPct =
    input.entryPriceUsd > 0
      ? ((input.currentPriceUsd - input.entryPriceUsd) / input.entryPriceUsd) * 100
      : 0;

  const alerts = input.surveillance.alerts;
  const alertSummary = alerts.length === 0
    ? "Nenhum alerta de vigilância ativo."
    : alerts
        .map(
          (a) =>
            `- [${a.severity.toUpperCase()}] ${a.type}: ${a.message}`
        )
        .join("\n");

  const marketStr = marketSnapshot
    ? JSON.stringify(marketSnapshot, null, 2)
    : "Sem snapshot de mercado disponível.";

  return `Você é o Exit Planner de um bot de trade autônomo. Sua função é decidir o destino de uma posição ABERTA com base em alertas de vigilância, indicadores técnicos, e condições de mercado.

POSITION:
- Symbol: ${input.symbol}
- Source: ${input.source}${input.chain ? ` (${input.chain})` : ""}
- Entry price: $${input.entryPriceUsd.toFixed(6)}
- Current price: $${input.currentPriceUsd.toFixed(6)}
- Unrealized PnL: ${unrealizedPnlPct.toFixed(2)}%
- Entry amount: $${input.entryAmountUsd.toFixed(2)}
- Take Profit: $${input.takeProfitPrice.toFixed(6)} (+${(((input.takeProfitPrice / input.entryPriceUsd) - 1) * 100).toFixed(1)}%)
- Stop Loss: $${input.stopLossPrice.toFixed(6)} (${(((input.stopLossPrice / input.entryPriceUsd) - 1) * 100).toFixed(1)}%)
- Tempo held: ${minutesHeld}min
- Tempo até timeout: ${minToExit}min
- Scam score at entry: ${input.scamScoreAtEntry}/100

ACTIVE SURVEILLANCE ALERTS:
${alertSummary}

MARKET SNAPSHOT (latest TA + sentiment):
${marketStr}

DECISION SPACE — escolha EXATAMENTE UMA:
- hold          — manter posição, sem mudanças (default quando alertas são info-only e PnL aceitável)
- tighten_sl    — subir stop-loss para travar lucro ou reduzir downside (informar novo SL)
- raise_tp      — estender take-profit se momentum ainda forte (informar novo TP)
- scale_out_50  — vender 50% a mercado, manter resto com TP/SL original
- exit_now      — fechar posição inteira a mercado (apenas para alertas críticos ou deterioração clara)

REGRAS:
1. Se há alerta critical (goplus_critical_flag, liquidity_drain, price_anomaly com >10% drop em 1h) →倾向于 exit_now ou scale_out_50
2. Se PnL > +10% e sem alertas críticos → considerar tighten_sl para travar lucro
3. Se PnL < -10% e sem alerta mas RSI < 30 (oversold) → hold (não realizar prejuízo em suporte)
4. Se timeout < 30min → considerar scale_out_50 ou exit_now dependendo do PnL
5. Não recomende exit_now sem confiança alta (>=70%)

OUTPUT FORMAT (obrigatório):
ACTION: <hold | tighten_sl | raise_tp | scale_out_50 | exit_now>
CONFIDENCE: <0-100>%
SUGGESTED_NEW_SL: <apenas se tighten_sl, valor numérico>
SUGGESTED_NEW_TP: <apenas se raise_tp, valor numérico>
REASONING:
<2-4 sentences explicando a decisão>

KEY SIGNALS:
- <bullet 1>
- <bullet 2>
- <bullet 3>`;
}

// ---------------------------------------------------------------------------
// Main entry — plan exit for a single position
// ---------------------------------------------------------------------------
export async function planExit(
  input: ExitPlannerInput
): Promise<ExitPlan> {
  const { surveillance } = input;

  // Determine highest severity alert
  const severities = surveillance.alerts.map((a) => a.severity);
  const alertSeverity: "info" | "warning" | "critical" = severities.includes("critical")
    ? "critical"
    : severities.includes("warning")
    ? "warning"
    : "info";

  // Quick path: no alerts → return hold without LLM call
  if (surveillance.alerts.length === 0) {
    return {
      positionId: input.positionId,
      symbol: input.symbol,
      action: "hold",
      confidence: 90,
      reasoning: "Sem alertas de vigilância ativos — manter posição com TP/SL original.",
      keySignals: ["No active surveillance alerts"],
      alertCount: 0,
      alertSeverity: "info",
    };
  }

  // Fetch latest market snapshot for the token (fresh TA + sentiment)
  let marketSnapshot: unknown = null;
  try {
    const candidate = {
      symbol: input.symbol,
      source: input.source,
      chain: input.chain ?? undefined,
      tokenId: input.tokenId ?? undefined,
      priceUsd: input.currentPriceUsd,
      volume24hUsd: 0,
      liquidityUsd: 0,
    };
    marketSnapshot = await analyzeMarket(candidate);
  } catch (err) {
    logger.debug("exit_planner", `Erro analyzeMarket ${input.symbol}: ${String(err)}`);
  }

  // Build prompt + call LLM
  const systemPrompt = `Você é o Exit Planner de um bot de trade autônomo de criptomoedas. Sua única função é decidir o destino de posições abertas com base em alertas de vigilância e condições de mercado. Você é conservador: prefere hold quando incerto, só recomenda exit_now com confiança alta.`;

  const userPrompt = buildPrompt(input, marketSnapshot);

  const promptSummary = userPrompt.length > 500 ? userPrompt.slice(0, 497) + "..." : userPrompt;
  const start = Date.now();
  let modelOutput = "";
  let tokensUsed = 0;
  let error: string | undefined;

  try {
    const zai = await getZai();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });
    modelOutput = completion.choices[0]?.message?.content ?? "";
    tokensUsed =
      (completion as { usage?: { total_tokens?: number } }).usage?.total_tokens ?? 0;
  } catch (err) {
    error = String(err);
    logger.error("exit_planner", `Erro LLM exit plan ${input.symbol}: ${error}`);
    modelOutput = `[LLM ERROR] ${error}`;
  }

  const durationMs = Date.now() - start;
  const action = error ? "hold" : parseAction(modelOutput);
  const confidence = error ? 0 : parseConfidence(modelOutput);
  const keySignals = error ? [] : extractSignals(modelOutput);
  const suggestedNewSl = parseNumber(modelOutput, "SUGGESTED_NEW_SL");
  const suggestedNewTp = parseNumber(modelOutput, "SUGGESTED_NEW_TP");

  // Extract reasoning (lines between REASONING: and KEY SIGNALS:)
  const reasoningMatch = modelOutput.match(/REASONING:\s*\n([\s\S]*?)(?:\nKEY SIGNALS:|$)/i);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : modelOutput.slice(0, 300);

  // Persist as AIInsight with role "risk_advisor"
  try {
    const role: AgentRole = "risk_advisor";
    await db.aIInsight.create({
      data: {
        agentRole: role,
        symbol: input.symbol,
        tokenId: input.tokenId ?? null,
        chain: input.chain ?? null,
        promptSummary,
        modelOutput,
        recommendation: action === "exit_now" ? "exit" : action === "hold" ? "hold" : "investigate",
        confidence,
        keySignals: JSON.stringify(keySignals),
        tokensUsed,
        durationMs,
        error: error ?? null,
      },
    });
  } catch (err) {
    logger.warn("exit_planner", `Falha persistindo insight: ${String(err)}`);
  }

  logger.info(
    "exit_planner",
    `${input.symbol}: action=${action} conf=${confidence}% (alerts=${surveillance.alerts.length} sev=${alertSeverity})`,
    { positionId: input.positionId, durationMs }
  );

  return {
    positionId: input.positionId,
    symbol: input.symbol,
    action,
    confidence,
    reasoning,
    keySignals,
    suggestedNewSl,
    suggestedNewTp,
    alertCount: surveillance.alerts.length,
    alertSeverity,
  };
}

// ---------------------------------------------------------------------------
// Apply an exit plan — actually modify the position or close it
// ---------------------------------------------------------------------------
export async function applyExitPlan(plan: ExitPlan): Promise<boolean> {
  if (plan.action === "hold") return false;

  // Only execute high-confidence actions OR critical-severity actions
  // (action !== "hold" already guaranteed above)
  const shouldExecute =
    plan.alertSeverity === "critical" || plan.confidence >= 70;

  if (!shouldExecute) {
    logger.info(
      "exit_planner",
      `${plan.symbol}: action=${plan.action} não executada (conf=${plan.confidence}% sev=${plan.alertSeverity})`
    );
    return false;
  }

  // For scale_out_50 / exit_now — engine.closePosition handles full close.
  // For partial close, we'd need to extend portfolio.ts; for now, scale_out_50
  // with critical severity escalates to exit_now to be safe.
  if (plan.action === "exit_now" || plan.action === "scale_out_50") {
    // Mark this as needing engine action — engine will pick it up
    return true;
  }

  // For tighten_sl / raise_tp — update the position row directly
  if (plan.action === "tighten_sl" && plan.suggestedNewSl) {
    await db.position.update({
      where: { id: plan.positionId },
      data: { stopLossPrice: plan.suggestedNewSl },
    });
    logger.info("exit_planner", `${plan.symbol}: SL atualizado para $${plan.suggestedNewSl}`);
    return true;
  }

  if (plan.action === "raise_tp" && plan.suggestedNewTp) {
    await db.position.update({
      where: { id: plan.positionId },
      data: { takeProfitPrice: plan.suggestedNewTp },
    });
    logger.info("exit_planner", `${plan.symbol}: TP atualizado para $${plan.suggestedNewTp}`);
    return true;
  }

  return false;
}
