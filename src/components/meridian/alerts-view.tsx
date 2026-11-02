"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { Icon } from "./icons";
import { Badge, Card, Empty, Kpi, Skeleton } from "./ui";
import { stampUtc } from "@/lib/meridian/format";

interface NotifLog {
  id: number;
  channelId?: string | null;
  eventType?: string | null;
  type?: string | null;
  status?: string | null;
  message?: string | null;
  error?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
}

type ChannelType = "telegram" | "discord" | "webhook";

interface Channel {
  id: string;
  type?: ChannelType;
  name?: string;
  enabled?: boolean;
  isActive?: boolean;
  events?: string[];
  throttleSec?: number;
  config?: Record<string, string | undefined>;
  lastError?: string | null;
}

interface LogsResponse {
  logs: NotifLog[];
  total: number;
  limit: number;
}
type EventType = string | { value: string; label?: string; description?: string };

interface ChannelsResponse {
  channels: Channel[];
  eventTypes?: EventType[];
}

const statusTone = (s?: string | null) =>
  s === "sent" || s === "delivered" || s === "ok" ? "pos" : s === "failed" || s === "error" ? "neg" : "warn";

const eventLabel = (t: EventType) => (typeof t === "string" ? t : t.label ?? t.value);
const eventValue = (t: EventType) => (typeof t === "string" ? t : t.value);

