// External notification dispatcher.
//
// Channels (Telegram / Discord / generic webhook) are stored in the
// NotificationChannel table. Each channel subscribes to a set of event types
// (kill_switch_on, position_opened, etc.). When the engine emits an event,
// notifyEvent() iterates over enabled channels whose `events` array contains
// the eventType, and dispatches the message via the channel's transport.
//
// All dispatches are fire-and-forget from the engine's perspective: failures
// are logged to NotificationLog but never block the engine tick.
//
// Per-channel throttle: if a channel has throttleSec > 0, only 1 message per
// eventType per throttleSec window is sent (further messages within the window
// are silently dropped, but a "throttled" NotificationLog row is written).

import { db } from "@/lib/db";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationEventType =
  | "kill_switch_on"
  | "kill_switch_off"
  | "position_opened"
  | "position_closed"
  | "drawdown_breach"
  | "daily_loss_breach"
  | "graduation"
  | "engine_started"
  | "engine_stopped";

export type ChannelType = "telegram" | "discord" | "webhook";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface DiscordConfig {
  webhookUrl: string;
}

export interface WebhookConfig {
  url: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
}

export interface NotificationChannelRow {
  id: string;
  name: string;
  type: ChannelType;
  config: TelegramConfig | DiscordConfig | WebhookConfig;
  events: NotificationEventType[];
  enabled: boolean;
  throttleSec: number;
}

