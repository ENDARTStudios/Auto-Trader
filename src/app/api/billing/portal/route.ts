import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { handleApiError } from "@/lib/api/error-handler";
import { appUrl, stripeConfigured, stripeGet, stripePost } from "@/lib/billing/stripe-api";
import { db } from "@/lib/db";
import { stripeCustomerKey } from "@/lib/billing/subscription-state";

export const dynamic = "force-dynamic";

// POST /api/billing/portal — abre o Billing Portal do cliente Stripe.
// Sem customer (nunca assinou) devolve 409 com código estável para a UI explicar.
export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    if (!stripeConfigured()) {
      return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
    }

    // 1) customer persistido no checkout (funciona mesmo se o e-mail mudar
    //    ou se a conta local não tiver e-mail entregável); 2) fallback por e-mail.
    const stored = await db.featureFlag
      .findFirst({ where: { key: stripeCustomerKey(session.userId) } })
      .catch(() => null);
    let customer = stored?.description?.trim() || null;

    if (!customer) {
      const customers = await stripeGet<{ data: { id: string }[] }>("/customers", {
        email: session.email,
        limit: 1,
      });
      customer = customers.data[0]?.id ?? null;
    }
    if (!customer) {
      return NextResponse.json({ error: "no_customer" }, { status: 409 });
    }

    const portal = await stripePost<{ url: string }>("/billing_portal/sessions", {
      customer,
      return_url: `${appUrl()}/billing`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (err) {
    return handleApiError(err, "POST /api/billing/portal");
  }
}
