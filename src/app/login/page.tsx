"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../(meridian)/meridian-tokens.css";
import "../(meridian)/meridian.css";
import { Icon } from "@/components/meridian/icons";
import { useAuth, useLogin } from "@/hooks/use-auth";

export default function LoginPage() {
  const { user, isLoading } = useAuth();
  const login = useLogin();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);

  if (user) {
    router.replace("/overview");
  }

  const error = login.error as (Error & { mfaRequired?: boolean }) | null;

  return (
    <div className="mrd mrd-auth" data-theme="dark">
      <aside className="mrd-auth-brand">
        <Link href="/welcome" className="mrd-mkt-brand" style={{ color: "inherit", textDecoration: "none" }}>
          <span className="mrd-logo">
            <Icon name="overview" size={16} />
          </span>
          <span>
            <b>Auto Trader</b>
            <small>MERIDIAN</small>
          </span>
        </Link>

        <div>
          <h1>O motor que mostra o porquê de cada trade.</h1>
          <p style={{ marginTop: 14 }}>
            Risco humano no comando, auditoria em cada passo e paper trading antes de qualquer capital real. Entre para
            ver o que o motor está decidindo agora.
          </p>
        </div>

        <div className="mrd-auth-list">
          <div><i>✓</i> Kill switch com confirmação tipada e registro de quem apertou</div>
          <div><i>✓</i> Journal exportável com o motivo de cada saída</div>
          <div><i>✓</i> Caps de perda, drawdown e exposição avaliados a cada rodada</div>
        </div>

        <div className="mrd-auth-mini">
          <small>Conta de demonstração</small>
          <b>$11,018.80</b>
          <small className="mrd-pos">+9.69% em 30 dias · 3 posições abertas · paper mode</small>
        </div>
      </aside>

      <main className="mrd-auth-panel">
        <div className="mrd-auth-form">
          <div>
            <h2>Entrar</h2>
            <div className="sub" style={{ marginTop: 6 }}>
              Use a conta do workspace. Sessões expiram e podem ser revogadas em Settings.
            </div>
          </div>

          {isLoading ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="mrd-skeleton" style={{ height: 38 }} />
              <div className="mrd-skeleton" style={{ height: 38 }} />
              <div className="mrd-skeleton" style={{ height: 38 }} />
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                login.mutate(
                  { email, password, totp: totp || undefined },
                  {
                    onError: (err: unknown) => {
                      if ((err as Error & { mfaRequired?: boolean }).mfaRequired) setMfaRequired(true);
                    },
                  }
                );
              }}
            >
              {error && !error.mfaRequired ? (
                <div className="mrd-banner" role="alert">
                  <Icon name="risk" size={15} />
                  <div className="grow">{error.message || "Não foi possível entrar. Confira e-mail e senha."}</div>
                </div>
              ) : null}

              <label className="mrd-field">
                <span>E-mail</span>
                <input
                  className="mrd-input"
                  style={{ height: 38, fontSize: 16 }}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@empresa.com"
                  autoComplete="email"
                  required
                />
              </label>

              <label className="mrd-field">
                <span>Senha</span>
                <input
                  className="mrd-input"
                  style={{ height: 38, fontSize: 16 }}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </label>

              {mfaRequired ? (
                <label className="mrd-field">
                  <span>Código 2FA (6 dígitos)</span>
                  <input
                    className="mrd-input"
                    style={{ height: 38, fontSize: 16, letterSpacing: "0.2em" }}
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    autoFocus
                  />
                  <small>Abra o app autenticador e insira o código atual.</small>
                </label>
              ) : null}

              <button type="submit" className="mrd-btn mrd-btn-primary" style={{ height: 38 }} disabled={login.isPending}>
                {login.isPending ? "Entrando…" : "Entrar"}
                {!login.isPending ? <Icon name="up" size={15} /> : null}
              </button>
            </form>
          )}

          <div className="mrd-auth-alt">
            <Link href="/forgot">Esqueci a senha</Link>
            <Link href="/pricing">Ver planos</Link>
          </div>

          <div className="mrd-auth-note">
            Conta de teste neste ambiente: <b>admin@local</b> / <b>Admin123!</b> · o cadastro é por convite, feito por um
            administrador.
          </div>
        </div>
      </main>
    </div>
  );
}
