"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, type AnalyticsResponse, type RoundRow } from "./api";
import { Icon } from "./icons";
import { AssetIcon, Badge, Card, Empty, Skeleton, colorFor } from "./ui";
import { clockUtc, pct, price, signedUsd, stampUtc, usd } from "@/lib/meridian/format";

interface TradeRow {
  id: string;
  symbol: string;
  source: string;
  chain: string | null;
  status: string;
  entryPriceUsd: number;
  entryAmountUsd: number;
  entryQty: number;
  entryAt: string;
  exitPriceUsd: number | null;
  exitAmountUsd: number | null;
  exitAt: string | null;
  exitReason: string | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  scamScore: number | null;
  roundId: number | null;
}

type Filter = "all" | "wins" | "losses";

const baseOf = (symbol: string) => symbol.replace(/USDT$|USDC$|USD$/, "");

export function JournalView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<TradeRow | null>(null);

  const history = useQuery<TradeRow[]>({
    queryKey: ["mrd", "history"],
    queryFn: () => apiGet<TradeRow[]>("/api/history?limit=100"),
    refetchInterval: 60_000,
  });
  const rounds = useQuery<RoundRow[]>({
    queryKey: ["mrd", "rounds"],
    queryFn: () => apiGet<RoundRow[]>("/api/rounds"),
    refetchInterval: 60_000,
  });
  const month = useQuery<AnalyticsResponse>({
    queryKey: ["mrd", "analytics", "30d"],
    queryFn: () => apiGet<AnalyticsResponse>("/api/analytics?range=30d"),
    refetchInterval: 120_000,
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (history.data ?? [])
      .filter((t) => (filter === "wins" ? (t.pnlUsd ?? 0) > 0 : filter === "losses" ? (t.pnlUsd ?? 0) < 0 : true))
      .filter((t) => !term || t.symbol.toLowerCase().includes(term));
  }, [history.data, filter, q]);

  const totals = useMemo(() => {
    const list = history.data ?? [];
    const pnl = list.reduce((a, t) => a + (t.pnlUsd ?? 0), 0);
    const wins = list.filter((t) => (t.pnlUsd ?? 0) > 0).length;
    return { count: list.length, pnl, wins, losses: list.length - wins };
  }, [history.data]);

  const exportCsv = () => {
    const header = ["symbol", "status", "entry_price", "exit_price", "pnl_usd", "pnl_pct", "exit_reason", "exit_at"];
    const lines = rows.map((t) => [t.symbol, t.status, t.entryPriceUsd, t.exitPriceUsd ?? "", t.pnlUsd ?? "", t.pnlPct ?? "", t.exitReason ?? "", t.exitAt ?? ""].join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export started", { description: `${rows.length} trades.` });
  };

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Journal</h1>
            <span className="mrd-status">
              <Badge>{totals.count} closed</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>
                {totals.wins}W · {totals.losses}L
              </span>
            </span>
          </div>
          <p className="mrd-sub">
            Every exit keeps the reason that closed it — target, stop, time or manual. The journal is the audit trail the
            analytics are computed from.
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Icon name="up" size={15} /> Export CSV
          </button>
          <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" onClick={() => history.refetch()}>
            <Icon name="activity" size={15} /> Refresh
          </button>
        </div>
      </header>

      <div className="mrd-hero">
        <section className="mrd-card">
          <div className="mrd-card-hd" data-border="true">
            <div>
              <div className="mrd-card-title">Closed trades</div>
              <div className="mrd-card-sub">Newest exit first · click a row for the full record</div>
            </div>
            <div className="mrd-toolbar">
              <div className="mrd-range" role="group" aria-label="Filter trades">
                {(["all", "wins", "losses"] as Filter[]).map((f) => (
                  <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {f === "all" ? "All" : f === "wins" ? "Wins" : "Losses"}
                  </button>
                ))}
              </div>
              <input className="mrd-input" placeholder="Filter symbol" aria-label="Filter symbol" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {history.isLoading ? (
            <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={16} />)}
            </div>
          ) : rows.length === 0 ? (
            <Empty
              title={q || filter !== "all" ? "No trade matches" : "No closed trades yet"}
              description={
                q || filter !== "all"
                  ? "Clear the filter to see the whole journal."
                  : "The first exit will show up here with its reason and round id."
              }
              action={
                q || filter !== "all" ? (
                  <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" onClick={() => { setQ(""); setFilter("all"); }}>
                    Clear filters
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="mrd-table-wrap">
              <table className="mrd-table">
                <thead>
                  <tr>
                    <th>Exit</th>
                    <th>Asset</th>
                    <th className="num">Entry</th>
                    <th className="num">Exit price</th>
                    <th className="num">P&amp;L</th>
                    <th>Reason</th>
                    <th className="num">Round</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const up = (t.pnlUsd ?? 0) >= 0;
                    return (
                      <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => setDetail(t)}>
                        <td className="mrd-dim">{t.exitAt ? stampUtc(t.exitAt) : "—"}</td>
                        <td>
                          <div className="mrd-asset">
                            <AssetIcon symbol={baseOf(t.symbol)} color={colorFor(baseOf(t.symbol))} />
                            <div className="mrd-cellstack">
                              <span>{t.symbol}</span>
                              <small>{t.status}</small>
                            </div>
                          </div>
                        </td>
                        <td className="num">{price(t.entryPriceUsd)}</td>
                        <td className="num">{t.exitPriceUsd ? price(t.exitPriceUsd) : "—"}</td>
                        <td className={`num ${up ? "mrd-pos" : "mrd-neg"}`}>
                          {t.pnlUsd !== null ? signedUsd(t.pnlUsd) : "—"}
                          <div style={{ fontSize: 11 }}>{t.pnlPct !== null ? pct(t.pnlPct) : ""}</div>
                        </td>
                        <td className="mrd-muted">{t.exitReason ?? "—"}</td>
                        <td className="num mrd-dim">{t.roundId ? `R-${t.roundId}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mrd-card-section" style={{ borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
            <span className="mrd-dim" style={{ fontSize: 11.5 }}>{rows.length} of {totals.count} trades</span>
            <span className="mrd-dim" style={{ fontSize: 11.5 }}>closed positions only</span>
          </div>
        </section>

        <div className="mrd-side">
          <Card title="This month" sub="closed trades, 30 days">
            <div className="mrd-kpi" style={{ padding: 0 }}>
              <div className="mrd-kpi-label">Realized P&amp;L</div>
              <div className={`mrd-kpi-value ${totals.pnl >= 0 ? "mrd-pos" : "mrd-neg"}`}>{signedUsd(totals.pnl)}</div>
              <div className="mrd-kpi-foot">{totals.count} trades · {totals.wins}W</div>
            </div>
            <dl className="mrd-kv" style={{ marginTop: 14 }}>
              <dt>Net return (30d)</dt>
              <dd className={month.data && month.data.summary.pctChange >= 0 ? "mrd-pos" : "mrd-neg"}>
                {month.data ? pct(month.data.summary.pctChange) : "—"}
              </dd>
              <dt>Best</dt>
              <dd className="mrd-pos">{month.data?.bestTrade ? signedUsd(month.data.bestTrade.pnlUsd) : "—"}</dd>
              <dt>Worst</dt>
              <dd className="mrd-neg">{month.data?.worstTrade ? signedUsd(month.data.worstTrade.pnlUsd) : "—"}</dd>
            </dl>
          </Card>

          <Card title="Rounds" sub="recent engine cycles">
            {rounds.isLoading ? (
              <Skeleton height={16} />
            ) : rounds.data?.length ? (
              <div style={{ display: "grid", gap: 9 }}>
                {rounds.data.slice(0, 5).map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span className="mrd-muted">R-{r.id} · {r.tokensScanned} scanned</span>
                    <span className={r.roundPnlUsd >= 0 ? "mrd-pos" : "mrd-neg"}>{signedUsd(r.roundPnlUsd)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>No rounds recorded.</p>
            )}
          </Card>

          <Card title="Integrity" sub="how to trust this log">
            <p className="mrd-dim" style={{ fontSize: 12, lineHeight: 1.55 }}>
              Exits are written by the engine at the moment they happen, with the reason and the round id. The CSV export
              keeps those fields so a post-mortem can be checked against the ledger.
            </p>
          </Card>
        </div>
      </div>

      {detail ? (
        <div className="mrd-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="mrd-modal" role="dialog" aria-modal="true" aria-label={`${detail.symbol} trade`}>
            <div className="mrd-modal-hd">
              <h2>{detail.symbol} · {detail.status}</h2>
              <p>{detail.exitReason ? `Closed by ${detail.exitReason}.` : "Closed position."}</p>
            </div>
            <div className="mrd-modal-body">
              <dl className="mrd-kv">
                <dt>Entry</dt>
                <dd>{usd(detail.entryPriceUsd)}</dd>
                <dt>Exit</dt>
                <dd>{detail.exitPriceUsd ? price(detail.exitPriceUsd) : "—"}</dd>
                <dt>Size</dt>
                <dd>{usd(detail.entryAmountUsd)}</dd>
                <dt>P&amp;L</dt>
                <dd className={(detail.pnlUsd ?? 0) >= 0 ? "mrd-pos" : "mrd-neg"}>
                  {detail.pnlUsd !== null ? signedUsd(detail.pnlUsd) : "—"} {detail.pnlPct !== null ? `(${pct(detail.pnlPct)})` : ""}
                </dd>
                <dt>Entry at</dt>
                <dd>{stampUtc(detail.entryAt)} UTC</dd>
                <dt>Exit at</dt>
                <dd>{detail.exitAt ? `${stampUtc(detail.exitAt)} UTC` : "—"}</dd>
                <dt>Round</dt>
                <dd>{detail.roundId ? `R-${detail.roundId}` : "—"}</dd>
                <dt>Scam score</dt>
                <dd>{detail.scamScore ?? "—"}</dd>
              </dl>
            </div>
            <div className="mrd-modal-foot">
              <button type="button" className="mrd-btn mrd-btn-secondary" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
