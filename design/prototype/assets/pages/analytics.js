/* pages/analytics.js */
import { icon } from "../icons.js";
import { pageHead, card, badge, delta, meter } from "../ui.js";
import { fmt, equity90, benchmark90, equityPoint as E } from "../data.js";
import { mountAreaChart, bars, gauge } from "../charts.js";

export const analytics = {
  title: "Analytics",
  crumb: ["Operate", "Analytics"],
  html() {
    const heat = [
      ["Mon", 0.4, 1.2, 0.8, -0.6, 1.4, 0.2],
      ["Tue", -0.8, 0.6, 1.8, 0.4, 0.9, -0.3],
      ["Wed", 1.2, -0.4, 0.6, 1.6, -0.2, 0.5],
      ["Thu", 0.2, 1.4, -1.2, 0.8, 1.1, 0.3],
      ["Fri", 0.9, 0.3, 1.6, -0.4, 0.7, 1.2],
    ];
    const cell = (v) => {
      const c = v > 0 ? `rgba(61,220,151,${Math.min(0.62, 0.12 + v * 0.28)})` : `rgba(255,107,129,${Math.min(0.62, 0.12 + Math.abs(v) * 0.28)})`;
      return `<div class="h-cell" style="background:${c}">${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}</div>`;
    };
    return `
  ${pageHead({
    title: "Analytics",
    sub: "Performance is measured on closed trades only, net of fees, with the benchmark shown for context.",
    actions: `<div class="segmented"><button>7D</button><button aria-pressed="true">30D</button><button>90D</button><button>1Y</button></div>
      <button class="btn btn-secondary btn-sm" data-action="export">${icon("download", { size: 15 })} Export</button>`,
  })}

  <div class="metric-grid">
    ${[
      ["Net return", "+14.42%", "30d · benchmark +8.12%", "pos"],
      ["Max drawdown", "−4.22%", "peak $25,904", "neg"],
      ["Sharpe", "1.84", "non-annualized", ""],
      ["Sortino", "2.41", "downside dev 2.1%", ""],
      ["Win rate", "61.8%", "92W · 56L", ""],
      ["Profit factor", "1.92", "gross 1.84 / 0.96", ""],
    ]
      .map(
        ([l, v, f, tone]) => `<div class="metric"><div class="m-l">${l}</div><div class="m-v ${tone}">${v}</div><div class="m-f">${f}</div></div>`
      )
      .join("")}
  </div>

  <div class="an-grid" style="margin-top:16px">
    <section class="card an-full">
      <div class="card-hd">
        <div><div class="card-title">Equity vs benchmark</div><div class="card-sub">Rebased to $10,000 · net of fees</div></div>
        <div class="chart-legend"><span><i style="background:var(--pos)"></i>Auto Trader</span><span><i class="dash"></i>BTC buy & hold</span></div>
      </div>
      <div class="card-body" data-an-chart></div>
      <div class="card-section row between" style="border-top:1px solid var(--line)">
        <div class="row gap-6 wrap">
          <span class="t-xs dim">Expectancy <b class="pos">+$42.18</b> / trade</span>
          <span class="t-xs dim">Avg hold <b>3h 42m</b></span>
          <span class="t-xs dim">Trades <b>148</b> · 12 today</span>
        </div>
        <span class="t-xs dim">Fees excluded from chart</span>
      </div>
    </section>

    <section class="card">
      <div class="card-hd"><div><div class="card-title">Monthly returns</div><div class="card-sub">Last 6 months</div></div>${badge("+4.2% avg", "pos")}</div>
      <div class="card-body">
        <div class="bars">${bars([3.2, 5.4, -1.8, 4.6, 2.8, 4.2], { h: 120 })}</div>
        <div class="bars-x"><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span></div>
        <div class="divider" style="margin:16px 0"></div>
        <div class="row between"><span class="dim t-xs">Best month</span><span class="strong pos">Jul +5.4%</span></div>
        <div class="row between mt-2"><span class="dim t-xs">Worst month</span><span class="strong neg">Aug −1.8%</span></div>
      </div>
    </section>

    <section class="card">
      <div class="card-hd"><div><div class="card-title">Return by weekday × session</div><div class="card-sub">Average % per trade</div></div></div>
      <div class="card-body">
        <div class="heat">
          <div></div><div class="h-label">00h</div><div class="h-label">04h</div><div class="h-label">08h</div><div class="h-label">12h</div><div class="h-label">16h</div><div class="h-label">20h</div>
          ${heat.map(([d, ...vals]) => `<div class="h-label">${d}</div>${vals.map(cell).join("")}`).join("")}
        </div>
        <p class="hint" style="margin-top:12px">Strongest window: 08h–12h UTC. Overnight sessions underperform — the engine already reduces size there.</p>
      </div>
    </section>

    <section class="card">
      <div class="card-hd"><div><div class="card-title">Drawdown</div><div class="card-sub">Underwater curve · 90d</div></div>${badge("−4.22% max", "neg")}</div>
      <div class="card-body">
        <div class="chart"><svg viewBox="0 0 360 110" style="height:110px" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="dd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF6B81" stop-opacity=".28"/><stop offset="1" stop-color="#FF6B81" stop-opacity="0"/></linearGradient></defs>
          <path d="M0,8 C30,14 44,10 62,26 C84,46 96,22 118,38 C140,54 158,30 176,44 C198,62 214,34 236,52 C256,68 274,40 292,58 C312,76 330,50 360,62 L360,110 L0,110 Z" fill="url(#dd)"/>
          <path d="M0,8 C30,14 44,10 62,26 C84,46 96,22 118,38 C140,54 158,30 176,44 C198,62 214,34 236,52 C256,68 274,40 292,58 C312,76 330,50 360,62" fill="none" stroke="#FF6B81" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
        </svg></div>
        <div class="row between mt-3"><span class="dim t-xs">Longest underwater</span><span class="strong">6 days</span></div>
      </div>
    </section>

    <section class="card an-full">
      <div class="card-hd with-border"><div><div class="card-title">Attribution by strategy</div><div class="card-sub">Contribution to net return, 30 days</div></div><a class="card-link" href="#/strategy">Manage strategies ${icon("arrowRight", { size: 13 })}</a></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Strategy</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">P&L</th><th class="num">Contribution</th><th class="num">Avg R</th><th>Share of risk</th></tr></thead>
          <tbody>
            ${[
              ["Momentum Breakout", 62, 64.2, 1842.4, 64.1, 1.8, 52],
              ["Trend Core", 34, 58.8, 1284.1, 44.2, 1.4, 40],
              ["Mean Reversion", 38, 49.1, -142.8, -5.4, 0.2, 25],
              ["Breakdown", 14, 52.4, 96.4, 3.1, 0.8, 20],
            ]
              .map(
                ([n, t, w, p, c, r, sh]) => `<tr>
                <td class="t-main">${n}</td>
                <td class="num">${t}</td>
                <td class="num">${w}%</td>
                <td class="num ${p >= 0 ? "pos" : "neg"}">${fmt.signed(p)}</td>
                <td class="num">${c > 0 ? "+" : ""}${c}%</td>
                <td class="num dim">${r}R</td>
                <td style="width:150px"><div class="row gap-2">${meter(sh, "pos")}<span class="dim t-xs nowrap">${sh}%</span></div></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  </div>`;
  },
  mount(root) {
    mountAreaChart(root.querySelector("[data-an-chart]"), {
      data: equity90,
      bench: benchmark90,
      h: 240,
      valueFmt: (v) => fmt.money(v),
    });
  },
};
