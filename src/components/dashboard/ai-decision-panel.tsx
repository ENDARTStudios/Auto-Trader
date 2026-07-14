"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Brain, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import type { AIInsightRow } from "@/hooks/use-trading-data";

interface AIDecisionPanelProps {
  insights: AIInsightRow[];
  isLoading?: boolean;
  className?: string;
}

type Action = "BUY" | "SELL" | "HOLD" | "AVOID" | "EXIT" | "WAIT";

interface NormalizedDecision {
  action: Action;
  confidence: number;
  symbol: string | null;
  reason: string;
  checks: { label: string; status: "pass" | "fail" | "warn" | "neutral"; detail?: string }[];
  timestamp: string | null;
}

/* Map raw AI recommendation to canonical action + accent class */
function normalizeRecommendation(rec: string): Action {
  const r = (rec ?? "").toLowerCase();
  if (r.includes("buy") || r.includes("long")) return "BUY";
  if (r.includes("sell") || r.includes("short")) return "SELL";
  if (r.includes("exit") || r.includes("close")) return "EXIT";
  if (r.includes("avoid") || r.includes("reject")) return "AVOID";
  if (r.includes("hold")) return "HOLD";
  return "WAIT";
}

function actionAccentClass(a: Action): string {
  switch (a) {
    case "BUY": return "accent-buy";
    case "SELL":
    case "EXIT":
    case "AVOID": return "accent-sell";
    case "HOLD": return "accent-warn";
    case "WAIT": return "accent-neutral";
  }
}

function actionColorVar(a: Action): string {
  switch (a) {
    case "BUY": return "var(--color-buy)";
    case "SELL":
    case "EXIT":
    case "AVOID": return "var(--color-sell)";
    case "HOLD": return "var(--color-warn)";
    case "WAIT": return "oklch(0.65 0.005 264)";
  }
}

function extractChecks(insight: AIInsightRow): NormalizedDecision["checks"] {
  const checks: NormalizedDecision["checks"] = [];
  // Try to read keySignals — they often contain PASS/FAIL markers
  for (const sig of insight.keySignals.slice(0, 6)) {
    const lower = sig.toLowerCase();
    let status: "pass" | "fail" | "warn" | "neutral" = "neutral";
    let label = sig;
    let detail: string | undefined;

    // Try to split "Label: Value" pairs
    const colonIdx = sig.indexOf(":");
    if (colonIdx > 0) {
      label = sig.slice(0, colonIdx).trim();
      detail = sig.slice(colonIdx + 1).trim();
    }

    if (lower.includes("pass") || lower.includes("ok") || lower.includes("good") || lower.includes("low risk")) {
      status = "pass";
    } else if (lower.includes("fail") || lower.includes("reject") || lower.includes("critical") || lower.includes("high risk")) {
      status = "fail";
    } else if (lower.includes("warn") || lower.includes("caution") || lower.includes("medium")) {
      status = "warn";
    }

    checks.push({ label, status, detail });
  }

  // Always ensure we have at least the standard 4 checks
  const defaults = [
    { label: "LIQUIDITY", status: "neutral" as const },
    { label: "MEV", status: "neutral" as const },
    { label: "SIMULATION", status: "neutral" as const },
    { label: "AUTHORITY", status: "neutral" as const },
  ];
  if (checks.length < 4) return defaults;
  return checks.slice(0, 6);
}

/**
 * AIDecisionPanel — permanent panel showing LATEST AI decision.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │ AI DECISION         · latest     │
 *   │                                  │
 *   │   BUY                            │  ← large 36px action
 *   │   Confidence                     │
 *   │   ████████░░  91%                │  ← progress bar
 *   │                                  │
 *   │   ─── REASON ────────────────    │
 *   │   Liquidity OK, MEV LOW, ...     │  ← short reasoning text
 *   │                                  │
 *   │   ─── CHECKS ─────────────────   │
 *   │   LIQUIDITY              PASS    │
 *   │   MEV                     LOW    │
 *   │   SIMULATION             PASS    │
 *   │   AUTHORITY              PASS    │
 *   └──────────────────────────────────┘
 *
 * Color: action drives the accent (Buy=emerald, Sell=red, Hold=amber, Wait=neutral).
 * Symbol/timestamp shown in header for context.
 */
