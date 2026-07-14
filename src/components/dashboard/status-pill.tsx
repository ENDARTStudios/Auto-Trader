"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type StatusKind = "running" | "stopped" | "killed" | "paused" | "live" | "paper";

interface StatusPillProps {
  kind: StatusKind;
  label?: string;
  className?: string;
  pulse?: boolean;
}

const kindConfig: Record<
  StatusKind,
  { dotClass: string; textClass: string; bgClass: string; glowClass: string; defaultLabel: string }
> = {
  running: {
    dotClass: "bg-emerald-400",
    textClass: "text-emerald-300",
    bgClass: "bg-emerald-500/10 border-emerald-500/30",
    glowClass: "glow-emerald",
    defaultLabel: "RUNNING",
  },
  stopped: {
    dotClass: "bg-zinc-500",
    textClass: "text-zinc-400",
    bgClass: "bg-zinc-500/10 border-zinc-500/30",
    glowClass: "",
    defaultLabel: "STOPPED",
  },
  killed: {
    dotClass: "bg-red-500",
    textClass: "text-red-300",
    bgClass: "bg-red-500/15 border-red-500/40",
    glowClass: "glow-red",
    defaultLabel: "KILLED",
  },
  paused: {
    dotClass: "bg-amber-400",
    textClass: "text-amber-300",
    bgClass: "bg-amber-500/10 border-amber-500/30",
    glowClass: "glow-amber",
    defaultLabel: "PAUSED",
  },
  live: {
    dotClass: "bg-red-500",
    textClass: "text-red-300",
    bgClass: "bg-red-500/15 border-red-500/40",
    glowClass: "glow-red",
    defaultLabel: "LIVE",
  },
  paper: {
    dotClass: "bg-cyan-400",
    textClass: "text-cyan-300",
    bgClass: "bg-cyan-500/10 border-cyan-500/30",
    glowClass: "",
    defaultLabel: "PAPER",
  },
};

/**
 * Compact status pill — used in the dashboard header.
 * Combines a small pulsing dot with a label-mono uppercase label.
 */
export function StatusPill({
  kind,
  label,
  className,
  pulse = kind === "running" || kind === "live" || kind === "killed",
}: StatusPillProps) {
  const cfg = kindConfig[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded border label-mono text-[10px] font-medium",
        cfg.bgClass,
        cfg.textClass,
        className
      )}
    >
      <span className="relative inline-flex">
        <span className={cn("size-1.5 rounded-full", cfg.dotClass)} />
        {pulse && (
          <span
            className={cn(
              "absolute inset-0 rounded-full animate-ping",
              cfg.dotClass,
              "opacity-75"
            )}
          />
        )}
      </span>
      {label ?? cfg.defaultLabel}
    </span>
  );
}
