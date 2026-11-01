"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
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

interface Channel {
  id: string;
  type?: string;
  name?: string;
  enabled?: boolean;
  isActive?: boolean;
  config?: unknown;
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

const eventLabel = (t: EventType) => (typeof t === "string" ? t : t.label ?? t.value);

const statusTone = (s?: string | null) =>
  s === "sent" || s === "delivered" || s === "ok" ? "pos" : s === "failed" || s === "error" ? "neg" : "warn";

export function AlertsView() {
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

  const list = logs.data?.logs ?? [];
  const chans = channels.data?.channels ?? [];
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of chans) map.set(c.id, c.name ?? c.type ?? c.id);
    return map;
  }, [chans]);

  const sent = list.filter((l) => statusTone(l.status) === "pos").length;
  const failed = list.filter((l) => statusTone(l.status) === "neg").length;

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
            Delivery history for every notification the engine emitted. Channels are configured in the legacy settings
            until the new channel editor lands — this page is the audit view.
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={() => logs.refetch()}>
            <Icon name="activity" size={15} /> Refresh
          </button>
          <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" disabled title="Channel editor arrives with Settings">
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
            <Empty title="No notifications yet" description="When the engine emits an event and a channel is configured, the attempt is recorded here." />
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
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>No channels configured. Add one in Settings to start receiving events.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {chans.map((c) => (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 550 }}>{c.name ?? c.type ?? c.id}</div>
                      <div className="mrd-dim" style={{ fontSize: 11 }}>{(c.enabled ?? c.isActive) ? "enabled" : "disabled"}</div>
                    </div>
                    <Badge tone={(c.enabled ?? c.isActive) ? "pos" : "neutral"}>{(c.enabled ?? c.isActive) ? "on" : "off"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Event types" sub="what can trigger an alert">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(channels.data?.eventTypes ?? ["trade", "risk", "kill_switch", "engine", "system"]).map((t) => (
                <span key={eventLabel(t)} className="mrd-chip" style={{ height: 22, fontSize: 11 }}>{eventLabel(t)}</span>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