export function AIDecisionPanel({ insights, isLoading, className }: AIDecisionPanelProps) {
  const latest = insights[0];
  const decision: NormalizedDecision | null = latest
    ? {
        action: normalizeRecommendation(latest.recommendation),
        confidence: latest.confidence,
        symbol: latest.symbol,
        reason: latest.keySignals.slice(0, 3).join(" · ") || latest.promptSummary.slice(0, 120),
        checks: extractChecks(latest),
        timestamp: latest.createdAt,
      }
    : null;

  return (
    <div className={cn("ws-panel ws-panel-l3 rounded-lg flex flex-col", className)}>
      {/* Header */}
      <div className="ws-panel-header">
        <div className="flex items-center gap-2">
          <Brain className="size-3.5 text-ai" />
          <span className="ws-panel-title">AI Decision</span>
          <span className="ws-panel-subtitle">· latest · {decision?.symbol ?? "—"}</span>
        </div>
        {decision?.timestamp && (
          <span className="label-mono text-[9px] text-muted-foreground">
            {new Date(decision.timestamp).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
      </div>

      <div className="ws-panel-body flex-1 flex flex-col gap-3">
        {isLoading && !decision ? (
          <div className="text-center text-[11px] text-muted-foreground label-mono py-8">
            Carregando decisão…
          </div>
        ) : !decision ? (
          <div className="text-center text-[11px] text-muted-foreground label-mono py-8">
            Sem decisões ainda.
            <br />
            Inicie a engine para gerar a primeira.
          </div>
        ) : (
          <>
            {/* ACTION — large 36px */}
            <div className={cn("flex items-center gap-3", actionAccentClass(decision.action))}>
              <span
                className="ai-decision-action"
                style={{ color: actionColorVar(decision.action) }}
              >
                {decision.action}
              </span>
            </div>

            {/* CONFIDENCE — bar */}
            <div className={cn("ai-decision-confidence", actionAccentClass(decision.action))}>
              <span className="label-mono text-[9px] text-muted-foreground tracking-[0.16em]">
                CONFIDENCE
              </span>
              <div className="telemetry-bar-track flex-1">
                <div
                  className="telemetry-bar-fill"
                  style={{ width: `${Math.max(0, Math.min(100, decision.confidence))}%` }}
                />
              </div>
              <span
                className="label-mono text-[12px] font-bold tabular"
                style={{ color: actionColorVar(decision.action) }}
              >
                {decision.confidence}%
              </span>
            </div>

            {/* REASON */}
            <div className="ai-decision-reason">
              <span className="label-mono text-[9px] text-muted-foreground tracking-[0.16em] block mb-1">
                REASON
              </span>
              <p className="text-[11px] text-foreground/90 leading-snug line-clamp-3">
                {decision.reason}
              </p>
            </div>

            {/* CHECKS */}
            <div className="ai-decision-reason">
              <span className="label-mono text-[9px] text-muted-foreground tracking-[0.16em] block mb-1">
                CHECKS
              </span>
              <div>
                {decision.checks.map((c, i) => (
                  <div key={i} className="ai-decision-check">
                    <span className="text-muted-foreground">{c.label}</span>
                    <span
                      className={cn(
                        "flex items-center gap-1",
                        c.status === "pass" && "text-buy",
                        c.status === "fail" && "text-sell",
                        c.status === "warn" && "text-warn",
                        c.status === "neutral" && "text-muted-foreground"
                      )}
                    >
                      {c.status === "pass" && <CheckCircle2 className="size-2.5" />}
                      {c.status === "fail" && <XCircle className="size-2.5" />}
                      {c.status === "warn" && <AlertCircle className="size-2.5" />}
                      {c.detail ?? c.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
