/* pages/design.js — living style guide */
import { icon } from "../icons.js";
import { pageHead, card, badge, empty } from "../ui.js";

const SW = [
  ["Canvas", "--bg", "#0A0B0D"],
  ["Surface 1", "--surface-1", "#101216"],
  ["Surface 2", "--surface-2", "#16191F"],
  ["Surface 3", "--surface-3", "#1D2129"],
  ["Line", "--line", "#23272F"],
  ["Text", "--text", "#F2F4F7"],
  ["Text 2", "--text-2", "#A7AFBC"],
  ["Text 3", "--text-3", "#6D7582"],
  ["Brand", "--brand", "#5B6CFF"],
  ["Positive", "--pos", "#3DDC97"],
  ["Negative", "--neg", "#FF6B81"],
  ["Warning", "--warn", "#F5B454"],
];

export const design = {
  title: "Design system",
  crumb: ["System", "Design system"],
  html() {
    return `
  ${pageHead({
    eyebrow: '<span class="badge brand">Meridian 1.0</span> <span class="dim t-xs">living documentation</span>',
    title: "Design system",
    sub: "Tokens, components and rules used across every screen. The same source of truth is exported to FigCraft and to the Next.js theme.",
    actions: `<button class="btn btn-secondary btn-sm">${icon("copy", { size: 15 })} Copy tokens</button>
      <button class="btn btn-primary btn-sm" data-theme-toggle>${icon("sun", { size: 15 })} Toggle theme</button>`,
  })}

  <div class="grid g-12">
    <section class="card col-8">
      <div class="card-hd with-border"><div><div class="card-title">Color</div><div class="card-sub">Semantic first: brand never means profit, green never means brand</div></div></div>
      <div class="card-body">
        <div class="ds-swatches">
          ${SW.map(
            ([n, v, hex]) => `<div class="sw"><div class="chip-color" style="background:var(${v})"></div>
            <div class="sw-meta"><b>${n}</b>${hex}<br>${v}</div></div>`
          ).join("")}
        </div>
        <div class="divider" style="margin:18px 0"></div>
        <div class="ds-row">
          ${badge("profit", "pos")}${badge("loss", "neg")}${badge("warning", "warn")}${badge("critical", "crit")}
          ${badge("brand", "brand")}${badge("neutral", "neutral")}
          <span class="delta pos">${icon("arrowUpRight", { size: 12 })}+4.21%</span>
          <span class="delta neg">${icon("arrowDownRight", { size: 12 })}−1.42%</span>
        </div>
      </div>
    </section>

    <section class="card col-4">
      <div class="card-hd with-border"><div class="card-title">Type</div></div>
      <div class="card-body">
        ${[
          ["Display / serif", "56 · 60", "The quiet advantage"],
          ["H1", "32 · 40", "Mission control"],
          ["H2", "24 · 32", "Portfolio"],
          ["H3", "18 · 26", "Open positions"],
          ["Body", "14 · 22", "Autonomous engine scanning 18 pairs."],
          ["Label", "12 · 16", "Risk per trade"],
          ["Caption", "11 · 14", "UNREALIZED P&L"],
        ]
          .map(
            ([n, m, s]) => `<div class="type-spec">
          <div style="${n.startsWith("Display") ? "font-family:var(--font-serif);font-size:22px" : n === "H1" ? "font-size:24px;font-weight:600" : n === "H2" ? "font-size:19px;font-weight:600" : n === "H3" ? "font-size:16px;font-weight:600" : n === "Caption" ? "font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)" : "font-size:13px"}">${s}</div>
          <div class="ts-meta">${n}<br>${m}</div>
        </div>`
          )
          .join("")}
      </div>
    </section>

    <section class="card col-6">
      <div class="card-hd with-border"><div class="card-title">Spacing & radius</div><span class="dim t-xs">4px base</span></div>
      <div class="card-body">
        ${[4, 8, 12, 16, 24, 32, 48]
          .map(
            (s) => `<div class="row gap-3" style="margin-bottom:8px"><span class="dim t-xs" style="width:34px">${s}</span><div class="space-bar" style="width:${s * 3}px"></div><span class="dim t-xs">space.${s}</span></div>`
          )
          .join("")}
        <div class="divider" style="margin:16px 0"></div>
        <div class="ds-row">
          ${[6, 8, 12, 16, 20].map((r) => `<div style="width:76px;height:52px;border-radius:${r}px;border:1px solid var(--line-strong);background:var(--surface-2);display:grid;place-items:center;font-size:11px;color:var(--text-3)">r ${r}</div>`).join("")}
        </div>
      </div>
    </section>

    <section class="card col-6">
      <div class="card-hd with-border"><div class="card-title">Controls</div><span class="dim t-xs">32 / 36 / 44</span></div>
      <div class="card-body stack gap-4">
        <div class="ds-row">
          <button class="btn btn-primary">${icon("plus", { size: 16 })} Primary</button>
          <button class="btn btn-secondary">Secondary</button>
          <button class="btn btn-ghost">Ghost</button>
          <button class="btn btn-danger">Danger</button>
          <button class="btn btn-primary" disabled>Disabled</button>
        </div>
        <div class="ds-row">
          <input class="input" style="width:180px" placeholder="Input" />
          <select class="select" style="width:150px"><option>Select</option></select>
          <label class="row gap-2"><input type="checkbox" class="switch" checked /> <span class="t-sm muted">Switch</span></label>
          <div class="segmented"><button aria-pressed="true">A</button><button>B</button></div>
        </div>
        <div class="ds-row">${["chip", "chip"].map((c, i) => `<button class="chip" aria-pressed="${i === 0}">${icon("filter", { size: 13 })} Filter</button>`).join("")}
          <span class="kbd">⌘K</span><span class="badge pos">ok</span><span class="badge warn">watch</span>
        </div>
      </div>
    </section>

    <section class="card col-12">
      <div class="card-hd with-border"><div><div class="card-title">Data display</div><div class="card-sub">Tables are 44px rows, tabular numerals, right-aligned numbers</div></div></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Asset</th><th>State</th><th class="num">Price</th><th class="num">24h</th><th class="num">Weight</th><th>Strategy</th></tr></thead>
          <tbody>
            ${[
              ["SOL", "open", "$208.44", "+6.12%", "34.1%", "Momentum Breakout"],
              ["BTC", "open", "$96,420.18", "+2.41%", "24.9%", "Trend Core"],
              ["PEPE", "rejected", "$0.0000112", "+24.6%", "0%", "Degen Guard"],
            ]
              .map(
                ([s, st, p, c, w, strat]) => `<tr>
              <td class="t-main">${s}/USDT</td>
              <td><span class="badge ${st === "open" ? "brand" : "neg"}">${st}</span></td>
              <td class="num">${p}</td>
              <td class="num ${c.startsWith("+") ? "pos" : "neg"}">${c}</td>
              <td class="num">${w}</td>
              <td class="dim">${strat}</td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card col-6">
      <div class="card-hd with-border"><div class="card-title">Empty state</div><span class="dim t-xs">one action, one escape</span></div>
      <div class="card-body" style="padding:0">
        ${empty({ title: "No positions yet", desc: "The engine opens its first paper position after a candidate passes every gate.", actions: `<button class="btn btn-primary btn-sm">Start engine</button><button class="btn btn-ghost btn-sm">Learn how</button>`, cls: "sm" })}
      </div>
    </section>

    <section class="card col-6">
      <div class="card-hd with-border"><div class="card-title">Rules</div></div>
      <div class="card-body stack gap-3">
        ${[
          ["One primary action per screen", "Everything else is secondary or ghost."],
          ["No color without meaning", "Brand ≠ profit. Green and red are reserved for P&L and risk."],
          ["Numbers are right-aligned and tabular", "Decimals line up across rows."],
          ["Dense, not cramped", "13–14px body; 44px rows; 8px rhythm."],
          ["Explain before asking", "Destructive actions show consequences and need typed consent."],
        ]
          .map(
            ([t, d]) => `<div class="row gap-3" style="align-items:flex-start">${icon("checkCircle", { size: 16, cls: "pos" })}<div><b style="font-size:13px">${t}</b><div class="dim t-xs" style="margin-top:2px;line-height:1.5">${d}</div></div></div>`
          )
          .join("")}
      </div>
    </section>
  </div>`;
  },
};
