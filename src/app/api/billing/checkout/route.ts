import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { handleApiError } from "@/lib/api/error-handler";
import { appUrl, stripeConfigured, stripePost } from "@/lib/billing/stripe-api";

export const dynamic = "force-dynamic";

const schema = z.object({ plan: z.enum(["pro", "elite"]) });

// POST /api/billing/checkout — cria uma Checkout Session de assinatura (test/live
// conforme a chave configurada) e devolve a URL para redirecionar o usuário.
export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    if (!stripeConfigured()) {
      return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }

    const price =
      parsed.data.plan === "pro"
        ? process.env.STRIPE_PRICE_PRO?.trim()
        : process.env.STRIPE_PRICE_ELITE?.trim();
    if (!price) {
      return NextResponse.json({ error: "price_not_configured", plan: parsed.data.plan }, { status: 503 });
    }

    const base = appUrl();
    // O Stripe valida e-mail; contas locais (@local) não são endereços válidos.
    // Sem customer_email ele cria o customer na hora e o e-mail pode ser
    // preenchido no próprio Checkout.
    const emailIsDeliverable = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(session.email);
    const checkout = await stripePost<{ id: string; url: string | null }>("/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": 1,
      ...(emailIsDeliverable ? { customer_email: session.email } : {}),
      client_reference_id: session.userId,
      "metadata[userId]": session.userId,
      "metadata[plan]": parsed.data.plan,
      "subscription_data[metadata][userId]": session.userId,
      "subscription_data[metadata][plan]": parsed.data.plan,
      success_url: `${base}/billing?checkout=success`,
      cancel_url: `${base}/billing?checkout=cancel`,
      allow_promotion_codes: "true",
    });

    if (!checkout.url) {
      return NextResponse.json({ error: "checkout_url_missing" }, { status: 502 });
    }
    return NextResponse.json({ id: checkout.id, url: checkout.url });
  } catch (err) {
    return handleApiError(err, "POST /api/billing/checkout");
  }
}
