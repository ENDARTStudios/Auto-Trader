"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "./api";
import { Icon } from "./icons";
import { Badge, Card, Empty, Kpi, Skeleton } from "./ui";
import { clockUtc, pct, signedUsd } from "@/lib/meridian/format";

interface BacktestRow {
  id: number;
  symbols: string;
  interval: string;
  periodDays: number;
  initialCapitalUsd: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgTradePnlUsd: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
  equityCurve: string;
  tradesJson: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: string;
  error: string | null;
}

interface BacktestList {
  backtests: BacktestRow[];
}

const INTERVALS = ["15m", "1h", "4h", "1d"];

const parseSymbols = (raw: string) => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.join(", ") : String(v);
  } catch {
    return raw;
  }
};

export function BacktestView() {
  const qc = useQueryClient();
  const [symbols, setSymbols] = useState("BTC/USDT,ETH/USDT");
  const [interval, setInterval] = useState("1h");
  const [periodDays, setPeriodDays] = useState(30);
  const [capital, setCapital] = useState(1000);
  const [perTrade, setPerTrade] = useState(100);
  const [tp, setTp] = useState(5);
  const [sl, setSl] = useState(3);
  const [detail, setDetail] = useState<BacktestRow | null>(null);

  const list = useQuery<BacktestList>({
    queryKey: ["mrd", "backtests"],
    queryFn: () => apiGet<BacktestList>("/api/backtest?limit=20"),
    refetchInterval: 30_000,
  });

  const run = useMutation({
    mutationFn: () =>
      apiPost<BacktestRow>("/api/backtest", {
        symbols: symbols.split(",").map((s) => s.trim()).filter(Boolean),
        interval,
        periodDays,
        initialCapitalUsd: capital,
        perTradeUsd: perTrade,
        takeProfitPct: tp / 100,
        stopLossPct: sl / 100,
      }),
    onSuccess: (row) => {
      toast.success("Backtest finished", {
        description: `#${row.id ?? "—"} · ${pct(row.totalPnlPct ?? 0)} · ${row.totalTrades ?? 0} trades`,
      });
      void qc.invalidateQueries({ queryKey: ["mrd", "backtests"] });
    },
    onError: (err: Error) => toast.error("Backtest failed", { description: err.message }),
  });

  const rows = list.data?.backtests ?? [];
  const best = useMemo(() => rows.reduce<BacktestRow | null>((acc, r) => (!acc || r.totalPnlPct > acc.totalPnlPct ? r : acc), null), [rows]);
  const curve = useMemo(() => {
    if (!detail) return [];
    try {
      const arr = JSON.parse(detail.equityCurve) as { bar: number; equityUsd: number }[];
      return arr.map((p) => ({ t: p.bar, v: p.equityUsd }));
    } catch {
      return [];
    }
  }, [detail]);

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Backtest</h1>
            <span className="mrd-status">
              <Badge>{rows.length} runs</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>historic replay with the same gates</span>
            </span>
          </div>
          <p className="mrd-sub">
            Replays the strategy on stored candles with the configured exits. Runs are stored, comparable, and never touch
            the live ledger.
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={() => list.refetch()}>
            <Icon name="activity" size={15} /> Refresh
          </button>
          <button type="button" className="mrd-btn mrd-btn-primary mrd-btn-sm" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? "Running…" : "Run backtest"}
          </button>
        </div>
      </header>

      <div className="mrd-hero">
        <section className="mrd-card">
          <div className="mrd-card-hd" data-border="true">
            <div>
              <div className="mrd-card-title">Configuration</div>
              <div className="mrd-card-sub">draft · applied to the next run</div>
            </div>
          </div>
          <div className="mrd-card-body">
            <div className="mrd-form-grid">
              <label className="mrd-field" style={{ gridColumn: "span 2" }}>
                <span>Symbols (comma separated)</span>
                <input className="mrd-input" value={symbols} onChange={(e) => setSymbols(e.target.value)} />
              </label>
              <label className="mrd-field">
                <span>Interval</span>
                <select className="mrd-input" value={interval} onChange={(e) => setInterval(e.target.value)}>
                  {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </label>
              <label className="mrd-field"><span>Period (days)</span><input className="mrd-input" type="number" value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} /></label>
              <label className="mrd-field"><span>Capital (USD)</span><input className="mrd-input" type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} /></label>
              <label className="mrd-field"><span>Per trade (USD)</span><input className="mrd-input" type="number" value={perTrade} onChange={(e) => setPerTrade(Number(e.target.value))} /></label>
              <label className="mrd-field"><span>Take profit (%)</span><input className="mrd-input" type="number" value={tp} onChange={(e) => setTp(Number(e.target.value))} /></label>
              <label className="mrd-field"><span>Stop loss (%)</span><input className="mrd-input" type="number" value={sl} onChange={(e) => setSl(Number(e.target.value))} /></label>
            </div>
            <p className="mrd-dim" style={{ fontSize: 11.5, marginTop: 12 }}>
              A run fetches candles from the configured venues, so it can take a few seconds. Results include fees and
              slippage from the engine config.
            </p>
          </div>
        </section>

        <div className="mrd-side">
          <Card title="Best run" sub={best ? `#${best.id} · ${best.interval} · ${best.periodDays}d` : "no runs yet"}>
            {best ? (
              <div className="mrd-kpi" style={{ padding: 0 }}>
                <div className="mrd-kpi-label">Net return</div>
                <div className={`mrd-kpi-value ${best.totalPnlPct >= 0 ? "mrd-pos" : "mrd-neg"}`}>{pct(best.totalPnlPct)}</div>
                <div className="mrd-kpi-foot">{best.winRate.toFixed(1)}% win · {best.totalTrades} trades</div>
              </div>
            ) : (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>Run the first backtest to populate this.</p>
            )}
          </Card>
          <Card title="How to read it" sub="what the numbers mean">
            <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6, fontSize: 12, color: "var(--text-2)" }}>
              <li>Return is net of fees and slippage.</li>
              <li>Max drawdown is measured on the replayed equity curve.</li>
              <li>Sharpe is per trade, not annualised.</li>
              <li>A good backtest is a hypothesis, not a promise.</li>
            </ul>
          </Card>
        </div>
      </div>

      <section className="mrd-card" style={{ marginTop: 16 }}>
        <div className="mrd-card-hd" data-border="true">
          <div>
            <div className="mrd-card-title">Runs</div>
            <div className="mrd-card-sub">click a run for the equity curve</div>
          </div>
          <Badge>{rows.length}</Badge>
        </div>
        {list.isLoading ? (
          <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}><Skeleton height={16} /><Skeleton height={16} /></div>
        ) : rows.length === 0 ? (
          <Empty title="No backtests yet" description="Configure a symbol list and run the first replay. Results are stored here." />
        ) : (
          <div className="mrd-table-wrap">
            <table className="mrd-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Config</th>
                  <th className="num">Trades</th>
                  <th className="num">Win rate</th>
                  <th className="num">Return</th>
                  <th className="num">Max DD</th>
                  <th className="num">Sharpe</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setDetail(r)}>
                    <td>#{r.id}</td>
                    <td className="mrd-muted">{parseSymbols(r.symbols)} · {r.interval} · {r.periodDays}d</td>
                    <td className="num">{r.totalTrades}</td>
                    <td className="num">{r.winRate.toFixed(1)}%</td>
                    <td className={`num ${r.totalPnlPct >= 0 ? "mrd-pos" : "mrd-neg"}`}>{pct(r.totalPnlPct)}</td>
                    <td className="num mrd-neg">{r.maxDrawdownPct.toFixed(2)}%</td>
                    <td className="num">{r.sharpeRatio.toFixed(2)}</td>
                    <td className="mrd-dim">{clockUtc(r.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detail ? (
        <div className="mrd-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="mrd-modal" role="dialog" aria-modal="true" aria-label={`Backtest ${detail.id}`} style={{ width: "min(720px, 100%)" }}>
            <div className="mrd-modal-hd">
              <h2>Backtest #{detail.id}</h2>
              <p>{detail.status} · {detail.totalTrades} trades · {detail.winRate.toFixed(1)}% win</p>
            </div>
            <div className="mrd-modal-body">
              <div className="mrd-kpi-row" style={{ marginBottom: 14 }}>
                <Kpi label="Return" value={pct(detail.totalPnlPct)} valueClassName={detail.totalPnlPct >= 0 ? "mrd-pos" : "mrd-neg"} />
                <Kpi label="Max DD" value={`${detail.maxDrawdownPct.toFixed(2)}%`} valueClassName="mrd-neg" />
                <Kpi label="Profit factor" value={Number.isFinite(detail.profitFactor) ? detail.profitFactor.toFixed(2) : "∞"} />
                <Kpi label="Avg trade" value={signedUsd(detail.avgTradePnlUsd)} />
              </div>
              {curve.length > 1 ? (
                <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: 10 }}>
                  <svg viewBox="0 0 620 160" style={{ width: "100%", height: 160 }} role="img" aria-label="Backtest equity curve">
                    {(() => {
                      const min = Math.min(...curve.map((p) => p.v));
                      const max = Math.max(...curve.map((p) => p.v));
                      const span = max - min || 1;
                      const d = curve.map((p, i) => `${i === 0 ? "M" : "L"}${(i / (curve.length - 1)) * 600 + 10},${150 - ((p.v - min) / span) * 130}`).join(" ");
                      return <path d={d} fill="none" stroke="var(--positive)" strokeWidth="1.8" />;
                    })()}
                  </svg>
                </div>
              ) : (
                <p className="mrd-dim" style={{ fontSize: 12.5 }}>No equity curve stored for this run.</p>
              )}
            </div>
            <div className="mrd-modal-foot">
              <button type="button" className="mrd-btn mrd-btn-secondary" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
