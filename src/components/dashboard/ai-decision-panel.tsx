"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Brain, CheckCircle2, XCircle, AlertCircle, MinusCircle } from "lucide-react";
import type { AIInsightRow } from "@/hooks/use-trading-data";

/** Pre-computed gate statuses, sourced from real backend (H1/H2 layers) */
export interface GateStatus {
  /** Liquidity gate (H2) — pool liquidity verification */
  liquidity: GateState;
  /** Authority gate (H2) — token authority check */
  authority: GateState;
  /** Simulation gate (H1) — pre-trade simulation */
  simulation: GateState;
  /** MEV gate (H1) — MEV baseline / sandwich protection */
  mev: GateState;
  /** Approval gate (H1) — token approval hardening */
  approval: GateState;
}

export type GateState = "pass" | "fail" | "warn" | "unknown";

interface AIDecisionPanelProps {
  insights: AIInsightRow[];
  /** If provided, replaces the parser-derived gates with real backend gate data */
  gates?: GateStatus;
  isLoading?: boolean;
  className?: string;
}

type Action = "BUY" | "SELL" | "HOLD" | "AVOID" | "EXIT" | "WAIT";

interface NormalizedDecision {
  action: Action;
  confidence: number;
  symbol: string | null;
  reason: string;
  timestamp: string | null;
}

/* Map raw AI recommendation to canonical action */
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

const GATE_META: { key: keyof GateStatus; label: string; layer: string }[] = [
  { key: "liquidity", label: "LIQUIDITY", layer: "H2" },
  { key: "authority", label: "AUTHORITY", layer: "H2" },
  { key: "simulation", label: "SIMULATION", layer: "H1" },
  { key: "mev", label: "MEV", layer: "H1" },
  { key: "approval", label: "APPROVAL", layer: "H1" },
];

function gateAccentClass(state: GateState): string {
  switch (state) {
    case "pass": return "accent-buy";
    case "warn": return "accent-warn";
    case "fail": return "accent-sell";
    case "unknown": return "accent-neutral";
  }
}

function gateIcon(state: GateState) {
  switch (state) {
    case "pass": return <CheckCircle2 className="size-3" />;
    case "warn": return <AlertCircle className="size-3" />;
    case "fail": return <XCircle className="size-3" />;
    case "unknown": return <MinusCircle className="size-3" />;
  }
}

function gateLabel(state: GateState): string {
  switch (state) {
    case "pass": return "PASS";
    case "warn": return "WARN";
    case "fail": return "FAIL";
    case "unknown": return "—";
  }
}

/**
 * AIDecisionPanel — permanent panel showing LATEST AI decision + 5 gate approvals.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │ AI DECISION         · latest     │
 *   │                                  │
 *   │   BUY                  92%       │  ← large 36px action + confidence
 *   │   ████████████████████░░░░       │
 *   │                                  │
 *   │   ─── GATES (H1/H2 hardening) ─  │
 *   │   LIQUIDITY              PASS    │
 *   │   AUTHORITY              PASS    │
 *   │   SIMULATION             PASS    │
 *   │   MEV                     LOW    │
 *   │   APPROVAL               OK      │
 *   │                                  │
 *   │   ─── REASON ────────────────    │
 *   │   Liquidity locked, MEV LOW...   │
 *   └──────────────────────────────────┘
 */
export function AIDecisionPanel({ insights, gates, isLoading, className }: AIDecisionPanelProps) {
  const latest = insights[0];
  const decision: NormalizedDecision | null = latest
    ? {
        action: normalizeRecommendation(latest.recommendation),
        confidence: latest.confidence,
        symbol: latest.symbol,
        reason: latest.keySignals.slice(0, 3).join(" · ") || latest.promptSummary.slice(0, 140),
        timestamp: latest.createdAt,
      }
    : null;

  // Default gates: unknown unless backend provides real values
  const resolvedGates: GateStatus = gates ?? {
    liquidity: "unknown",
    authority: "unknown",
    simulation: "unknown",
    mev: "unknown",
    approval: "unknown",
  };

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
          <>
            {/* Placeholder action when no decision yet */}
            <div className="flex items-center gap-3 accent-neutral">
              <span
                className="ai-decision-action"
                style={{ color: "oklch(0.65 0.005 264)" }}
              >
                WAIT
              </span>
            </div>
            <div className="ai-decision-confidence accent-neutral">
              <span className="label-mono text-[9px] text-muted-foreground tracking-[0.16em]">
                CONFIDENCE
              </span>
              <div className="telemetry-bar-track flex-1">
                <div className="telemetry-bar-fill" style={{ width: "0%" }} />
              </div>
              <span
                className="label-mono text-[12px] font-bold tabular"
                style={{ color: "oklch(0.65 0.005 264)" }}
              >
                —%
              </span>
            </div>
            <div className="text-center text-[11px] text-muted-foreground label-mono py-1">
              Sem decisões ainda. Inicie a engine para gerar a primeira.
            </div>
          </>
        ) : (
          <>
            {/* ACTION + CONFIDENCE — large 36px */}
            <div className={cn("flex items-center gap-3", actionAccentClass(decision.action))}>
              <span
                className="ai-decision-action"
                style={{ color: actionColorVar(decision.action) }}
              >
                {decision.action}
              </span>
            </div>

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
          </>
        )}

        {/* GATES — 5 hardening gates (Liquidity / Authority / Simulation / MEV / Approval)
            ALWAYS visible per operator spec — even without a decision. */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="label-mono text-[9px] text-muted-foreground tracking-[0.16em]">
              GATES
            </span>
            <span className="label-mono text-[8px] text-muted-foreground/70 tracking-[0.10em]">
              H1/H2 HARDENING
            </span>
          </div>
          <div className="gate-list">
            {GATE_META.map((g) => {
              const state = resolvedGates[g.key];
              return (
                <div
                  key={g.key}
                  className={cn("gate-row", gateAccentClass(state))}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="gate-row-label">{g.label}</span>
                    <span className="label-mono text-[7.5px] text-muted-foreground/60 tracking-[0.08em]">
                      {g.layer}
                    </span>
                  </div>
                  <span className="gate-row-value">
                    {gateIcon(state)}
                    {gateLabel(state)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* REASON */}
        {decision && (
          <div className="ai-decision-reason">
            <span className="label-mono text-[9px] text-muted-foreground tracking-[0.16em] block mb-1">
              REASON
            </span>
            <p className="text-[11px] text-foreground/90 leading-snug line-clamp-3">
              {decision.reason}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
