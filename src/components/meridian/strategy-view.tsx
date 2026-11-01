"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost, type EngineConfig, type GraduationState, type RoundRow, type RuntimeStatus } from "./api";
import { Icon } from "./icons";
import { Badge, Card, Meter, Ring, Skeleton } from "./ui";
import { duration, signedUsd } from "@/lib/meridian/format";

interface ScheduleResponse {
  schedule?: {
    enabled?: boolean;
    startHourUtc?: number;
    endHourUtc?: number;
    daysOfWeek?: string | number[];
    timezone?: string;
  } | null;
  status?: { withinWindow?: boolean; nextChangeAt?: string | null } | null;
}

const STRATEGIES: { id: string; label: string; blurb: string }[] = [
  { id: "scalp", label: "Scalp", blurb: "short holds, tight stops, high frequency" },
  { id: "day", label: "Day", blurb: "session momentum with a daily exit" },
  { id: "swing", label: "Swing", blurb: "multi-day trend, wider invalidation" },
];

export function StrategyView() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<EngineConfig>>({});

  const config = useQuery<EngineConfig>({
    queryKey: ["mrd", "config"],
    queryFn: () => apiGet<EngineConfig>("/api/config"),
  });
  const status = useQuery<RuntimeStatus>({
    queryKey: ["mrd", "status"],
    queryFn: () => apiGet<RuntimeStatus>("/api/runtime/status"),
    refetchInterval: 15_000,
  });
  const rounds = useQuery<RoundRow[]>({
    queryKey: ["mrd", "rounds"],
    queryFn: () => apiGet<RoundRow[]>("/api/rounds"),
    refetchInterval: 30_000,
  });
  const graduation = useQuery<GraduationState>({
    queryKey: ["mrd", "graduation"],
    queryFn: () => apiGet<GraduationState>("/api/graduation"),
    retry: 0,
  });
  const schedule = useQuery<ScheduleResponse>({
    queryKey: ["mrd", "schedule"],
    queryFn: () => apiGet<ScheduleResponse>("/api/schedule"),
    retry: 0,
  });

  const cfg = config.data;
  const save = useMutation({
    mutationFn: (patch: Partial<EngineConfig>) => apiPost<EngineConfig>("/api/config", patch),
    onSuccess: () => {
      toast.success("Settings saved", { description: "Applied on the next round." });
      setEditing(false);
      setDraft({});
      void qc.invalidateQueries({ queryKey: ["mrd", "config"] });
    },
    onError: (err: Error) => toast.error("Could not save", { description: err.message }),
  });

  const engine = useMutation({
    mutationFn: (action: "start" | "stop") => apiPost<{ ok: boolean }>(`/api/engine/${action}`),
    onSuccess: (_r, action) => {
      toast.success(action === "start" ? "Engine started" : "Engine paused");
      void qc.invalidateQueries({ queryKey: ["mrd", "status"] });
      void qc.invalidateQueries({ queryKey: ["mrd", "config"] });
    },
    onError: (err: Error) => toast.error("Engine action failed", { description: err.message }),
  });

  const running = status.data?.runtime === "RUNNING";
  const value = (key: keyof EngineConfig, fallback: number) =>
    Number(draft[key] ?? (cfg?.[key] as number | undefined) ?? fallback);
  const set = (key: keyof EngineConfig, v: number) => setDraft((d) => ({ ...d, [key]: v }));
  const dirty = Object.keys(draft).length > 0;

  const strategies = useMemo(() => {
    const current = new Set(draft.enabledStrategies ?? cfg?.enabledStrategies ?? []);
    return STRATEGIES.map((s) => ({ ...s, on: current.has(s.id) }));
  }, [draft.enabledStrategies, cfg?.enabledStrategies]);

  const toggleStrategy = (id: string) => {
    const current = new Set(draft.enabledStrategies ?? cfg?.enabledStrategies ?? []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    setDraft((d) => ({ ...d, enabledStrategies: [...current] }));
    setEditing(true);
  };

  const cyclesPassed = Number(graduation.data?.cyclesPassed ?? cfg?.paperCyclesPassed ?? 0);
  const cyclesRequired = Number(graduation.data?.cyclesRequired ?? cfg?.paperCyclesRequired ?? 50);
  const cyclesPct = cyclesRequired > 0 ? Math.min(100, (cyclesPassed / cyclesRequired) * 100) : 0;

  const fields: { key: keyof EngineConfig; label: string; hint: string; step?: number }[] = [
    { key: "loopIntervalSec", label: "Loop interval (s)", hint: "minimum 30s" },
    { key: "maxPositionsPerRound", label: "Positions per round", hint: "concurrency cap" },
    { key: "takeProfitPct", label: "Take profit (%)", hint: "default exit target" },
    { key: "stopLossPct", label: "Stop loss (%)", hint: "hard invalidation" },
    { key: "maxHoldMinutes", label: "Max hold (min)", hint: "time-based exit" },
  ];

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Strategy &amp; engine</h1>
            <span className="mrd-status">
              <Badge tone={cfg?.mode === "live" ? "neg" : "warn"}>{cfg?.mode ?? "paper"}</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }} aria-live="polite">
                {running ? `running · ${status.data?.rounds.ok ?? 0} rounds ok` : "stopped"}
              </span>
            </span>
          </div>
          <p className="mrd-sub">
            The engine can tighten these limits, never loosen them. Changes are written to the config and apply on the
            next round — no restart needed.
          </p>
        </div>
        <div className="mrd-actions">
          <button
            type="button"
            className="mrd-btn mrd-btn-ghost mrd-btn-sm"
            onClick={() => {
              const blob = new Blob([JSON.stringify(cfg ?? {}, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "engine-config.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Icon name="up" size={15} /> Export config
          </button>
          {editing ? (
            <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" onClick={() => { setEditing(false); setDraft({}); }}>
              Discard
            </button>
          ) : null}
          <button
            type="button"
            className="mrd-btn mrd-btn-primary mrd-btn-sm"
            onClick={() => (editing ? save.mutate(draft) : setEditing(true))}
            disabled={save.isPending || (editing && !dirty)}
          >
            {editing ? (save.isPending ? "Saving…" : "Save changes") : "Edit settings"}
          </button>
        </div>
      </header>

      <div className="mrd-hero">
        <div className="mrd-stack" style={{ display: "grid", gap: 16 }}>
          <section className="mrd-card">
            <div className="mrd-card-body" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 16, flex: 1, minWidth: 260, alignItems: "center" }}>
                <Ring
                  value={status.data && status.data.rounds.started > 0 ? status.data.rounds.ok / status.data.rounds.started : 0}
                  label={status.data ? `${Math.round((status.data.rounds.ok / Math.max(1, status.data.rounds.started)) * 100)}%` : "—"}
                />
                <div>
                  <div className="mrd-title-row" style={{ gap: 8 }}>
                    <b style={{ fontSize: 16 }}>{running ? "Engine running" : "Engine stopped"}</b>
                    <Badge tone={running ? "pos" : "warn"}>{running ? "live loop" : "idle"}</Badge>
                  </div>
                  <div className="mrd-dim" style={{ fontSize: 12, marginTop: 3 }}>
                    {status.data
                      ? `${status.data.rounds.started} rounds · ${status.data.rounds.failed} failed · uptime ${duration(status.data.uptime * 1000)}`
                      : "runtime not attached"}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 24 }} className="hide-sm">
                <div>
                  <div className="mrd-dim" style={{ fontSize: 11 }}>Rounds (24h)</div>
                  <b>{rounds.data?.length ?? 0}</b>
                </div>
                <div>
                  <div className="mrd-dim" style={{ fontSize: 11 }}>Last P&L</div>
                  <b className={(rounds.data?.[0]?.roundPnlUsd ?? 0) >= 0 ? "mrd-pos" : "mrd-neg"}>
                    {signedUsd(rounds.data?.[0]?.roundPnlUsd ?? 0)}
                  </b>
                </div>
              </div>
              <button
                type="button"
                className={`mrd-btn ${running ? "mrd-btn-secondary" : "mrd-btn-primary"} mrd-btn-sm`}
                onClick={() => engine.mutate(running ? "stop" : "start")}
                disabled={engine.isPending}
              >
                {running ? "Pause engine" : "Start engine"}
              </button>
            </div>
          </section>

          <section className="mrd-card">
            <div className="mrd-card-hd" data-border="true">
              <div>
                <div className="mrd-card-title">Runtime settings</div>
                <div className="mrd-card-sub">Loop, exits and concurrency</div>
              </div>
              {editing ? <Badge tone="brand">editing</Badge> : null}
            </div>
            <div className="mrd-card-body">
              {config.isLoading ? (
                <div style={{ display: "grid", gap: 10 }}><Skeleton height={18} /><Skeleton height={18} /></div>
              ) : (
                <div className="mrd-form-grid">
                  {fields.map((f) => (
                    <label key={String(f.key)} className="mrd-field">
                      <span>{f.label}</span>
                      <input
                        className="mrd-input"
                        type="number"
                        inputMode="decimal"
                        aria-label={f.label}
                        value={value(f.key, 0)}
                        onChange={(e) => { set(f.key, Number(e.target.value)); setEditing(true); }}
                        disabled={!editing}
                      />
                      <small className="mrd-dim">{f.hint}</small>
                    </label>
                  ))}
                  <label className="mrd-field">
                    <span>Mode</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 32 }}>
                      <Badge tone={cfg?.mode === "live" ? "neg" : "warn"}>{cfg?.mode ?? "paper"}</Badge>
                      <span className="mrd-dim" style={{ fontSize: 11 }}>live needs 50 cycles + MFA</span>
                    </div>
                  </label>
                </div>
              )}
            </div>
          </section>

          <section className="mrd-card">
            <div className="mrd-card-hd" data-border="true">
              <div>
                <div className="mrd-card-title">Strategies</div>
                <div className="mrd-card-sub">Allocation is decided per round by the engine</div>
              </div>
              <Badge>{strategies.filter((s) => s.on).length} enabled</Badge>
            </div>
            <div className="mrd-list">
              {strategies.map((s) => (
                <div className="mrd-list-item" key={s.id}>
                  <span className="mrd-asset-ico" style={{ background: "linear-gradient(145deg,#2b3140,#1d2129)" }}>
                    {s.label.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="mrd-list-main">
                    <div className="mrd-list-title">{s.label}</div>
                    <div className="mrd-list-sub">{s.blurb}</div>
                  </div>
                  <button
                    type="button"
                    className={`mrd-btn mrd-btn-sm ${s.on ? "mrd-btn-secondary" : "mrd-btn-ghost"}`}
                    aria-pressed={s.on}
                    onClick={() => toggleStrategy(s.id)}
                  >
                    {s.on ? "Enabled" : "Disabled"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="mrd-side">
          <Card title="Graduation to live" sub={`${cyclesPassed} / ${cyclesRequired} positive cycles`}>
            <Meter value={cyclesPct} label="Graduation progress" tone="pos" />
            <p className="mrd-dim" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
              Live trading unlocks when the window is full and no risk incident is open. It still requires your explicit
              confirmation with MFA.
            </p>
            <dl className="mrd-kv" style={{ marginTop: 14 }}>
              <dt>Graduated</dt>
              <dd>{cfg?.graduatedToLive ? "yes" : "no"}</dd>
              <dt>Kill switch</dt>
              <dd className={cfg?.killSwitchActive ? "mrd-neg" : "mrd-pos"}>{cfg?.killSwitchActive ? "active" : "clear"}</dd>
              <dt>Est. unlock</dt>
              <dd>{cyclesRequired > cyclesPassed ? `${cyclesRequired - cyclesPassed} cycles` : "ready"}</dd>
            </dl>
          </Card>

          <Card title="Trading window" sub={schedule.data?.schedule?.timezone ?? "engine schedule"}>
            {schedule.data?.schedule ? (
              <dl className="mrd-kv">
                <dt>Enabled</dt>
                <dd>{schedule.data.schedule.enabled ? "yes" : "no"}</dd>
                <dt>Hours (UTC)</dt>
                <dd>
                  {schedule.data.schedule.startHourUtc ?? "—"}–{schedule.data.schedule.endHourUtc ?? "—"}
                </dd>
                <dt>Inside window</dt>
                <dd className={schedule.data.status?.withinWindow ? "mrd-pos" : "mrd-dim"}>
                  {schedule.data.status?.withinWindow ? "yes" : "no"}
                </dd>
              </dl>
            ) : (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>
                No custom schedule: the engine runs continuously. Schedule editing arrives with the next phase.
              </p>
            )}
          </Card>

          <Card title="Recent rounds" sub="latest first">
            {rounds.isLoading ? (
              <Skeleton height={16} />
            ) : rounds.data?.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {rounds.data.slice(0, 4).map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span className="mrd-muted">R-{r.id}</span>
                    <span className={r.roundPnlUsd >= 0 ? "mrd-pos" : "mrd-neg"}>{signedUsd(r.roundPnlUsd)}</span>
                    <span className="mrd-dim">{r.positionsOpened} opened</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>No rounds recorded yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
