"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import "../(meridian)/meridian-tokens.css";
import "../(meridian)/meridian.css";
import { AuthShell } from "@/components/marketing/auth-shell";
import { Icon } from "@/components/meridian/icons";

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = token.length > 0 && password.length >= 8 && password === confirm && !pending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error === "invalid or expired token" ? "Link inválido ou expirado." : data.error ?? "Falha ao redefinir");
      }
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <>
        <div className="mrd-banner" role="alert">
          <Icon name="risk" size={15} />
          <div className="grow">Falta o token no link. Abra o endereço completo que você recebeu.</div>
        </div>
        <Link href="/forgot" className="mrd-btn mrd-btn-primary" style={{ height: 38 }}>
          Pedir novo link
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <div className="mrd-banner" role="status">
          <Icon name="shield" size={15} />
          <div className="grow">Senha alterada. Todas as sessões desta conta foram encerradas.</div>
        </div>
        <Link href="/login" className="mrd-btn mrd-btn-primary" style={{ height: 38 }}>
          Entrar com a nova senha
        </Link>
      </>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 13 }}>
      {error ? (
        <div className="mrd-banner" role="alert">
          <Icon name="risk" size={15} />
          <div className="grow">{error}</div>
        </div>
      ) : null}
      <label className="mrd-field">
        <span>Nova senha</span>
        <input
          className="mrd-input"
          style={{ height: 38, fontSize: 16 }}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="mínimo de 8 caracteres"
          autoComplete="new-password"
          required
          autoFocus
        />
        {tooShort ? <small className="mrd-neg">Use pelo menos 8 caracteres.</small> : null}
      </label>
      <label className="mrd-field">
        <span>Confirmar senha</span>
        <input
          className="mrd-input"
          style={{ height: 38, fontSize: 16 }}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="repita a senha"
          autoComplete="new-password"
          required
        />
        {mismatch ? <small className="mrd-neg">As senhas não coincidem.</small> : null}
      </label>
      <button type="submit" className="mrd-btn mrd-btn-primary" style={{ height: 38 }} disabled={!canSubmit}>
        {pending ? "Salvando…" : "Definir nova senha"}
      </button>
      <p className="mrd-dim" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
        Ao salvar, encerramos todas as sessões ativas desta conta e registramos a troca no audit log.
      </p>
    </form>
  );
}

export default function ResetPage() {
  return (
    <AuthShell title="Definir nova senha" subtitle="O link vale por 15 minutos e só pode ser usado uma vez.">
      <Suspense fallback={<div className="mrd-skeleton" style={{ height: 120 }} />}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
