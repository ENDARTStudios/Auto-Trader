"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost, type AnalyticsResponse, type PositionRow } from "./api";
import { Icon } from "./icons";
import { AreaChart } from "./area-chart";
import { AssetIcon, Badge, Card, Empty, Kpi, Meter, Skeleton, colorFor } from "./ui";
import { money, pct, price, clockUtc, signedUsd, usd } from "@/lib/meridian/format";

interface ReserveResponse {
  reserve?: { balanceUsd?: number; totalDepositedUsd?: number } | null;
  trading?: { balanceUsd?: number } | null;
  balanceUsd?: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
const baseOf = (symbol: string) => symbol.replace(/USDT$|USDC$|USD$/, "");

export function PortfolioView() {
  const [closing, setClosing] = useState<PositionRow | null>(null);
  const [note, setNote] = useState("");
  const qc = useQueryClient();

  const analytics = useQuery<AnalyticsResponse>({
    queryKey: ["mrd", "analytics", "30d"],
    queryFn: () => apiGet<AnalyticsResponse>("/api/analytics?range=30d"),
    refetchInterval: 60_000,
  });
  const positions = useQuery<PositionRow[]>({
    queryKey: ["mrd", "positions"],
    queryFn: () => apiGet<PositionRow[]>("/api/positions"),
    refetchInterval: 20_000,
  });
  const reserve = useQuery<ReserveResponse>({
    queryKey: ["mrd", "reserve"],
    queryFn: () => apiGet<ReserveResponse>("/api/reserve"),
    retry: 0,
  });

  const close = useMutation({
    mutationFn: (p: PositionRow) => apiPost<{ ok: boolean }>(`/api/positions/${p.id}/close`, { note }),
    onSuccess: (_res, p) => {
      toast.success("Position closed", { description: `${p.symbol} flattened at market.` });
      setClosing(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["mrd", "positions"] });
      void qc.invalidateQueries({ queryKey: ["mrd", "analytics"] });
    },
    onError: (err: Error) => toast.error("Could not close position", { description: err.message }),
  });

  const rows = positions.data ?? [];
  const summary = analytics.data?.summary;
  const deployed = sum(rows.map((p) => p.entryAmountUsd));
  const equity = summary?.endEquityUsd ?? 0;
  const cash = Math.max(0, equity - deployed);
  const total = deployed + cash || 1;
  const exposurePct = equity > 0 ? (deployed / equity) * 100 : 0;
  const unrealized = sum(rows.map((p) => p.unrealizedPnlUsd));

  const curve = useMemo(
    () => (analytics.data?.equityCurve ?? []).map((p) => ({ t: new Date(p.timestamp).getTime(), v: p.totalEquityUsd })),
    [analytics.data]
  );

  const allocation = useMemo(() => {
    const bySymbol = new Map<string, number>();
    for (const p of rows) bySymbol.set(baseOf(p.symbol), (bySymbol.get(baseOf(p.symbol)) ?? 0) + p.entryAmountUsd);
    const items = [...bySymbol.entries()].map(([symbol, value]) => ({
      symbol,
      value,
      color: colorFor(symbol),
      pct: deployed > 0 ? (value / deployed) * 100 : 0,
    }));
    items.sort((a, b) => b.value - a.value);
    return items;
  }, [rows, deployed]);

