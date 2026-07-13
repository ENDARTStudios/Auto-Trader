import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  listChannels,
  ALL_EVENT_TYPES,
  type ChannelType,
  type NotificationEventType,
  type TelegramConfig,
  type DiscordConfig,
  type WebhookConfig,
} from "@/lib/trading/notifier";
import { logger } from "@/lib/trading/logger";

// GET /api/notifications/channels — list all channels
// POST /api/notifications/channels — create new channel
export async function GET() {
  try {
    const channels = await listChannels();
    return NextResponse.json({
      channels,
      eventTypes: ALL_EVENT_TYPES,
    });
  } catch (err) {
    logger.error("api", `Erro listando channels: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to list channels" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name?: string;
      type?: ChannelType;
      config?: TelegramConfig | DiscordConfig | WebhookConfig;
      events?: NotificationEventType[];
      enabled?: boolean;
      throttleSec?: number;
    };

    if (!body.name || !body.type || !body.config) {
      return NextResponse.json(
        { error: "Missing required fields: name, type, config" },
        { status: 400 }
      );
    }

    if (!["telegram", "discord", "webhook"].includes(body.type)) {
      return NextResponse.json(
        { error: `Invalid type: ${body.type}` },
        { status: 400 }
      );
    }

    // Validate config per type
    if (body.type === "telegram") {
      const c = body.config as TelegramConfig;
      if (!c.botToken || !c.chatId) {
        return NextResponse.json(
          { error: "Telegram requires botToken and chatId" },
          { status: 400 }
        );
      }
    } else if (body.type === "discord") {
      const c = body.config as DiscordConfig;
      if (!c.webhookUrl) {
        return NextResponse.json(
          { error: "Discord requires webhookUrl" },
          { status: 400 }
        );
      }
    } else if (body.type === "webhook") {
      const c = body.config as WebhookConfig;
      if (!c.url) {
        return NextResponse.json(
          { error: "Webhook requires url" },
          { status: 400 }
        );
      }
    }

    const events = body.events ?? [];
    const created = await db.notificationChannel.create({
      data: {
        name: body.name,
        type: body.type,
        config: JSON.stringify(body.config),
        events: JSON.stringify(events),
        enabled: body.enabled ?? true,
        throttleSec: Math.max(0, body.throttleSec ?? 0),
      },
    });

    logger.info("api", `Canal de notificação criado: ${created.name} (${created.type})`);

    return NextResponse.json({
      id: created.id,
      name: created.name,
      type: created.type,
      config: JSON.parse(created.config),
      events: JSON.parse(created.events),
      enabled: created.enabled,
      throttleSec: created.throttleSec,
      createdAt: created.createdAt,
    });
  } catch (err) {
    logger.error("api", `Erro criando channel: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to create channel" },
      { status: 500 }
    );
  }
}
