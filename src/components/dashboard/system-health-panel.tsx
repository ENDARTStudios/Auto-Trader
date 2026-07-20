"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface HardeningLayerMetric {
  label: string;
  /** 0-100 — drives the bar fill */
  pct: number;
  /** Short qualitative state, e.g. "PASS", "HEALTHY", "LOW" */
  state: string;
  /** Optional detail line under the bar */
  detail?: string;
}

export interface HardeningLayer {
  /** Layer ID — H0, H1, H2, H2.6, M3, M4 */
  id: string;
  /** Display title — "H0 · KEY LIFECYCLE" etc. */
  title: string;
  /** Short tag — "KDF / AUDIT / ROTATION" */
  tag: string;
  /** Accent class — buy / warn / chain / sell / neutral */
  accent: "buy" | "warn" | "chain" | "sell" | "ai" | "neutral";
  metrics: HardeningLayerMetric[];
}

interface SystemHealthPanelProps {
  layers: HardeningLayer[];
  className?: string;
}

const ACCENT_VAR: Record<HardeningLayer["accent"], string> = {
  buy: "var(--color-buy)",
  warn: "var(--color-warn)",
  chain: "var(--color-chain)",
  sell: "var(--color-sell)",
  ai: "var(--color-ai)",
  neutral: "oklch(0.7 0.008 264)",
};

/**
 * SystemHealthPanel — explicit hardening-layer reflection (H0/H1/H2/M3/M4).
 *
 * Per operator spec: "Excelente oportunidade para refletir H0/H1/H2."
 *
 * Each block = one hardening layer with progress bars showing the
 * health of each sub-component (KDF, AUDIT, ROTATION for H0, etc.).
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │ System Health · 5 layers                             │
 *   ├──────────────────┬──────────────────┬────────────────┤
 *   │ H0 · KEY LIFECYCLE│ H1 · RPC RESIL.  │ H2 · VERIFY    │
 *   │ KDF   ████  100%  │ RPC    ████  92% │ LIQ    ███ 82% │
 *   │ AUDIT █████ 100%  │ SIM    ████  94% │ AUTH   ████100%│
 *   │ ROT   █████ 100%  │ APPROV ████  94% │ SELLSIM ███ 88%│
 *   └──────────────────┴──────────────────┴────────────────┘
 */
export function SystemHealthPanel({ layers, className }: SystemHealthPanelProps) {
  return (
    <div className={cn("ws-panel ws-panel-l3 rounded-lg flex flex-col", className)}>
      <div className="ws-panel-header">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400 status-dot-pulse text-emerald-400" />
          <span className="ws-panel-title">System Health</span>
          <span className="ws-panel-subtitle">· {layers.length} hardening layers</span>
        </div>
        <span className="label-mono text-[9px] text-muted-foreground">LIVE</span>
      </div>

      <div className="ws-panel-body grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 flex-1 overflow-y-auto" style={{ maxHeight: 360 }}>
        {layers.length === 0 ? (
          <div className="col-span-full text-center text-[11px] text-muted-foreground label-mono py-8">
            Sem dados de hardening.
          </div>
        ) : (
          layers.map((layer) => {
            const color = ACCENT_VAR[layer.accent];
            return (
              <div
                key={layer.id}
                className="hardening-block"
                style={{ ["--accent" as string]: color } as React.CSSProperties}
              >
                <div className="hardening-block-header">
                  <span className="hardening-block-title">{layer.title}</span>
                  <span className="hardening-block-tag">{layer.tag}</span>
                </div>
                <div className="hardening-bar">
                  {layer.metrics.map((m) => (
                    <div key={m.label} className="hardening-bar-row">
                      <span className="hardening-bar-label">{m.label}</span>
                      <div className="hardening-bar-track">
                        <div
                          className="hardening-bar-fill"
                          style={{ width: `${Math.max(0, Math.min(100, m.pct))}%` }}
                        />
                      </div>
                      <span className="hardening-bar-pct">
                        {Math.round(m.pct)}%
                      </span>
                      <span className="hardening-bar-state">{m.state}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
