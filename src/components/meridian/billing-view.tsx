"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "./api";
import { Icon } from "./icons";
import { Badge, Card, Kpi, Skeleton } from "./ui";
import { clockUtc } from "@/lib/meridian/format";

interface Subscription {
  plan?: string;
  enabled?: boolean;
  tier?: string;
  status?: string;
  currentPeriodEnd?: string | null;
  renewsAt?: string | null;
  seats?: number;
  priceUsd?: number;
  cancelAtPeriodEnd?: boolean;
  [key: string]: unknown;
}

interface StripeStatus {
  configured: boolean;
  mode: "live" | "test" | "none";
  missing: string[];
  present: string[];
  webhookPath: string;
}

export function BillingView() {
  const portal = useMutation({
    mutationFn: () => apiPost<{ url: string }>("/api/billing/portal"),
    onSuccess: (res) => window.location.assign(res.url),
    onError: (err: Error) => {
      const message = err.message.includes("409")
        ? "Assine um plano primeiro para abrir o portal."
        : err.message.includes("503")
          ? "Stripe ainda não está configurado neste ambiente."
          : err.message;
      toast.error("Não foi possível abrir o portal", { description: message });
    },
  });

  const stripe = useQuery<StripeStatus>({
    queryKey: ["mrd", "stripe-status"],
    queryFn: () => apiGet<StripeStatus>("/api/billing/status"),
    retry: 0,
  });

  const sub = useQuery<{ subscription?: Subscription | null } & Subscription>({
    queryKey: ["mrd", "subscription"],
    queryFn: () => apiGet<{ subscription?: Subscription | null } & Subscription>("/api/billing/subscription"),
    retry: 0,
  });

  const raw = sub.data?.subscription ?? sub.data;
  const plan = raw?.plan ?? raw?.tier ?? "paper";
  const renews = raw?.currentPeriodEnd ?? raw?.renewsAt ?? null;
  // enabled=false com plano pago = cobrança pendente/falha (webhook marca assim).
  const status = raw?.enabled === false && plan !== "paper" ? "past_due" : raw?.status ?? "active";

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Billing</h1>
            <span className="mrd-status">
              <Badge tone={status === "active" ? "pos" : "warn"}>{status === "past_due" ? "pagamento pendente" : status}</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>{plan} plan</span>
            </span>
          </div>
          <p className="mrd-sub">
            Paper trading is free and unlimited. Live trading requires a plan plus the graduation window — billing never
            unlocks risk limits by itself.
          </p>
        </div>
        <div className="mrd-actions">
          <a className="mrd-btn mrd-btn-ghost mrd-btn-sm" href="/pricing">
            <Icon name="billing" size={15} /> Compare plans
          </a>
          <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" disabled title="Stripe portal arrives with the production keys">
            Manage subscription
          </button>
        </div>
      </header>

      <div className="mrd-kpi-row">
        <Kpi label="Plan" value={String(plan)} foot={<span className="mrd-dim">current workspace</span>} />
        <Kpi label="Status" value={status} valueClassName={status === "active" ? "mrd-pos" : "mrd-warn"} foot={<span className="mrd-dim">billing state</span>} />
        <Kpi label="Renews" value={renews ? clockUtc(renews) : "—"} foot={<span className="mrd-dim">UTC</span>} />
        <Kpi label="Seats" value={String(raw?.seats ?? 1)} foot={<span className="mrd-dim">operator accounts</span>} />
      </div>

      <div className="mrd-hero" style={{ marginTop: 16 }}>
        <section className="mrd-card">
          <div className="mrd-card-hd" data-border="true">
            <div>
              <div className="mrd-card-title">What the plan covers</div>
              <div className="mrd-card-sub">limits are enforced by the risk engine, not by the invoice</div>
            </div>
          </div>
          <div className="mrd-card-body">
            <div className="mrd-list">
              {[
                ["Paper engine", "unlimited rounds, all strategies", "pos"],
                ["Analytics & journal", "full history, CSV export", "pos"],
                ["Live trading", "after 50 positive cycles + MFA", "warn"],
                ["Priority RPC", "dedicated endpoint, lower latency", "neutral"],
              ].map(([title, detail, tone]) => (
                <div className="mrd-list-item" key={title}>
                  <span className="mrd-asset-ico" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}><Icon name="billing" size={14} /></span>
                  <div className="mrd-list-main">
                    <div className="mrd-list-title">{title} <Badge tone={tone as "pos" | "warn" | "neutral"}>{tone === "pos" ? "included" : tone === "warn" ? "gated" : "add-on"}</Badge></div>
                    <div className="mrd-list-sub">{detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="mrd-side">
          <Card title="Invoices" sub="last 12 months">
            <p className="mrd-dim" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Invoices are issued by Stripe and mirrored here once the production keys are configured. No invoice is
              fabricated in paper mode.
            </p>
          </Card>
          <Card title="Payment method" sub="card on file">
            {sub.isLoading ? (
              <Skeleton height={16} />
            ) : raw ? (
              <dl className="mrd-kv">
                <dt>Brand</dt>
                <dd>{String(raw.cardBrand ?? "—")}</dd>
                <dt>Last 4</dt>
                <dd>{String(raw.cardLast4 ?? "—")}</dd>
                <dt>Expires</dt>
                <dd>{String(raw.cardExp ?? "—")}</dd>
              </dl>
            ) : (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>No payment method recorded for this workspace.</p>
            )}
          </Card>
          <Card title="Stripe" sub={stripe.data ? `modo ${stripe.data.mode}` : "integração"}>
            {stripe.isLoading ? (
              <Skeleton height={16} />
            ) : stripe.data?.configured ? (
              <div style={{ display: "grid", gap: 8 }}>
                <Badge tone="pos">pronto</Badge>
                <p className="mrd-dim" style={{ fontSize: 11.5 }}>
                  Checkout e webhook configurados. O portal de faturas usa {stripe.data.webhookPath}.
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <Badge tone="warn">falta configurar</Badge>
                <p className="mrd-dim" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                  Nenhuma chave é inventada: sem estes envs o checkout fica desligado e a tela continua honesta.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(stripe.data?.missing ?? []).map((k) => (
                    <span key={k} className="mrd-chip" style={{ height: 22, fontSize: 10.5 }}>{k}</span>
                  ))}
                </div>
                <p className="mrd-dim" style={{ fontSize: 11 }}>
                  Webhook: <code>{stripe.data?.webhookPath}</code> · assinatura verificada por HMAC.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
