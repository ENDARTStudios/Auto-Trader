import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyStripeWebhook } from "@/lib/billing/stripe-hmac";
import { checkoutSessionGrantsAccess, isActiveSubscriptionStatus, planFromMetadata, STRIPE_CUSTOMER_PREFIX, stripeCustomerKey, userIdFromCustomerKey } from "@/lib/billing/subscription-state";
import { logger } from "@/lib/trading/logger";
import { eventBus } from "@/lib/trading/event-bus";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

/** Descobre o userId a partir do customer do Stripe (flag gravada no checkout). */
async function userIdForCustomer(customer: string | undefined): Promise<string | null> {
  if (!customer) return null;
  const flag = await db.featureFlag
    .findFirst({ where: { key: { startsWith: STRIPE_CUSTOMER_PREFIX }, description: customer } })
    .catch(() => null);
  return flag ? userIdFromCustomerKey(flag.key) : null;
}

// POST /api/webhooks/stripe
// Stripe sends signed events here. We verify HMAC + persist idempotently.
export async function POST(req: NextRequest) {
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ error: "missing_signature" }, { status: 400 });
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      logger.error("api", "STRIPE_WEBHOOK_SECRET not configured");
      return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
    }

    const rawBody = await req.text();
    const result = verifyStripeWebhook({ payload: rawBody, header: sig, secret });
    if (!result.valid) {
      logger.warn("api", "Stripe webhook signature failed", { reason: result.reason });
      return NextResponse.json({ error: "invalid_signature", reason: result.reason }, { status: 400 });
    }

    const event = JSON.parse(rawBody) as {
      id: string;
      type: string;
      data?: {
        object?: {
          id?: string;
          customer?: string;
          status?: string;
          payment_status?: string;
          metadata?: Record<string, string>;
        };
      };
    };

    // Idempotency: skip if event.id already processed
    if (event.id) {
      const seen = await db.appLog
        .findFirst({ where: { source: "stripe-webhook", message: { contains: event.id } } })
        .catch(() => null);
      if (seen) {
        return NextResponse.json({ ok: true, idempotent: true });
      }
    }

    switch (event.type) {
      // Checkout concluído: o objeto é a Session (status "complete"), não a
      // subscription. Marcar enabled pelo status da sessão deixava o plano
      // "pro" com enabled=false quando este evento chegava depois do
      // subscription.created. Aqui o critério é o pagamento.
      case "checkout.session.completed": {
        const session = event.data?.object;
        if (session?.customer && session?.metadata?.userId) {
          const paid = checkoutSessionGrantsAccess(session);
          await db.featureFlag.upsert({
            where: { key: `subscription:${session.metadata.userId}` },
            create: {
              key: `subscription:${session.metadata.userId}`,
              description: planFromMetadata(session.metadata),
              enabled: paid,
              rolloutPct: 100,
            },
            update: { description: planFromMetadata(session.metadata), enabled: paid },
          }).catch(() => null);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data?.object;
        const active = isActiveSubscriptionStatus(sub?.status);
        if (sub?.customer && sub?.metadata?.userId) {
          await db.featureFlag.upsert({
            where: { key: `subscription:${sub.metadata.userId}` },
            create: {
              key: `subscription:${sub.metadata.userId}`,
              description: planFromMetadata(sub.metadata),
              enabled: active,
              rolloutPct: 100,
            },
            update: { description: planFromMetadata(sub.metadata), enabled: active },
          }).catch(() => null);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data?.object;
        if (sub?.customer && sub?.metadata?.userId) {
          await db.featureFlag.upsert({
            where: { key: `subscription:${sub.metadata.userId}` },
            create: {
              key: `subscription:${sub.metadata.userId}`,
              description: "free",
              enabled: false,
              rolloutPct: 0,
            },
            update: { description: "free", enabled: false },
          }).catch(() => null);
        }
        break;
      }
      // Falha de cobrança: revoga acesso na hora, sem esperar o
      // customer.subscription.updated (que pode vir com atraso).
      case "invoice.payment_failed": {
        const invoice = event.data?.object;
        const userId = await userIdForCustomer(invoice?.customer);
        if (userId) {
          const existing = await db.featureFlag
            .findFirst({ where: { key: `subscription:${userId}` } })
            .catch(() => null);
          await db.featureFlag
            .upsert({
              where: { key: `subscription:${userId}` },
              create: {
                key: `subscription:${userId}`,
                description: existing?.description ?? "pro",
                enabled: false,
                rolloutPct: 100,
              },
              update: { enabled: false },
            })
            .catch(() => null);
        }
        logger.warn("api", "Stripe invoice.payment_failed", { id: event.id, customer: invoice?.customer });
        break;
      }
      // Cobrança recuperada: devolve acesso (o subscription.updated mantém depois).
      case "invoice.payment_succeeded": {
        const invoice = event.data?.object;
        const userId = await userIdForCustomer(invoice?.customer);
        if (userId) {
          await db.featureFlag
            .updateMany({ where: { key: `subscription:${userId}` }, data: { enabled: true } })
            .catch(() => null);
        }
        break;
      }
      default:
        logger.info("api", "Stripe webhook unhandled event", { type: event.type, id: event.id });
    }

    // Persist for idempotency
    if (event.id) {
      await db.appLog.create({
        data: {
          level: "info",
          source: "stripe-webhook",
          message: event.id,
          context: JSON.stringify({ type: event.type }),
        },
      }).catch(() => null);
    }

    return NextResponse.json({ ok: true, received: event.type });
  } catch (err) {
    // Falha de processamento de cobrança é crítica: além do log, publica no
    // barramento para aparecer no Activity/SSE do operador.
    const message = err instanceof Error ? err.message : String(err);
    logger.error("api", "Stripe webhook falhou", { message });
    eventBus.push({
      type: "alert",
      level: "error",
      source: "stripe-webhook",
      title: "Falha ao processar webhook do Stripe",
      message: message.slice(0, 200),
    });
    return handleApiError(err, "POST /api/webhooks/stripe");
  }
}
