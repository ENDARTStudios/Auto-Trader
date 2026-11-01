/* pages/risk.js */
import { icon } from "../icons.js";
import { pageHead, card, badge, meter, gate, delta } from "../ui.js";
import { fmt, alerts } from "../data.js";

export const risk = {
  title: "Risk & safety",
  crumb: ["Guard", "Risk & safety"],
  html() {
    return `
  ${pageHead({
    status: `${badge("All clear", "pos")} <span class="dim t-xs">no unresolved incidents</span>`,
    title: "Risk & safety",
    sub: "The only page allowed to stop the machine. Limits here are human-owned; the engine can tighten them but never loosen them.",
    actions: `<button class="btn btn-ghost btn-sm">${icon("clipboard", { size: 15 })} Run drill</button>
      <button class="btn btn-danger btn-sm" data-kill>${icon("power", { size: 15 })} Kill switch</button>`,
  })}

  <div class="risk-top">
    <section class="card kill-card">
      <div class="row between">
        <h3>${icon("power", { size: 17, cls: "neg" })} Emergency stop</h3>
        ${badge("armed", "crit")}
      </div>
      <p>Halts the engine instantly and flattens every open position at market. Requires a typed confirmation and is written to the audit chain.</p>
      <div class="row gap-2 wrap">
        <button class="btn btn-danger-solid" data-kill>${icon("power", { size: 15 })} Trigger kill switch</button>
        <button class="btn btn-secondary">${icon("flask", { size: 15 })} Dry run</button>
      </div>
      <div class="divider" style="margin:4px 0"></div>
      <div class="stack gap-2">
        ${[
          ["Stops the loop", "No new entries — immediately."],
          ["Flattens positions", "Market orders, logged with slippage."],
          ["Writes to the chain", "Hash-chained audit entry with operator id."],
        ]
          .map(
            ([t, d]) => `<div class="row gap-3" style="align-items:flex-start">${icon("chevronRight", { size: 14, cls: "dim" })}<div><b style="font-size:12.5px">${t}</b><span class="dim t-xs" style="margin-left:6px">${d}</span></div></div>`
          )
          .join("")}
      </div>
      <div class="dim t-xs" style="margin-top:auto">Last triggered 11 days ago by trader@local · reason “exchange maintenance”.</div>
    </section>

    <section class="card">
      <div class="card-hd"><div><div class="card-title">Risk budget</div><div class="card-sub">Today, rolling 24h</div></div><span class="badge warn">62% used</span></div>
      <div class="card-body">
        ${[
          ["Daily loss", "1.24%", "of 2.0% cap", 62, "warn"],
          ["Exposure", "75.4%", "of 80% cap", 94, "warn"],
          ["Risk per trade", "0.35%", "of 0.50% envelope", 70, "pos"],
          ["Open positions", "4", "of 6 slots", 66, "pos"],
        ]
          .map(
            ([l, v, f, m, tone]) => `<div style="margin-bottom:15px">
          <div class="row between t-xs" style="margin-bottom:5px"><span class="dim">${l}</span><span><b>${v}</b> <span class="dim">${f}</span></span></div>
          ${meter(m, tone)}
        </div>`
          )
          .join("")}
        <div class="banner" style="margin-top:4px">${icon("alert", { size: 15 })}<div class="grow">Exposure is at 94% of its cap. New entries are queued until a slot frees up.</div></div>
      </div>
    </section>
  </div>

  <div class="risk-grid">
    <section class="card">
      <div class="card-hd with-border"><div><div class="card-title">Circuit breakers</div><div class="card-sub">Automatic, enforced before every order</div></div>${badge("3 armed", "pos")}</div>
      <div>
        ${[
          ["Drawdown breaker", "Equity −3.5% in 24h → halve sizing", 40, "−1.2% today", "armed"],
          ["Loss streak", "3 consecutive closed losses → cooldown 30m", 100, "1 in a row", "armed"],
          ["Volatility guard", "ATR > 2.4× median → skip entries", 12, "0.8× median", "armed"],
          ["Venue outage", "2 failed fills → move to read-only", 0, "no failures", "armed"],
          ["Honeypot guard", "Sell simulation fails → hard reject", 0, "1 reject today", "fired"],
        ]
          .map(
            ([n, d, m, cur, state]) => `<div class="breaker">
          <span class="li-ico" style="width:30px;height:30px">${icon(state === "fired" ? "shield" : "shieldCheck", { size: 14, cls: state === "fired" ? "warn" : "pos" })}</span>
          <div class="b-main"><div class="b-top">${n} ${badge(state, state === "fired" ? "warn" : "pos")}</div><div class="b-sub">${d}</div></div>
          <div class="b-meter">${meter(m, state === "fired" ? "warn" : "pos")}</div>
          <div class="b-num">${cur}</div>
        </div>`
          )
          .join("")}
      </div>
    </section>

    <section class="card">
      <div class="card-hd with-border"><div><div class="card-title">Scam surveillance</div><div class="card-sub">Tokens inspected before any entry</div></div>${badge("1,842 scanned", "neutral")}</div>
      <div>
        ${[
          ["PEPE/USDT", "Honeypot · sell simulation failed", "crit", "10:04"],
          ["SAFE/USDT", "Mint authority still active", "warn", "09:12"],
          ["XYZ/USDT", "Liquidity removed 92% in 6h", "crit", "08:40"],
          ["JUP/USDT", "Holder concentration 18.2%", "warn", "yesterday"],
        ]
          .map(
            ([t, d, sev, time]) => `<div class="scam-row">
          <span class="li-ico" style="width:30px;height:30px">${icon("shield", { size: 14, cls: sev === "crit" ? "neg" : "warn" })}</span>
          <div class="sc-main"><div class="sc-top">${t} <span class="badge ${sev === "crit" ? "crit" : "warn"}">${sev === "crit" ? "blocked" : "watch"}</span></div><div class="sc-sub">${d}</div></div>
          <span class="dim t-xs">${time}</span>
        </div>`
          )
          .join("")}
      </div>
      <div class="card-section row between"><span class="dim t-xs">Verified against 4 sources</span><a class="card-link" href="#/data">Source health ${icon("arrowRight", { size: 13 })}</a></div>
    </section>
  </div>

  <section class="card" style="margin-top:16px">
    <div class="card-hd with-border"><div><div class="card-title">Risk events</div><div class="card-sub">Hash-chained · immutable</div></div><button class="btn btn-ghost btn-sm">${icon("download", { size: 14 })} Export</button></div>
    <div class="table-wrap">
      <table class="table compact">
        <thead><tr><th>Time</th><th>Type</th><th>Detail</th><th>Action taken</th><th class="num">Impact</th><th>Status</th></tr></thead>
        <tbody>
          ${[
            ["14:12", "Exposure cap", "New entry would reach 82%", "Entry queued", "0", "resolved"],
            ["11:16", "Manual halt", "Operator trigger during maintenance", "Engine paused 42m", "0", "resolved"],
            ["10:04", "Honeypot", "PEPE sell simulation failed", "Trade rejected", "0", "resolved"],
            ["08:40", "Liquidity", "XYZ liquidity −92%", "Removed from scanner", "0", "resolved"],
            ["Yesterday", "RPC latency", "BSC median 410ms for 4m", "Failover to publicnode", "0", "resolved"],
          ]
            .map(
              ([t, ty, d, a, i, s]) => `<tr><td class="dim">${t}</td><td class="t-main">${ty}</td><td class="muted">${d}</td><td>${a}</td><td class="num">${i}</td><td><span class="badge pos">${s}</span></td></tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  </section>`;
  },
  mount(root) {
    root.querySelectorAll("[data-kill]").forEach((b) =>
      b.addEventListener("click", () => window.__at.openKillSwitch())
    );
  },
};
