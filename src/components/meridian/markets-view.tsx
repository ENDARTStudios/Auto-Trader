"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import { Icon } from "./icons";
import { Badge, Card, Delta, Dot, Empty, Meter, Skeleton } from "./ui";
import { clockUtc, price } from "@/lib/meridian/format";

interface Snapshot {
  id: number;
  symbol: string;
  source: string;
  chain: string | null;
  priceUsd: number;
  rsi14: number | null;
  macdHist: number | null;
  ema20: number | null;
  ema50: number | null;
  bollPercent: number | null;
  fearGreedIndex: number | null;
  fearGreedClass: string | null;
  trendingRank: number | null;
  signalScore: number;
  signalLabel: string;
  analyzedAt: string;
}

interface MarketResponse {
  snapshots: Snapshot[];
  fearGreed: { value?: number; classification?: string; index?: number } | null;
  trending: { symbol?: string; name?: string; marketCapRank?: number }[];
}

const SIGNALS: Record<string, { label: string; tone: "pos" | "neg" | "warn" | "neutral" }> = {
  strong_buy: { label: "Strong buy", tone: "pos" },
  buy: { label: "Buy", tone: "pos" },
  neutral: { label: "Neutral", tone: "neutral" },
  sell: { label: "Sell", tone: "neg" },
  strong_sell: { label: "Strong sell", tone: "neg" },
};

function fearValue(f?: MarketResponse["fearGreed"]) {
  if (!f) return null;
  const n = Number(f.value ?? f.index ?? NaN);
  return Number.isFinite(n) ? n : null;
}

