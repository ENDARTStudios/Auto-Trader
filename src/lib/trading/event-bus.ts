// In-memory event bus for real-time push to dashboard.
//
// Why in-memory?
//   The engine and the API route handlers run in the same Next.js server
//   process (verified: dev server on localhost:3000). An in-memory EventEmitter
//   is therefore sufficient for broadcasting events from the engine to all
//   connected SSE clients. No Redis / PubSub needed.
//
// What it does:
//   - Holds a ring buffer of the last N events (so a newly-connected SSE
//     client can immediately receive recent history, not just future events).
//   - Emits "event" for each new event pushed via pushEvent().
//   - The SSE route (/api/stream) subscribes via subscribe(), writes each
//     event to the client, and unsubscribes on disconnect.
//
// Event types pushed:
//   - "log"           — every warn/error log line (info+debug excluded to
//                       keep the channel high-signal)
//   - "alert"         — surveillance alerts (critical/warning severity)
//   - "position"      — position opened / closed
//   - "engine"        — engine state transitions (start/stop/killed/loop)
//   - "round"         — round started / ended
//   - "kill_switch"   — kill switch triggered (sticky toast)
//   - "scam_detected" — scam score below threshold (toast with score)

import { EventEmitter } from "events";

export type EventType =
  | "log"
  | "alert"
  | "position"
  | "engine"
  | "round"
  | "kill_switch"
  | "scam_detected"
  | "trade"
  | "market";

export interface BusEvent {
  id: number;            // monotonic per-process counter
  type: EventType;
  level: "info" | "warn" | "error" | "critical";
  source: string;        // logger source or subsystem name
  title: string;         // short headline (<=120 chars)
  message: string;       // human-readable detail
  context?: Record<string, unknown>;
  timestamp: string;     // ISO 8601
}

const MAX_BUFFER = 200;

class EventBus {
  private emitter = new EventEmitter();
  private buffer: BusEvent[] = [];
  private counter = 0;

  constructor() {
    // Allow many SSE listeners (one per open dashboard tab)
    this.emitter.setMaxListeners(100);
  }

  /**
   * Push a new event. Returns the assigned id.
   */
  push(opts: Omit<BusEvent, "id" | "timestamp">): BusEvent {
    const ev: BusEvent = {
      id: ++this.counter,
      timestamp: new Date().toISOString(),
      ...opts,
    };
    this.buffer.push(ev);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    }
    // Emit non-blocking — listeners (SSE routes) handle their own writes
    this.emitter.emit("event", ev);
    return ev;
  }

  /**
   * Subscribe to future events. Returns an unsubscribe function.
   */
  subscribe(
    onEvent: (ev: BusEvent) => void,
    opts?: { replayHistory?: boolean; historyLimit?: number }
  ): () => void {
    const handler = (ev: BusEvent) => {
      try {
        onEvent(ev);
      } catch (err) {
        // Never let a single bad listener break the bus
        console.error("[event-bus] listener error:", err);
      }
    };
    this.emitter.on("event", handler);

    if (opts?.replayHistory) {
      const limit = opts.historyLimit ?? 20;
      const slice = this.buffer.slice(-limit);
      // Defer to next tick so the subscribe call returns first
      setImmediate(() => {
        for (const ev of slice) {
          try {
            handler(ev);
          } catch {
            // ignore
          }
        }
      });
    }

    return () => {
      this.emitter.off("event", handler);
    };
  }

  /**
   * Return recent history (most recent first).
   */
  history(limit = 50): BusEvent[] {
    return this.buffer.slice(-limit).reverse();
  }

  /**
   * Current buffer length (for diagnostics).
   */
  size(): number {
    return this.buffer.length;
  }
}

// Singleton — must be module-level so it persists across requests in the
// same Node.js process. Next.js dev mode may reload modules; for production
// builds this is stable.
declare global {
  var __AUTO_TRADER_EVENT_BUS__: EventBus | undefined;
}

export const eventBus: EventBus =
  globalThis.__AUTO_TRADER_EVENT_BUS__ ?? new EventBus();

if (!globalThis.__AUTO_TRADER_EVENT_BUS__) {
  globalThis.__AUTO_TRADER_EVENT_BUS__ = eventBus;
}
