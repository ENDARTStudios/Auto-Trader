/* pages/markets.js — scanner, screener, token detail */
import { icon } from "../icons.js";
import { pageHead, card, badge, delta, assetIco, empty, meter } from "../ui.js";
import { assets, marketStats, fmt, positions, alerts } from "../data.js";
import { spark, mountAreaChart, candles, depthChart, gauge } from "../charts.js";
import { series } from "../data.js";

const riskTone = (r) => (r === "low" ? "pos" : r === "mid" ? "warn" : "neg");

function row(a) {
  const up = a.chg >= 0;
  return `<tr class="row-click" data-sym="${a.sym}">
    <td>
      <div class="asset">
        <span class="asset-ico" style="width:30px;height:30px;border-radius:9px;background:linear-gradient(145deg,${a.color},${a.color}99)">${a.sym.slice(0, 3)}</span>
        <div class="cell-stack"><span class="t-main">${a.pair}</span><span class="t-sub">${a.name}</span></div>
      </div>
    </td>
    <td class="num"><b>${fmt.px(a.px)}</b></td>
    <td class="num ${up ? "pos" : "neg"}">${fmt.pct(a.m5)}</td>
    <td class="num"><span class="delta ${up ? "pos" : "neg"}">${up ? icon("arrowUpRight", { size: 12 }) : icon("arrowDownRight", { size: 12 })}${fmt.pct(a.chg, 2).replace("+", "")}</span></td>
    <td class="num dim">${a.vol}</td>
    <td class="num dim">${a.spread}</td>
    <td class="num dim">${a.liq}</td>
    <td><span class="badge ${riskTone(a.risk)}">${a.risk}</span></td>
    <td style="width:96px">${spark(series(20, 100, up ? 0.004 : -0.003, 0.02, a.sym.charCodeAt(0)), { w: 84, h: 26, tone: up ? "pos" : "neg" })}</td>
    <td class="num dim">${a.score}</td>
  </tr>`;
}

export const markets = {
  title: "Markets",
  crumb: ["Operate", "Markets"],
  html() {
    return `
  ${pageHead({
    title: "Markets",
    sub: "18 pairs across 3 venues, ranked by opportunity score. Scanner refreshes every 30 seconds.",
    actions: `<button class="btn btn-ghost btn-sm" data-action="export">${icon("download", { size: 15 })} Export</button>
      <button class="btn btn-secondary btn-sm">${icon("sliders", { size: 15 })} Filters</button>
      <button class="btn btn-primary btn-sm">${icon("plus", { size: 15 })} Add pair</button>`,
  })}

  <div class="mkt-strip">
    ${marketStats
      .map(
        (s) => `<div class="mkt-cell">
        <div class="mc-hd"><span>${s.label}</span><span class="t-xs ${s.tone}">${s.delta}</span></div>
        <div class="mc-val">${s.value}</div>
        <div class="mc-foot">${s.foot}</div>
      </div>`
      )
      .join("")}
  </div>

  <div class="mkt-layout">
    <section class="card">
      <div class="card-hd with-border">
        <div class="row gap-3 wrap">
          <div class="card-title">Scanner</div>
          <div class="segmented">
            <button aria-pressed="true">All</button><button>Watchlist</button><button>Positions</button><button>Rejected</button>
          </div>
        </div>
        <div class="row gap-2">
          <div class="input-wrap" style="width:200px">
            ${icon("search", { size: 16 })}<input class="input" style="height:32px" placeholder="Filter pairs" aria-label="Filter pairs" />
          </div>
        </div>
      </div>
      <div class="table-wrap" style="max-height:560px">
        <table class="table mkt-table">
          <thead><tr>
            <th>Asset</th><th class="num">Price</th><th class="num">5m</th><th class="num">24h</th>
            <th class="num">Volume</th><th class="num">Spread</th><th class="num">Liquidity</th>
            <th>Risk</th><th>7d</th><th class="num">Score</th>
          </tr></thead>
          <tbody>${assets.map(row).join("")}</tbody>
        </table>
      </div>
      <div class="table-foot"><span>8 of 18 pairs · sorted by score</span><span class="row gap-2"><span class="dot pos"></span>Live · 4s ago</span></div>
    </section>

    <aside class="mkt-side">
      <section class="card">
        <div class="card-hd with-border" style="padding-bottom:12px">
          <div><div class="card-title">Top movers</div><div class="card-sub">24h · min $20M volume</div></div>
        </div>
        ${assets
          .slice()
          .sort((a, b) => b.chg - a.chg)
          .slice(0, 5)
          .map(
            (a) => `<div class="pos-mini" style="cursor:pointer" data-sym="${a.sym}">
          ${assetIco(a.sym, a.color)}
          <div class="pm-main"><div class="pm-top">${a.sym}</div><div class="pm-sub">${a.vol} vol</div></div>
          <div class="pm-side"><b class="${a.chg >= 0 ? "pos" : "neg"}">${fmt.pct(a.chg)}</b><span>${fmt.px(a.px)}</span></div>
        </div>`
          )
          .join("")}
      </section>

      <section class="card">
        <div class="card-hd with-border" style="padding-bottom:12px">
          <div><div class="card-title">Order flow</div><div class="card-sub">Aggregated · last 15m</div></div>
          <span class="badge neutral">SOL/USDT</span>
        </div>
        <div class="card-body">
          <div class="row between t-xs" style="margin-bottom:6px"><span class="pos">Buy 62.4%</span><span class="neg">Sell 37.6%</span></div>
          <div class="flow-bar"><span class="buy" style="width:62.4%"></span><span class="sell" style="width:37.6%"></span></div>
          <dl class="dl tight" style="margin-top:14px">
            <dt>Buy volume</dt><dd class="pos">$4.82M</dd>
            <dt>Sell volume</dt><dd class="neg">$2.91M</dd>
            <dt>Large orders</dt><dd>12 (>$50k)</dd>
            <dt>Depth ±1%</dt><dd>$1.24M</dd>
          </dl>
          <div style="margin-top:12px">${depthChart({ w: 280, h: 92 })}</div>
        </div>
      </section>

      <section class="card">
        <div class="card-hd" style="padding-bottom:4px"><div class="card-title">Market sentiment</div></div>
        <div class="card-body row gap-4">
          ${gauge(0.72, { size: 108, label: "72" })}
          <div>
            <div class="strong">Greed</div>
            <div class="dim t-xs" style="margin-top:2px">7-day average 64</div>
            <div class="badge warn" style="margin-top:8px">Elevated risk appetite</div>
          </div>
        </div>
      </section>
    </aside>
  </div>`;
  },
  mount(root) {
    root.querySelectorAll("[data-sym]").forEach((n) =>
      n.addEventListener("click", () => (location.hash = `#/token/${n.dataset.sym}`))
    );
  },
};