const TYPE_FIELDS: Record<ChannelType, { key: string; label: string; placeholder: string }[]> = {
  telegram: [
    { key: "botToken", label: "Bot token", placeholder: "123456:ABC-DEF…" },
    { key: "chatId", label: "Chat id", placeholder: "-1001234567890" },
  ],
  discord: [{ key: "webhookUrl", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/…" }],
  webhook: [
    { key: "url", label: "URL", placeholder: "https://example.com/hooks/autotrader" },
    { key: "secret", label: "Secret (opcional)", placeholder: "assina o payload" },
  ],
};

interface Draft {
  id?: string;
  name: string;
  type: ChannelType;
  config: Record<string, string>;
  events: string[];
  throttleSec: number;
  enabled: boolean;
}

const emptyDraft: Draft = { name: "", type: "telegram", config: {}, events: [], throttleSec: 60, enabled: true };

export function AlertsView() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const logs = useQuery<LogsResponse>({
    queryKey: ["mrd", "notif-logs"],
    queryFn: () => apiGet<LogsResponse>("/api/notifications/logs?limit=50"),
    refetchInterval: 30_000,
  });
  const channels = useQuery<ChannelsResponse>({
    queryKey: ["mrd", "notif-channels"],
    queryFn: () => apiGet<ChannelsResponse>("/api/notifications/channels"),
    retry: 0,
  });

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = {
        name: d.name.trim(),
        type: d.type,
        config: d.config,
        events: d.events,
        throttleSec: d.throttleSec,
        enabled: d.enabled,
      };
      return d.id
        ? apiPatch<Channel>(`/api/notifications/channels/${d.id}`, body)
        : apiPost<Channel>("/api/notifications/channels", body);
    },
    onSuccess: (_r, d) => {
      toast.success(d.id ? "Channel updated" : "Channel created");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["mrd", "notif-channels"] });
    },
    onError: (err: Error) => toast.error("Could not save channel", { description: err.message }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: boolean }>(`/api/notifications/channels/${id}`),
    onSuccess: () => {
      toast.success("Channel removed");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["mrd", "notif-channels"] });
    },
    onError: (err: Error) => toast.error("Could not remove channel", { description: err.message }),
  });

  const list = logs.data?.logs ?? [];
  const chans = channels.data?.channels ?? [];
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of chans) map.set(c.id, c.name ?? c.type ?? c.id);
    return map;
  }, [chans]);

  const sent = list.filter((l) => statusTone(l.status) === "pos").length;
  const failed = list.filter((l) => statusTone(l.status) === "neg").length;
  const eventTypes = channels.data?.eventTypes ?? [];

  const openNew = () => setDraft({ ...emptyDraft, config: {} });
  const openEdit = (c: Channel) =>
    setDraft({
      id: c.id,
      name: c.name ?? "",
      type: c.type ?? "telegram",
      config: Object.fromEntries(Object.entries(c.config ?? {}).map(([k, v]) => [k, String(v ?? "")])),
      events: c.events ?? [],
      throttleSec: c.throttleSec ?? 60,
      enabled: c.enabled ?? c.isActive ?? true,
    });

  const toggleEnabled = (c: Channel) => {
    void apiPatch<Channel>(`/api/notifications/channels/${c.id}`, { enabled: !(c.enabled ?? c.isActive) })
      .then(() => qc.invalidateQueries({ queryKey: ["mrd", "notif-channels"] }))
      .catch((err: Error) => toast.error("Could not toggle channel", { description: err.message }));
  };

  const draftValid =
    !!draft &&
    draft.name.trim().length > 0 &&
    TYPE_FIELDS[draft.type].every((f) => (f.key === "secret" ? true : (draft.config[f.key] ?? "").trim().length > 0));

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Alerts</h1>
            <span className="mrd-status">
              <Badge tone={failed ? "neg" : "pos"}>{failed ? `${failed} failed` : "delivery healthy"}</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>{logs.data?.total ?? 0} events recorded</span>
            </span>
          </div>
          <p className="mrd-sub">
            Canais definem para onde o motor avisa — kill switch, entradas, saídas e falhas de infraestrutura. O log abaixo
            é a auditoria de cada tentativa de entrega.
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={() => logs.refetch()}>
            <Icon name="activity" size={15} /> Refresh
          </button>
          <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" onClick={openNew}>
            <Icon name="alerts" size={15} /> New channel
          </button>
        </div>
      </header>

      <div className="mrd-kpi-row">
        <Kpi label="Delivered" value={String(sent)} foot={<span className="mrd-dim">last {list.length} events</span>} />
        <Kpi label="Failed" value={String(failed)} valueClassName={failed ? "mrd-neg" : ""} foot={<span className="mrd-dim">needs a retry</span>} />
        <Kpi label="Channels" value={String(chans.length)} foot={<span className="mrd-dim">{chans.filter((c) => c.enabled ?? c.isActive).length} enabled</span>} />
        <Kpi label="Total logged" value={String(logs.data?.total ?? 0)} foot={<span className="mrd-dim">all time</span>} />
      </div>

      <div className="mrd-hero" style={{ marginTop: 16 }}>
        <section className="mrd-card">
          <div className="mrd-card-hd" data-border="true">
            <div>
              <div className="mrd-card-title">Delivery log</div>
              <div className="mrd-card-sub">newest first</div>
            </div>
            <Badge>{list.length}</Badge>
          </div>
          {logs.isLoading ? (
            <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}><Skeleton height={16} /><Skeleton height={16} /><Skeleton height={16} /></div>
          ) : list.length === 0 ? (
            <Empty title="No notifications yet" description="Quando o engine emitir um evento e houver um canal ativo, a tentativa aparece aqui." />
          ) : (
            <div className="mrd-list">
              {list.map((l) => (
                <div className="mrd-list-item" key={l.id}>
                  <span className="mrd-asset-ico" style={{ background: "var(--surface-2)", color: statusTone(l.status) === "neg" ? "var(--negative)" : "var(--positive)" }}>
                    <Icon name="alerts" size={14} />
                  </span>
                  <div className="mrd-list-main">
                    <div className="mrd-list-title">
                      {l.eventType ?? l.type ?? "event"}
                      <Badge tone={statusTone(l.status)}>{l.status ?? "unknown"}</Badge>
                    </div>
                    <div className="mrd-list-sub">
                      {l.channelId ? nameOf.get(l.channelId) ?? l.channelId : "no channel"} · {l.message ?? l.error ?? "no detail"}
                    </div>
                  </div>
                  <span className="mrd-dim" style={{ fontSize: 11 }}>{stampUtc(l.sentAt ?? l.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mrd-side">
          <Card title="Channels" sub={`${chans.length} configured`}>
            {channels.isLoading ? (
              <Skeleton height={16} />
            ) : chans.length === 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                <p className="mrd-dim" style={{ fontSize: 12.5 }}>Nenhum canal configurado. Crie um para receber kill switch e eventos de posição.</p>
                <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" onClick={openNew}>Criar canal</button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {chans.map((c) => (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", color: "inherit" }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 550 }}>{c.name ?? c.type ?? c.id}</div>
                      <div className="mrd-dim" style={{ fontSize: 11 }}>
                        {c.type} · {(c.events?.length ?? 0) || "todos"} eventos
                      </div>
                    </button>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button
                        type="button"
                        className="mrd-btn mrd-btn-ghost mrd-btn-sm"
                        onClick={() => toggleEnabled(c)}
                        aria-pressed={c.enabled ?? c.isActive}
                      >
                        {(c.enabled ?? c.isActive) ? "on" : "off"}
                      </button>
                      <Icon name="settings" size={14} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Event types" sub="o que pode disparar um alerta">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(eventTypes.length ? eventTypes : ["trade", "risk", "kill_switch", "engine", "system"]).map((t) => (
                <span key={eventValue(t)} className="mrd-chip" style={{ height: 22, fontSize: 11 }}>{eventLabel(t)}</span>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {draft ? (
        <div className="mrd-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}>
          <div className="mrd-modal" role="dialog" aria-modal="true" aria-label={draft.id ? "Editar canal" : "Novo canal"} style={{ width: "min(620px, 100%)" }}>
            <div className="mrd-modal-hd">
              <h2>{draft.id ? "Editar canal" : "Novo canal"}</h2>
              <p>O engine envia os eventos marcados abaixo; sem eventos selecionados, envia todos.</p>
            </div>
            <div className="mrd-modal-body" style={{ display: "grid", gap: 12 }}>
              <div className="mrd-form-grid">
                <label className="mrd-field" style={{ gridColumn: "span 2" }}>
                  <span>Nome</span>
                  <input className="mrd-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Alertas do operador" />
                </label>
                <label className="mrd-field">
                  <span>Tipo</span>
                  <select
                    className="mrd-input"
                    value={draft.type}
                    onChange={(e) => setDraft({ ...draft, type: e.target.value as ChannelType, config: {} })}
                  >
                    <option value="telegram">Telegram</option>
                    <option value="discord">Discord</option>
                    <option value="webhook">Webhook</option>
                  </select>
                </label>
              </div>

              {TYPE_FIELDS[draft.type].map((f) => (
                <label className="mrd-field" key={f.key}>
                  <span>{f.label}</span>
                  <input
                    className="mrd-input"
                    value={draft.config[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, config: { ...draft.config, [f.key]: e.target.value } })}
                    placeholder={f.placeholder}
                    type={f.key === "botToken" || f.key === "secret" ? "password" : "text"}
                  />
                </label>
              ))}

              <label className="mrd-field">
                <span>Throttle (segundos entre mensagens)</span>
                <input
                  className="mrd-input"
                  type="number"
                  min={0}
                  value={draft.throttleSec}
                  onChange={(e) => setDraft({ ...draft, throttleSec: Number(e.target.value) })}
                />
              </label>

              <div>
                <div className="mrd-field" style={{ marginBottom: 6 }}><span>Eventos</span></div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(eventTypes.length ? eventTypes : []).map((t) => {
                    const value = eventValue(t);
                    const on = draft.events.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        className="mrd-chip"
                        aria-pressed={on}
                        style={{
                          borderColor: on ? "var(--brand)" : "var(--line-strong)",
                          background: on ? "var(--brand-soft)" : "var(--surface-2)",
                          color: on ? "var(--text)" : "var(--text-2)",
                        }}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            events: on ? draft.events.filter((x) => x !== value) : [...draft.events, value],
                          })
                        }
                      >
                        {eventLabel(t)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                Canal ativo
              </label>
            </div>
            <div className="mrd-modal-foot" style={{ justifyContent: draft.id ? "space-between" : "flex-end" }}>
              {draft.id ? (
                <button
                  type="button"
                  className="mrd-btn mrd-btn-ghost"
                  onClick={() => remove.mutate(draft.id!)}
                  disabled={remove.isPending}
                >
                  Remover
                </button>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="mrd-btn mrd-btn-ghost" onClick={() => setDraft(null)}>Cancelar</button>
                <button
                  type="button"
                  className="mrd-btn mrd-btn-primary"
                  disabled={!draftValid || save.isPending}
                  onClick={() => save.mutate(draft)}
                >
                  {save.isPending ? "Salvando…" : draft.id ? "Salvar" : "Criar canal"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
