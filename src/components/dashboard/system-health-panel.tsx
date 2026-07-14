"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Activity, Boxes, Shield, Server } from "lucide-react";

export interface SystemHealthMetric {
  label: string;
  value: string | number;
  /** 0-100 — drives the bar fill. omit for non-percentage metrics. */
  pct?: number;
  /** qualitative state label, e.g. "Healthy", "LOW", "OK", "PASS" */
  state?: string;
  /** category drives color (accent class) and grouping */
  category: "engine" | "blockchain" | "security" | "system";
  pulse?: boolean;
}

interface SystemHealthPanelProps {
  metrics: SystemHealthMetric[];
  className?: string;
}

const CATEGORY_META: Record<
  SystemHealthMetric["category"],
  { label: string; icon: typeof Activity; accentClass: string }
> = {
  engine: { label: "ENGINE", icon: Activity, accentClass: "accent-system" },
  blockchain: { label: "BLOCKCHAIN", icon: Boxes, accentClass: "accent-chain" },
  security: { label: "SECURITY", icon: Shield, accentClass: "accent-buy" },
  system: { label: "SYSTEM", icon: Server, accentClass: "accent-neutral" },
};

/**
 * SystemHealthPanel — 4-block grouped telemetry with state bars.
 *
 * Layout:
 *   ┌──────────────┬──────────────┬──────────────┬──────────────┐
 *   │ ENGINE       │ BLOCKCHAIN   │ SECURITY     │ SYSTEM       │
 *   │ Tick #142    │ RPC 92%      │ MEV LOW      │ CPU 38%      │
 *   │ ████████░░   │ █████████░   │ ■■■■□□□□□□   │ ████░░░░░░   │
 *   │ Latency 41ms │ Block 23.5M  │ Sim PASS     │ RAM 142M     │
 *   │ ██████░░░░   │ TPS 0.12     │ Approval OK  │ DB 4.2M      │
 *   │ …            │ …            │ …            │ …            │
 *   └──────────────┴──────────────┴──────────────┴──────────────┘
 *
 * Each block groups metrics by category. Within a block, each metric
 * is a row with: label · value · state · bar (or segmented bar).
 */
export function SystemHealthPanel({ metrics, className }: SystemHealthPanelProps) {
  // Group metrics by category, preserving ENGINE/BLOCKCHAIN/SECURITY/SYSTEM order
  const groups = (["engine", "blockchain", "security", "system"] as const).map((cat) => ({
    cat,
    items: metrics.filter((m) => m.category === cat),
  }));

  return (
    <div className={cn("ws-panel ws-panel-l3 rounded-lg flex flex-col", className)}>
      <div className="ws-panel-header">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400 status-dot-pulse text-emerald-400" />
          <span className="ws-panel-title">System Health</span>
          <span className="ws-panel-subtitle">· {metrics.length} channels</span>
        </div>
        <span className="label-mono text-[9px] text-muted-foreground">LIVE</span>
      </div>

      <div className="ws-panel-body grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
        {groups.map(({ cat, items }) => {
          const meta = CATEGORY_META[cat];
          const Icon = meta.icon;
          return (
            <div
              key={cat}
              className={cn(
                "rounded-md border border-border/40 p-2.5 flex flex-col gap-1.5 bg-muted/10",
                meta.accentClass
              )}
            >
              <div className="flex items-center gap-1.5 pb-1 border-b border-border/40">
                <Icon className="size-3" style={{ color: "var(--accent)" }} />
                <span
                  className="label-mono text-[9px] font-bold tracking-[0.16em]"
                  style={{ color: "var(--accent)" }}
                >
                  {meta.label}
                </span>
              </div>

              {items.length === 0 ? (
                <div className="text-[10px] text-muted-foreground label-mono py-2 text-center">
                  —
                </div>
              ) : (
                items.map((m) => (
                  <MetricRow key={m.label} metric={m} />
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricRow({ metric }: { metric: SystemHealthMetric }) {
  const showBar = typeof metric.pct === "number";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-1">
        <span className="label-mono text-[9px] text-muted-foreground tracking-[0.10em] truncate">
          {metric.label}
        </span>
        <span
          className="label-mono text-[11px] font-bold tabular"
          style={{ color: "var(--accent, oklch(0.96 0.002 264))" }}
        >
          {metric.value}
        </span>
      </div>
      {showBar && (
        <div className="telemetry-bar" style={{ padding: 0 }}>
          <div className="telemetry-bar-track">
            <div
              className="telemetry-bar-fill"
              style={{ width: `${Math.max(0, Math.min(100, metric.pct ?? 0))}%` }}
            />
          </div>
          {metric.state && (
            <span className="telemetry-bar-state">{metric.state}</span>
          )}
        </div>
      )}
      {!showBar && metric.state && (
        <span
          className="label-mono text-[9px] font-semibold tracking-[0.10em]"
          style={{ color: "var(--accent, oklch(0.65 0.008 264))" }}
        >
          {metric.state}
        </span>
      )}
    </div>
  );
}
