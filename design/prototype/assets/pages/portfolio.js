/* pages/portfolio.js — portfolio + position detail */
import { icon } from "../icons.js";
import { pageHead, card, badge, delta, assetIco, meter, gate } from "../ui.js";
import { positions, equityPoint as E, fmt, trades } from "../data.js";
import { donut, mountAreaChart, spark, candles } from "../charts.js";
import { equity30 } from "../data.js";

const ALLOC = [
  { label: "Solana", value: 34.1, color: "#14F195" },
  { label: "Bitcoin", value: 24.9, color: "#F7931A" },
  { label: "Ethereum", value: 13.4, color: "#627EEA" },
  { label: "Arbitrum", value: 4.2, color: "#28A0F0" },
  { label: "Cash", value: 23.4, color: "#3A4250" },
];

export const portfolio = {
  title: "Portfolio",
  crumb: ["Operate", "Portfolio"],
  html() {
    const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
    return `
  ${pageHead({
    title: "Portfolio",
    sub: "4 open positions and $6,120 in cash. Allocation is rebalanced by the risk engine, not by hand.",
    actions: `<button class="btn btn-ghost btn-sm" data-action="export">${icon("download", { size: 15 })} Export</button>
      <button class="btn btn-secondary btn-sm">${icon("sliders", { size: 15 })} Risk limits</button>
      <button class="btn btn-primary btn-sm">${icon("plus", { size: 15 })} New position</button>`,
  })}

  <div class="pf-head">
    <section class="card">
      <div class="card-hd"><div><div class="card-title">Equity</div><div class="card-sub">Paper ledger · USD</div></div>
        <div class="range"><button aria-pressed="true">1M</button><button>3M</button><button>ALL</button></div></div>
      <div class="card-body">
        <div class="row between wrap gap-3">
          <div>
            <div class="t-num-lg" style="font-size:34px">$24,812.44</div>
            <div class="row gap-2 mt-1">${delta(14.42)} <span class="dim t-xs">30 days · benchmark +8.12%</span></div>
          </div>
          <div class="row gap-5">
            <div><div class="t-caption">Realized</div><div class="strong">+$2,489.79</div></div>
            <div><div class="t-caption">Unrealized</div><div class="strong pos">+$638.40</div></div>
            <div><div class="t-caption">Fees</div><div class="strong dim">−$142.18</div></div>
          </div>
        </div>
        <div class="ov-chart" data-pf-chart style="margin-top:14px"></div>
      </div>
    </section>

    <section class="card">
      <div class="card-hd"><div class="card-title">Allocation</div><span class="badge neutral">5 assets</span></div>
      <div class="card-body pf-alloc">
        ${donut(ALLOC, { size: 128, thickness: 13 })}
        <div class="alloc-legend">
          ${ALLOC.map(
            (a) => `<div class="al"><i style="background:${a.color}"></i>${a.label}<b>${a.value.toFixed(1)}%</b></div>`
          ).join("")}
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-hd"><div class="card-title">Buying power</div>${badge("paper", "warn")}</div>
      <div class="card-body">
        <div class="kpi"><div class="kpi-label">Available cash</div><div class="kpi-value">$6,120.44</div><div class="kpi-foot">24.7% of equity</div></div>
        <div style="margin:16px 0 6px" class="row between t-xs"><span class="dim">Exposure</span><span><b>75.4%</b> <span class="dim">of 80% cap</span></span></div>
        ${meter(94.2, "warn")}
        <div class="row between t-xs" style="margin-top:14px"><span class="dim">Risk budget used</span><span><b>1.24%</b> <span class="dim">of 2.0%</span></span></div>
        ${meter(62, "pos")}
        <div class="banner" style="margin-top:16px">${icon("info", { size: 15 })}<div class="grow">One more position would breach the 80% cap. The engine will trim the smallest weight first.</div></div>
      </div>
    </section>
  </div>

  <div class="pf-split">
    <section class="card">
      <div class="card-hd with-border">
        <div><div class="card-title">Open positions ${badge("4", "neutral")}</div><div class="card-sub">Unrealized ${fmt.signed(totalPnl)}</div></div>
        <div class="row gap-2"><div class="segmented"><button aria-pressed="true">All</button><button>Long</button><button>Short</button></div></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Asset</th><th>Side</th><th class="num">Size</th><th class="num">Entry</th><th class="num">Mark</th>
            <th class="num">P&L</th><th class="num">Weight</th><th>Strategy</th><th></th>
          </tr></thead>
          <tbody>
            ${positions
              .map(
                (p) => `<tr class="row-click" data-pos="${p.sym}">
              <td>${`<div class="asset">${assetIco(p.sym, p.color)}<div class="cell-stack"><span class="t-main">${p.sym}</span><span class="t-sub">${p.pair}</span></div></div>`}</td>
              <td><span class="badge ${p.side === "LONG" ? "pos" : "neg"}">${p.side}</span></td>
              <td class="num">${fmt.usd(p.size)}</td>
              <td class="num">$${fmt.px(p.entry)}</td>
              <td class="num">$${fmt.px(p.mark)}</td>
              <td class="num ${p.pnl >= 0 ? "pos" : "neg"}">${fmt.signed(p.pnl)}<div class="t-sub ${p.pnl >= 0 ? "pos" : "neg"}" style="font-size:10.5px">${fmt.pct(p.pnlPct)}</div></td>
              <td class="num">${p.weight}%</td>
              <td class="dim" style="font-size:11.5px;max-width:130px;overflow:hidden;text-overflow:ellipsis">${p.strategy}</td>
              <td class="num"><button class="icon-btn" data-close="${p.sym}" data-tip="Close position" style="width:26px;height:26px">${icon("x", { size: 13 })}</button></td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="table-foot"><span>4 positions · ${fmt.usd(18692)} deployed</span><span>Fees today −$12.42</span></div>
    </section>

    <aside>
      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Exposure by strategy</div></div>
        <div class="card-body">
          ${[
            ["Momentum Breakout", 42, 52],
            ["Trend Core", 31, 40],
            ["Mean Reversion", 18, 25],
            ["Breakdown", 9, 20],
          ]
            .map(
              ([n, v, cap]) => `<div class="exposure-row"><span>${n}</span><div class="bar"><i style="width:${(v / cap) * 100}%"></i></div><b>${v}%</b></div>`
            )
            .join("")}
          <div class="divider" style="margin:14px 0"></div>
          <div class="row between"><span class="dim t-xs">Portfolio beta (BTC)</span><span class="strong">0.82</span></div>
          <div class="row between mt-2"><span class="dim t-xs">Correlation (24h)</span><span class="strong">0.64</span></div>
          <div class="row between mt-2"><span class="dim t-xs">Value at risk (95%)</span><span class="strong neg">−$1,842</span></div>
        </div>
      </section>
      <section class="card" style="margin-top:16px">
        <div class="card-hd with-border"><div class="card-title">Recent fills</div><a class="card-link" href="#/journal">Journal ${icon("arrowRight", { size: 13 })}</a></div>
        <div>
          ${trades
            .slice(0, 3)
            .map(
              (t) => `<div class="pos-mini">
            <span class="li-ico" style="width:26px;height:26px">${icon(t.side === "BUY" ? "arrowUpRight" : "arrowDownRight", { size: 13, cls: t.side === "BUY" ? "pos" : "neg" })}</span>
            <div class="pm-main"><div class="pm-top">${t.side} ${t.sym}</div><div class="pm-sub">${t.ts.replace(" · ", " ")}</div></div>
            <div class="pm-side"><b>${fmt.usd(t.notional)}</b><span>${t.px < 1 ? t.px : fmt.px(t.px)}</span></div>
          </div>`
            )
            .join("")}
        </div>
      </section>
    </aside>
  </div>`;
  },
  mount(root) {
    const host = root.querySelector("[data-pf-chart]");
    mountAreaChart(host, { data: equity30, h: 150, valueFmt: (v) => fmt.money(v), labels: [] });
    root.querySelectorAll("[data-pos]").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("[data-close]")) return;
        location.hash = `#/position/${tr.dataset.pos}`;
      })
    );
    root.querySelectorAll("[data-close]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        window.__at.openModal({
          title: `Close ${b.dataset.close} position?`,
          desc: "A market order will be simulated at the current mark. Paper mode — no capital moves.",
          primary: "Close position",
          tone: "danger",
          body: `<dl class="dl tight"><dt>Notional</dt><dd>$8,420.50</dd><dt>Est. slippage</dt><dd>0.04%</dd><dt>Realized P&L</dt><dd class="pos">+$525.40</dd></dl>`,
          onConfirm: () => window.__at.toast({ title: "Close order submitted", desc: `${b.dataset.close} flattening at market.`, iconName: "checkCircle" }),
        });
      })
    );
  },
};

