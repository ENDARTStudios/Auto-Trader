// Server-Sent Events (SSE) stream — pushes real-time events from the
// in-memory event bus to the dashboard client.
//
// Why SSE instead of WebSocket?
//   - One-way push (server → client) is all we need.
//   - Native EventSource API on the client auto-reconnects on disconnect.
//   - No upgrade handshake needed; works through any HTTP proxy.
//   - Trivially composable with Next.js route handlers.
//
// Endpoint: GET /api/stream
//
// Wire format (SSE):
//   event: event
//   data: {"id":7,"type":"position","level":"info","source":"engine","title":"...","message":"...","timestamp":"2026-07-13T..."}
//
//   event: heartbeat
//   data: {"ts": "2026-07-13T..."}
//
// The route:
//   1. Sets SSE headers (Content-Type, Cache-Control, Connection).
//   2. Sends an initial "hello" event so the client knows the stream is alive.
//   3. Replays the last 20 buffered events (so newly-connected clients see
//      recent activity immediately instead of waiting for the next event).
//   4. Subscribes to eventBus and writes each new event to the stream.
//   5. Sends a heartbeat every 15s to keep the connection alive (proxies
//      may close idle connections after 30-60s).
//   6. On client disconnect (req.signal.aborted), unsubscribes and closes.
//
// Edge runtime is disabled because we use the in-memory event bus singleton
// which lives in the Node.js process.

import { eventBus, type BusEvent } from "@/lib/trading/event-bus";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/stream");
    if (!rl.allowed) {
      return new Response("rate_limited", { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");
  } catch (err) {
    return handleApiError(err, "GET /api/stream");
  }
  // SSE headers
  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable nginx buffering
  });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const write = (eventName: string, payload: unknown) => {
        if (closed) return;
        try {
          const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          closed = true;
        }
      };

      // 1. Hello event — client knows stream is alive
      write("hello", {
        message: "SSE connected",
        serverTime: new Date().toISOString(),
        bufferSize: eventBus.size(),
      });

      // 2. Replay last 20 buffered events (most recent first → reverse)
      const history = eventBus.history(20).reverse();
      for (const ev of history) {
        write("event", ev);
      }

      // 3. Subscribe to future events
      const unsubscribe = eventBus.subscribe((ev: BusEvent) => {
        write("event", ev);
      });

      // 4. Heartbeat every 15s
      const heartbeat = setInterval(() => {
        if (closed) return;
        write("heartbeat", { ts: new Date().toISOString() });
      }, 15_000);

      // 5. Handle client disconnect
      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, { headers });
}
