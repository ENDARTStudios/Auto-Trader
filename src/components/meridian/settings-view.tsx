"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost } from "./api";
import { Icon } from "./icons";
import { Badge, Card, Skeleton } from "./ui";

interface Me {
  user?: { id: string; email: string; role: string; mfaEnabled?: boolean; createdAt?: string };
}

interface Prefs {
  locale?: string;
  timezone?: string;
  theme?: string;
  density?: string;
  notifications?: { email?: boolean; telegram?: boolean };
  [key: string]: unknown;
}

export function SettingsView() {
  const qc = useQueryClient();
  const me = useQuery<Me>({ queryKey: ["mrd", "me"], queryFn: () => apiGet<Me>("/api/auth/me") });
  const prefs = useQuery<Prefs>({ queryKey: ["mrd", "prefs"], queryFn: () => apiGet<Prefs>("/api/preferences") });
  const [draft, setDraft] = useState<Prefs | null>(null);
  const current = draft ?? prefs.data ?? {};

  const save = useMutation({
    mutationFn: (patch: Prefs) => apiPost<Prefs>("/api/preferences", patch),
    onSuccess: () => {
      toast.success("Preferences saved");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["mrd", "prefs"] });
    },
    onError: (err: Error) => toast.error("Could not save", { description: err.message }),
  });

  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaUrl, setMfaUrl] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const startMfa = useMutation({
    mutationFn: () => apiPost<{ secret: string; otpauthUrl: string }>("/api/auth/mfa/setup"),
    onSuccess: (res) => {
      setMfaSecret(res.secret);
      setMfaUrl(res.otpauthUrl);
      setMfaOpen(true);
    },
    onError: (err: Error) => toast.error("Não foi possível iniciar o MFA", { description: err.message }),
  });

  const verifyMfa = useMutation({
    mutationFn: () => apiPost<{ ok: boolean }>("/api/auth/mfa/verify", { token: mfaCode }),
    onSuccess: () => {
      toast.success("MFA ativado", { description: "Guarde o código de recuperação do app autenticador." });
      setMfaOpen(false);
      setMfaSecret(null);
      setMfaUrl(null);
      setMfaCode("");
      void qc.invalidateQueries({ queryKey: ["mrd", "me"] });
    },
    onError: (err: Error) => toast.error("Código inválido", { description: err.message }),
  });

  const disableMfa = useMutation({
    mutationFn: () => apiDelete<{ ok: boolean }>("/api/auth/mfa"),
    onSuccess: () => {
      toast.success("MFA desativado");
      void qc.invalidateQueries({ queryKey: ["mrd", "me"] });
    },
    onError: (err: Error) => toast.error("Não foi possível desativar", { description: err.message }),
  });

  const user = me.data?.user;
  const dirty = draft !== null;

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Settings</h1>
            <span className="mrd-status">
              <Badge tone={user?.role === "super_admin" ? "brand" : "neutral"}>{user?.role?.replace("_", " ") ?? "—"}</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>profile, security and workspace preferences</span>
            </span>
          </div>
          <p className="mrd-sub">
            Security changes require your password and are written to the audit log. Theme and density are stored in this
            browser; the rest follows the account.
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={() => setDraft(null)} disabled={!dirty}>
            Discard
          </button>
          <button type="button" className="mrd-btn mrd-btn-primary mrd-btn-sm" onClick={() => save.mutate(current)} disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </header>

      <div className="mrd-hero">
        <div style={{ display: "grid", gap: 16 }}>
          <Card title="Profile" sub="identity used across the workspace">
            {me.isLoading ? (
              <Skeleton height={20} />
            ) : (
              <div className="mrd-form-grid">
                <label className="mrd-field"><span>Email</span><input className="mrd-input" value={user?.email ?? ""} readOnly /></label>
                <label className="mrd-field"><span>Role</span><input className="mrd-input" value={user?.role?.replace("_", " ") ?? ""} readOnly /></label>
                <label className="mrd-field"><span>Member since</span><input className="mrd-input" value={user?.createdAt ? new Date(user.createdAt).toISOString().slice(0, 10) : "—"} readOnly /></label>
              </div>
            )}
          </Card>

          <Card title="Security" sub="what protects the account">
            <div className="mrd-list">
              <div className="mrd-list-item">
                <span className="mrd-asset-ico" style={{ background: "var(--surface-2)", color: user?.mfaEnabled ? "var(--positive)" : "var(--warning)" }}><Icon name="risk" size={14} /></span>
                <div className="mrd-list-main">
                  <div className="mrd-list-title">Two-factor authentication <Badge tone={user?.mfaEnabled ? "pos" : "warn"}>{user?.mfaEnabled ? "enabled" : "not configured"}</Badge></div>
                  <div className="mrd-list-sub">TOTP · required to unlock live trading</div>
                </div>
                {user?.mfaEnabled ? (
                  <button
                    type="button"
                    className="mrd-btn mrd-btn-ghost mrd-btn-sm"
                    onClick={() => disableMfa.mutate()}
                    disabled={disableMfa.isPending}
                  >
                    Desativar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mrd-btn mrd-btn-secondary mrd-btn-sm"
                    onClick={() => startMfa.mutate()}
                    disabled={startMfa.isPending}
                  >
                    {startMfa.isPending ? "Gerando…" : "Configurar"}
                  </button>
                )}
              </div>
              <div className="mrd-list-item">
                <span className="mrd-asset-ico" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}><Icon name="admin" size={14} /></span>
                <div className="mrd-list-main">
                  <div className="mrd-list-title">Audit log</div>
                  <div className="mrd-list-sub">privileged actions with IP and timestamp</div>
                </div>
                <a className="mrd-btn mrd-btn-ghost mrd-btn-sm" href="/admin">Open</a>
              </div>
            </div>

            {mfaOpen && mfaSecret ? (
              <div style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 14, display: "grid", gap: 12 }}>
                <div className="mrd-card-sub">
                  1. Adicione a conta no app autenticador usando o segredo abaixo
                  {mfaUrl ? <> ou o link <a href={mfaUrl} style={{ color: "var(--brand)" }}>otpauth://</a></> : null}.
                </div>
                <code
                  style={{
                    display: "block",
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    fontSize: 13,
                    letterSpacing: "0.12em",
                    wordBreak: "break-all",
                  }}
                >
                  {mfaSecret}
                </code>
                <label className="mrd-field">
                  <span>2. Código de 6 dígitos gerado pelo app</span>
                  <input
                    className="mrd-input"
                    inputMode="numeric"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    autoComplete="one-time-code"
                  />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="mrd-btn mrd-btn-primary mrd-btn-sm"
                    disabled={mfaCode.length !== 6 || verifyMfa.isPending}
                    onClick={() => verifyMfa.mutate()}
                  >
                    {verifyMfa.isPending ? "Confirmando…" : "Ativar MFA"}
                  </button>
                  <button
                    type="button"
                    className="mrd-btn mrd-btn-ghost mrd-btn-sm"
                    onClick={() => {
                      setMfaOpen(false);
                      setMfaSecret(null);
                      setMfaUrl(null);
                      setMfaCode("");
                    }}
                  >
                    Cancelar
                  </button>
                </div>
                <p className="mrd-dim" style={{ fontSize: 11.5 }}>
                  O segredo só aparece uma vez. Ativar o MFA é pré-requisito para liberar o modo live.
                </p>
              </div>
            ) : null}
          </Card>

          <Card title="Preferences" sub="saved to your account">
            {prefs.isLoading ? (
              <Skeleton height={20} />
            ) : (
              <div className="mrd-form-grid">
                <label className="mrd-field">
                  <span>Language</span>
                  <select className="mrd-input" value={String(current.locale ?? "en-US")} onChange={(e) => setDraft({ ...current, locale: e.target.value })}>
                    <option value="en-US">English</option>
                    <option value="pt-BR">Português (BR)</option>
                    <option value="es-ES">Español</option>
                  </select>
                </label>
                <label className="mrd-field">
                  <span>Timezone</span>
                  <input className="mrd-input" value={String(current.timezone ?? "")} placeholder="America/Sao_Paulo" onChange={(e) => setDraft({ ...current, timezone: e.target.value })} />
                </label>
                <label className="mrd-field">
                  <span>Theme (this browser)</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", height: 32 }}>
                    <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" onClick={() => document.querySelector<HTMLElement>(".mrd")?.setAttribute("data-theme", "dark")}>Dark</button>
                    <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" onClick={() => document.querySelector<HTMLElement>(".mrd")?.setAttribute("data-theme", "light")}>Light</button>
                  </div>
                </label>
              </div>
            )}
            <p className="mrd-dim" style={{ fontSize: 11.5, marginTop: 12 }}>
              Fields the backend does not recognise are preserved untouched — this page sends the whole preference object.
            </p>
          </Card>
        </div>

        <div className="mrd-side">
          <Card title="Session" sub="current browser">
            <dl className="mrd-kv">
              <dt>Role</dt>
              <dd>{user?.role ?? "—"}</dd>
              <dt>MFA</dt>
              <dd className={user?.mfaEnabled ? "mrd-pos" : "mrd-warn"}>{user?.mfaEnabled ? "on" : "off"}</dd>
              <dt>Mode</dt>
              <dd>paper</dd>
            </dl>
          </Card>
          <Card title="Danger zone" sub="irreversible">
            <p className="mrd-dim" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Deleting the workspace removes positions, rounds and the audit trail. It is disabled in this build and requires
              a typed confirmation in the final implementation.
            </p>
            <button type="button" className="mrd-btn mrd-btn-danger mrd-btn-sm" style={{ marginTop: 12 }} disabled>
              Delete workspace
            </button>
          </Card>
        </div>
      </div>
    </>
  );
}