/* ---------- Position detail ---------- */
export const position = {
  title: "Position",
  crumb: ["Operate", "Portfolio", "Position"],
  html(param) {
    const p = positions.find((x) => x.sym === (param || "SOL")) || positions[0];
    const cs = Array.from({ length: 40 }, (_, i) => {
      const base = p.entry * (1 - 0.03 + i * 0.0022);
      const o = base * (0.995 + Math.random() * 0.01);
      const c = base * (0.995 + Math.random() * 0.01);
      return { o, c, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, v: 20 + Math.random() * 60 };
    });
    return `
  <div class="row gap-2" style="margin-bottom:14px">
    <a class="btn btn-ghost btn-sm" href="#/portfolio">${icon("arrowLeft", { size: 15 })} Portfolio</a>
    <span class="dim t-xs">/ ${p.pair} · ${p.strategy}</span>
  </div>
  ${pageHead({
    status: `<span class="badge ${p.side === "LONG" ? "pos" : "neg"}">${p.side}</span> <span class="dim t-xs">opened ${p.opened} ago · ${p.round}</span>`,
    title: `<span class="row gap-3">${assetIco(p.sym, p.color, "xl")} ${p.sym}/USDT</span>`,
    sub: `Entry $${fmt.px(p.entry)} · mark $${fmt.px(p.mark)} · stop $${fmt.px(p.stop)} · target $${fmt.px(p.target)}`,
    actions: `<button class="btn btn-secondary btn-sm" data-nav="#/copilot">${icon("sparkles", { size: 15 })} Ask Copilot</button>
      <button class="btn btn-secondary btn-sm">${icon("sliders", { size: 15 })} Adjust stop</button>
      <button class="btn btn-danger btn-sm" data-close-pos>${icon("x", { size: 15 })} Close position</button>`,
  })}

  <div class="pd-summary">
    <div><div class="kpi-label">Size</div><div class="t-num-lg" style="font-size:22px;margin-top:4px">${fmt.usd(p.size)}</div><div class="kpi-foot">${p.weight}% of equity</div></div>
    <div><div class="kpi-label">Unrealized P&L</div><div class="t-num-lg ${p.pnl >= 0 ? "pos" : "neg"}" style="font-size:22px;margin-top:4px">${fmt.signed(p.pnl)}</div><div class="kpi-foot"><span class="${p.pnl >= 0 ? "pos" : "neg"}">${fmt.pct(p.pnlPct)}</span> · net of fees</div></div>
    <div><div class="kpi-label">Distance to stop</div><div class="t-num-lg" style="font-size:22px;margin-top:4px">${(((p.mark - p.stop) / p.mark) * 100).toFixed(2)}%</div><div class="kpi-foot">risk ${fmt.usd(Math.abs((p.mark - p.stop) * (p.size / p.mark)))} at stop</div></div>
    <div><div class="kpi-label">Confidence at entry</div><div class="t-num-lg" style="font-size:22px;margin-top:4px">${p.conf}%</div><div class="kpi-foot">decay −2.4%/h</div></div>
  </div>

  <div class="pd-grid" style="margin-top:16px">
    <section class="card">
      <div class="card-hd">
        <div><div class="card-title">Price vs plan</div><div class="card-sub">Entry, stop and target projected on the 4H chart</div></div>
        <div class="chart-legend">
          <span><i style="background:var(--pos)"></i>Mark</span>
          <span><i class="dash" style="color:var(--neg)"></i>Stop</span>
          <span><i class="dash" style="color:var(--brand)"></i>Target</span>
        </div>
      </div>
      <div class="card-body" style="position:relative">
        ${candles(cs, { w: 720, h: 280 })}
        <div style="position:absolute;inset:0;pointer-events:none">
          <div style="position:absolute;left:8px;right:8px;top:38%;border-top:1px dashed var(--neg)"></div>
          <div style="position:absolute;left:8px;right:8px;top:18%;border-top:1px dashed var(--brand)"></div>
        </div>
      </div>
    </section>

    <aside>
      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Execution trail</div>${badge("paper", "warn")}</div>
        <div class="card-body">
          <div class="stage-track">
            ${["Scored", "Risk", "Signed", "Filled", "Manage"]
              .map((s, i) => `<div class="stage ${i < 3 ? "done" : i === 3 ? "now" : ""}"><i></i><span>${s}</span></div>`)
              .join("")}
          </div>
          <div class="divider" style="margin:16px 0"></div>
          <dl class="dl tight">
            <dt>Order type</dt><dd>Limit IOC</dd>
            <dt>Fill price</dt><dd>$${fmt.px(p.mark * 0.999)}</dd>
            <dt>Fee</dt><dd class="dim">−$2.14 (0.025%)</dd>
            <dt>Slippage</dt><dd class="pos">+0.01%</dd>
            <dt>Venue</dt><dd>Binance</dd>
          </dl>
        </div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="card-hd with-border"><div class="card-title">Gates at entry</div></div>
        <div class="card-body gates">
          ${gate("Liquidity depth", "$28.4M", "ok")}
          ${gate("Sell simulation", "passed", "ok")}
          ${gate("Exposure budget", "within cap", "ok")}
          ${gate("Regime", "trend up", "ok")}
        </div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="card-hd with-border"><div class="card-title">Invalidation</div></div>
        <div class="card-body">
          <p class="t-sm muted" style="line-height:1.55">The thesis is void if price closes below <b>$${fmt.px(p.stop)}</b> on the 4H chart, or if funding flips above 0.03% for 3 consecutive windows.</p>
          <div class="banner info" style="margin-top:12px">${icon("info", { size: 15 })}<div class="grow">Trailing stop moves to break-even at +6%.</div></div>
        </div>
      </section>
    </aside>
  </div>`;
  },
  mount(root) {
    root.querySelectorAll("[data-close-pos]").forEach((b) =>
      b.addEventListener("click", () =>
        window.__at.openModal({
          title: "Close position?",
          desc: "A market order is simulated at the current mark.",
          primary: "Close position",
          tone: "danger",
          body: `<dl class="dl tight"><dt>Notional</dt><dd>${fmt.usd(8420.5)}</dd><dt>Est. slippage</dt><dd>0.04%</dd><dt>Realized P&L</dt><dd class="pos">+$525.40</dd></dl>`,
          onConfirm: () => window.__at.toast({ title: "Position closed", desc: "SOL/USDT flattened at $208.31.", iconName: "checkCircle" }),
        })
      )
    );
  },
};
