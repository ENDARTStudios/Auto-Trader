"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/components/meridian/api";
import { Icon } from "@/components/meridian/icons";
import { PLANS } from "@/lib/billing/plans";
import { useAuth } from "@/hooks/use-auth";

interface SubscriptionResponse {
  subscription?: { plan?: string; status?: string } | null;
  plan?: string;
}

export function Pricing() {
  const { user } = useAuth();
  const router = useRouter();
  const sub = useQuery<SubscriptionResponse>({
    queryKey: ["mrd", "subscription"],
    queryFn: () => apiGet<SubscriptionResponse>("/api/billing/subscription"),
    enabled: Boolean(user),
    retry: 0,
  });

  const current = user ? sub.data?.subscription?.plan ?? sub.data?.plan ?? "free" : null;

  const change = useMutation({
    mutationFn: (planId: string) =>
      apiPost<{ ok: boolean }>("/api/billing/subscription", {
        action: planId === "free" ? "cancel" : "upgrade",
        plan: planId,
      }),
    onSuccess: (_r, planId) => toast.success("Plano atualizado", { description: `Agora no ${planId}.` }),
    onError: (err: Error) => toast.error("Não foi possível alterar o plano", { description: err.message }),
  });

  return (
    <div className="mrd mrd-mkt" data-theme="dark">
      <header className="mrd-mkt-nav">
        <Link href="/welcome" className="mrd-mkt-brand">
          <span className="mrd-logo"><Icon name="overview" size={16} /></span>
          <span><b>Auto Trader</b><small>MERIDIAN</small></span>
        </Link>
        <nav className="mrd-mkt-links" aria-label="Sections">
          <Link href="/welcome">Produto</Link>
          <Link href="/pricing">Planos</Link>
        </nav>
        <div className="mrd-mkt-actions">
          <Link href="/login" className="mrd-btn mrd-btn-ghost mrd-btn-sm">Entrar</Link>
          <Link href="/signup" className="mrd-btn mrd-btn-primary mrd-btn-sm">Solicitar acesso</Link>
        </div>
      </header>

      <main>
        <section style={{ padding: "56px 0 28px", maxWidth: 720 }}>
          <div className="mrd-mkt-eyebrow"><span className="mrd-dot" /> Paper é grátis e ilimitado</div>
          <h1 style={{ fontSize: "clamp(32px, 4vw, 46px)", letterSpacing: "-0.03em", lineHeight: 1.08 }}>
            Você paga pelo <span className="mrd-mkt-accent">acesso</span>, não pelo risco.
          </h1>
          <p style={{ marginTop: 14, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-2)" }}>
            Nenhum plano aumenta seus limites de risco: eles continuam definidos na config e no envelope humano. O que muda
            é quantas posições e quanta infraestrutura você pode usar.
          </p>
        </section>

        <section className="mrd-pricing-grid">
          {PLANS.map((plan) => {
            const featured = plan.id === "pro";
            const isCurrent = current === plan.id;
            return (
              <article key={plan.id} className={`mrd-plan${featured ? " featured" : ""}`}>
                <h3>
                  {plan.name}
                  {featured ? <span className="mrd-badge">popular</span> : null}
                  {isCurrent ? <span className="mrd-badge">atual</span> : null}
                </h3>
                <div className="price">
                  ${plan.priceUsdMonthly}
                  <small> /mês</small>
                </div>
                <ul>
                  {plan.features.map((f) => <li key={f}>{f}</li>)}
                </ul>
                <div className="mrd-dim" style={{ fontSize: 11 }}>
                  até {plan.maxOpenPositions} {plan.maxOpenPositions === 1 ? "posição" : "posições"} · {plan.rateLimitPerMinute}/min de API
                </div>
                <button
                  type="button"
                  data-testid={`pricing-subscribe-${plan.id}`}
                  className={`mrd-btn ${featured ? "mrd-btn-primary" : "mrd-btn-secondary"}`}
                  disabled={change.isPending || isCurrent}
                  onClick={() => (user ? change.mutate(plan.id) : router.push("/login"))}
                >
                  {isCurrent ? "Plano atual" : plan.priceUsdMonthly === 0 ? "Voltar para o Free" : `Assinar ${plan.name}`}
                </button>
              </article>
            );
          })}
        </section>

        <section className="mrd-mkt-band" style={{ marginTop: 32 }}>
          <div>
            <h2>Live trading não se compra. Se conquista.</h2>
            <p>
              Para sair do paper você precisa de 50 ciclos positivos, MFA ativo e nenhum incidente de risco em aberto. O
              plano libera a infraestrutura; a graduação libera o capital.
            </p>
          </div>
          <Link href="/login" className="mrd-btn mrd-btn-secondary">
            Entrar no workspace <Icon name="up" size={15} />
          </Link>
        </section>
      </main>

      <footer className="mrd-mkt-foot">
        <span>© {new Date().getFullYear()} Auto Trader · Meridian</span>
        <nav>
          <Link href="/welcome">Produto</Link>
          <Link href="/login">Entrar</Link>
          <Link href="/privacy">Privacidade</Link>
        </nav>
      </footer>
    </div>
  );
}
