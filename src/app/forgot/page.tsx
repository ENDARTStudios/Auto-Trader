"use client";

import { useState } from "react";
import Link from "next/link";
import "../(meridian)/meridian-tokens.css";
import "../(meridian)/meridian.css";
import { AuthShell } from "@/components/marketing/auth-shell";
import { Icon } from "@/components/meridian/icons";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error === "rate_limited" ? "Muitas tentativas. Espere um minuto." : data.error ?? "Falha ao enviar");
      }
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title={sent ? "Verifique seu e-mail" : "Recuperar acesso"}
      subtitle={
        sent
          ? "Se existir uma conta com esse endereço, o link de recuperação foi gerado e vale por 15 minutos."
          : "Informe o e-mail da conta. Enviamos um link de uso único para definir uma nova senha."
      }
    >
      {sent ? (
        <>
          <div className="mrd-banner" role="status">
            <Icon name="alerts" size={15} />
            <div className="grow">
              Neste ambiente o envio é simulado: o link aparece no log do servidor e no audit log, não na caixa de
              entrada.
            </div>
          </div>
          <Link href="/login" className="mrd-btn mrd-btn-primary" style={{ height: 38 }}>
            Voltar para o login
          </Link>
          <button type="button" className="mrd-btn mrd-btn-ghost" onClick={() => setSent(false)}>
            Usar outro e-mail
          </button>
        </>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 13 }}>
          {error ? (
            <div className="mrd-banner" role="alert">
              <Icon name="risk" size={15} />
              <div className="grow">{error}</div>
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
              autoFocus
            />
          </label>
          <button type="submit" className="mrd-btn mrd-btn-primary" style={{ height: 38 }} disabled={pending}>
            {pending ? "Gerando link…" : "Enviar link de recuperação"}
          </button>
          <p className="mrd-dim" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            Por segurança, a resposta é sempre a mesma, exista ou não a conta.
          </p>
        </form>
      )}
    </AuthShell>
  );
}
