"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  apiGet,
  apiPost,
  type AnalyticsResponse,
  type GraduationState,
  type InsightRow,
  type PositionRow,
  type RoundRow,
  type RuntimeStatus,
} from "./api";
import { Icon } from "./icons";
import { AreaChart } from "./area-chart";
import { AssetIcon, Badge, Card, colorFor, Delta, Dot, Empty, Kpi, Meter, Ring, Skeleton } from "./ui";
import { money, pct, price, relative, signedUsd, usd } from "@/lib/meridian/format";

type Range = "24h" | "7d" | "30d" | "all";
const RANGES: { id: Range; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "1W" },
  { id: "30d", label: "1M" },
  { id: "all", label: "ALL" },
];

const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

function paperProgress(graduation?: GraduationState) {
  if (!graduation) return null;
  const passed = Number(graduation.cyclesPassed ?? graduation.paperCycles ?? NaN);
  const required = Number(graduation.cyclesRequired ?? graduation.requiredCycles ?? NaN);
  if (Number.isFinite(passed) && Number.isFinite(required) && required > 0) {
    return { passed, required, pct: Math.min(100, (passed / required) * 100) };
  }
  const p = Number(graduation.progressPct);
  if (Number.isFinite(p)) return { passed: NaN, required: NaN, pct: Math.min(100, p) };
  return null;
}

