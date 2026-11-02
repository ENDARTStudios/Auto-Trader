"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type LiveStatus = "connecting" | "live" | "polling";

interface BusEvent {
  id?: number;
  type?: string;
  level?: string;
  source?: string;
  title?: string;
  message?: string;
  timestamp?: string;
}

export interface LiveEvent {
  id: string;
  type?: string;
  level?: string;
  title?: string;
  message?: string;
  source?: string;
  at: string;
}

const EMPTY: LiveEvent[] = [];
let feed: LiveEvent[] = EMPTY;
const feedListeners = new Set<() => void>();

function emit(event: LiveEvent) {
  feed = [event, ...feed].slice(0, 20);
  feedListeners.forEach((l) => l());
}
function subscribeFeed(cb: () => void) {
  feedListeners.add(cb);
  return () => {
    feedListeners.delete(cb);
  };
}

/** Últimos eventos recebidos pelo SSE, mais recente primeiro. */
export function useLiveFeed(): LiveEvent[] {
  return useSyncExternalStore(subscribeFeed, () => feed, () => EMPTY);
}

const INVALIDATE_BY_TYPE: Record<string, string[]> = {
  position: ["positions", "analytics", "status", "rounds"],
  trade: ["positions", "analytics", "status", "rounds"],
  kill_switch: ["config", "status", "positions", "risk-scale"],
  risk: ["config", "risk-scale", "status"],
  engine: ["status", "rounds", "config"],
  system: ["status"],
};

/**
 * Assina /api/stream (SSE) e invalida os caches afetados por cada evento.
 * Se o stream cair, as telas continuam funcionando pelo polling normal; o
 * estado vira "polling" e o EventSource tenta reconectar sozinho.
 */
export function useLiveEvents() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [last, setLast] = useState<BusEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    const es = new EventSource("/api/stream");
    let closed = false;

    const goLive = () => {
      if (!closed) setStatus("live");
    };

    es.addEventListener("hello", goLive);

    es.addEventListener("event", (raw) => {
      if (closed) return;
      let event: BusEvent;
      try {
        event = JSON.parse((raw as MessageEvent<string>).data) as BusEvent;
      } catch {
        return;
      }
      setStatus("live");
      setLast(event);
      emit({
        id: `ev-${event.id ?? Date.now()}`,
        type: event.type,
        level: event.level,
        title: event.title,
        message: event.message,
        source: event.source,
        at: event.timestamp ?? new Date().toISOString(),
      });

      const keys = INVALIDATE_BY_TYPE[event.type ?? ""] ?? ["status", "positions", "rounds"];
      for (const key of keys) {
        void qc.invalidateQueries({ queryKey: ["mrd", key] });
      }
    });

    es.onerror = () => {
      if (closed) return;
      setStatus("polling");
      // EventSource reconnects automaticamente; o polling segue como fallback.
    };

    return () => {
      closed = true;
      es.close();
    };
  }, [qc]);

  return { status, last };
}
