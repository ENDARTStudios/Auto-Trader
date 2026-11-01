"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  apiGet,
  apiPost,
  type AnalyticsResponse,
  type EngineConfig,
  type PositionRow,
  type RiskScaleResponse,
  type RuntimeStatus,
  type SurveillanceAlert,
} from "./api";
import { Icon } from "./icons";
import { Badge, Card, Dot, Empty, Meter, Skeleton } from "./ui";
import { pct, signedUsd, clockUtc } from "@/lib/meridian/format";

const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

export function RiskView() {
  const qc = useQueryClient();
  const [killOpen, setKillOpen] = useState(false);
  const [halt, setHalt] = useState("");
  const [reason, setReason] = useState("");

  const config = useQuery<EngineConfig>({
    queryKey: ["mrd", "config"],
    queryFn: () => apiGet<EngineConfig>("/api/config"),
  });
  const status = useQuery<RuntimeStatus>({
    queryKey: ["mrd", "status"],
    queryFn: () => apiGet<RuntimeStatus>("/api/runtime/status"),
    refetchInterval: 15_000,
  });
  const daily = useQuery<AnalyticsResponse>({
    queryKey: ["mrd", "analytics", "24h"],
    queryFn: () => apiGet<AnalyticsResponse>("/api/analytics?range=24h"),
    refetchInterval: 60_000,
  });
  const monthly = useQuery<AnalyticsResponse>({
    queryKey: ["mrd", "analytics", "30d"],
    queryFn: () => apiGet<AnalyticsResponse>("/api/analytics?range=30d"),
    refetchInterval: 60_000,
  });
  const positions = useQuery<PositionRow[]>({
    queryKey: ["mrd", "positions"],
    queryFn: () => apiGet<PositionRow[]>("/api/positions"),
    refetchInterval: 20_000,
  });
  const scale = useQuery<RiskScaleResponse>({
    queryKey: ["mrd", "risk-scale"],
    queryFn: () => apiGet<RiskScaleResponse>("/api/risk-scale"),
    retry: 0,
  });
  const surveillance = useQuery<SurveillanceAlert[] | { alerts?: SurveillanceAlert[] }>({
    queryKey: ["mrd", "surveillance"],
    queryFn: () => apiGet<SurveillanceAlert[] | { alerts?: SurveillanceAlert[] }>("/api/surveillance?limit=6"),
    retry: 0,
  });

  const cfg = config.data;
  const killActive = Boolean(cfg?.killSwitchActive);

  const kill = useMutation({
    mutationFn: (active: boolean) =>
      apiPost<{ ok: boolean }>("/api/kill-switch", active ? { active: true, reason: reason || "Manual kill via dashboard" } : { active: false }),
    onSuccess: (_r, active) => {
      toast[active ? "error" : "success"](active ? "Kill switch active" : "Kill switch cleared", {
        description: active ? "Entries stopped; open positions will be flattened." : "Engine may be started again.",
      });
      setKillOpen(false);
      setHalt("");
      setReason("");
      void qc.invalidateQueries({ queryKey: ["mrd", "config"] });
      void qc.invalidateQueries({ queryKey: ["mrd", "status"] });
    },
    onError: (err: Error) => toast.error("Kill switch failed", { description: err.message }),
  });

  const deployed = sum((positions.data ?? []).map((p) => p.entryAmountUsd));
  const equity = monthly.data?.summary.endEquityUsd ?? 0;
  const exposurePct = equity > 0 ? (deployed / equity) * 100 : 0;
  const exposureCap = Math.max(0, 100 - Number(cfg?.reservePct ?? 50));
  const dailyPnlPct = daily.data?.summary.pctChange ?? 0;
  const dailyLossPct = dailyPnlPct < 0 ? Math.abs(dailyPnlPct) : 0;
  const drawdownPct = Math.abs(monthly.data?.summary.maxDrawdownPct ?? 0);
  const dailyCap = Number(cfg?.maxDailyLossPct ?? 0);
  const drawdownCap = Number(cfg?.maxDrawdownPct ?? 0);

  const breakers = useMemo(
    () => [
      { name: "Kill switch", detail: "manual or automatic halt", fired: killActive, current: killActive ? "active" : "clear" },
      { name: "Daily loss", detail: `cap ${dailyCap}% of equity`, fired: dailyCap > 0 && dailyLossPct >= dailyCap, current: `${dailyLossPct.toFixed(2)}%` },
      { name: "Drawdown", detail: `cap ${drawdownCap}% from peak`, fired: drawdownCap > 0 && drawdownPct >= drawdownCap, current: `${drawdownPct.toFixed(2)}%` },
      { name: "Exposure", detail: `cash floor ${cfg?.reservePct ?? 0}%`, fired: exposurePct > exposureCap, current: `${exposurePct.toFixed(1)}%` },
      {
        name: "Engine errors",
        detail: "rpc / signer / broadcast",
        fired: Boolean(status.data && (status.data.errors.rpc + status.data.errors.signer + status.data.errors.broadcast) > 0),
        current: status.data ? String(status.data.errors.rpc + status.data.errors.signer + status.data.errors.broadcast) : "—",
      },
    ],
    [killActive, dailyCap, dailyLossPct, drawdownCap, drawdownPct, exposurePct, exposureCap, cfg?.reservePct, status.data]
  );

  const rawAlerts = surveillance.data;
  const alerts: SurveillanceAlert[] = Array.isArray(rawAlerts) ? rawAlerts : rawAlerts?.alerts ?? [];
  const openAlerts = alerts.filter((a) => !a.resolvedAt);
  const allClear = !killActive && breakers.every((b) => !b.fired);

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Risk &amp; safety</h1>
            <span className="mrd-status">
              <Badge tone={killActive ? "neg" : allClear ? "pos" : "warn"}>
                {killActive ? "halted" : allClear ? "all clear" : "attention"}
              </Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>
                {openAlerts.length} open surveillance alert{openAlerts.length === 1 ? "" : "s"}
              </span>
            </span>
          </div>
          <p className="mrd-sub">
            The only page allowed to stop the machine. Limits here are human-owned; the engine can tighten them but
            never loosen them.
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" disabled title="Drills arrive in phase 2">
            <Icon name="risk" size={15} /> Run drill
          </button>
          {killActive ? (
            <button
              type="button"
              className="mrd-btn mrd-btn-secondary mrd-btn-sm"
              onClick={() => kill.mutate(false)}
              disabled={kill.isPending}
            >
              Clear kill switch
            </button>
          ) : (
            <button type="button" className="mrd-btn mrd-btn-danger-solid mrd-btn-sm" onClick={() => setKillOpen(true)}>
              <Icon name="power" size={15} /> Kill switch
            </button>
          )}
        </div>
      </header>

      <div className="mrd-hero">
        <section className="mrd-card" style={{ borderColor: "color-mix(in srgb, var(--critical) 32%, var(--line))" }}>
          <div className="mrd-card-body" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div className="mrd-card-title">
                <Icon name="power" size={17} /> Emergency stop
              </div>
              <Badge tone={killActive ? "neg" : "neutral"}>{killActive ? "active" : "armed"}</Badge>
            </div>
            <p className="mrd-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              Halts entries immediately and force-exits every open position on the next tick. Requires typing
              <b> HALT </b> and is written to the audit log with your user id.
            </p>
            {killActive ? (
              <div className="mrd-banner" role="alert">
                <Icon name="risk" size={16} />
                <div className="grow">
                  Active since {clockUtc(cfg?.killSwitchAt ?? null)} UTC — {cfg?.killSwitchReason ?? "no reason recorded"}.
                </div>
              </div>
            ) : (
              <button type="button" className="mrd-btn mrd-btn-danger-solid" onClick={() => setKillOpen(true)} style={{ width: "fit-content" }}>
                Trigger kill switch
              </button>
            )}
            <div className="mrd-dim" style={{ fontSize: 11.5 }}>
              Last change: {cfg?.killSwitchAt ? `${clockUtc(cfg.killSwitchAt)} UTC` : "never triggered"}
            </div>
          </div>
        </section>

        <Card title="Risk budget" sub={`caps from config · ${cfg?.mode ?? "paper"} mode`}>
          <div style={{ display: "grid", gap: 14 }}>
            <BudgetRow label="Daily loss" value={dailyLossPct} cap={dailyCap} suffix="%" />
            <BudgetRow label="Drawdown" value={drawdownPct} cap={drawdownCap} suffix="%" />
            <BudgetRow label="Exposure" value={exposurePct} cap={exposureCap} suffix="%" />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
              <span className="mrd-muted">Risk per trade</span>
              <span><b>{Number(cfg?.maxLossPerTradePct ?? 0).toFixed(2)}%</b> <span className="mrd-dim">hard cap, not a target</span></span>
            </div>
          </div>
          <div className="mrd-dim" style={{ fontSize: 11.5, marginTop: 12 }}>
            Exposure cap derives from the reserve floor ({cfg?.reservePct ?? 0}%).
          </div>
        </Card>
      </div>

      <div className="mrd-lower" style={{ marginTop: 16 }}>
        <section className="mrd-card">
          <div className="mrd-card-hd" data-border="true">
            <div>
              <div className="mrd-card-title">Circuit breakers</div>
              <div className="mrd-card-sub">Evaluated before every order</div>
            </div>
            <Badge tone={breakers.some((b) => b.fired) ? "neg" : "pos"}>
              {breakers.filter((b) => b.fired).length} fired
            </Badge>
          </div>
          <div className="mrd-list">
            {breakers.map((b) => (
              <div className="mrd-list-item" key={b.name}>
                <span
                  className="mrd-asset-ico"
                  style={{ background: b.fired ? "var(--critical-soft)" : "var(--surface-2)", color: b.fired ? "var(--critical)" : "var(--positive)" }}
                >
                  <Icon name="risk" size={14} />
                </span>
                <div className="mrd-list-main">
                  <div className="mrd-list-title">
                    {b.name} <Badge tone={b.fired ? "neg" : "pos"}>{b.fired ? "fired" : "armed"}</Badge>
                  </div>
                  <div className="mrd-list-sub">{b.detail}</div>
                </div>
                <b className={b.fired ? "mrd-neg" : "mrd-muted"}>{b.current}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="mrd-card">
          <div className="mrd-card-hd" data-border="true">
            <div>
              <div className="mrd-card-title">Scam surveillance</div>
              <div className="mrd-card-sub">Tokens inspected before any entry</div>
            </div>
            <Badge>{alerts.length} alerts</Badge>
          </div>
          {surveillance.isLoading ? (
            <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}><Skeleton height={16} /><Skeleton height={16} /></div>
          ) : alerts.length === 0 ? (
            <Empty title="No surveillance alerts" description="Nothing suspicious has been flagged in the current window." />
          ) : (
            <div className="mrd-list">
              {alerts.map((a) => (
                <div className="mrd-list-item" key={a.id}>
                  <span className="mrd-asset-ico" style={{ background: "var(--surface-2)", color: a.resolvedAt ? "var(--text-3)" : "var(--warning)" }}>
                    <Icon name="risk" size={14} />
                  </span>
                  <div className="mrd-list-main">
                    <div className="mrd-list-title">
                      {a.title ?? a.symbol ?? "Alert"}
                      <Badge tone={a.resolvedAt ? "neutral" : "warn"}>{a.resolvedAt ? "resolved" : "open"}</Badge>
                    </div>
                    <div className="mrd-list-sub">{a.message ?? a.severity ?? "—"}</div>
                  </div>
                  <span className="mrd-dim" style={{ fontSize: 11 }}>{clockUtc(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="mrd-lower" style={{ marginTop: 16, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <Card title="Risk scale" sub={scale.data ? `${scale.data.assessment.tradesClosed} closed trades in the window` : "win-rate based sizing"}>
          {scale.data ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <b style={{ fontSize: 26, letterSpacing: "-0.02em" }}>{(scale.data.assessment.winRate * 100).toFixed(1)}%</b>
                <span className="mrd-dim" style={{ fontSize: 12 }}>win rate</span>
                <Badge tone={scale.data.assessment.applied ? "brand" : "neutral"}>{scale.data.assessment.band.label}</Badge>
              </div>
              <p className="mrd-muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
                {scale.data.assessment.band.description}. Multiplier ×{scale.data.assessment.multiplier.toFixed(2)} ·
                {" "}{scale.data.assessment.applied ? "applied" : scale.data.assessment.reason ?? "not applied (insufficient data)"}.
              </p>
            </>
          ) : scale.isLoading ? (
            <Skeleton height={20} />
          ) : (
            <p className="mrd-dim" style={{ fontSize: 12.5 }}>Risk scaling is not enabled in this workspace.</p>
          )}
        </Card>

        <Card title="Position limits" sub="enforced by the diversity guard">
          <dl className="mrd-kv">
            <dt>Per round</dt>
            <dd>{cfg?.maxPositionsPerRound ?? "—"}</dd>
            <dt>Per symbol</dt>
            <dd>{String((cfg as unknown as { maxPositionsPerSymbol?: number })?.maxPositionsPerSymbol ?? "—")}</dd>
            <dt>Engine errors</dt>
            <dd className={(status.data?.errors.rpc ?? 0) + (status.data?.errors.signer ?? 0) > 0 ? "mrd-neg" : "mrd-pos"}>
              {status.data ? status.data.errors.rpc + status.data.errors.signer + status.data.errors.broadcast : "—"}
            </dd>
            <dt>RPC quorum</dt>
            <dd>{status.data ? `${status.data.rpc.quorumHealthy} healthy · ${status.data.rpc.unhealthy} unhealthy` : "—"}</dd>
          </dl>
        </Card>
      </div>

      {killOpen ? (
        <div className="mrd-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setKillOpen(false)}>
          <div className="mrd-modal" role="dialog" aria-modal="true" aria-label="Trigger kill switch">
            <div className="mrd-modal-hd">
              <h2>Trigger kill switch?</h2>
              <p>Immediately stops entries and flattens every open position on the next tick. This is logged in the audit trail.</p>
            </div>
            <div className="mrd-modal-body" style={{ display: "grid", gap: 12 }}>
              <div className="mrd-banner" role="alert">
                <Icon name="risk" size={16} />
                <div className="grow">This is the only action that stops execution instantly.</div>
              </div>
              <label className="mrd-field">
                <span>Reason (recorded in the audit log)</span>
                <input className="mrd-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="exchange maintenance" maxLength={200} />
              </label>
              <label className="mrd-field">
                <span>Type <b>HALT</b> to confirm</span>
                <input className="mrd-input" value={halt} onChange={(e) => setHalt(e.target.value)} placeholder="HALT" autoComplete="off" />
              </label>
            </div>
            <div className="mrd-modal-foot">
              <button type="button" className="mrd-btn mrd-btn-ghost" onClick={() => setKillOpen(false)}>Cancel</button>
              <button
                type="button"
                className="mrd-btn mrd-btn-danger-solid"
                disabled={halt.trim().toUpperCase() !== "HALT" || kill.isPending}
                onClick={() => kill.mutate(true)}
              >
                {kill.isPending ? "Halting…" : "Trigger kill switch"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {killActive ? (
        <div className="mrd-banner" style={{ marginTop: 16 }} role="status">
          <Icon name="power" size={16} />
          <div className="grow">Kill switch is active: entries are blocked and open positions are being flattened.</div>
        </div>
      ) : null}
    </>
  );
}

function BudgetRow({ label, value, cap, suffix, hint }: { label: string; value: number; cap: number; suffix: string; hint?: string }) {
  const pctOfCap = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;
  const tone = pctOfCap >= 90 ? "neg" : pctOfCap >= 70 ? "warn" : "pos";
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
        <span className="mrd-muted">{label}</span>
        <span>
          <b className={value > 0 && pctOfCap >= 90 ? "mrd-neg" : undefined}>
            {value.toFixed(2)}
            {suffix}
          </b>{" "}
          <span className="mrd-dim">of {cap.toFixed(2)}{suffix}</span>
        </span>
      </div>
      <Meter value={pctOfCap} label={`${label} usage`} tone={tone as "pos" | "warn" | "neg"} />
      {hint ? <span className="mrd-dim" style={{ fontSize: 10.5 }}>{hint}</span> : null}
    </div>
  );
}
