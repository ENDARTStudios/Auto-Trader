import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ALL_EVENT_TYPES,
  type ChannelType,
  type NotificationEventType,
  type TelegramConfig,
  type DiscordConfig,
  type WebhookConfig,
} from "@/lib/trading/notifier";
import { logger } from "@/lib/trading/logger";
import { requirePermission } from "@/lib/auth/session";
import { rlsWhere } from "@/lib/auth/rls";
import { withUserRls } from "@/lib/auth/rls-context";
import { handleApiError } from "@/lib/api/error-handler";

// GET /api/notifications/channels — list channels (RLS: own channels, or all
// for super_admin)
// POST /api/notifications/channels — create new channel (owned by the caller)
export async function GET(req: Request) {
  try {
    const session = await requirePermission("notifications:manage")(req);
    // RLS nativo: a transação carrega app.user_id/app.rls_bypass; a policy do
    // Postgres filtra por ownerId (super_admin = bypass). O where rlsWhere
    // continua como defesa em profundidade na camada de aplicação.
    const rows = await withUserRls(session, (tx) =>
      tx.notificationChannel.findMany({
        where: rlsWhere(session, "notificationChannel"),
        orderBy: { createdAt: "asc" },
      }),
    );
    const channels = rows
      .map((row) => {
        try {
          return {
            id: row.id,
            name: row.name,
            type: row.type,
            config: JSON.parse(row.config),
            events: JSON.parse(row.events),
            enabled: row.enabled,
            throttleSec: row.throttleSec,
          };
        } catch {
          return null;
        }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    return NextResponse.json({
      channels,
      eventTypes: ALL_EVENT_TYPES,
    });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") {
      return handleApiError(err, "GET /api/notifications/channels");
    }
    logger.error("api", `Erro listando channels: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to list channels" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission("notifications:manage")(req);
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
    const created = await withUserRls(session, (tx) =>
      tx.notificationChannel.create({
        data: {
          name: body.name!,
          type: body.type!,
          config: JSON.stringify(body.config),
          events: JSON.stringify(events),
          enabled: body.enabled ?? true,
          throttleSec: Math.max(0, body.throttleSec ?? 0),
          ownerId: session.userId,
        },
      }),
    );
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
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") {
      return handleApiError(err, "POST /api/notifications/channels");
    }
    logger.error("api", `Erro criando channel: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to create channel" },
      { status: 500 }
    );
  }
}
