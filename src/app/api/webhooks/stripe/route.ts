import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyStripeWebhook } from "@/lib/billing/stripe-hmac";
import { logger } from "@/lib/trading/logger";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

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
      data?: { object?: { id?: string; customer?: string; status?: string; metadata?: Record<string, string> } };
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
      case "checkout.session.completed":
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data?.object;
        if (sub?.customer && sub?.metadata?.userId) {
          await db.featureFlag.upsert({
            where: { key: `subscription:${sub.metadata.userId}` },
            create: {
              key: `subscription:${sub.metadata.userId}`,
              description: sub.metadata.plan ?? "pro",
              enabled: sub.status === "active",
              rolloutPct: 100,
            },
            update: { description: sub.metadata.plan ?? "pro", enabled: sub.status === "active" },
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
    return handleApiError(err, "POST /api/webhooks/stripe");
  }
}
