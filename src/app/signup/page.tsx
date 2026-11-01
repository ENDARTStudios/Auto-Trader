import type { Metadata } from "next";
import Link from "next/link";
import "../(meridian)/meridian-tokens.css";
import "../(meridian)/meridian.css";
import { Icon } from "@/components/meridian/icons";

export const metadata: Metadata = {
  title: "Solicitar acesso · Auto Trader",
  description: "O Auto Trader opera por convite. Peça acesso ao administrador do workspace.",
};

export default function SignupPage() {
  return (
    <div className="mrd mrd-mkt" data-theme="dark">
      <header className="mrd-mkt-nav">
        <Link href="/welcome" className="mrd-mkt-brand">
          <span className="mrd-logo"><Icon name="overview" size={16} /></span>
          <span><b>Auto Trader</b><small>MERIDIAN</small></span>
        </Link>
        <div className="mrd-mkt-actions">
          <Link href="/pricing" className="mrd-btn mrd-btn-ghost mrd-btn-sm">Planos</Link>
          <Link href="/login" className="mrd-btn mrd-btn-primary mrd-btn-sm">Entrar</Link>
        </div>
      </header>

      <main style={{ maxWidth: 620, padding: "72px 0 40px" }}>
        <div className="mrd-mkt-eyebrow"><span className="mrd-dot" /> Acesso por convite</div>
        <h1 style={{ fontSize: "clamp(30px, 4vw, 42px)", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
          O Auto Trader não abre cadastro sozinho.
        </h1>
        <p style={{ marginTop: 16, fontSize: 14.5, lineHeight: 1.65, color: "var(--text-2)" }}>
          Cada workspace tem um administrador que cria as contas e define papéis (super admin, trader, viewer). Isso
          mantém o audit log confiável e evita que qualquer pessoa chegue perto de um kill switch.
        </p>

        <div className="mrd-mkt-card" style={{ marginTop: 24, padding: 22 }}>
          <h2 style={{ fontSize: 14.5, marginBottom: 10 }}>Como pedir acesso</h2>
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
            <li>Fale com o administrador do workspace que você quer usar.</li>
            <li>Ele cria sua conta em Users &amp; audit e define o papel.</li>
            <li>Você entra com a senha temporária e troca no primeiro login.</li>
          </ol>
          <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
            <Link href="/login" className="mrd-btn mrd-btn-primary">Já tenho convite</Link>
            <Link href="/pricing" className="mrd-btn mrd-btn-secondary">Ver planos</Link>
          </div>
        </div>

        <p className="mrd-dim" style={{ fontSize: 11.5, marginTop: 18 }}>
          Ambiente de demonstração: use <b>admin@local</b> / <b>Admin123!</b> para explorar o produto.
        </p>
      </main>

      <footer className="mrd-mkt-foot">
        <span>© {new Date().getFullYear()} Auto Trader · Meridian</span>
        <nav><Link href="/welcome">Produto</Link><Link href="/login">Entrar</Link></nav>
      </footer>
    </div>
  );
}
