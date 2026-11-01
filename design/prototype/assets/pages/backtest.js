/* pages/backtest.js */
import { icon } from "../icons.js";
import { pageHead, card, badge, delta, assetIco } from "../ui.js";
import { fmt, equity90, trades } from "../data.js";
import { mountAreaChart, bars } from "../charts.js";

export const backtest = {
  title: "Backtest",
  crumb: ["Operate", "Backtest"],
  html() {
    return `
  ${pageHead({
    title: "Backtest",
    sub: "Replay any strategy on historical candles with the same risk gates used live. Results are stored and comparable.",
    actions: `<button class="btn btn-ghost btn-sm">${icon("history", { size: 15 })} Run history</button>
      <button class="btn btn-secondary btn-sm">${icon("copy", { size: 15 })} Compare</button>
      <button class="btn btn-primary btn-sm" data-run>${icon("play", { size: 15 })} Run backtest</button>`,
  })}

  <div class="bt-layout">
    <section class="card">
      <div class="card-hd with-border"><div><div class="card-title">Configuration</div><div class="card-sub">Draft · not saved</div></div></div>
      <div class="card-body">
        <div class="field"><label>Strategy</label>
          <select class="select"><option>Momentum Breakout v12</option><option>Trend Core v9</option><option>Mean Reversion v7</option><option>Breakdown v3</option></select>
        </div>
        <div class="field mt-3"><label>Universe</label>
          <select class="select"><option>Top 18 by liquidity (default)</option><option>Watchlist (5)</option><option>Custom…</option></select>
        </div>
        <div class="row gap-2 mt-3">
          <div class="field grow"><label>From</label><input class="input" value="01 Jun 2026" /></div>
          <div class="field grow"><label>To</label><input class="input" value="01 Nov 2026" /></div>
        </div>
        <div class="row gap-2 mt-3">
          <div class="field grow"><label>Initial capital</label><input class="input" value="$10,000" /></div>
          <div class="field grow"><label>Slippage</label><input class="input" value="0.05%" /></div>
        </div>
        <div class="row gap-2 mt-3">
          <div class="field grow"><label>Fee</label><input class="input" value="0.025%" /></div>
          <div class="field grow"><label>Leverage</label><input class="input" value="1×" /></div>
        </div>
        <div class="divider" style="margin:18px 0"></div>
        <div class="stack gap-3">
          <label class="set-row" style="padding:4px 0;border:0"><span class="sr-main"><span class="sr-title">Apply live risk gates</span><span class="sr-desc">Liquidity, authority and sell simulation</span></span><input type="checkbox" class="switch" checked /></label>
          <label class="set-row" style="padding:4px 0;border:0"><span class="sr-main"><span class="sr-title">Walk-forward split</span><span class="sr-desc">70% train · 30% out-of-sample</span></span><input type="checkbox" class="switch" checked /></label>
          <label class="set-row" style="padding:4px 0;border:0"><span class="sr-main"><span class="sr-title">Include fees</span><span class="sr-desc">Maker/taker as configured</span></span><input type="checkbox" class="switch" checked /></label>
        </div>
        <button class="btn btn-primary btn-block mt-4" data-run>${icon("play", { size: 15 })} Run backtest</button>
        <p class="hint" style="margin-top:10px">Runs in ~40s. You can leave this page — we will notify you.</p>
      </div>
    </section>

    <div class="stack gap-4">
      <section class="card">
        <div class="card-hd"><div><div class="card-title">Result · Momentum v12</div><div class="card-sub">01 Jun → 01 Nov 2026 · 153 days · out-of-sample included</div></div>
          <div class="row gap-2">${badge("validated", "pos")}${badge("4 gates", "neutral")}</div></div>
        <div class="card-body">
          <div class="bt-stats">
            ${[
              ["Net return", "+18.42%", "pos"],
              ["Max drawdown", "−6.14%", "neg"],
              ["Sharpe", "1.92", ""],
              ["Sortino", "2.54", ""],
              ["Win rate", "63.4%", ""],
              ["Profit factor", "1.88", ""],
              ["Trades", "214", ""],
              ["Avg hold", "4h 12m", ""],
            ]
              .map(([l, v, tone]) => `<div class="bt-stat"><div class="s-l">${l}</div><div class="s-v ${tone}">${v}</div></div>`)
              .join("")}
          </div>
          <div class="ov-chart mt-4" data-bt-chart></div>
          <div class="row between mt-3">
            <div class="chart-legend"><span><i style="background:var(--pos)"></i>Strategy</span><span><i class="dash"></i>Buy & hold BTC</span></div>
            <span class="dim t-xs">Equity, net of fees</span>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Monthly returns</div><span class="dim t-xs">5 months</span></div>
        <div class="card-body">
          <div class="bars">${bars([4.2, 6.8, -2.1, 5.4, 3.1], { h: 96 })}</div>
          <div class="bars-x"><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span></div>
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Sample trades</div><a class="card-link" href="#/journal">Open journal ${icon("arrowRight", { size: 13 })}</a></div>
        <div class="table-wrap">
          <table class="table compact">
            <thead><tr><th>Time</th><th>Asset</th><th>Side</th><th class="num">Entry</th><th class="num">Exit</th><th class="num">P&L</th><th class="num">R</th></tr></thead>
            <tbody>
              ${trades.slice(0, 5).map((t, i) => `<tr>
                <td class="dim">${t.ts.split(" · ")[0]}</td>
                <td>${assetIco(t.sym, "#3A4250")}<span style="margin-left:6px">${t.sym}</span></td>
                <td><span class="badge ${t.side === "BUY" ? "pos" : "neg"}">${t.side}</span></td>
                <td class="num">$${fmt.px(t.px)}</td>
                <td class="num">$${fmt.px(t.px * 1.014)}</td>
                <td class="num ${i % 3 === 2 ? "neg" : "pos"}">${fmt.signed(i % 3 === 2 ? -42.1 : 96.4 + i * 11)}</td>
                <td class="num dim">${(1.2 + i * 0.3).toFixed(1)}R</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>`;
  },
  mount(root) {
    mountAreaChart(root.querySelector("[data-bt-chart]"), {
      data: equity90,
      bench: equity90.map((v, i) => 10000 * Math.pow(1.0012, i)),
      h: 220,
      valueFmt: (v) => fmt.money(v),
    });
    root.querySelectorAll("[data-run]").forEach((b) =>
      b.addEventListener("click", () => {
        b.innerHTML = `${icon("refresh", { size: 15, cls: "spin" })} Running…`;
        b.setAttribute("aria-disabled", "true");
        setTimeout(() => {
          b.innerHTML = `${icon("check", { size: 15 })} Run complete`;
          window.__at.toast({ title: "Backtest finished", desc: "+18.42% net · 214 trades · max DD −6.14%.", iconName: "checkCircle" });
        }, 1600);
      })
    );
  },
};
