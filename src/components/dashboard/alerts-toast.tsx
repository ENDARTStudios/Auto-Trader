"use client";

// AlertsToast — sticky toast notifications for real-time events from the
// SSE stream. Sits in the top-right corner of the dashboard.
//
// Behavior:
//   - Critical events (kill_switch, error, force-exit) stay until dismissed.
//   - Warning events auto-dismiss after 8s.
//   - Info events (position opened/closed, engine start) auto-dismiss after 5s.
//   - Last 5 toasts visible; older ones queue below.
//   - Click × to dismiss; click anywhere on the toast to expand the message.
//   - Color-coded by severity (red / amber / blue / green).
//   - Subtle slide-in animation via Tailwind.
//   - "LIVE" indicator in top-right shows SSE connection state (green=open,
//     amber=reconnecting, gray=closed).
//
// Mount ONCE at the dashboard root.

import { useEffect, useState, useCallback, useRef } from "react";
import { useEventStream, type StreamEvent, isCritical } from "@/hooks/use-event-stream";

interface ToastItem {
  ev: StreamEvent;
  id: number;
  expanded: boolean;
  autoDismissAt: number | null; // epoch ms; null = sticky
}

const MAX_VISIBLE = 5;

function toastAutoDismissMs(ev: StreamEvent): number | null {
  if (isCritical(ev)) return null; // sticky
  if (ev.level === "warn") return 8000;
  return 5000;
}

function toastColor(ev: StreamEvent): {
  border: string;
  bg: string;
  accent: string;
  icon: string;
} {
  if (ev.type === "kill_switch")
    return {
      border: "border-red-500",
      bg: "bg-red-950/95",
      accent: "text-red-300",
      icon: "🛑",
    };
  if (ev.level === "critical" || ev.level === "error")
    return {
      border: "border-red-500",
      bg: "bg-red-950/95",
      accent: "text-red-300",
      icon: "⚠",
    };
  if (ev.level === "warn")
    return {
      border: "border-amber-500",
      bg: "bg-amber-950/95",
      accent: "text-amber-300",
      icon: "▲",
    };
  // info
  switch (ev.type) {
    case "position":
      return {
        border: "border-emerald-500",
        bg: "bg-emerald-950/95",
        accent: "text-emerald-300",
        icon: "→",
      };
    case "engine":
      return {
        border: "border-sky-500",
        bg: "bg-sky-950/95",
        accent: "text-sky-300",
        icon: "◎",
      };
    default:
      return {
        border: "border-slate-500",
        bg: "bg-slate-900/95",
        accent: "text-slate-300",
        icon: "•",
      };
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export function AlertsToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenIds = useRef(new Set<number>());
  const [now, setNow] = useState(Date.now());

  // Tick every 1s for auto-dismiss checks
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const onEvent = useCallback((ev: StreamEvent) => {
    // Dedupe — never show the same event id twice
    if (seenIds.current.has(ev.id)) return;
    seenIds.current.add(ev.id);
    // Trim seen set to last 500 to avoid unbounded growth
    if (seenIds.current.size > 500) {
      seenIds.current = new Set(Array.from(seenIds.current).slice(-500));
    }

    const dismissMs = toastAutoDismissMs(ev);
    const item: ToastItem = {
      ev,
      id: ev.id,
      expanded: false,
      autoDismissAt: dismissMs ? Date.now() + dismissMs : null,
    };
    setToasts((prev) => [item, ...prev].slice(0, MAX_VISIBLE));
  }, []);

  const { readyState } = useEventStream({ onEvent, maxRecent: 50 });

  // Auto-dismiss expired toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const expired = toasts.some(
      (t) => t.autoDismissAt !== null && t.autoDismissAt <= now
    );
    if (expired) {
      setToasts((prev) =>
        prev.filter((t) => t.autoDismissAt === null || t.autoDismissAt > now)
      );
    }
  }, [now, toasts]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleExpand = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, expanded: !t.expanded } : t))
    );
  }, []);

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)] pointer-events-none">
      {/* Live indicator + clear-all */}
      <div className="flex justify-end items-center gap-3 mb-1 pointer-events-auto">
        <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-slate-900/80 backdrop-blur border border-slate-700">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              readyState === "open"
                ? "bg-emerald-400 animate-pulse"
                : readyState === "connecting"
                ? "bg-amber-400 animate-pulse"
                : "bg-slate-500"
            }`}
          />
          <span className="text-slate-300 font-mono">
            {readyState === "open"
              ? "LIVE"
              : readyState === "connecting"
              ? "RECONNECTING"
              : "OFFLINE"}
          </span>
        </div>
        {toasts.length > 0 && (
          <button
            onClick={clearAll}
            className="text-xs px-2 py-1 rounded bg-slate-900/80 backdrop-blur border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
            aria-label="Limpar todos os toasts"
          >
            Limpar ({toasts.length})
          </button>
        )}
      </div>

      {/* Toast stack */}
      {toasts.map((t) => {
        const colors = toastColor(t.ev);
        const isSticky = t.autoDismissAt === null;
        const context = t.ev.context;
        const hasContext = context && Object.keys(context).length > 0;

        return (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border-l-4 ${colors.border} ${colors.bg} backdrop-blur shadow-xl shadow-black/40 p-3 text-sm animate-[slideIn_0.2s_ease-out]`}
            role="alert"
          >
            <div className="flex items-start gap-2">
              <span className={`${colors.accent} text-base leading-none mt-0.5`}>
                {colors.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={`font-semibold ${colors.accent} cursor-pointer break-words`}
                    onClick={() => toggleExpand(t.id)}
                  >
                    {t.ev.title}
                  </div>
                  <button
                    onClick={() => dismiss(t.id)}
                    className="text-slate-400 hover:text-white transition-colors flex-shrink-0 -mt-0.5 -mr-0.5"
                    aria-label="Dispensar"
                  >
                    ✕
                  </button>
                </div>
                <div
                  className={`text-slate-200 mt-1 text-xs ${
                    t.expanded ? "" : "line-clamp-2"
                  }`}
                >
                  {t.ev.message}
                </div>
                {t.expanded && hasContext && (
                  <pre className="text-[10px] text-slate-400 mt-2 bg-black/30 rounded p-2 overflow-x-auto max-h-40">
                    {JSON.stringify(context, null, 2)}
                  </pre>
                )}
                <div className="flex items-center justify-between mt-1.5 text-[10px] text-slate-400">
                  <span className="font-mono">
                    [{t.ev.source}] {t.ev.type}
                  </span>
                  <span className="font-mono">{formatTimestamp(t.ev.timestamp)}</span>
                </div>
                {isSticky && (
                  <div className="mt-1 text-[10px] text-red-300 font-mono">
                    • requer ação •
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Inline style for slideIn animation (Tailwind has no built-in) */}
      <style jsx>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
