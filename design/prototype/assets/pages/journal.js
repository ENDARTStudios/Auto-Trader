/* pages/journal.js — trade & decision log */
import { icon } from "../icons.js";
import { pageHead, card, badge, assetIco, empty } from "../ui.js";
import { fmt, trades, rounds } from "../data.js";

const statusTone = (s) => (s === "open" ? "brand" : s === "closed" ? "neutral" : "neg");

export const journal = {
  title: "Journal",
  crumb: ["Operate", "Journal"],
  html() {
    return `
  ${pageHead({
    title: "Journal",
    sub: "Every fill, rejection and round is recorded with its reason. Exportable for tax and post-mortems.",
    actions: `<button class="btn btn-ghost btn-sm">${icon("filter", { size: 15 })} Filters</button>
      <button class="btn btn-secondary btn-sm" data-action="export">${icon("download", { size: 15 })} Export CSV</button>
      <button class="btn btn-primary btn-sm" data-nav="#/copilot">${icon("sparkles", { size: 15 })} Summarize month</button>`,
  })}

  <div class="jr-layout">
    <section class="card">
      <div class="card-hd with-border">
        <div class="row gap-3 wrap">
          <div class="card-title">Trades</div>
          <div class="segmented"><button aria-pressed="true">All</button><button>Open</button><button>Closed</button><button>Rejected</button></div>
        </div>
        <div class="row gap-2">
          <div class="input-wrap" style="width:190px">${icon("search", { size: 15 })}<input class="input" style="height:32px" placeholder="Pair or strategy" /></div>
        </div>
      </div>
      <div class="table-wrap" style="max-height:620px">
        <table class="table">
          <thead><tr><th>Time</th><th>Asset</th><th>Side</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Notional</th><th class="num">Fee</th><th class="num">P&L</th><th>Status</th><th>Round</th></tr></thead>
          <tbody>
            ${["Today", "Yesterday", "31 Oct"].map((day) => {
              const list = trades.filter((t) => t.ts.startsWith(day));
              return `${list.length ? `<tr><td colspan="10" style="padding:0"><div class="jr-day"><b>${day}</b><span>·</span><span>${list.length} events</span><span class="grow"></span><span class="dim">${fmt.signed(list.reduce((s, t) => s + (t.pnl || 0), 0))} realized</span></div></td></tr>` : ""}
              ${list
                .map(
                  (t) => `<tr class="row-click" data-trade="${t.sym}">
                <td class="dim" style="font-size:11.5px">${t.ts.replace("Today · ", "").replace("Yesterday · ", "")}</td>
                <td><div class="asset">${assetIco(t.sym, t.sym === "BTC" ? "#F7931A" : t.sym === "ETH" ? "#627EEA" : t.sym === "SOL" ? "#14F195" : "#3A4250")}<span class="t-main">${t.sym}</span></div></td>
                <td><span class="badge ${t.side === "BUY" ? "pos" : "neg"}">${t.side}</span></td>
                <td class="num">${t.qty}</td>
                <td class="num">$${fmt.px(t.px)}</td>
                <td class="num">${fmt.usd(t.notional)}</td>
                <td class="num dim">${fmt.usd(t.fee)}</td>
                <td class="num ${t.pnl == null ? "dim" : t.pnl >= 0 ? "pos" : "neg"}">${t.pnl == null ? "—" : fmt.signed(t.pnl)}</td>
                <td><span class="badge ${statusTone(t.status)}">${t.status}</span></td>
                <td class="dim t-xs">${t.round}</td>
              </tr>`
                )
                .join("")}`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="table-foot"><span>148 trades · 7 shown</span><span class="row gap-2"><span class="dot"></span>Synced 4s ago</span></div>
    </section>

    <aside class="stack gap-4">
      <section class="card">
        <div class="card-hd with-border"><div class="card-title">This month</div></div>
        <div class="card-body">
          <div class="kpi"><div class="kpi-label">Realized P&L</div><div class="kpi-value pos">+$2,489.79</div><div class="kpi-foot">142 trades · 61.8% win</div></div>
          <div class="divider" style="margin:14px 0"></div>
          <dl class="dl tight">
            <dt>Fees paid</dt><dd class="dim">−$142.18</dd>
            <dt>Funding</dt><dd class="dim">+$38.42</dd>
            <dt>Best trade</dt><dd class="pos">+$412.60 · TIA</dd>
            <dt>Worst trade</dt><dd class="neg">−$84.20 · PEPE</dd>
          </dl>
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Rounds</div><span class="badge neutral">last 5</span></div>
        <div>
          ${rounds
            .map(
              (r) => `<div class="pos-mini" style="cursor:pointer">
            <span class="li-ico" style="width:26px;height:26px">${icon(r.state === "live" ? "activity" : r.state === "veto" ? "shield" : "check", { size: 13, cls: r.state === "veto" ? "warn" : r.state === "live" ? "pos" : "" })}</span>
            <div class="pm-main"><div class="pm-top">${r.id}</div><div class="pm-sub">${r.started} · ${r.dur} · ${r.traded} traded</div></div>
            <div class="pm-side"><b class="${r.pnl.includes("-") ? "neg" : r.pnl.includes("rej") ? "warn" : "pos"}">${r.pnl}</b></div>
          </div>`
            )
            .join("")}
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Data integrity</div></div>
        <div class="card-body">
          <div class="row gap-2"><span class="dot pos"></span><span class="t-sm">Hash-chained audit log</span></div>
          <p class="dim t-xs" style="margin-top:6px;line-height:1.5">Each event carries the previous hash. Any tampering breaks the chain and is flagged in Risk & safety.</p>
          <button class="btn btn-secondary btn-sm btn-block" style="margin-top:12px">${icon("shieldCheck", { size: 14 })} Verify chain</button>
        </div>
      </section>
    </aside>
  </div>`;
  },
  mount(root) {
    root.querySelectorAll("[data-trade]").forEach((tr) =>
      tr.addEventListener("click", () =>
        window.__at.openDrawer({
          title: `${tr.dataset.trade} · trade detail`,
          subtitle: "Paper fill · hash-chained record",
          iconName: "book",
          body: `<dl class="dl">
            <dt>Order id</dt><dd class="t-mono">ord_8f21c4</dd>
            <dt>Fill</dt><dd>$207.82</dd>
            <dt>Notional</dt><dd>$8,562.20</dd>
            <dt>Fee</dt><dd>$2.14</dd>
            <dt>Slippage</dt><dd class="pos">+0.01%</dd>
            <dt>Venue</dt><dd>Binance</dd>
          </dl>
          <div class="divider" style="margin:18px 0"></div>
          <div class="t-caption">Why this trade</div>
          <div class="quote" style="margin-top:8px">Momentum score 0.82 crossed the 0.75 threshold while liquidity depth stayed above $20M. All four risk gates passed.</div>`,
          footer: `<button class="btn btn-secondary" data-x>Copy id</button><button class="btn btn-primary" data-x>Open position</button>`,
        })
      )
    );
  },
};