export interface NotifyPayload {
  eventType: NotificationEventType;
  title: string;
  message: string;
  // Optional structured context — included in webhook payloads as JSON body
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// In-memory throttle tracker (per channel per event type)
//   key: `${channelId}:${eventType}` -> last-sent epoch ms
// ---------------------------------------------------------------------------

const lastSentAt = new Map<string, number>();

// ---------------------------------------------------------------------------
// Helpers — parse / serialize channel rows
// ---------------------------------------------------------------------------

function parseChannel(row: {
  id: string;
  name: string;
  type: string;
  config: string;
  events: string;
  enabled: boolean;
  throttleSec: number;
}): NotificationChannelRow | null {
  try {
    let config: TelegramConfig | DiscordConfig | WebhookConfig;
    try {
      config = JSON.parse(row.config);
    } catch {
      return null;
    }
    let events: NotificationEventType[];
    try {
      events = JSON.parse(row.events);
    } catch {
      events = [];
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type as ChannelType,
      config,
      events,
      enabled: row.enabled,
      throttleSec: row.throttleSec,
    };
  } catch {
    return null;
  }
}

export async function listChannels(): Promise<NotificationChannelRow[]> {
  const rows = await db.notificationChannel.findMany({
    orderBy: { createdAt: "asc" },
  });
  return rows
    .map(parseChannel)
    .filter((c): c is NotificationChannelRow => c !== null);
}

export async function getChannel(id: string): Promise<NotificationChannelRow | null> {
  const row = await db.notificationChannel.findUnique({ where: { id } });
  if (!row) return null;
  return parseChannel(row);
}

// ---------------------------------------------------------------------------
// Transports — one function per channel type. Each returns
// { status: "sent" | "failed", error?: string, durationMs: number }.
// ---------------------------------------------------------------------------

interface DispatchResult {
  status: "sent" | "failed";
  error?: string;
  durationMs: number;
}

async function sendTelegram(
  cfg: TelegramConfig,
  text: string
): Promise<DispatchResult> {
  const start = Date.now();
  try {
    if (!cfg.botToken || !cfg.chatId) {
      return { status: "failed", error: "Missing botToken or chatId", durationMs: 0 };
    }
    const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      // Don't hang the engine if Telegram is slow
      signal: AbortSignal.timeout(10_000),
    });
    const durationMs = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        status: "failed",
        error: `Telegram API ${res.status}: ${body.slice(0, 300)}`,
        durationMs,
      };
    }
    // Telegram returns 200 even for "ok: false" payloads
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      return {
        status: "failed",
        error: `Telegram ok=false: ${json.description ?? "unknown"}`,
        durationMs,
      };
    }
    return { status: "sent", durationMs };
  } catch (err) {
    return {
      status: "failed",
      error: String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function sendDiscord(
  cfg: DiscordConfig,
  text: string
): Promise<DispatchResult> {
  const start = Date.now();
  try {
    if (!cfg.webhookUrl) {
      return { status: "failed", error: "Missing webhookUrl", durationMs: 0 };
    }
    const res = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Discord caps content at 2000 chars — truncate to be safe
        content: text.length > 1990 ? text.slice(0, 1990) + "…" : text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const durationMs = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        status: "failed",
        error: `Discord webhook ${res.status}: ${body.slice(0, 300)}`,
        durationMs,
      };
    }
    return { status: "sent", durationMs };
  } catch (err) {
    return {
      status: "failed",
      error: String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function sendWebhook(
  cfg: WebhookConfig,
  payload: NotifyPayload
): Promise<DispatchResult> {
  const start = Date.now();
  try {
    if (!cfg.url) {
      return { status: "failed", error: "Missing url", durationMs: 0 };
    }
    const method = cfg.method ?? "POST";
    const res = await fetch(cfg.url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cfg.headers ?? {}),
      },
      body: JSON.stringify({
        eventType: payload.eventType,
        title: payload.title,
        message: payload.message,
        context: payload.context ?? {},
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const durationMs = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        status: "failed",
        error: `Webhook ${res.status}: ${body.slice(0, 300)}`,
        durationMs,
      };
    }
    return { status: "sent", durationMs };
  } catch (err) {
    return {
      status: "failed",
      error: String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Public API — notifyEvent() called by engine / kill-switch handler.
// ---------------------------------------------------------------------------

/**
 * Dispatch a notification event to all subscribed channels.
 * Fire-and-forget: never throws.
 */
export async function notifyEvent(payload: NotifyPayload): Promise<void> {
  let channels: NotificationChannelRow[];
  try {
    channels = await listChannels();
  } catch (err) {
    logger.warn("notifier", `Erro carregando canais: ${String(err)}`);
    return;
  }

  const subscribed = channels.filter(
    (c) => c.enabled && c.events.includes(payload.eventType)
  );

  if (subscribed.length === 0) return;

  // Format the message body once (Telegram/Discord use plain text)
  const body = formatMessage(payload);

  for (const ch of subscribed) {
    // Throttle check
    const throttleKey = `${ch.id}:${payload.eventType}`;
    if (ch.throttleSec > 0) {
      const last = lastSentAt.get(throttleKey) ?? 0;
      const elapsed = (Date.now() - last) / 1000;
      if (elapsed < ch.throttleSec) {
        // Drop but log
        try {
          await db.notificationLog.create({
            data: {
              channelId: ch.id,
              channelName: ch.name,
              channelType: ch.type,
              eventType: payload.eventType,
              message: `[throttled] ${body}`,
              status: "failed",
              error: `Throttled (last sent ${elapsed.toFixed(1)}s ago, min interval ${ch.throttleSec}s)`,
              durationMs: 0,
            },
          });
        } catch {
          // ignore
        }
        continue;
      }
    }

    // Dispatch
    let result: DispatchResult;
    try {
      if (ch.type === "telegram") {
        result = await sendTelegram(ch.config as TelegramConfig, body);
      } else if (ch.type === "discord") {
        result = await sendDiscord(ch.config as DiscordConfig, body);
      } else if (ch.type === "webhook") {
        result = await sendWebhook(ch.config as WebhookConfig, payload);
      } else {
        result = {
          status: "failed",
          error: `Unknown channel type: ${ch.type}`,
          durationMs: 0,
        };
      }
    } catch (err) {
      result = { status: "failed", error: String(err), durationMs: 0 };
    }

    if (result.status === "sent") {
      lastSentAt.set(throttleKey, Date.now());
    }

    // Log the attempt
    try {
      await db.notificationLog.create({
        data: {
          channelId: ch.id,
          channelName: ch.name,
          channelType: ch.type,
          eventType: payload.eventType,
          message: body,
          status: result.status,
          error: result.error,
          durationMs: result.durationMs,
        },
      });
    } catch {
      // ignore log failure
    }
  }

  // Trim notification logs to last 5,000 rows
  try {
    const total = await db.notificationLog.count();
    if (total > 5000) {
      const excess = total - 5000;
      // Find the id threshold
      const cutoff = await db.notificationLog.findFirst({
        orderBy: { id: "asc" },
        skip: excess,
      });
      if (cutoff) {
        await db.notificationLog.deleteMany({
          where: { id: { lt: cutoff.id } },
        });
      }
    }
  } catch {
    // ignore trim failure
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatMessage(p: NotifyPayload): string {
  const emoji = emojiFor(p.eventType);
  const lines = [
    `${emoji} *${p.title}*`,
    ``,
    p.message,
  ];
  if (p.context && Object.keys(p.context).length > 0) {
    lines.push(``);
    for (const [k, v] of Object.entries(p.context)) {
      const sv = typeof v === "object" ? JSON.stringify(v) : String(v);
      const truncated = sv.length > 120 ? sv.slice(0, 120) + "…" : sv;
      lines.push(`• ${k}: ${truncated}`);
    }
  }
  lines.push(``);
  lines.push(`_${new Date().toISOString()}_`);
  return lines.join("\n");
}

function emojiFor(t: NotificationEventType): string {
  switch (t) {
    case "kill_switch_on":
      return "🛑";
    case "kill_switch_off":
      return "✅";
    case "position_opened":
      return "🟢";
    case "position_closed":
      return "🔵";
    case "drawdown_breach":
      return "📉";
    case "daily_loss_breach":
      return "⚠️";
    case "graduation":
      return "🎓";
    case "engine_started":
      return "▶️";
    case "engine_stopped":
      return "⏹️";
    default:
      return "🔔";
  }
}

/**
 * Send a test notification through a specific channel (used by the "Test"
 * button in the UI). Bypasses the events subscription check.
 */
export async function sendTestNotification(
  channel: NotificationChannelRow
): Promise<DispatchResult> {
  const testPayload: NotifyPayload = {
    eventType: "position_closed", // any valid type works for test
    title: "Teste de Notificação",
    message: `Canal "${channel.name}" (${channel.type}) está funcionando. Este é um teste manual disparado pelo dashboard.`,
    context: { channelName: channel.name, channelType: channel.type, test: true },
  };
  const body = formatMessage(testPayload);

  if (channel.type === "telegram") {
    return sendTelegram(channel.config as TelegramConfig, body);
  } else if (channel.type === "discord") {
    return sendDiscord(channel.config as DiscordConfig, body);
  } else if (channel.type === "webhook") {
    return sendWebhook(channel.config as WebhookConfig, testPayload);
  }
  return {
    status: "failed",
    error: `Unknown channel type: ${channel.type}`,
    durationMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Helper — list all available event types (for UI)
// ---------------------------------------------------------------------------

export const ALL_EVENT_TYPES: {
  value: NotificationEventType;
  label: string;
  description: string;
}[] = [
  { value: "kill_switch_on", label: "Kill Switch Ativado", description: "Circuit breaker disparou" },
  { value: "kill_switch_off", label: "Kill Switch Desativado", description: "Circuit breaker resetado manualmente" },
  { value: "position_opened", label: "Posição Aberta", description: "Nova posição comprada" },
  { value: "position_closed", label: "Posição Fechada", description: "Posição fechada (TP/SL/timeout)" },
  { value: "drawdown_breach", label: "Drawdown Atingido", description: "Queda do pico excedeu limite" },
  { value: "daily_loss_breach", label: "Perda Diária Atingida", description: "Perda do dia excedeu limite" },
  { value: "graduation", label: "Graduação Paper → Live", description: "Bot completou ciclos paper" },
  { value: "engine_started", label: "Engine Iniciada", description: "Loop principal started" },
  { value: "engine_stopped", label: "Engine Parada", description: "Loop principal parado" },
];
