// AI agent module — autonomous LLM agents that:
//   1. Generate trading thesis for each candidate (combines market data,
//      scam report, sentiment → buy/hold/avoid decision with reasoning)
//   2. Analyze contract source code for hidden risks that the static
//      regex-based scam-detector might miss
//   3. Synthesize news sentiment from public sources
//
// Uses z-ai-web-dev-sdk (free, no extra cost). All calls are logged to the
// AIInsight table so we have a full audit trail of AI decisions.
//
// IMPORTANT: AI is advisory only. It can REJECT a trade (veto power) but
// cannot FORCE a trade — the engine still gates on scam-score, risk-manager,
// and circuit breakers. AI is a layer of skepticism, not autopilot.

import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { logger } from "./logger";
import type { ScamReportData, TokenCandidate } from "./types";
import type { MarketSignal } from "./market-analysis";
import type { GoPlusResult } from "./goplus-scanner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AgentRole = "thesis" | "contract_analyst" | "news_sentiment" | "risk_advisor";

export interface AIInsightResult {
  agentRole: AgentRole;
  symbol?: string;
  tokenId?: string;
  chain?: string;
  recommendation: "buy" | "hold" | "avoid" | "investigate" | "exit";
  confidence: number; // 0-100
  keySignals: string[];
  modelOutput: string;
  promptSummary: string;
  tokensUsed: number;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Singleton ZAI instance (initialised lazily)
// ---------------------------------------------------------------------------
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
function extractKeySignals(text: string, max = 5): string[] {
  // Pull bullet points or short sentences containing action verbs
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[\s>*\-•]+/, "").trim())
    .filter((l) => l.length > 0 && l.length < 200);
  const keywords = ["risk", "red flag", "concern", "bullish", "bearish", "honeypot", "rug", "momentum", "liquidity", "tax", "mint", "owner", "recommend", "avoid", "buy", "sell", "warning", "caution"];
  const scored = lines
    .filter((l) => /[:.!?]/.test(l))
    .map((l) => ({
      line: l,
      score: keywords.reduce((s, k) => s + (l.toLowerCase().includes(k) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.line);
}

function parseRecommendation(text: string): AIInsightResult["recommendation"] {
  // First, look for an explicit "RECOMMENDATION: <X>" line. This is the
  // authoritative signal — the LLM was instructed to start with it.
  const recMatch = text.match(/RECOMMENDATION:\s*(strong\s*buy|buy|hold|avoid|investigate|exit)/i);
  if (recMatch) {
    const rec = recMatch[1].toLowerCase().replace(/\s+/g, "_");
    if (rec === "strong_buy") return "buy";
    if (["buy", "hold", "avoid", "investigate", "exit"].includes(rec)) {
      return rec as AIInsightResult["recommendation"];
    }
  }
  // Fallback: scan full text for keywords (lower confidence in parser)
  const lower = text.toLowerCase();
  if (/honeypot|rug pull|confirmed scam|do not (buy|trade|invest)/.test(lower)) return "avoid";
  if (/investigate further|needs? review|insufficient data|cannot recommend/.test(lower)) return "investigate";
  if (/strong (buy|bullish)|high conviction|clear buy/.test(lower)) return "buy";
  if (/\bexit|close position|sell now\b/.test(lower)) return "exit";
  if (/\bavoid\b|decline|skip|do not buy/.test(lower)) return "avoid";
  if (/\bbuy\b|bullish|long position|accumulate/.test(lower)) return "buy";
  return "hold"; // default — neutral, doesn't veto
}

function parseConfidence(text: string): number {
  const m = text.match(/confidence[:\s]+(\d{1,3})\s*%?/i);
  if (m) return Math.max(0, Math.min(100, parseInt(m[1], 10)));
  // Heuristic: if the text uses strong words like "high conviction" → 80,
  // if it uses hedging like "may", "could", "uncertain" → 40
  const lower = text.toLowerCase();
  if (/high conviction|very confident|strongly/.test(lower)) return 80;
  if (/uncertain|may|could|might|unclear|ambiguous/.test(lower)) return 40;
  return 60;
}

// ---------------------------------------------------------------------------
// Core LLM call with retry + audit logging
// ---------------------------------------------------------------------------
async function callAgent(
  role: AgentRole,
  systemPrompt: string,
  userPrompt: string,
  metadata: { symbol?: string; tokenId?: string; chain?: string }
): Promise<AIInsightResult> {
  const promptSummary =
    userPrompt.length > 500 ? userPrompt.slice(0, 497) + "..." : userPrompt;
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
    tokensUsed = (completion as { usage?: { total_tokens?: number } }).usage?.total_tokens ?? 0;
  } catch (err) {
    error = String(err);
    logger.error("ai", `Erro LLM (${role}): ${error}`);
    modelOutput = `[LLM ERROR] ${error}`;
  }

  const durationMs = Date.now() - start;
  const recommendation = error ? "investigate" : parseRecommendation(modelOutput);
  const confidence = error ? 0 : parseConfidence(modelOutput);
  const keySignals = error ? [] : extractKeySignals(modelOutput);

  const result: AIInsightResult = {
    agentRole: role,
    symbol: metadata.symbol,
    tokenId: metadata.tokenId,
    chain: metadata.chain,
    recommendation,
    confidence,
    keySignals,
    modelOutput,
    promptSummary,
    tokensUsed,
    durationMs,
    error,
  };

  // Persist
  try {
    await db.aIInsight.create({
      data: {
        agentRole: role,
        symbol: metadata.symbol ?? null,
        tokenId: metadata.tokenId ?? null,
        chain: metadata.chain ?? null,
        promptSummary,
        modelOutput,
        recommendation,
        confidence,
        keySignals: JSON.stringify(keySignals),
        tokensUsed,
        durationMs,
        error: error ?? null,
      },
    });
  } catch (err) {
    logger.error("ai", `Erro persistindo AIInsight: ${String(err)}`);
  }

  logger.info(
    "ai",
    `Agent ${role} ${metadata.symbol ?? "?"} → ${recommendation} (conf ${confidence}%) ${durationMs}ms`,
    { tokens: tokensUsed }
  );

  return result;
}

// ---------------------------------------------------------------------------
// Agent 1: Trading thesis generator
// Combines market signal + scam report + GoPlus into a buy/avoid recommendation.
// ---------------------------------------------------------------------------
export async function generateTradingThesis(
  candidate: TokenCandidate,
  market: MarketSignal,
  scam: ScamReportData,
  goplus: GoPlusResult | null
): Promise<AIInsightResult> {
  const systemPrompt = `You are a senior crypto analyst evaluating a token for an autonomous trading bot running in paper-trading mode.

Your job: synthesize the technical indicators, market sentiment, and scam/security signals into a clear recommendation.

Calibration:
- For CEX-listed major tokens (BTC, ETH, SOL, BNB, XRP, etc.) with no critical red flags, the DEFAULT recommendation should be "hold" or "buy" based on technicals — NOT "avoid". Avoid is reserved for actual red flags.
- For DEX tokens, apply more scrutiny — but still only recommend "avoid" when there are concrete issues (honeypot, unverified source, mint authority, concentrated holders, very low liquidity, very young age).
- "investigate" is for cases where you lack data to make a call (e.g., unrecognized token).
- "hold" means neutral — not enough conviction to buy, but no red flags to avoid.
- "buy" requires bullish technicals AND no security concerns.

Output rules:
1. Be concise (max 250 words).
2. Start with a one-line recommendation: "RECOMMENDATION: <buy|hold|avoid|investigate>".
3. End with "CONFIDENCE: <0-100>%".
4. Between them, give 3-5 bullet points of key reasoning covering:
   - Technical momentum (RSI / MACD / EMA trend)
   - Sentiment context (Fear & Greed, trending)
   - Security posture (scam score, GoPlus red flags if any)
   - Risk factors that could invalidate the thesis
5. If GoPlus flagged the token as honeypot or has criticalFlags, RECOMMENDATION must be "avoid".
6. If scamScore < 70, RECOMMENDATION must be "avoid" or "investigate".
7. Do NOT recommend "avoid" just because you are skeptical — only do so when there is a CONCRETE red flag listed in the data above. Skepticism without evidence = "hold".`;

  const userPrompt = `TOKEN: ${candidate.symbol} (${candidate.source}${candidate.chain ? " on " + candidate.chain : ""})
${candidate.tokenId ? `CONTRACT: ${candidate.tokenId}` : ""}

PRICE: $${candidate.priceUsd.toFixed(6)}
VOLUME 24H: $${candidate.volume24hUsd.toFixed(0)}
LIQUIDITY: $${candidate.liquidityUsd.toFixed(0)}
${candidate.ageHours !== undefined ? `AGE: ${(candidate.ageHours / 24).toFixed(1)} days` : ""}

TECHNICAL INDICATORS (1h candles):
- RSI(14): ${market.rsi14?.toFixed(1) ?? "n/a"}
- MACD histogram: ${market.macdHist?.toFixed(6) ?? "n/a"}
- EMA20: ${market.ema20?.toFixed(6) ?? "n/a"} | EMA50: ${market.ema50?.toFixed(6) ?? "n/a"} → trend: ${market.ema20 && market.ema50 ? (market.ema20 > market.ema50 ? "UP" : "DOWN") : "n/a"}
- Bollinger %B: ${market.bollPercent?.toFixed(2) ?? "n/a"} (0 = lower band, 1 = upper band)
- Composite signal: ${market.signalLabel} (${market.signalScore}/100)

MARKET SENTIMENT:
- Fear & Greed Index: ${market.fearGreedIndex ?? "n/a"} (${market.fearGreedClass ?? "n/a"})
- CoinGecko trending rank: ${market.trendingRank ?? "not trending"}

SCAM REPORT (composite score: ${scam.score}/100, ${scam.passed ? "PASSED" : "FAILED"}):
${scam.subscores.map((s) => `  - ${s.name}: ${s.score}/100 (weight ${s.weight})`).join("\n")}
Key findings:
${Object.values(scam.findings).flat().slice(0, 8).map((f) => `  • ${f}`).join("\n")}

${
  goplus
    ? `GOPLUS SECURITY SCAN (score ${goplus.score}/100):
Critical flags: ${goplus.criticalFlags.length === 0 ? "none" : goplus.criticalFlags.join("; ")}
Key findings: ${goplus.findings.slice(0, 8).join("\n  ")}`
    : "GOPLUS: not available for this chain"
}

Give your analysis now.`;

  return callAgent(
    "thesis",
    systemPrompt,
    userPrompt,
    { symbol: candidate.symbol, tokenId: candidate.tokenId, chain: candidate.chain }
  );
}

// ---------------------------------------------------------------------------
// Agent 2: Contract source analyst
// Takes the contract source code (if available) and asks the LLM to look for
// subtle risks the regex-based detector might miss: hidden mint logic via
// modifiers, time-locked rug patterns, fake renunciation, etc.
// ---------------------------------------------------------------------------
export async function analyzeContractWithAI(
  candidate: TokenCandidate,
  sourceCode: string,
  contractName?: string
): Promise<AIInsightResult> {
  // Truncate source to ~12k chars to stay within token budget
  const truncated =
    sourceCode.length > 12000
      ? sourceCode.slice(0, 6000) + "\n// [...truncated...]\n" + sourceCode.slice(-6000)
      : sourceCode;

  const systemPrompt = `You are a smart contract security auditor. You receive a token's Solidity source code and must identify RUG-PULL and SCAM patterns that automated heuristics miss.

Look specifically for:
1. Hidden mint logic (e.g., mint callable only after a timestamp, or via a modifier that bypasses onlyOwner)
2. Fake renunciation (owner is set to 0x0 but a separate admin role retains mint power)
3. Time-locked rug pulls (functions that allow sell-blocking after N days)
4. Pause/blacklist functions that can be triggered by arbitrary addresses
5. Tax manipulation (setTaxFee that can go above 50%)
6. Proxy upgradeability that lets the dev swap to a malicious implementation later
7. Backdoor in modifiers (e.g., _isExcludedFromFee that includes the dev's wallet)
8. Self-destruct or delegatecall to arbitrary addresses

Output rules:
1. Start with "RECOMMENDATION: <buy|hold|avoid|investigate>".
2. End with "CONFIDENCE: <0-100>%".
3. Between them, list concrete findings with line references where possible.
4. If source code looks safe, say so explicitly and recommend buy/hold.
5. If you see a critical pattern, RECOMMENDATION must be "avoid".`;

  const userPrompt = `Analyze this Solidity contract for ${candidate.symbol} (${candidate.chain}):
${contractName ? `Contract name: ${contractName}` : ""}

\`\`\`solidity
${truncated}
\`\`\`

Give your audit now.`;

  return callAgent(
    "contract_analyst",
    systemPrompt,
    userPrompt,
    { symbol: candidate.symbol, tokenId: candidate.tokenId, chain: candidate.chain }
  );
}

// ---------------------------------------------------------------------------
// Agent 3: News / sentiment synthesis
// Asks the LLM to provide general market context for the token based on its
// training data (no live news scraping — keeps the system dependency-free).
// Output is treated as advisory, not authoritative.
// ---------------------------------------------------------------------------
export async function synthesizeNewsSentiment(
  candidate: TokenCandidate
): Promise<AIInsightResult> {
  const systemPrompt = `You are a crypto market sentiment analyst. Based on your knowledge of the token, the project, and recent market context, give a brief sentiment read.

Be explicit about uncertainty — your knowledge has a cutoff and you may not know the latest news. Treat this as advisory.

Output rules:
1. Start with "RECOMMENDATION: <buy|hold|avoid|investigate>".
2. End with "CONFIDENCE: <0-100>%".
3. Between them, 2-4 bullets covering:
   - Project fundamentals (what does it do, is the team doxxed, is there product-market fit)
   - Recent narrative alignment (is this token in a narrative that's heating up or cooling down)
   - Known historical red flags (prior hacks, dev controversies, regulatory issues)
4. If you don't recognize the token, say so and recommend "investigate".
5. Max 200 words.`;

  const userPrompt = `Token: ${candidate.symbol}
Chain: ${candidate.chain ?? "n/a"}
Contract: ${candidate.tokenId ?? "n/a (CEX-listed)"}
Age: ${candidate.ageHours ? `${(candidate.ageHours / 24).toFixed(0)} days` : "unknown"}
Liquidity: $${candidate.liquidityUsd.toFixed(0)}
24h volume: $${candidate.volume24hUsd.toFixed(0)}

Give your sentiment read now.`;

  return callAgent(
    "news_sentiment",
    systemPrompt,
    userPrompt,
    { symbol: candidate.symbol, tokenId: candidate.tokenId, chain: candidate.chain }
  );
}

// ---------------------------------------------------------------------------
// Convenience: run all 3 agents in parallel for a single candidate
// ---------------------------------------------------------------------------
export async function runAgentSquad(
  candidate: TokenCandidate,
  market: MarketSignal,
  scam: ScamReportData,
  goplus: GoPlusResult | null,
  contractSource?: string
): Promise<{
  thesis: AIInsightResult;
  news: AIInsightResult;
  contractAudit?: AIInsightResult;
  consensus: AIInsightResult["recommendation"];
  consensusConfidence: number;
}> {
  const base = { symbol: candidate.symbol, tokenId: candidate.tokenId, chain: candidate.chain };

  const tasks: Promise<AIInsightResult>[] = [
    generateTradingThesis(candidate, market, scam, goplus),
    synthesizeNewsSentiment(candidate),
  ];
  if (contractSource && contractSource.length > 100) {
    tasks.push(analyzeContractWithAI(candidate, contractSource));
  }
  const [thesis, news, contractAudit] = await Promise.all(tasks);

  // Consensus: any "avoid" → avoid. Any "investigate" → investigate.
  // Otherwise, weight by confidence.
  const recs = [thesis.recommendation, news.recommendation, ...(contractAudit ? [contractAudit.recommendation] : [])];
  let consensus: AIInsightResult["recommendation"] = "hold";
  if (recs.includes("avoid")) {
    consensus = "avoid";
  } else if (recs.includes("investigate")) {
    consensus = "investigate";
  } else if (recs.filter((r) => r === "buy").length >= 2) {
    consensus = "buy";
  } else if (recs.filter((r) => r === "exit").length >= 2) {
    consensus = "exit";
  } else {
    consensus = "hold";
  }
  const confidences = [thesis.confidence, news.confidence, ...(contractAudit ? [contractAudit.confidence] : [])];
  const consensusConfidence = Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);

  logger.info("ai", `Agent squad consensus for ${candidate.symbol}: ${consensus} (${consensusConfidence}%)`, {
    thesis: thesis.recommendation,
    news: news.recommendation,
    contract: contractAudit?.recommendation ?? "skip",
  });

  return {
    thesis,
    news,
    contractAudit,
    consensus,
    consensusConfidence,
  };
}
