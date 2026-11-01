"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "./api";
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
                <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" disabled title="MFA setup arrives in the next phase">
                  Configure
                </button>
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