/* ---------- Token detail ---------- */
export const token = {
  title: "Token",
  crumb: ["Operate", "Markets", "Token"],
  html(param) {
    const a = assets.find((x) => x.sym === (param || "SOL")) || assets[2];
    const held = positions.find((p) => p.sym === a.sym);
    const cs = Array.from({ length: 48 }, (_, i) => {
      const base = a.px * (0.94 + i * 0.0018);
      const o = base * (0.99 + Math.random() * 0.02);
      const c = base * (0.99 + Math.random() * 0.02);
      return { o, c, h: Math.max(o, c) * 1.008, l: Math.min(o, c) * 0.992, v: 20 + Math.random() * 80 };
    });
    return `
  <div class="row gap-2" style="margin-bottom:14px">
    <a class="btn btn-ghost btn-sm" href="#/markets">${icon("arrowLeft", { size: 15 })} Markets</a>
    <span class="dim t-xs">/ ${a.name}</span>
  </div>
  ${pageHead({
    status: `<span class="badge brand">${a.tag}</span> <span class="dim t-xs">${a.pair} · Binance</span>`,
    title: `<span class="row gap-3">${assetIco(a.sym, a.color, "xl")} ${a.name} <span class="dim" style="font-size:16px;font-weight:500">${a.sym}</span></span>`,
    actions: `<button class="btn btn-secondary btn-sm">${icon("star", { size: 15 })} Watchlist</button>
      <button class="btn btn-secondary btn-sm" data-nav="#/copilot">${icon("sparkles", { size: 15 })} Ask Copilot</button>
      <button class="btn btn-primary btn-sm" data-action="trade">${icon("arrowUpRight", { size: 15 })} Paper trade</button>`,
  })}
  <div class="token-price" style="margin:-6px 0 18px">
    <span class="p">$${fmt.px(a.px)}</span>
    <span class="delta ${a.chg >= 0 ? "pos" : "neg"}" style="font-size:14px">${icon(a.chg >= 0 ? "arrowUpRight" : "arrowDownRight", { size: 14 })} ${fmt.pct(a.chg)} · 24h</span>
    <span class="dim t-xs">vol ${a.vol} · liq ${a.liq} · spread ${a.spread}</span>
  </div>

  <div class="token-hero">
    <section class="card">
      <div class="card-hd">
        <div class="row gap-3">
          <div class="card-title">Price</div>
          <div class="segmented"><button>15m</button><button>1H</button><button aria-pressed="true">4H</button><button>1D</button></div>
        </div>
        <div class="chart-legend">
          <span><i style="background:var(--pos)"></i>Up</span><span><i style="background:var(--neg)"></i>Down</span>
          <span class="dim">Volume · 20%</span>
        </div>
      </div>
      <div class="card-body" style="padding-top:6px">${candles(cs, { w: 740, h: 260 })}</div>
    </section>

    <aside>
      <section class="card">
        <div class="card-hd"><div class="card-title">Risk score</div><span class="badge ${riskTone(a.risk)}">${a.risk}</span></div>
        <div class="card-body">
          <div class="risk-score" style="margin-bottom:14px">
            <span class="rs-big">${a.score}</span>
            <div class="grow">${meter(a.score, a.score > 75 ? "pos" : a.score > 50 ? "warn" : "neg")}
              <div class="dim t-xs" style="margin-top:6px">Composite of liquidity, authority, holder concentration and honeypot checks.</div>
            </div>
          </div>
          <div class="rflags">
            <div class="rflag ok"><div class="rf-top">${icon("checkCircle", { size: 13, cls: "pos" })} Liquidity</div><div class="rf-val">$28.4M locked</div></div>
            <div class="rflag ok"><div class="rf-top">${icon("checkCircle", { size: 13, cls: "pos" })} Authority</div><div class="rf-val">renounced</div></div>
            <div class="rflag ok"><div class="rf-top">${icon("checkCircle", { size: 13, cls: "pos" })} Sell test</div><div class="rf-val">passed · 0.4% tax</div></div>
            <div class="rflag bad"><div class="rf-top">${icon("alert", { size: 13, cls: "neg" })} Top holders</div><div class="rf-val">18.2% · watch</div></div>
          </div>
        </div>
      </section>
      ${held
        ? `<section class="card" style="margin-top:16px">
        <div class="card-hd"><div class="card-title">Your position</div><span class="badge ${held.side === "LONG" ? "pos" : "neg"}">${held.side}</span></div>
        <div class="card-body">
          <dl class="dl tight">
            <dt>Size</dt><dd>${fmt.usd(held.size)}</dd>
            <dt>Entry</dt><dd>$${fmt.px(held.entry)}</dd>
            <dt>Mark</dt><dd>$${fmt.px(held.mark)}</dd>
            <dt>Unrealized</dt><dd class="${held.pnl >= 0 ? "pos" : "neg"}">${fmt.signed(held.pnl)} (${fmt.pct(held.pnlPct)})</dd>
            <dt>Stop / target</dt><dd>$${fmt.px(held.stop)} / $${fmt.px(held.target)}</dd>
          </dl>
          <button class="btn btn-secondary btn-sm btn-block" style="margin-top:14px" data-nav="#/position/${held.sym}">Open position ${icon("arrowRight", { size: 14 })}</button>
        </div>
      </section>`
        : ""}
    </aside>
  </div>

  <div class="grid g-12" style="margin-top:16px">
    <section class="card col-7">
      <div class="card-hd with-border"><div><div class="card-title">Why it is in the scanner</div><div class="card-sub">Evidence collected by the perception layer</div></div>${badge("4 signals", "brand")}</div>
      <div class="list">
        ${[
          ["activity", "Momentum", "Price broke the 20-period high with 2.4× average volume.", "pos"],
          ["database", "Liquidity depth", "±1% depth of $1.24M supports a $8.4k position with 0.7% slippage.", "ok"],
          ["shield", "Safety", "No mint authority, no blacklist, sell simulation succeeded.", "ok"],
          ["radar", "Social velocity", "Mentions up 38% in 6h across indexed channels.", ""],
        ]
          .map(
            ([ic, t, d, tone]) => `<div class="list-item">
          <span class="li-ico">${icon(ic, { size: 15, cls: tone === "neg" ? "neg" : "" })}</span>
          <div class="li-main"><div class="li-title">${t}</div><div class="li-sub" style="white-space:normal">${d}</div></div>
          ${tone === "pos" ? badge("bullish", "pos") : tone === "ok" ? badge("pass", "neutral") : badge("info", "neutral")}
        </div>`
          )
          .join("")}
      </div>
    </section>
    <section class="card col-5">
      <div class="card-hd with-border"><div class="card-title">Key statistics</div></div>
      <div class="card-body">
        <dl class="dl">
          <dt>Market cap</dt><dd>$112.4B</dd>
          <dt>24h volume</dt><dd>${a.vol}</dd>
          <dt>Circulating</dt><dd>482.4M ${a.sym}</dd>
          <dt>All-time high</dt><dd>$294.30 (−29.2%)</dd>
          <dt>Listed</dt><dd>Apr 2020 · ${a.age}</dd>
          <dt>Venues</dt><dd>3 · Binance, Bybit, OKX</dd>
        </dl>
      </div>
    </section>
  </div>`;
  },
  mount(root) {
    root.querySelectorAll("[data-action='trade']").forEach((b) =>
      b.addEventListener("click", () =>
        window.__at.toast({ title: "Paper order drafted", desc: "Review in the position ticket before confirming.", iconName: "arrowUpRight" })
      )
    );
  },
};
