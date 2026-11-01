"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, type AnalyticsResponse } from "./api";
import { Icon } from "./icons";
import { AreaChart } from "./area-chart";
import { Badge, Card, Empty, Kpi, Skeleton } from "./ui";
import { pct, signedUsd, usd } from "@/lib/meridian/format";

type Range = "24h" | "7d" | "30d" | "all";
const RANGES: { id: Range; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "all", label: "ALL" },
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AnalyticsView() {
  const [range, setRange] = useState<Range>("30d");
  const analytics = useQuery<AnalyticsResponse>({
    queryKey: ["mrd", "analytics", range],
    queryFn: () => apiGet<AnalyticsResponse>(`/api/analytics?range=${range}`),
    refetchInterval: 60_000,
  });

  const data = analytics.data;
  const summary = data?.summary;
  const bySymbol = data?.bySymbol ?? [];
  const totals = useMemo(() => {
    const trades = bySymbol.reduce((a, s) => a + s.trades, 0);
    const wins = bySymbol.reduce((a, s) => a + s.wins, 0);
    const pnl = bySymbol.reduce((a, s) => a + s.totalPnlUsd, 0);
    return { trades, wins, losses: trades - wins, pnl, winRate: trades ? (wins / trades) * 100 : 0 };
  }, [bySymbol]);

  const curve = useMemo(
    () => (data?.equityCurve ?? []).map((p) => ({ t: new Date(p.timestamp).getTime(), v: p.totalEquityUsd })),
    [data]
  );

  const dow = data?.byDayOfWeek ?? [];
  const maxDow = Math.max(1, ...dow.map((d) => Math.abs(d.totalPnlUsd)));

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Analytics</h1>
            <span className="mrd-status">
              <Badge>{range}</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>
                {totals.trades} closed trades in the window
              </span>
            </span>
          </div>
          <p className="mrd-sub">
            Performance is measured on closed trades only, net of fees where the ledger records them. Every metric names
            its window — nothing is annualised behind your back.
          </p>
        </div>
        <div className="mrd-actions">
          <div className="mrd-range" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mrd-btn mrd-btn-ghost mrd-btn-sm"
            onClick={() => {
              const rows = [["symbol", "trades", "wins", "losses", "win_rate", "total_pnl_usd"], ...bySymbol.map((s) => [s.symbol, s.trades, s.wins, s.losses, s.winRate, s.totalPnlUsd])];
              const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `analytics-${range}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Icon name="up" size={15} /> Export
          </button>
        </div>
      </header>

      <div className="mrd-kpi-row">
        <Kpi
          label="Net return"
          value={summary ? pct(summary.pctChange) : "—"}
          valueClassName={summary ? (summary.pctChange >= 0 ? "mrd-pos" : "mrd-neg") : ""}
          foot={<span className="mrd-dim">{summary ? signedUsd(summary.absChangeUsd) : "no data"}</span>}
        />
        <Kpi
          label="Max drawdown"
          value={summary ? `${summary.maxDrawdownPct.toFixed(2)}%` : "—"}
          valueClassName="mrd-neg"
          foot={<span className="mrd-dim">peak {summary ? usd(summary.maxEquityUsd) : "—"}</span>}
        />
        <Kpi label="Win rate" value={`${totals.winRate.toFixed(1)}%`} foot={<span className="mrd-dim">{totals.wins}W · {totals.losses}L</span>} />
        <Kpi
          label="Expectancy"
          value={totals.trades ? signedUsd(totals.pnl / totals.trades) : "—"}
          valueClassName={totals.pnl >= 0 ? "mrd-pos" : "mrd-neg"}
          foot={<span className="mrd-dim">per closed trade</span>}
        />
        <Kpi label="Best trade" value={data?.bestTrade ? signedUsd(data.bestTrade.pnlUsd) : "—"} valueClassName="mrd-pos" foot={<span className="mrd-dim">{data?.bestTrade?.symbol ?? "—"}</span>} />
        <Kpi label="Worst trade" value={data?.worstTrade ? signedUsd(data.worstTrade.pnlUsd) : "—"} valueClassName="mrd-neg" foot={<span className="mrd-dim">{data?.worstTrade?.symbol ?? "—"}</span>} />
      </div>

      <section className="mrd-card" style={{ marginTop: 16 }}>
        <div className="mrd-card-hd" data-border="true">
          <div>
            <div className="mrd-card-title">Equity</div>
            <div className="mrd-card-sub">{summary ? `${summary.snapshotCount} snapshots · ${range}` : "no snapshots"}</div>
          </div>
          <Badge>USD</Badge>
        </div>
        <div className="mrd-card-body">
          {analytics.isLoading ? (
            <Skeleton height={220} />
          ) : (
            <AreaChart
              data={curve}
              height={230}
              label={`Equity curve, ${range}`}
              emptyLabel="No snapshots in this window. Start the engine to collect performance."
            />
          )}
        </div>
      </section>

      <div className="mrd-lower" style={{ marginTop: 16 }}>
        <Card title="Result by weekday" sub="sum of closed P&L per weekday">
          {dow.length === 0 ? (
            <p className="mrd-dim" style={{ fontSize: 12.5 }}>No closed trades in this window.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {[...dow]
                .sort((a, b) => a.dow - b.dow)
                .map((d) => (
                  <div key={d.dow} style={{ display: "grid", gridTemplateColumns: "44px 1fr 84px", gap: 10, alignItems: "center", fontSize: 11.5 }}>
                    <span className="mrd-dim">{DOW[d.dow] ?? d.dow}</span>
                    <div style={{ height: 8, background: "var(--surface-3)", borderRadius: 99, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${(Math.abs(d.totalPnlUsd) / maxDow) * 100}%`,
                          height: "100%",
                          background: d.totalPnlUsd >= 0 ? "var(--positive)" : "var(--negative)",
                          borderRadius: 99,
                        }}
                      />
                    </div>
                    <b className={d.totalPnlUsd >= 0 ? "mrd-pos" : "mrd-neg"} style={{ textAlign: "right" }}>
                      {signedUsd(d.totalPnlUsd)}
                    </b>
                  </div>
                ))}
            </div>
          )}
        </Card>

        <Card title="Streaks" sub="current and longest runs">
          <dl className="mrd-kv">
            <dt>Current win streak</dt>
            <dd className="mrd-pos">{data?.streaks.currentWinStreak ?? 0}</dd>
            <dt>Current loss streak</dt>
            <dd className="mrd-neg">{data?.streaks.currentLossStreak ?? 0}</dd>
            <dt>Longest win streak</dt>
            <dd>{data?.streaks.longestWinStreak ?? 0}</dd>
            <dt>Longest loss streak</dt>
            <dd>{data?.streaks.longestLossStreak ?? 0}</dd>
            <dt>Snapshots</dt>
            <dd>{summary?.snapshotCount ?? 0}</dd>
          </dl>
        </Card>
      </div>

      <section className="mrd-card" style={{ marginTop: 16 }}>
        <div className="mrd-card-hd" data-border="true">
          <div>
            <div className="mrd-card-title">Attribution by symbol</div>
            <div className="mrd-card-sub">Which pairs actually paid for the risk</div>
          </div>
          <Badge>{bySymbol.length} symbols</Badge>
        </div>
        {analytics.isLoading ? (
          <div className="mrd-card-body"><Skeleton height={16} /></div>
        ) : bySymbol.length === 0 ? (
          <Empty title="No closed trades" description="Attribution appears once the engine closes its first position." />
        ) : (
          <div className="mrd-table-wrap">
            <table className="mrd-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num">Trades</th>
                  <th className="num">Win rate</th>
                  <th className="num">Total P&amp;L</th>
                  <th className="num">Avg P&amp;L</th>
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {[...bySymbol]
                  .sort((a, b) => b.totalPnlUsd - a.totalPnlUsd)
                  .map((s) => (
                    <tr key={s.symbol}>
                      <td>{s.symbol}</td>
                      <td className="num">{s.trades}</td>
                      <td className="num">{s.winRate.toFixed(1)}%</td>
                      <td className={`num ${s.totalPnlUsd >= 0 ? "mrd-pos" : "mrd-neg"}`}>{signedUsd(s.totalPnlUsd)}</td>
                      <td className="num mrd-muted">{signedUsd(s.avgPnlUsd)}</td>
                      <td className="num mrd-dim">{totals.pnl ? `${((s.totalPnlUsd / Math.abs(totals.pnl)) * 100).toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
