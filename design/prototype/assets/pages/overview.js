/* pages/overview.js — Mission control */
import { icon } from "../icons.js";
import { pageHead, kpi, delta, badge, dot, assetIco, card, gate } from "../ui.js";
import { equity30, equity90, equityAll, benchmark90, equityPoint as E, positions, alerts, fmt } from "../data.js";
import { mountAreaChart, spark } from "../charts.js";

const RANGES = {
  "1W": { data: equity30.slice(-7), bench: null, labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  "1M": { data: equity30, bench: null, labels: equity30.map((_, i) => (i % 6 === 0 ? `${i + 1}` : "")) },
  "3M": { data: equity90, bench: benchmark90, labels: equity90.map((_, i) => (i % 15 === 0 ? `W${i / 15 + 1}` : "")) },
  ALL: { data: equityAll, bench: null, labels: equityAll.map((_, i) => (i % 30 === 0 ? `M${i / 30 + 1}` : "")) },
};

function positionRow(p) {
  const tone = p.pnl >= 0 ? "pos" : "neg";
  return `<a class="pos-mini" href="#/position/${p.sym}" aria-label="${p.sym} position">
    ${assetIco(p.sym, p.color)}
    <div class="pm-main">
      <div class="pm-top">${p.pair}
        <span class="badge ${p.side === "LONG" ? "pos" : "neg"}" style="height:17px;font-size:10px">${p.side}</span>
      </div>
      <div class="pm-sub">${p.strategy} · ${p.opened}</div>
    </div>
    <div class="pm-side">
      <b class="${tone}">${fmt.signed(p.pnl)}</b>
      <span class="${tone}">${fmt.pct(p.pnlPct)}</span>
    </div>
  </a>`;
}

export const overview = {
  title: "Overview",
  crumb: ["Operate", "Overview"],
  html() {
    return `
  ${pageHead({
    status: `${badge("Paper", "warn")} <span class="dim t-xs">Engine running · round 4,128</span>`,
    title: "Mission control",
    sub: "Autonomous engine scanning 18 pairs. 4 open positions, 75.4% exposure, no unresolved risk events.",
    actions: `
      <button class="btn btn-ghost btn-sm" data-action="export">${icon("download", { size: 15 })} Export</button>
      <button class="btn btn-secondary btn-sm" data-nav="#/backtest">${icon("flask", { size: 15 })} New backtest</button>
      <button class="btn btn-primary btn-sm" data-action="pause-engine">${icon("pause", { size: 15 })} Pause engine</button>`,
  })}

  <div class="banner info" style="margin-bottom:16px">
    ${icon("info", { size: 16 })}
    <div class="grow">Paper mode — real prices, zero capital at risk. Live unlocks after <b>50</b> positive cycles · <b>12</b>/50 completed.</div>
    <a class="btn btn-ghost btn-sm" href="#/risk">Graduation rules ${icon("arrowRight", { size: 14 })}</a>
  </div>

  <div class="ov-hero">
    <section class="card ov-equity">
      <div class="card-hd">
        <div>
          <div class="card-title">Portfolio equity</div>
          <div class="card-sub">Net of fees · updated 4s ago</div>
        </div>
        <div class="row gap-2">
          <span class="badge neutral">USD</span>
          <div class="range" data-range role="group" aria-label="Time range">
            ${Object.keys(RANGES).map((r) => `<button aria-pressed="${r === "1M"}">${r}</button>`).join("")}
          </div>
        </div>
      </div>
      <div class="card-body" style="padding-bottom:12px">
        <div class="big">
          <span class="amt">$24,812.44</span>
          <span class="cur">USD</span>
          <span class="delta pos" style="font-size:14px">${icon("arrowUpRight", { size: 14 })} +$3,128.19 · +14.42%</span>
        </div>
        <div class="meta">
          <span>Initial <b>$10,000.00</b></span>
          <span>Peak <b>$25,904.12</b></span>
          <span>Max drawdown <b class="neg">−4.22%</b></span>
          <span>Benchmark <b>+8.12%</b></span>
        </div>
        <div class="ov-chart" data-equity-chart></div>
      </div>
      <div class="card-section row between" style="padding-top:12px">
        <div class="chart-legend">
          <span><i style="background:var(--pos)"></i>Auto Trader</span>
          <span><i class="dash"></i>BTC benchmark</span>
        </div>
        <span class="dim t-xs">30 daily snapshots · paper ledger</span>
      </div>
    </section>

    <div class="ov-side">
      <section class="card engine-card">
        <div class="card-hd" style="padding:0">
          <div>
            <div class="card-title">Engine ${badge("running", "pos")}</div>
            <div class="card-sub">Scout → decision → risk → execute</div>
          </div>
          <button class="icon-btn" data-tip="Engine settings" data-nav="#/strategy">${icon("settings", { size: 16 })}</button>
        </div>
        <div class="state">
          <div class="ring" style="--p:.72"><b>72%</b></div>
          <div>
            <b>Round 4,128 · stage 4/5</b>
            <span>Executing SOL/USDT · next scan in 41s</span>
          </div>
        </div>
        <div class="steps">
          <i class="done"></i><i class="done"></i><i class="done"></i><i class="now"></i><i></i>
        </div>
        <div class="step-labels">
          <span>Scan</span><span>Score</span><span>Risk</span><span>Execute</span><span>Log</span>
        </div>
      </section>

      <section class="card decision-card">
        <div class="dc-hd">
          <div>
            <div class="card-title">AI decision ${badge("2m ago", "neutral")}</div>
            <div class="dc-act">${icon("arrowUpRight", { size: 18, cls: "pos" })} LONG <span class="dim" style="font-weight:500">SOL/USDT</span></div>
            <div class="dc-sym">Momentum Breakout · size $8,420 · stop $186.40</div>
          </div>
          <div class="ring" style="--p:.78;width:48px;height:48px"><b>78</b></div>
        </div>
        <div class="gates">
          ${gate("Liquidity", "$28.4M", "ok")}
          ${gate("Token authority", "renounced", "ok")}
          ${gate("Sell simulation", "passed", "ok")}
          ${gate("Exposure budget", "75.4% / 80%", "ok")}
        </div>
        <button class="btn btn-secondary btn-sm btn-block" data-nav="#/copilot">${icon("sparkles", { size: 15 })} Why this trade?</button>
      </section>
    </div>
  </div>

  <section class="card" style="margin-top:16px">
    <div class="kpi-row">
      ${kpi({ label: "Equity", value: "$24,812.44", foot: `<span class="pos">+$14,812.44</span> all-time` })}
      ${kpi({ label: "30d P&L", value: "$3,128.19", foot: delta(14.42) + "<span class='dim'>vs bench +8.1%</span>" })}
      ${kpi({ label: "Win rate", value: "61.8%", foot: "<span class='dim'>92W · 56L · 148 trades</span>" })}
      ${kpi({ label: "Sharpe", value: "1.84", foot: "<span class='dim'>30d · non-annualized</span>" })}
      ${kpi({ label: "Exposure", value: "75.4%", foot: "<span class='dim'>$18,692 of $24,812</span>" })}
      ${kpi({ label: "Open positions", value: "4", foot: "<span class='dim'>SOL · BTC · ETH · ARB</span>" })}
    </div>
  </section>

  <div class="ov-lower">
    <section class="card">
      <div class="card-hd with-border" style="padding-bottom:12px">
        <div><div class="card-title">Open positions ${badge("4", "neutral")}</div><div class="card-sub">Unrealized P&L $638.40</div></div>
        <a class="card-link" href="#/portfolio">All positions ${icon("arrowRight", { size: 13 })}</a>
      </div>
      <div>${positions.map(positionRow).join("")}</div>
    </section>

    <section class="card alerts-mini">
      <div class="card-hd with-border" style="padding-bottom:12px">
        <div><div class="card-title">Needs attention ${badge("2", "crit")}</div><div class="card-sub">Since your last visit</div></div>
        <a class="card-link" href="#/alerts">Inbox ${icon("arrowRight", { size: 13 })}</a>
      </div>
      ${alerts
        .slice(0, 3)
        .map(
          (a) => `<div class="alert-row">
        <span class="sev-ico ${a.sev === "crit" ? "neg" : a.sev === "warn" ? "warn" : "brand"}">${icon(a.icon, { size: 14 })}</span>
        <div class="grow">
          <div class="row gap-2" style="font-size:12.5px;font-weight:550">${a.title}</div>
          <div class="dim t-xs" style="margin-top:2px;line-height:1.45">${a.desc}</div>
        </div>
        <span class="dim t-xs nowrap">${a.time}</span>
      </div>`
        )
        .join("")}
      <div class="card-section row between">
        <button class="btn btn-ghost btn-sm" data-nav="#/alerts">Open inbox</button>
        <button class="btn btn-ghost btn-sm" data-action="mute">Mute 1h</button>
      </div>
    </section>

    <section class="card act-list">
      <div class="card-hd with-border" style="padding-bottom:12px">
        <div><div class="card-title">Activity</div><div class="card-sub">Engine + operator log</div></div>
        <button class="icon-btn" data-tip="Full log" data-nav="#/journal">${icon("history", { size: 16 })}</button>
      </div>
      ${[
        ["play", "<b>Round 4,128</b> started · 18 pairs scanned", "14:22"],
        ["check", "<b>SOL/USDT</b> entry filled at $207.82", "14:22"],
        ["sparkles", "Strategy <b>Momentum v12</b> promoted (forward 21d)", "13:42"],
        ["shield", "<b>PEPE/USDT</b> rejected · liquidity gate", "10:04"],
      ]
        .map(
          ([ic, text, t]) => `<div class="act">
        <span class="a-ico">${icon(ic, { size: 12 })}</span>
        <div style="flex:1;min-width:0"><p>${text}</p></div>
        <time>${t}</time>
      </div>`
        )
        .join("")}
    </section>
  </div>`;
  },
  mount(root) {
    const host = root.querySelector("[data-equity-chart]");
    let current = "1M";
    const draw = (key) => {
      const r = RANGES[key];
      mountAreaChart(host, {
        data: r.data,
        bench: r.bench,
        labels: r.labels,
        h: 214,
        valueFmt: (v) => fmt.money(v),
      });
    };
    draw(current);
    root.querySelectorAll("[data-range] button").forEach((btn) => {
      btn.addEventListener("click", () => {
        root.querySelectorAll("[data-range] button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        current = btn.textContent.trim();
        draw(current);
      });
    });
  },
};
