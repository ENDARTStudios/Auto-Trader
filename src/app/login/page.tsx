"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../(meridian)/meridian-tokens.css";
import "../(meridian)/meridian.css";
import { Icon } from "@/components/meridian/icons";
import { useAuth, useLogin } from "@/hooks/use-auth";

const OAUTH_ERRORS: Record<string, string> = {
  google_not_configured: "Login com Google ainda não está configurado neste ambiente.",
  google_state: "A sessão do login com Google expirou. Tente novamente.",
  google_denied: "Você cancelou o consentimento no Google.",
  google_unverified: "A conta Google não tem e-mail verificado.",
  google_inactive: "Esta conta está desativada. Fale com o administrador.",
  google_failed: "Não foi possível concluir o login com Google. Tente novamente.",
};

function OauthError() {
  const params = useSearchParams();
  const code = params.get("error");
  if (!code) return null;
  return (
    <div className="mrd-banner" role="alert">
      <Icon name="risk" size={15} />
      <div className="grow">{OAUTH_ERRORS[code] ?? "Falha no login social."}</div>
    </div>
  );
}

export default function LoginPage() {
  const { user } = useAuth();
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

          {(
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

              <label className="mrd-field" htmlFor="email">
                <span>E-mail</span>
                <input
                  id="email"
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

              <label className="mrd-field" htmlFor="password">
                <span>Senha</span>
                <input
                  id="password"
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

          <Suspense fallback={null}>
            <OauthError />
          </Suspense>

          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-3)", fontSize: 11 }}>
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
            ou
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
          </div>

          <a href="/api/auth/google" className="mrd-btn mrd-btn-secondary" style={{ height: 38 }}>
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Continuar com Google
          </a>

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
