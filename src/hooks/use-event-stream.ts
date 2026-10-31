"use client";

// useEventStream — opens an SSE connection to /api/stream and exposes:
//   1. connection status (connecting | open | closed)
//   2. a rolling list of recent events (most recent first)
//   3. a callback registration API so individual components can react
//      to specific event types (kill_switch, position, alert, etc.)
//
// Why a global singleton?
//   Browsers limit the number of concurrent SSE connections per origin
//   (typically 6). The dashboard has many tabs/components that want
//   real-time events, but they must all share ONE EventSource.
//
// We achieve this via a module-level singleton + React context-free pub/sub:
//   - The hook guarantees only one EventSource exists per browser tab.
//   - Multiple components calling useEventStream() all subscribe to the
//     same singleton and receive the same events.
//
// Auto-reconnect: the native EventSource API reconnects automatically with
// exponential backoff. We also expose the readyState so the UI can show a
// "reconnecting…" indicator.

import { useEffect, useRef, useState, useCallback } from "react";

export interface StreamEvent {
  id: number;
  type:
    | "log"
    | "alert"
    | "position"
    | "engine"
    | "round"
    | "kill_switch"
    | "scam_detected"
    | "trade"
    | "market";
  level: "info" | "warn" | "error" | "critical";
  source: string;
  title: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

type ReadyState = "connecting" | "open" | "closed";

type Listener = (ev: StreamEvent) => void;

const MAX_RECENT = 100;

// ----------------------------------------------------------------------------
// Module-level singleton — shared across all hook callers in the same tab
// ----------------------------------------------------------------------------
let sharedSource: EventSource | null = null;
let sharedReadyState: ReadyState = "closed";
let sharedRecent: StreamEvent[] = [];
const listeners = new Set<Listener>();
const readyListeners = new Set<(s: ReadyState) => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function setReadyState(s: ReadyState) {
  sharedReadyState = s;
  readyListeners.forEach((fn) => fn(s));
}

function dispatch(ev: StreamEvent) {
  sharedRecent = [ev, ...sharedRecent].slice(0, MAX_RECENT);
  listeners.forEach((fn) => {
    try {
      fn(ev);
    } catch {
      // ignore listener errors
    }
  });
}

function connect() {
  if (sharedSource) {
    try {
      sharedSource.close();
    } catch {
      // ignore
    }
  }
  setReadyState("connecting");
  try {
    const source = new EventSource("/api/stream");
    sharedSource = source;

    source.addEventListener("hello", () => {
      setReadyState("open");
    });

    source.addEventListener("event", (raw) => {
      try {
        const ev = JSON.parse((raw as MessageEvent).data) as StreamEvent;
        dispatch(ev);
      } catch {
        // ignore malformed event
      }
    });

    source.addEventListener("open", () => {
      setReadyState("open");
    });

    source.addEventListener("error", () => {
      setReadyState("closed");
      // EventSource auto-reconnects, but if readyState === CLOSED (2),
      // we need to manually retry after backoff.
      try {
        if (source.readyState === 2) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 3000);
        }
      } catch {
        // ignore
      }
    });
  } catch {
    setReadyState("closed");
  }
}

function ensureConnected() {
  if (!sharedSource && !reconnectTimer) {
    connect();
  }
}

// ----------------------------------------------------------------------------
// React hook
// ----------------------------------------------------------------------------
export function useEventStream(opts?: {
  onEvent?: (ev: StreamEvent) => void;
  maxRecent?: number;
}): {
  readyState: ReadyState;
  recent: StreamEvent[];
  reconnect: () => void;
} {
  const [readyState, setReadyStateLocal] = useState<ReadyState>(sharedReadyState);
  const [recent, setRecent] = useState<StreamEvent[]>(
    opts?.maxRecent ? sharedRecent.slice(0, opts.maxRecent) : sharedRecent
  );
  const onEventRef = useRef(opts?.onEvent);
  useEffect(() => {
    onEventRef.current = opts?.onEvent;
  }, [opts?.onEvent]);

  useEffect(() => {
    ensureConnected();

    const onEv: Listener = (ev) => {
      onEventRef.current?.(ev);
      setRecent((prev) => [ev, ...prev].slice(0, opts?.maxRecent ?? MAX_RECENT));
    };
    const onReady = (s: ReadyState) => setReadyStateLocal(s);

    listeners.add(onEv);
    readyListeners.add(onReady);

    // Sync local state with shared state immediately
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReadyStateLocal(sharedReadyState);
    setRecent(sharedRecent.slice(0, opts?.maxRecent ?? MAX_RECENT));

    return () => {
      listeners.delete(onEv);
      readyListeners.delete(onReady);
    };
  }, [opts?.maxRecent]);

  const reconnect = useCallback(() => {
    connect();
  }, []);

  return { readyState, recent, reconnect };
}

// ----------------------------------------------------------------------------
// Convenience: filter helpers
// ----------------------------------------------------------------------------
export function isCritical(ev: StreamEvent): boolean {
  return ev.level === "critical" || ev.level === "error" || ev.type === "kill_switch";
}

export function severityRank(ev: StreamEvent): number {
  switch (ev.level) {
    case "critical":
      return 4;
    case "error":
      return 3;
    case "warn":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}
