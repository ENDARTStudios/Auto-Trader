import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { handleApiError } from "@/lib/api/error-handler";
import { stripeMode } from "@/lib/billing/stripe-api";

// GET /api/billing/status — what the Stripe integration still needs to work.
// Nunca devolve valores de chave, apenas presença/ausência dos envs.
export const dynamic = "force-dynamic";

const REQUIRED = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_ELITE",
] as const;

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const present = (key: string) => Boolean(process.env[key]?.trim());
    const missing = REQUIRED.filter((k) => !present(k));

    return NextResponse.json({
      configured: missing.length === 0,
      mode: stripeMode(),
      missing,
      present: REQUIRED.filter(present),
      webhookPath: "/api/webhooks/stripe",
    });
  } catch (err) {
    return handleApiError(err, "GET /api/billing/status");
  }
}
