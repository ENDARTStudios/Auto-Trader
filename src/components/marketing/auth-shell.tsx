import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/meridian/icons";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mrd mrd-auth" data-theme="dark">
      <aside className="mrd-auth-brand">
        <Link href="/welcome" className="mrd-mkt-brand" style={{ color: "inherit", textDecoration: "none" }}>
          <span className="mrd-logo"><Icon name="overview" size={16} /></span>
          <span><b>Auto Trader</b><small>MERIDIAN</small></span>
        </Link>
        <div>
          <h1>O motor que mostra o porquê de cada trade.</h1>
          <p style={{ marginTop: 14 }}>
            Risco humano no comando e auditoria em cada passo. Se você está aqui, é porque quer voltar para dentro do
            workspace — vamos resolver isso sem atalhos.
          </p>
        </div>
        <div className="mrd-auth-list">
          <div><i>✓</i> O link de recuperação expira em 15 minutos</div>
          <div><i>✓</i> Trocar a senha encerra todas as sessões ativas</div>
          <div><i>✓</i> Nenhum e-mail é enviado para contas inexistentes</div>
        </div>
        <div className="mrd-auth-mini">
          <small>Segurança</small>
          <b>2 passos</b>
          <small>pedir link → definir nova senha · tudo registrado no audit log</small>
        </div>
      </aside>
      <main className="mrd-auth-panel">
        <div className="mrd-auth-form">
          <div>
            <h2>{title}</h2>
            <div className="sub" style={{ marginTop: 6 }}>{subtitle}</div>
          </div>
          {children}
          <div className="mrd-auth-alt">
            <Link href="/login">Voltar para o login</Link>
            <Link href="/pricing">Ver planos</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
