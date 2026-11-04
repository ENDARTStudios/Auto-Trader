import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  type ChannelType,
  type TelegramConfig,
  type DiscordConfig,
  type WebhookConfig,
  type NotificationEventType,
} from "@/lib/trading/notifier";
import { logger } from "@/lib/trading/logger";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { assertOwner } from "@/lib/auth/rls";
import { withUserRls } from "@/lib/auth/rls-context";
import { handleApiError } from "@/lib/api/error-handler";

// PATCH /api/notifications/channels/[id] — update channel (name, config, events, enabled, throttleSec)
// DELETE /api/notifications/channels/[id] — delete channel

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requireSession(req);
    if (!hasPermission(session.role, "notifications:manage")) {
      throw new ForbiddenError("notifications:manage");
    }
    const { id } = await params;
    // RLS: only the owner (or super_admin) may read/update a channel.
    await assertOwner(session, "notificationChannel", id);
    // RLS nativo: leitura dentro do contexto do usuário (policy filtra ownerId).
    const existing = await withUserRls(session, (tx) =>
      tx.notificationChannel.findUnique({ where: { id } }),
    );
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = (await req.json()) as {
      name?: string;
      type?: ChannelType;
      config?: TelegramConfig | DiscordConfig | WebhookConfig;
      events?: NotificationEventType[];
      enabled?: boolean;
      throttleSec?: number;
    };

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.type !== undefined) {
      if (!["telegram", "discord", "webhook"].includes(body.type)) {
        return NextResponse.json(
          { error: `Invalid type: ${body.type}` },
          { status: 400 }
        );
      }
      updates.type = body.type;
    }
    if (body.config !== undefined) {
      // Validate config per type
      const t = (body.type ?? existing.type) as ChannelType;
      if (t === "telegram") {
        const c = body.config as TelegramConfig;
        if (!c.botToken || !c.chatId) {
          return NextResponse.json(
            { error: "Telegram requires botToken and chatId" },
            { status: 400 }
          );
        }
      } else if (t === "discord") {
        const c = body.config as DiscordConfig;
        if (!c.webhookUrl) {
          return NextResponse.json(
            { error: "Discord requires webhookUrl" },
            { status: 400 }
          );
        }
      } else if (t === "webhook") {
        const c = body.config as WebhookConfig;
        if (!c.url) {
          return NextResponse.json(
            { error: "Webhook requires url" },
            { status: 400 }
          );
        }
      }
      updates.config = JSON.stringify(body.config);
    }
    if (body.events !== undefined) {
      updates.events = JSON.stringify(body.events);
    }
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.throttleSec !== undefined) {
      updates.throttleSec = Math.max(0, body.throttleSec);
    }

    // RLS nativo: o UPDATE roda com app.user_id; a policy também barra
    // alteração de linha de outro owner (WITH CHECK).
    const updated = await withUserRls(session, (tx) =>
      tx.notificationChannel.update({
        where: { id },
        data: updates as never,
      }),
    );

    logger.info("api", `Canal atualizado: ${updated.name} (${updated.id})`);

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      type: updated.type,
      config: JSON.parse(updated.config),
      events: JSON.parse(updated.events),
      enabled: updated.enabled,
      throttleSec: updated.throttleSec,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") {
      return handleApiError(err, "PATCH /api/notifications/channels/[id]");
    }
    logger.error("api", `Erro atualizando channel: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to update channel" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const session = await requireSession(req);
    if (!hasPermission(session.role, "notifications:manage")) {
      throw new ForbiddenError("notifications:manage");
    }
    const { id } = await params;
    await assertOwner(session, "notificationChannel", id);
    const existing = await withUserRls(session, (tx) =>
      tx.notificationChannel.findUnique({ where: { id } }),
    );
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await withUserRls(session, (tx) => tx.notificationChannel.delete({ where: { id } }));
    logger.info("api", `Canal deletado: ${existing.name} (${id})`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).name === "UnauthorizedError" || (err as Error).name === "ForbiddenError") {
      return handleApiError(err, "DELETE /api/notifications/channels/[id]");
    }
    logger.error("api", `Erro deletando channel: ${String(err)}`);
    return NextResponse.json(
      { error: "Failed to delete channel" },
      { status: 500 }
    );
  }
}