export function MarketsView() {
  const [q, setQ] = useState("");
  const market = useQuery<MarketResponse>({
    queryKey: ["mrd", "market"],
    queryFn: () => apiGet<MarketResponse>("/api/market?limit=60"),
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (market.data?.snapshots ?? []).filter((s) => !term || s.symbol.toLowerCase().includes(term));
  }, [market.data, q]);

  const counts = useMemo(() => {
    const base = { strong_buy: 0, buy: 0, neutral: 0, sell: 0, strong_sell: 0 };
    for (const s of market.data?.snapshots ?? []) {
      if (s.signalLabel in base) base[s.signalLabel as keyof typeof base] += 1;
    }
    return base;
  }, [market.data]);

  const total = counts.strong_buy + counts.buy + counts.neutral + counts.sell + counts.strong_sell;
  const bullish = counts.strong_buy + counts.buy;
  const bearish = counts.sell + counts.strong_sell;
  const fg = fearValue(market.data?.fearGreed);
  const fgClass = market.data?.fearGreed?.classification ?? "—";
  const topTrending = market.data?.trending?.[0];

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Markets</h1>
            <span className="mrd-status">
              <Badge tone={market.data ? "pos" : "neutral"}>{market.data ? "live" : "loading"}</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>
                {total} pairs analysed
              </span>
            </span>
          </div>
          <p className="mrd-sub">
            Signals combine RSI, MACD, EMA trend and global sentiment. A pair only becomes a candidate after the scam
            gates pass — the table shows what the engine sees, not what it bought.
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={() => market.refetch()} disabled={market.isFetching}>
            <Icon name="activity" size={15} /> Refresh
          </button>
          <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" disabled title="Watchlist arrives in phase 2">
            <Icon name="markets" size={15} /> Add pair
          </button>
        </div>
      </header>

      <div className="mrd-strip">
        <div className="mrd-cell">
          <div className="mrd-cell-label">
            <span>Fear &amp; Greed</span>
            <span className={fg !== null ? (fg > 60 ? "mrd-pos" : fg < 40 ? "mrd-neg" : "mrd-muted") : "mrd-dim"}>
              {fg !== null ? (fg > 60 ? "greed" : fg < 40 ? "fear" : "neutral") : "—"}
            </span>
          </div>
          <div className="mrd-cell-value">{fg ?? "—"}</div>
          <div className="mrd-cell-foot">{fgClass}</div>
        </div>
        <div className="mrd-cell">
          <div className="mrd-cell-label">
            <span>Bullish</span>
          </div>
          <div className="mrd-cell-value mrd-pos">{bullish}</div>
          <div className="mrd-cell-foot">{total ? `${Math.round((bullish / total) * 100)}% of analysed` : "no data"}</div>
        </div>
        <div className="mrd-cell">
          <div className="mrd-cell-label">
            <span>Bearish</span>
          </div>
          <div className="mrd-cell-value mrd-neg">{bearish}</div>
          <div className="mrd-cell-foot">{total ? `${Math.round((bearish / total) * 100)}% of analysed` : "no data"}</div>
        </div>
        <div className="mrd-cell">
          <div className="mrd-cell-label">
            <span>Neutral</span>
          </div>
          <div className="mrd-cell-value">{counts.neutral}</div>
          <div className="mrd-cell-foot">waiting for a clear edge</div>
        </div>
        <div className="mrd-cell">
          <div className="mrd-cell-label">
            <span>Top trending</span>
          </div>
          <div className="mrd-cell-value" style={{ fontSize: 17 }}>
            {topTrending?.symbol ?? "—"}
          </div>
          <div className="mrd-cell-foot">{topTrending?.name ?? "no trending data"}</div>
        </div>
      </div>

      <div className="mrd-hero">
        <section className="mrd-card">
          <div className="mrd-card-hd" data-border="true">
            <div>
              <div className="mrd-card-title">Scanner</div>
              <div className="mrd-card-sub">Latest snapshot per pair · sorted by signal score</div>
            </div>
            <div className="mrd-toolbar">
              <input
                className="mrd-input"
                placeholder="Filter pair"
                aria-label="Filter pair"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          {market.isLoading ? (
            <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={16} />
              ))}
            </div>
          ) : market.isError ? (
            <div className="mrd-card-body">
              <div className="mrd-banner" role="alert">
                <Icon name="risk" size={16} />
                <div className="grow">Could not load market snapshots. Retrying in a minute.</div>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <Empty
              title={q ? "No pair matches" : "No snapshots yet"}
              description={
                q
                  ? "Clear the filter to see every analysed pair."
                  : "The scanner writes one snapshot per pair per round. Start the engine to collect data."
              }
              action={
                q ? (
                  <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" onClick={() => setQ("")}>
                    Clear filter
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="mrd-table-wrap">
              <table className="mrd-table">
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th className="num">Price</th>
                    <th className="num">RSI</th>
                    <th className="num">MACD</th>
                    <th>Trend</th>
                    <th>Signal</th>
                    <th className="num">Score</th>
                    <th>Analyzed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice()
                    .sort((a, b) => b.signalScore - a.signalScore)
                    .map((s) => {
                      const sig = SIGNALS[s.signalLabel] ?? SIGNALS.neutral;
                      const trend = s.ema20 && s.ema50 ? (s.ema20 > s.ema50 ? "up" : "down") : null;
                      return (
                        <tr key={s.id}>
                          <td>
                            <div className="mrd-asset">
                              <span className="mrd-asset-ico" style={{ background: "linear-gradient(145deg,#2b3140,#1d2129)" }}>
                                {s.symbol.slice(0, 3)}
                              </span>
                              <div className="mrd-cellstack">
                                <span>{s.symbol}</span>
                                <small>{s.source.toUpperCase()}{s.chain ? ` · ${s.chain}` : ""}</small>
                              </div>
                            </div>
                          </td>
                          <td className="num">{price(s.priceUsd)}</td>
                          <td className="num">{s.rsi14 !== null ? s.rsi14.toFixed(1) : "—"}</td>
                          <td className={`num ${s.macdHist && s.macdHist > 0 ? "mrd-pos" : s.macdHist && s.macdHist < 0 ? "mrd-neg" : ""}`}>
                            {s.macdHist !== null ? (s.macdHist > 0 ? "+" : "") + s.macdHist.toFixed(3) : "—"}
                          </td>
                          <td>
                            {trend ? (
                              <span className={`mrd-delta ${trend === "up" ? "mrd-pos" : "mrd-neg"}`}>
                                {trend === "up" ? "↗" : "↘"} {trend}
                              </span>
                            ) : (
                              <span className="mrd-dim">—</span>
                            )}
                          </td>
                          <td>
                            <span className="mrd-signal">
                              <Badge tone={sig.tone}>{sig.label}</Badge>
                            </span>
                          </td>
                          <td className="num">{s.signalScore}</td>
                          <td className="mrd-dim">{clockUtc(s.analyzedAt)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mrd-card-section" style={{ borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
            <span className="mrd-dim" style={{ fontSize: 11.5 }}>
              {rows.length} of {market.data?.snapshots.length ?? 0} pairs
            </span>
            <span className="mrd-dim" style={{ fontSize: 11.5 }}>
              indicators from the engine, not from a chart vendor
            </span>
          </div>
        </section>

        <div className="mrd-side">
          <Card
            title="Signal mix"
            sub={total ? `${total} analysed pairs` : "no data"}
            bodyClassName="mrd-card-body"
          >
            <div style={{ display: "grid", gap: 10 }}>
              {[
                ["Strong buy", counts.strong_buy, "pos"],
                ["Buy", counts.buy, "pos"],
                ["Neutral", counts.neutral, "brand"],
                ["Sell", counts.sell, "warn"],
                ["Strong sell", counts.strong_sell, "neg"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} style={{ display: "grid", gap: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                    <span className="mrd-muted">{label}</span>
                    <b>{value as number}</b>
                  </div>
                  <Meter
                    value={total ? ((value as number) / total) * 100 : 0}
                    label={`${label} share`}
                    tone={tone === "brand" ? "brand" : (tone as "pos" | "warn" | "neg")}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Trending" sub="CoinGecko · engine source">
            {market.data?.trending?.length ? (
              <div className="mrd-list">
                {market.data.trending.slice(0, 6).map((t, i) => (
                  <div className="mrd-list-item" key={`${t.symbol}-${i}`}>
                    <span className="mrd-dim" style={{ width: 18 }}>{i + 1}</span>
                    <div className="mrd-list-main">
                      <div className="mrd-list-title">{t.symbol ?? "—"}</div>
                      <div className="mrd-list-sub">{t.name ?? "trending token"}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mrd-card-body">
                <p className="mrd-dim" style={{ fontSize: 12.5 }}>No trending data returned by the source.</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