export function OverviewView() {
  const [range, setRange] = useState<Range>("30d");
  const qc = useQueryClient();

  const status = useQuery<RuntimeStatus>({
    queryKey: ["mrd", "status"],
    queryFn: () => apiGet<RuntimeStatus>("/api/runtime/status"),
    refetchInterval: 15_000,
  });
  const positions = useQuery<PositionRow[]>({
    queryKey: ["mrd", "positions"],
    queryFn: () => apiGet<PositionRow[]>("/api/positions"),
    refetchInterval: 20_000,
  });
  const analytics = useQuery<AnalyticsResponse>({
    queryKey: ["mrd", "analytics", range],
    queryFn: () => apiGet<AnalyticsResponse>(`/api/analytics?range=${range}`),
    refetchInterval: 60_000,
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
  const insights = useQuery<InsightRow[]>({
    queryKey: ["mrd", "insights"],
    queryFn: () => apiGet<InsightRow[]>("/api/ai-insights?limit=1"),
    retry: 0,
  });

  const running = status.data?.runtime === "RUNNING";

  const engine = useMutation({
    mutationFn: (action: "start" | "stop") => apiPost<{ ok: boolean }>(`/api/engine/${action}`),
    onSuccess: (_res, action) => {
      toast.success(action === "start" ? "Engine started" : "Engine paused", {
        description: action === "start" ? "Paper mode · entries are live." : "Open positions are no longer monitored.",
      });
      void qc.invalidateQueries({ queryKey: ["mrd", "status"] });
      void qc.invalidateQueries({ queryKey: ["mrd", "rounds"] });
    },
    onError: (err: Error) => toast.error("Engine action failed", { description: err.message }),
  });

  const summary = analytics.data?.summary;
  const curve = useMemo(
    () => (analytics.data?.equityCurve ?? []).map((p) => ({ t: new Date(p.timestamp).getTime(), v: p.totalEquityUsd })),
    [analytics.data]
  );

  const openRows = positions.data ?? [];
  const exposureUsd = sum(openRows.map((p) => p.entryAmountUsd));
  const equity = summary?.endEquityUsd ?? 0;
  const exposurePct = equity > 0 ? (exposureUsd / equity) * 100 : 0;
  const grad = paperProgress(graduation.data);
  const roundsToday = (rounds.data ?? []).filter(
    (r) => new Date(r.startedAt).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
  ).length;

  const exportCsv = () => {
    const header = ["symbol", "entry_price_usd", "entry_amount_usd", "current_price_usd", "unrealized_pnl_usd", "unrealized_pnl_pct"];
    const lines = openRows.map((p) =>
      [p.symbol, p.entryPriceUsd, p.entryAmountUsd, p.currentPriceUsd, p.unrealizedPnlUsd, p.unrealizedPnlPct].join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `positions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export started", { description: `${openRows.length} open positions.` });
  };

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Mission control</h1>
            <span className="mrd-status">
              <Badge tone="warn">Paper</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }} aria-live="polite">
                {status.isLoading
                  ? "Checking engine…"
                  : running
                    ? `Engine running · ${status.data?.rounds.ok.toLocaleString("en-US")} rounds ok`
                    : "Engine stopped"}
              </span>
            </span>
          </div>
          <p className="mrd-sub">
            {openRows.length > 0
              ? `${openRows.length} open positions, ${exposurePct.toFixed(1)}% exposure, no unresolved risk events.`
              : "Autonomous engine ready. No open positions — start the engine to let it scan and size the first trade."}
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={exportCsv}>
            <Icon name="up" size={15} /> Export
          </button>
          <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" disabled title="Backtest arrives in phase 1">
            <Icon name="backtest" size={15} /> New backtest
          </button>
          <button
            type="button"
            className="mrd-btn mrd-btn-primary mrd-btn-sm"
            onClick={() => engine.mutate(running ? "stop" : "start")}
            disabled={engine.isPending || status.isLoading}
          >
            {running ? "Pause engine" : "Start engine"}
          </button>
        </div>
      </header>

      <div className="mrd-banner" data-tone="info" style={{ marginBottom: 16 }}>
        <Icon name="activity" size={16} />
        <div className="grow">
          Paper mode — real prices, zero capital at risk.{" "}
          {grad ? (
            <>
              Live unlocks after <b>{grad.required}</b> positive cycles · <b>{grad.passed}</b>/{grad.required} completed.
            </>
          ) : (
            <>Live unlocks after 50 positive cycles.</>
          )}
        </div>
      </div>

      {analytics.isError || positions.isError ? (
        <div className="mrd-banner" style={{ marginBottom: 16 }} role="alert">
          <Icon name="risk" size={16} />
          <div className="grow">Some data could not be loaded. Retrying automatically — figures may be incomplete.</div>
        </div>
      ) : null}

      <div className="mrd-hero">
        <section className="mrd-card mrd-equity">
          <div className="mrd-card-hd">
            <div>
              <div className="mrd-card-title">Portfolio equity</div>
              <div className="mrd-card-sub">
                Net of fees · {analytics.data ? `${analytics.data.summary.snapshotCount} snapshots` : "loading…"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Badge>USD</Badge>
              <div className="mrd-range" role="group" aria-label="Time range">
                {RANGES.map((r) => (
                  <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mrd-card-body" style={{ paddingBottom: 12 }}>
            {summary ? (
              <>
                <div className="mrd-big">
                  <span className="amt">{usd(summary.endEquityUsd)}</span>
                  <span className="cur">USD</span>
                  <span className={`mrd-delta ${summary.absChangeUsd >= 0 ? "mrd-pos" : "mrd-neg"}`} style={{ fontSize: 14 }}>
                    {summary.absChangeUsd >= 0 ? "↗" : "↘"} {signedUsd(summary.absChangeUsd)} · {pct(summary.pctChange)}
                  </span>
                </div>
                <div className="mrd-meta">
                  <span>
                    Start <b>{usd(summary.startEquityUsd)}</b>
                  </span>
                  <span>
                    Peak <b>{usd(summary.maxEquityUsd)}</b>
                  </span>
                  <span>
                    Max drawdown <b className="mrd-neg">{summary.maxDrawdownPct.toFixed(2)}%</b>
                  </span>
                  <span>
                    Window <b>{range === "all" ? "all time" : range}</b>
                  </span>
                </div>
                <AreaChart
                  data={curve}
                  height={214}
                  label={`Equity curve, ${range}`}
                  emptyLabel={
                    analytics.isLoading
                      ? "Loading snapshots…"
                      : "No equity snapshots yet. Start the engine to build the curve."
                  }
                />
              </>
            ) : analytics.isLoading ? (
              <div style={{ display: "grid", gap: 14 }}>
                <Skeleton width={220} height={38} />
                <Skeleton width="70%" height={180} />
              </div>
            ) : (
              <Empty
                title="No equity yet"
                description="The engine records a snapshot after each round. Start it in paper mode — real prices, no capital."
                action={
                  <button type="button" className="mrd-btn mrd-btn-primary mrd-btn-sm" onClick={() => engine.mutate("start")}>
                    Start engine
                  </button>
                }
              />
            )}
          </div>
          <div className="mrd-card-section" style={{ borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="mrd-legend">
              <span>
                <i style={{ background: "var(--positive)" }} />
                Auto Trader
              </span>
              <span className="mrd-dim">Benchmark appears once the journal has 30 days</span>
            </div>
            <span className="mrd-dim" style={{ fontSize: 11.5 }}>
              paper ledger
            </span>
          </div>
        </section>

        <div className="mrd-side">
          <EngineCard status={status.data} loading={status.isLoading} running={running} />
          <DecisionCard insight={insights.data?.[0]} loading={insights.isLoading} />
        </div>
      </div>

      <div className="mrd-kpi-row" style={{ marginTop: 16 }}>
        <Kpi
          label="Equity"
          value={summary ? usd(summary.endEquityUsd) : "—"}
          foot={<span className="mrd-dim">{summary ? `${signedUsd(summary.absChangeUsd)} in ${range}` : "no snapshots"}</span>}
        />
        <Kpi
          label="Net return"
          value={summary ? pct(summary.pctChange) : "—"}
          valueClassName={summary ? (summary.pctChange >= 0 ? "mrd-pos" : "mrd-neg") : ""}
          foot={<span className="mrd-dim">{range === "all" ? "all time" : `last ${range}`}</span>}
        />
        <Kpi
          label="Max drawdown"
          value={summary ? `${summary.maxDrawdownPct.toFixed(2)}%` : "—"}
          valueClassName="mrd-neg"
          foot={<span className="mrd-dim">peak {summary ? usd(summary.maxEquityUsd) : "—"}</span>}
        />
        <Kpi label="Open positions" value={String(openRows.length)} foot={<span className="mrd-dim">{money(exposureUsd)} deployed</span>} />
        <Kpi
          label="Exposure"
          value={`${exposurePct.toFixed(1)}%`}
          foot={<Meter value={exposurePct} label="Exposure" tone={exposurePct > 80 ? "warn" : "pos"} />}
        />
        <Kpi label="Rounds today" value={String(roundsToday)} foot={<span className="mrd-dim">{status.data ? `${status.data.rounds.failed} failed` : "no runtime"}</span>} />
      </div>

      <div className="mrd-lower">
        <PositionsCard rows={openRows} loading={positions.isLoading} />
        <RoundsCard rounds={rounds.data ?? []} loading={rounds.isLoading} />
        <ActivityCard rounds={rounds.data ?? []} positions={openRows} />
      </div>
    </>
  );
}

function EngineCard({ status, loading, running }: { status?: RuntimeStatus; loading: boolean; running: boolean }) {
  const ringP = status && status.rounds.started > 0 ? Math.min(1, status.rounds.ok / status.rounds.started) : 0;
  return (
    <section className="mrd-card mrd-equity">
      <div className="mrd-card-hd" style={{ paddingBottom: 0 }}>
        <div>
          <div className="mrd-card-title">
            Engine <Badge tone={running ? "pos" : "warn"}>{running ? "running" : "stopped"}</Badge>
          </div>
          <div className="mrd-card-sub">Scout → decision → risk → execute</div>
        </div>
      </div>
      <div className="mrd-card-body" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Ring value={ringP} label={status ? `${Math.round(ringP * 100)}%` : "—"} />
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 14 }}>{loading ? "Checking runtime…" : `${status?.rounds.started.toLocaleString("en-US") ?? 0} rounds started`}</b>
            <div className="mrd-dim" style={{ fontSize: 11.5 }}>
              {status ? `${status.rounds.ok.toLocaleString("en-US")} ok · ${status.rounds.failed} failed` : "runtime not attached"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {["Scan", "Score", "Risk", "Execute", "Log"].map((stage, i) => (
            <div key={stage} style={{ flex: 1, display: "grid", gap: 4 }}>
              <div
                style={{
                  height: 4,
                  borderRadius: 99,
                  background: running && i <= 2 ? "var(--brand)" : "var(--surface-3)",
                }}
              />
              <span className="mrd-dim" style={{ fontSize: 9, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {stage}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DecisionCard({ insight, loading }: { insight?: InsightRow; loading: boolean }) {
  return (
    <section className="mrd-card mrd-decision">
      <div className="mrd-card-hd" style={{ paddingBottom: 0 }}>
        <div>
          <div className="mrd-card-title">
            AI decision {insight ? <Badge>{relative(insight.createdAt)}</Badge> : null}
          </div>
          <div className="mrd-card-sub">{insight ? insight.agentRole.replace("_", " ") : "no decision in this window"}</div>
        </div>
      </div>
      <div className="mrd-card-body" style={{ display: "grid", gap: 12 }}>
        {loading ? (
          <Skeleton width="80%" height={20} />
        ) : insight ? (
          <>
            <div className="dc-act">
              <span className="mrd-pos">↗</span> {insight.symbol ?? "Portfolio"}
            </div>
            <p className="mrd-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              {insight.summary ?? "Insight recorded without a summary."}
            </p>
            <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" disabled title="Copilot arrives in phase 2">
              Why this trade?
            </button>
          </>
        ) : (
          <p className="mrd-dim" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Insights appear here after the first analysed round. Nothing is invented to fill the space.
          </p>
        )}
      </div>
    </section>
  );
}

function PositionsCard({ rows, loading }: { rows: PositionRow[]; loading: boolean }) {
  return (
    <section className="mrd-card">
      <div className="mrd-card-hd" data-border="true">
        <div>
          <div className="mrd-card-title">
            Open positions <Badge>{rows.length}</Badge>
          </div>
          <div className="mrd-card-sub">Unrealized {signedUsd(sum(rows.map((r) => r.unrealizedPnlUsd)))}</div>
        </div>
        <span className="mrd-dim" style={{ fontSize: 11.5 }}>
          click a row for detail (phase 1)
        </span>
      </div>
      {loading ? (
        <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}>
          <Skeleton height={16} />
          <Skeleton height={16} />
          <Skeleton height={16} />
        </div>
      ) : rows.length === 0 ? (
        <Empty title="No open positions" description="The engine sizes the first trade only after a candidate passes every gate." />
      ) : (
        <div className="mrd-list">
          {rows.map((p) => {
            const tone = p.unrealizedPnlUsd >= 0 ? "mrd-pos" : "mrd-neg";
            return (
              <div className="mrd-list-item" key={p.id}>
                <AssetIcon symbol={p.symbol} color={colorFor(p.symbol)} />
                <div className="mrd-list-main">
                  <div className="mrd-list-title">
                    {p.symbol}
                    <Badge tone="pos">LONG</Badge>
                  </div>
                  <div className="mrd-list-sub">
                    entry {usd(p.entryPriceUsd)} · mark {price(p.currentPriceUsd)} · {relative(p.entryAt)}
                  </div>
                </div>
                <div className="mrd-list-side">
                  <b className={tone}>{signedUsd(p.unrealizedPnlUsd)}</b>
                  <div className={`${tone}`} style={{ fontSize: 11 }}>{pct(p.unrealizedPnlPct)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RoundsCard({ rounds, loading }: { rounds: RoundRow[]; loading: boolean }) {
  const recent = rounds.slice(0, 5);
  return (
    <section className="mrd-card">
      <div className="mrd-card-hd" data-border="true">
        <div>
          <div className="mrd-card-title">Rounds</div>
          <div className="mrd-card-sub">last {recent.length || 0}</div>
        </div>
      </div>
      {loading ? (
        <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}>
          <Skeleton height={16} />
          <Skeleton height={16} />
        </div>
      ) : recent.length === 0 ? (
        <Empty title="No rounds yet" description="Each engine cycle writes one round with what it scanned and traded." />
      ) : (
        <div className="mrd-list">
          {recent.map((r) => (
            <div className="mrd-list-item" key={r.id}>
              <div className="mrd-list-main">
                <div className="mrd-list-title">R-{r.id}</div>
                <div className="mrd-list-sub">
                  {r.tokensScanned} scanned · {r.positionsOpened} opened · {r.status}
                </div>
              </div>
              <div className="mrd-list-side">
                <b className={r.roundPnlUsd >= 0 ? "mrd-pos" : "mrd-neg"}>{signedUsd(r.roundPnlUsd)}</b>
                <div className="mrd-dim" style={{ fontSize: 10.5 }}>{relative(r.startedAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ActivityCard({ rounds, positions }: { rounds: RoundRow[]; positions: PositionRow[] }) {
  const events = useMemo(() => {
    const fromRounds = rounds.slice(0, 3).map((r) => ({
      id: `r-${r.id}`,
      icon: "activity",
      text: (
        <>
          <b>Round R-{r.id}</b> {r.tokensScanned} pairs scanned
        </>
      ),
      at: r.startedAt,
    }));
    const fromPositions = positions.slice(0, 2).map((p) => ({
      id: `p-${p.id}`,
      icon: "up",
      text: (
        <>
          <b>{p.symbol}</b> position open at {usd(p.entryPriceUsd)}
        </>
      ),
      at: p.entryAt,
    }));
    return [...fromPositions, ...fromRounds]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 4);
  }, [rounds, positions]);

  return (
    <section className="mrd-card mrd-activity">
      <div className="mrd-card-hd" data-border="true">
        <div>
          <div className="mrd-card-title">Activity</div>
          <div className="mrd-card-sub">engine + operator log</div>
        </div>
      </div>
      {events.length === 0 ? (
        <Empty title="Nothing yet" description="Rounds and fills will show up here." />
      ) : (
        <div>
          {events.map((e) => (
            <div className="act" key={e.id}>
              <span className="a-ico">
                <Icon name={e.icon} size={12} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p>{e.text}</p>
              </div>
              <time dateTime={e.at}>{relative(e.at)}</time>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