  const exportCsv = () => {
    const header = ["symbol", "entry_price_usd", "entry_amount_usd", "current_price_usd", "unrealized_pnl_usd", "unrealized_pnl_pct"];
    const lines = rows.map((p) =>
      [p.symbol, p.entryPriceUsd, p.entryAmountUsd, p.currentPriceUsd, p.unrealizedPnlUsd, p.unrealizedPnlPct].join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export started", { description: `${rows.length} open positions.` });
  };

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Portfolio</h1>
            <span className="mrd-status">
              <Badge tone="warn">Paper</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>
                {rows.length} open · {exposurePct.toFixed(1)}% exposure
              </span>
            </span>
          </div>
          <p className="mrd-sub">
            Allocation is a consequence of the risk engine, not a manual setting. Cash stays in the paper balance and
            every exit is recorded with its reason.
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Icon name="up" size={15} /> Export
          </button>
          <button
            type="button"
            className="mrd-btn mrd-btn-secondary mrd-btn-sm"
            onClick={() => {
              void positions.refetch();
              void analytics.refetch();
            }}
          >
            <Icon name="activity" size={15} /> Refresh
          </button>
        </div>
      </header>

      <div className="mrd-hero">
        <section className="mrd-card">
          <div className="mrd-card-hd">
            <div>
              <div className="mrd-card-title">Equity</div>
              <div className="mrd-card-sub">
                {summary ? `${summary.snapshotCount} snapshots · last 30 days` : "loading…"}
              </div>
            </div>
            <Badge>USD</Badge>
          </div>
          <div className="mrd-card-body">
            {summary ? (
              <>
                <div className="mrd-big">
                  <span className="amt">{usd(summary.endEquityUsd)}</span>
                  <span className="cur">USD</span>
                  <span className={`mrd-delta ${summary.pctChange >= 0 ? "mrd-pos" : "mrd-neg"}`} style={{ fontSize: 13 }}>
                    {summary.pctChange >= 0 ? "↗" : "↘"} {pct(summary.pctChange)} · 30d
                  </span>
                </div>
                <div className="mrd-meta">
                  <span>Realized <b className={summary.absChangeUsd >= 0 ? "mrd-pos" : "mrd-neg"}>{signedUsd(summary.absChangeUsd)}</b></span>
                  <span>Unrealized <b className={unrealized >= 0 ? "mrd-pos" : "mrd-neg"}>{signedUsd(unrealized)}</b></span>
                  <span>Peak <b>{usd(summary.maxEquityUsd)}</b></span>
                  <span>Max DD <b className="mrd-neg">{summary.maxDrawdownPct.toFixed(2)}%</b></span>
                </div>
                <AreaChart data={curve} height={150} label="Portfolio equity, 30 days" />
              </>
            ) : analytics.isLoading ? (
              <Skeleton width="70%" height={160} />
            ) : (
              <Empty
                title="No equity history"
                description="The portfolio needs at least one performance snapshot. Start the engine in paper mode."
              />
            )}
          </div>
        </section>

        <div className="mrd-side">
          <Card title="Allocation" sub={rows.length ? `${allocation.length} assets` : "no positions"}>
            {rows.length === 0 ? (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>Nothing allocated while there are no open positions.</p>
            ) : (
              <>
                <div className="mrd-alloc" role="img" aria-label="Allocation by asset and cash">
                  {allocation.map((a) => (
                    <i key={a.symbol} style={{ width: `${(a.value / total) * 100}%`, background: a.color }} />
                  ))}
                  <i style={{ width: `${(cash / total) * 100}%`, background: "var(--surface-3)" }} />
                </div>
                <div className="mrd-alloc-legend">
                  {allocation.map((a) => (
                    <div className="mrd-alloc-row" key={a.symbol}>
                      <i style={{ background: a.color }} />
                      {a.symbol}
                      <b>{usd(a.value, 0)} · {a.pct.toFixed(0)}%</b>
                    </div>
                  ))}
                  <div className="mrd-alloc-row">
                    <i style={{ background: "var(--surface-3)" }} />
                    Cash
                    <b>{usd(cash, 0)} · {eq(cash, equity)}</b>
                  </div>
                </div>
              </>
            )}
          </Card>

          <Card title="Buying power" sub="paper balance">
            <div className="mrd-kpi" style={{ padding: 0 }}>
              <div className="mrd-kpi-label">Available cash</div>
              <div className="mrd-kpi-value">{usd(cash)}</div>
              <div className="mrd-kpi-foot">{eq(cash, equity)} of equity</div>
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                <span className="mrd-dim">Exposure</span>
                <span><b>{exposurePct.toFixed(1)}%</b> <span className="mrd-dim">of equity</span></span>
              </div>
              <Meter value={exposurePct} label="Exposure" tone={exposurePct > 80 ? "warn" : "pos"} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                <span className="mrd-dim">Reserve</span>
                <span><b>{usd(Number(reserve.data?.reserve?.balanceUsd ?? 0))}</b></span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <section className="mrd-card" style={{ marginTop: 16 }}>
        <div className="mrd-card-hd" data-border="true">
          <div>
            <div className="mrd-card-title">
              Open positions <Badge>{rows.length}</Badge>
            </div>
            <div className="mrd-card-sub">Unrealized {signedUsd(unrealized)} · close asks for confirmation</div>
          </div>
        </div>
        {positions.isLoading ? (
          <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}>
            <Skeleton height={16} />
            <Skeleton height={16} />
          </div>
        ) : rows.length === 0 ? (
          <Empty
            title="No open positions"
            description="Every candidate must pass liquidity, authority and simulation gates before a position exists."
          />
        ) : (
          <div className="mrd-table-wrap">
            <table className="mrd-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Side</th>
                  <th className="num">Size</th>
                  <th className="num">Entry</th>
                  <th className="num">Mark</th>
                  <th className="num">Stop</th>
                  <th className="num">P&amp;L</th>
                  <th>Age</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const up = p.unrealizedPnlUsd >= 0;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/positions/${p.id}`} className="mrd-asset" style={{ textDecoration: "none", color: "inherit" }}>
                          <AssetIcon symbol={baseOf(p.symbol)} color={colorFor(baseOf(p.symbol))} />
                          <div className="mrd-cellstack">
                            <span>{p.symbol}</span>
                            <small>{p.source.toUpperCase()}</small>
                          </div>
                        </Link>
                      </td>
                      <td><Badge tone="pos">LONG</Badge></td>
                      <td className="num">{usd(p.entryAmountUsd)}</td>
                      <td className="num">{usd(p.entryPriceUsd)}</td>
                      <td className="num">{price(p.currentPriceUsd)}</td>
                      <td className="num mrd-dim">{p.stopLossPrice ? usd(p.stopLossPrice) : "—"}</td>
                      <td className={`num ${up ? "mrd-pos" : "mrd-neg"}`}>
                        {signedUsd(p.unrealizedPnlUsd)}
                        <div style={{ fontSize: 11 }}>{pct(p.unrealizedPnlPct)}</div>
                      </td>
                      <td className="mrd-dim">{clockUtc(p.entryAt)}</td>
                      <td className="num">
                        <button
                          type="button"
                          className="mrd-btn mrd-btn-ghost mrd-btn-sm"
                          onClick={() => {
                            setClosing(p);
                            setNote("");
                          }}
                          aria-label={`Close ${p.symbol}`}
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mrd-kpi-row" style={{ marginTop: 16 }}>
        <Kpi label="Deployed" value={money(deployed)} foot={<span className="mrd-dim">{rows.length} positions</span>} />
        <Kpi label="Cash" value={money(cash)} foot={<span className="mrd-dim">paper balance</span>} />
        <Kpi
          label="Unrealized"
          value={signedUsd(unrealized)}
          valueClassName={unrealized >= 0 ? "mrd-pos" : "mrd-neg"}
          foot={<span className="mrd-dim">mark to market</span>}
        />
        <Kpi
          label="Realized 30d"
          value={summary ? signedUsd(summary.absChangeUsd) : "—"}
          valueClassName={summary && summary.absChangeUsd < 0 ? "mrd-neg" : "mrd-pos"}
          foot={<span className="mrd-dim">closed trades</span>}
        />
      </div>

      {closing ? (
        <div className="mrd-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setClosing(null)}>
          <div className="mrd-modal" role="dialog" aria-modal="true" aria-label={`Close ${closing.symbol}`}>
            <div className="mrd-modal-hd">
              <h2>Close {closing.symbol}?</h2>
              <p>A market order is simulated at the current mark. The position stops being monitored after this.</p>
            </div>
            <div className="mrd-modal-body">
              <dl className="mrd-kv">
                <dt>Size</dt>
                <dd>{usd(closing.entryAmountUsd)}</dd>
                <dt>Entry</dt>
                <dd>{usd(closing.entryPriceUsd)}</dd>
                <dt>Mark</dt>
                <dd>{price(closing.currentPriceUsd)}</dd>
                <dt>Unrealized</dt>
                <dd className={closing.unrealizedPnlUsd >= 0 ? "mrd-pos" : "mrd-neg"}>
                  {signedUsd(closing.unrealizedPnlUsd)} ({pct(closing.unrealizedPnlPct)})
                </dd>
              </dl>
              <label style={{ display: "grid", gap: 6, marginTop: 16 }}>
                <span className="mrd-dim" style={{ fontSize: 12 }}>Operator note (optional)</span>
                <input
                  className="mrd-input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="why are you closing?"
                  maxLength={200}
                />
              </label>
            </div>
            <div className="mrd-modal-foot">
              <button type="button" className="mrd-btn mrd-btn-ghost" onClick={() => setClosing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="mrd-btn mrd-btn-danger-solid"
                onClick={() => close.mutate(closing)}
                disabled={close.isPending}
              >
                {close.isPending ? "Closing…" : "Close position"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function eq(value: number, total: number) {
  if (!total) return "—";
  return `${((value / total) * 100).toFixed(0)}%`;
}
