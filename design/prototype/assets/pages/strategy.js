/* pages/strategy.js — engine, strategies, guardrails */
import { icon } from "../icons.js";
import { pageHead, card, badge, meter, gate, delta } from "../ui.js";
import { fmt } from "../data.js";

const STRATS = [
  { name: "Momentum Breakout", ver: "v12", state: "live", pnl: 1842.4, pct: 9.4, wr: 64.2, alloc: 52, trades: 62, color: "pos" },
  { name: "Trend Core", ver: "v9", state: "live", pnl: 1284.1, pct: 6.2, wr: 58.8, alloc: 40, trades: 34, color: "pos" },
  { name: "Mean Reversion", ver: "v7", state: "live", pnl: -142.8, pct: -0.9, wr: 49.1, alloc: 25, trades: 38, color: "neg" },
  { name: "Breakdown", ver: "v3", state: "shadow", pnl: 96.4, pct: 0.6, wr: 52.4, alloc: 20, trades: 14, color: "dim" },
  { name: "Degen Guard", ver: "v1", state: "paused", pnl: -84.2, pct: -0.4, wr: 41.7, alloc: 0, trades: 12, color: "neg" },
];

export const strategy = {
  title: "Strategy & engine",
  crumb: ["Operate", "Strategy"],
  html() {
    return `
  ${pageHead({
    title: "Strategy & engine",
    sub: "Five strategies, one engine. Allocation and promotion are decided by the evolution loop, inside the guardrails below.",
    actions: `<button class="btn btn-ghost btn-sm" data-action="export">${icon("download", { size: 15 })} Export config</button>
      <button class="btn btn-secondary btn-sm">${icon("history", { size: 15 })} Versions</button>
      <button class="btn btn-primary btn-sm">${icon("edit", { size: 15 })} Edit config</button>`,
  })}

  <div class="strat-grid">
    <div class="stack gap-4">
      <section class="card">
        <div class="card-body" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
          <div class="row gap-4" style="flex:1;min-width:260px">
            <div class="ring" style="--p:.3;width:56px;height:56px"><b>72%</b></div>
            <div>
              <div class="row gap-2"><span class="t-h3" style="font-size:16px">Engine running</span>${badge("paper", "warn")}</div>
              <div class="dim t-xs" style="margin-top:3px">Round 4,128 · 18 pairs · next scan in 41s</div>
            </div>
          </div>
          <div class="row gap-5 hide-sm">
            <div><div class="t-caption">Rounds today</div><div class="strong">1,284</div></div>
            <div><div class="t-caption">Trades today</div><div class="strong">12</div></div>
            <div><div class="t-caption">Uptime 7d</div><div class="strong">99.97%</div></div>
          </div>
          <div class="row gap-2">
            <button class="btn btn-secondary btn-sm" data-pause>${icon("pause", { size: 15 })} Pause</button>
            <button class="btn btn-danger btn-sm" data-kill>${icon("power", { size: 15 })} Kill switch</button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border">
          <div><div class="card-title">Strategies ${badge("5", "neutral")}</div><div class="card-sub">Allocation is a share of the risk budget, not of equity</div></div>
          <a class="card-link" href="#/backtest">Validate a version ${icon("arrowRight", { size: 13 })}</a>
        </div>
        <div>
          ${STRATS.map(
            (s) => `<div class="strategy-row">
            <span class="li-ico" style="width:34px;height:34px">${icon("zap", { size: 15, cls: s.state === "live" ? "pos" : "" })}</span>
            <div class="st-main">
              <div class="st-top">${s.name} <span class="badge neutral">${s.ver}</span>
                ${s.state === "live" ? badge("live", "pos") : s.state === "shadow" ? badge("shadow", "brand") : badge("paused", "neutral")}
              </div>
              <div class="st-sub"><span>${s.trades} trades 30d</span><span>win ${s.wr}%</span><span>alloc ${s.alloc}%</span></div>
            </div>
            <div class="st-kpi"><b class="${s.pnl >= 0 ? "pos" : "neg"}">${fmt.signed(s.pnl)}</b><span>${fmt.pct(s.pct)} 30d</span></div>
            <div class="row gap-2">
              <label class="switch" style="display:inline-block"><input type="checkbox" ${s.state === "live" ? "checked" : ""} aria-label="Toggle ${s.name}" /></label>
              <button class="icon-btn" data-tip="Version details">${icon("more", { size: 15 })}</button>
            </div>
          </div>`
          ).join("")}
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div><div class="card-title">Runtime settings</div><div class="card-sub">Changes apply on the next round and are audited</div></div></div>
        <div class="card-body">
          <div class="config-grid">
            <div class="field"><label>Mode</label><div class="segmented"><button aria-pressed="true">Paper</button><button>Live</button></div><span class="hint">Live requires 50 positive cycles and MFA re-auth.</span></div>
            <div class="field"><label>Schedule</label><div class="segmented"><button aria-pressed="true">24/7</button><button>Custom</button></div><span class="hint">Custom windows are evaluated in UTC.</span></div>
            <div class="field"><label>Loop interval</label><input class="input" value="60 seconds" /><span class="hint">Minimum 30s · default 60s.</span></div>
            <div class="field"><label>Max positions</label><input class="input" value="6" /><span class="hint">Currently open: 4.</span></div>
          </div>
        </div>
      </section>
    </div>

    <aside class="stack gap-4">
      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Guardrails</div><span class="badge warn">human-owned</span></div>
        <div class="card-body">
          ${[
            ["Risk per trade", "0.35%", 70, "pos", "of 0.5% envelope"],
            ["Daily loss", "1.2%", 60, "warn", "of 2.0% hard cap"],
            ["Exposure", "75.4%", 94, "warn", "of 80% cap"],
            ["Open positions", "4", 66, "pos", "of 6 slots"],
          ]
            .map(
              ([l, v, m, tone, f]) => `<div style="margin-bottom:14px">
            <div class="row between t-xs" style="margin-bottom:5px"><span class="dim">${l}</span><span><b>${v}</b> <span class="dim">${f}</span></span></div>
            ${meter(m, tone)}
          </div>`
            )
            .join("")}
          <div class="cfg-note">${icon("lock", { size: 13 })}<span>These four values form the human envelope. The evolution loop cannot change them — only you can, with a 30-day review SLA.</span></div>
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Graduation to live</div><span class="badge neutral">12 / 50</span></div>
        <div class="card-body">
          ${meter(24, "pos")}
          <p class="t-xs dim" style="margin-top:10px;line-height:1.5">Positive cycles with zero risk incidents. At 50 the live switch unlocks; it still requires your explicit confirmation.</p>
          <dl class="dl tight" style="margin-top:14px">
            <dt>Positive cycles</dt><dd>12</dd>
            <dt>Risk incidents</dt><dd class="pos">0</dd>
            <dt>Est. unlock</dt><dd>~38 days</dd>
          </dl>
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Last promotion</div></div>
        <div class="card-body">
          <div class="row gap-3">
            <span class="li-ico" style="width:30px;height:30px">${icon("sparkles", { size: 14, cls: "brand" })}</span>
            <div><div class="strong t-sm">Momentum Breakout v12</div><div class="dim t-xs">forward 21d · Sharpe 1.9</div></div>
          </div>
          <div class="quote" style="margin-top:12px">v12 keeps the v11 entry rules and adds a volume confirmation gate. Drawdown improved from −6.1% to −4.2%.</div>
        </div>
      </section>
    </aside>
  </div>`;
  },
  mount(root) {
    root.querySelector("[data-pause]")?.addEventListener("click", () =>
      window.__at.toast({ title: "Engine paused", desc: "Exits stay managed; entries are off.", tone: "warn", iconName: "pause" })
    );
    root.querySelector("[data-kill]")?.addEventListener("click", () => window.__at.openKillSwitch());
    root.querySelectorAll(".switch input").forEach((s) =>
      s.addEventListener("change", () =>
        window.__at.toast({ title: s.checked ? "Strategy enabled" : "Strategy paused", desc: "Applied on the next round.", iconName: s.checked ? "checkCircle" : "pause" })
      )
    );
  },
};
