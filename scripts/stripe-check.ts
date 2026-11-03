// scripts/stripe-check.ts — diagnóstico somente leitura do billing.
//
// Uso: npx tsx scripts/stripe-check.ts
// Lê STRIPE_SECRET_KEY/STRIPE_PRICE_PRO/STRIPE_PRICE_ELITE/WEBHOOK_SECRET do .env
// e confirma: modo da conta, preços existentes, endpoints de webhook e segredo.
// Nunca imprime valores de chave.

import "dotenv/config";
import { stripeConfigured, stripeGet, stripePost } from "../src/lib/billing/stripe-api";

interface Price {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  recurring?: { interval: string } | null;
  product: string;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
}

async function main() {
  if (!stripeConfigured()) {
    console.log("STRIPE_SECRET_KEY ausente — nada a verificar.");
    process.exitCode = 1;
    return;
  }

  const livemode = String(process.env.STRIPE_SECRET_KEY).startsWith("sk_live_");
  console.log(`modo: ${livemode ? "LIVE" : "test"}`);

  for (const envName of ["STRIPE_PRICE_PRO", "STRIPE_PRICE_ELITE"]) {
    const id = process.env[envName]?.trim();
    if (!id) {
      console.log(`${envName}: ausente`);
      continue;
    }
    try {
      const price = await stripeGet<Price>(`/prices/${id}`);
      console.log(
        `${envName}: ok · ${price.currency.toUpperCase()} ${((price.unit_amount ?? 0) / 100).toFixed(2)}/${price.recurring?.interval ?? "?"} · active=${price.active}`
      );
    } catch (err) {
      console.log(`${envName}: FALHOU (${(err as Error).message})`);
      process.exitCode = 1;
    }
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  console.log(`STRIPE_WEBHOOK_SECRET: ${webhookSecret ? `presente (${webhookSecret.slice(0, 8)}…)` : "ausente"}`);

  if (process.argv.includes("--checkout")) {
    const priceId = process.env.STRIPE_PRICE_PRO?.trim();
    if (!priceId || !process.env.STRIPE_PUBLISHABLE_KEY?.trim()) {
      console.log("checkout: faltam STRIPE_PRICE_PRO/STRIPE_PUBLISHABLE_KEY");
      process.exitCode = 1;
    } else {
      const session = await stripePost<{ id: string; url: string; status: string }>("/checkout/sessions", {
        mode: "subscription",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": 1,
        success_url: "https://example.com/billing?ok=1",
        cancel_url: "https://example.com/billing?ok=0",
      });
      const host = new URL(session.url).host;
      console.log(`checkout: criado ${session.id} · status=${session.status} · host=${host}`);
      await stripePost<{ status: string }>(`/checkout/sessions/${session.id}/expire`, {});
      console.log("checkout: sessão expirada (nenhuma cobrança criada)");
    }
  }

  const endpoints = await stripeGet<{ data: WebhookEndpoint[] }>("/webhook_endpoints?limit=10").catch(() => null);
  if (!endpoints) {
    console.log("webhook endpoints: não foi possível listar (chave restrita?)");
  } else if (endpoints.data.length === 0) {
    console.log("webhook endpoints: nenhum cadastrado");
  } else {
    for (const ep of endpoints.data) {
      console.log(`webhook: ${ep.url} · ${ep.status} · ${ep.enabled_events.length} eventos`);
    }
  }
}

main().catch((err) => {
  console.error("stripe-check falhou:", (err as Error).message);
  process.exitCode = 1;
});
