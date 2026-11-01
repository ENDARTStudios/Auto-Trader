/* pages/copilot.js */
import { icon } from "../icons.js";
import { pageHead, card, badge, gate, assetIco } from "../ui.js";
import { threads } from "../data.js";

export const copilot = {
  title: "AI Copilot",
  crumb: ["Guard", "AI Copilot"],
  html() {
    return `
  ${pageHead({
    status: `<span class="badge brand">grounded</span> <span class="dim t-xs">answers cite the evidence they used</span>`,
    title: "AI Copilot",
    sub: "Ask about decisions, risk or performance. The Copilot reads the same ledger the engine uses and never invents numbers.",
    actions: `<button class="btn btn-ghost btn-sm">${icon("history", { size: 15 })} History</button>
      <button class="btn btn-primary btn-sm">${icon("plus", { size: 15 })} New thread</button>`,
  })}

  <div class="cp-layout">
    <aside class="card cp-threads">
      <div class="card-hd with-border" style="padding-bottom:10px"><div class="card-title">Threads</div><button class="icon-btn" data-tip="New">${icon("plus", { size: 15 })}</button></div>
      <div class="input-wrap" style="margin:12px 14px">${icon("search", { size: 15 })}<input class="input" style="height:32px" placeholder="Search threads" /></div>
      ${threads
        .map(
          (t) => `<div class="th ${t.active ? "active" : ""}"><div class="th-main"><b>${t.title}</b><span>${t.time}</span></div></div>`
        )
        .join("")}
    </aside>

    <section class="card chat">
      <div class="card-hd with-border">
        <div><div class="card-title">Why did SOL get promoted?</div><div class="card-sub">Grounded on 6 sources · updated 2m ago</div></div>
        <div class="row gap-2">${badge("paper dataset", "warn")}<button class="icon-btn" data-tip="Copy thread">${icon("copy", { size: 15 })}</button></div>
      </div>
      <div class="chat-scroll">
        <div class="msg user">
          <div class="av">AD</div>
          <div class="bubble">SOL was promoted to the live queue this morning. What exactly changed, and what would make you reverse it?</div>
        </div>
        <div class="msg ai">
          <div class="av">AI</div>
          <div class="bubble">
            <b>Short answer:</b> v12 of Momentum Breakout cleared its 21-day forward window with a 1.92 Sharpe and a max drawdown of −4.2%, beating v11 on both. Allocation moved from 40% to 52% of the risk budget.
            <div style="margin-top:10px"><b>What changed</b></div>
            <div class="stack gap-2" style="margin-top:6px">
              <div class="row gap-2"><span class="dot pos"></span><span>Forward Sharpe 1.92 (v11: 1.41)</span></div>
              <div class="row gap-2"><span class="dot pos"></span><span>Max drawdown −4.2% (v11: −6.1%)</span></div>
              <div class="row gap-2"><span class="dot pos"></span><span>Zero honeypot exposures in the window</span></div>
            </div>
            <div style="margin-top:12px"><b>What would reverse it</b></div>
            <div style="margin-top:6px">Two consecutive weeks under a 1.0 rolling Sharpe, or any unresolved risk incident. The evolution loop demotes automatically; you do not have to act.</div>
            <div class="cites">
              <span class="cite">forward_collection · 21d</span>
              <span class="cite">model_registry.json</span>
              <span class="cite">risk_config.json</span>
            </div>
          </div>
        </div>
        <div class="msg ai">
          <div class="av">AI</div>
          <div class="bubble">Want me to draft a one-paragraph note for the weekly report?</div>
        </div>
      </div>
      <div class="chat-compose">
        <textarea placeholder="Ask about a decision, a position or a metric…" aria-label="Message"></textarea>
        <button class="btn btn-primary" data-send>${icon("send", { size: 15 })} Send</button>
      </div>
      <div class="card-section" style="display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--line)">
        <button class="chip">Explain the liquidity gate</button>
        <button class="chip">Is my drawdown within limits?</button>
        <button class="chip">Draft a weekly summary</button>
        <button class="chip">Compare v11 and v12</button>
      </div>
    </section>

    <aside class="stack gap-4">
      <section class="card evidence">
        <div class="card-hd with-border"><div class="card-title">Evidence used</div><span class="badge neutral">6</span></div>
        <div class="ev"><div class="ev-top">${icon("flask", { size: 14 })} Forward collection</div><p>21 days · 214 trades · Sharpe 1.92 · max DD −4.2%</p></div>
        <div class="ev"><div class="ev-top">${icon("file", { size: 14 })} model_registry.json</div><p>param_v12 promoted 14:02 UTC · signed by evolution core</p></div>
        <div class="ev"><div class="ev-top">${icon("shield", { size: 14 })} Risk envelope</div><p>risk_config.json unchanged since 12 Oct · 0.35% per trade</p></div>
        <div class="ev"><div class="ev-top">${icon("book", { size: 14 })} Ledger</div><p>episodes.jsonl · 148 closed trades in window</p></div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Decision at a glance</div></div>
        <div class="card-body">
          <div class="row gap-3" style="margin-bottom:12px">${assetIco("SOL", "#14F195")}<div><div class="strong">SOL/USDT</div><div class="dim t-xs">Momentum Breakout · v12</div></div></div>
          <div class="gates">
            ${gate("Liquidity depth", "$28.4M", "ok")}
            ${gate("Sell simulation", "passed", "ok")}
            ${gate("Exposure", "within cap", "ok")}
            ${gate("Regime", "trend up", "ok")}
          </div>
          <button class="btn btn-secondary btn-sm btn-block" style="margin-top:12px" data-nav="#/position/SOL">Open position ${icon("arrowRight", { size: 14 })}</button>
        </div>
      </section>

      <div class="banner info">${icon("info", { size: 15 })}<div class="grow">Copilot is advisory. It cannot place, close or resize orders.</div></div>
    </aside>
  </div>`;
  },
  mount(root) {
    const ta = root.querySelector("textarea");
    const send = () => {
      if (!ta.value.trim()) return;
      const bubble = document.createElement("div");
      bubble.className = "msg user";
      bubble.innerHTML = `<div class="av">AD</div><div class="bubble">${ta.value.replace(/</g, "&lt;")}</div>`;
      root.querySelector(".chat-scroll").appendChild(bubble);
      ta.value = "";
      setTimeout(() => {
        const ai = document.createElement("div");
        ai.className = "msg ai";
        ai.innerHTML = `<div class="av">AI</div><div class="bubble">I can only answer from the ledger in this concept. In the product, this reply would cite the exact episodes and gates it used.<div class="cites"><span class="cite">episodes.jsonl</span><span class="cite">risk_config.json</span></div></div>`;
        root.querySelector(".chat-scroll").appendChild(ai);
        ai.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 700);
    };
    root.querySelector("[data-send]")?.addEventListener("click", send);
    ta?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    root.querySelectorAll(".chip").forEach((c) =>
      c.addEventListener("click", () => {
        ta.value = c.textContent;
        ta.focus();
      })
    );
  },
};
