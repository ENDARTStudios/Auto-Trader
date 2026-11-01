/* pages/public.js — landing, auth, onboarding */
import { icon } from "../icons.js";
import { badge, assetIco } from "../ui.js";
import { spark } from "../charts.js";
import { series } from "../data.js";

const logo = (size = 28) => `<span class="rail-logo" style="width:${size}px;height:${size}px;border-radius:${size / 3.6}px">${icon("activity", { size: size * 0.62, stroke: 2.2 })}</span>`;

/* ---------------- Landing ---------------- */
export const landing = {
  title: "Autonomous crypto trading, with a risk officer built in",
  html() {
    return `<div class="pub">
    <nav class="pub-nav">
      <a href="#/landing" class="row gap-2">${logo()}<span class="rail-word" style="font-size:15px">Auto Trader<small>Meridian</small></span></a>
      <div class="links">
        <a href="#/landing" data-scroll="how">How it works</a><a href="#/landing" data-scroll="safety">Safety</a><a href="#/landing" data-scroll="pricing">Pricing</a><a href="#/landing" data-scroll="how">Docs</a>
      </div>
      <div class="right">
        <a class="btn btn-ghost btn-sm" href="#/login">Sign in</a>
        <a class="btn btn-primary btn-sm" href="#/signup">Start free</a>
      </div>
    </nav>

    <header class="pub-hero">
      <div class="glow"></div>
      <div class="inner">
        <span class="pub-badge"><span class="tag">New</span> Multichain scanner · 18 pairs, 4 venues <span class="dim">${icon("arrowRight", { size: 13 })}</span></span>
        <h1>Autonomous crypto trading, with a <em>risk officer</em> built in.</h1>
        <p class="lede">Auto Trader runs a disciplined strategy loop on live prices, checks every token for scams before it buys, and explains each decision in plain language. Paper first — always.</p>
        <div class="pub-cta">
          <a class="btn btn-primary btn-lg" href="#/signup">Start in paper mode ${icon("arrowRight", { size: 16 })}</a>
          <a class="btn btn-secondary btn-lg" href="#/login">${icon("play", { size: 16 })} See the live demo</a>
        </div>
        <div class="pub-note">No card required · paper capital included · live trading unlocks after 50 positive cycles</div>

        <div class="pub-shot">
          <div class="chrome"><i></i><i></i><i></i><span class="url">app.autotrader.io/overview</span></div>
          <div style="display:grid;grid-template-columns:190px 1fr;min-height:420px;text-align:left">
            <div style="border-right:1px solid var(--line);padding:14px 12px;background:var(--bg-elev)">
              <div class="row gap-2" style="padding:4px 6px 14px">${logo(22)}<span style="font-size:12px;font-weight:600">Auto Trader</span></div>
              ${[
                ["home", "Overview", true], ["candles", "Markets", false], ["wallet", "Portfolio", false],
                ["play", "Strategy", false], ["flask", "Backtest", false], ["chart", "Analytics", false],
                ["shieldCheck", "Risk & safety", false], ["sparkles", "AI Copilot", false],
              ]
                .map(
                  ([ic, l, on]) => `<div class="row gap-2" style="padding:7px 8px;border-radius:7px;font-size:11.5px;color:${on ? "var(--text)" : "var(--text-3)"};background:${on ? "var(--surface-2)" : "transparent"}">${icon(ic, { size: 13 })}${l}</div>`
                )
                .join("")}
              <div style="margin-top:18px;padding:8px;border-radius:7px;background:var(--warn-soft);color:var(--warn);font-size:10px" class="row gap-2"><span class="dot warn"></span>Paper mode</div>
            </div>
            <div style="padding:18px">
              <div class="row between" style="margin-bottom:14px">
                <div><div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em">Portfolio equity</div><div style="font-size:26px;font-weight:600;letter-spacing:-.02em">$24,812.44</div></div>
                <span class="badge neutral">USD · paper</span>
              </div>
              ${spark(series(40, 10000, 0.006, 0.02, 91), { w: 560, h: 92, fill: true, strokeWidth: 1.8 })}
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px">
                ${[
                  ["Win rate", "61.8%", "+2.4"],
                  ["Sharpe", "1.84", "+0.12"],
                  ["Open", "4 positions", "75% exp."],
                ]
                  .map(
                    ([l, v, d]) => `<div style="border:1px solid var(--line);border-radius:9px;padding:10px;background:var(--surface-1)">
                  <div style="font-size:10px;color:var(--text-3)">${l}</div>
                  <div style="font-size:15px;font-weight:600;margin-top:2px">${v}</div>
                  <div style="font-size:10px;color:var(--pos)">${d}</div>
                </div>`
                  )
                  .join("")}
              </div>
              <div style="margin-top:12px;border:1px solid var(--line);border-radius:9px;overflow:hidden">
                ${[
                  ["SOL", "LONG", "+$525.40", "#14F195"],
                  ["BTC", "LONG", "+$145.60", "#F7931A"],
                  ["ETH", "LONG", "−$69.40", "#627EEA"],
                ]
                  .map(
                    ([s, side, pnl, c]) => `<div class="row gap-2" style="padding:8px 10px;border-bottom:1px solid var(--line);font-size:11px">
                  ${assetIco(s, c)}<b>${s}/USDT</b><span class="badge ${side === "LONG" ? "pos" : "neg"}" style="height:16px;font-size:9px">${side}</span>
                  <span style="margin-left:auto" class="${pnl.startsWith("+") ? "pos" : "neg"}">${pnl}</span>
                </div>`
                  )
                  .join("")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section class="pub-section" id="how">
      <div class="inner">
        <h2>Three layers, one decision.</h2>
        <p class="sub">The engine never buys a token it cannot explain. Every candidate passes perception, safety and risk before an order exists.</p>
        <div class="feature-grid">
          ${[
            ["radar", "Perceive", "Prices, liquidity, holder concentration and social velocity are normalised into a single opportunity score every 30 seconds."],
            ["shieldCheck", "Protect", "Honeypot simulation, mint authority, blacklist and liquidity-lock checks run before any position. Failed tokens are blocked, not down-ranked."],
            ["sparkles", "Explain", "Each decision is stored with the gates it passed, the confidence it had and the condition that invalidates it. Ask why, any time."],
          ]
            .map(
              ([ic, t, d]) => `<div class="feature"><span class="f-ico">${icon(ic, { size: 16 })}</span><h3>${t}</h3><p>${d}</p></div>`
            )
            .join("")}
        </div>
        <div class="stat-band">
          ${[
            ["18", "pairs scanned per round"],
            ["1,842", "tokens safety-checked"],
            ["0.35%", "risk per trade (default)"],
            ["99.97%", "engine uptime 7d"],
          ]
            .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`)
            .join("")}
        </div>
      </div>
    </section>

    <section class="pub-section" id="safety">
      <div class="inner" style="display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center">
        <div>
          <h2>Paper first. Live only when the numbers earn it.</h2>
          <p class="sub">Live trading unlocks after 50 positive cycles with zero risk incidents — and still needs your explicit confirmation with MFA.</p>
          <div class="stack gap-3 mt-6">
            ${[
              ["Human-owned envelope", "Risk limits can be tightened by the engine, never loosened."],
              ["Kill switch in one place", "Halts execution and flattens positions, with a typed confirmation."],
              ["Immutable audit trail", "Hash-chained events, exportable for every closed trade."],
            ]
              .map(
                ([t, d]) => `<div class="row gap-3" style="align-items:flex-start">${icon("checkCircle", { size: 18, cls: "pos" })}<div><b style="font-size:13.5px">${t}</b><div class="dim t-sm" style="margin-top:2px">${d}</div></div></div>`
              )
              .join("")}
          </div>
        </div>
        <div class="card" style="padding:22px;background:var(--bg-elev)">
          <div class="row between" style="margin-bottom:16px"><span class="t-caption">Graduation to live</span>${badge("12 / 50", "warn")}</div>
          <div class="meter warn"><span style="width:24%"></span></div>
          <div class="row between mt-2"><span class="dim t-xs">Positive cycles</span><span class="strong">12</span></div>
          <div class="divider" style="margin:16px 0"></div>
          <div class="stack gap-3">
            <div class="row between"><span class="t-sm muted">Risk incidents</span><span class="badge pos">0</span></div>
            <div class="row between"><span class="t-sm muted">Forward Sharpe</span><span class="strong">1.92</span></div>
            <div class="row between"><span class="t-sm muted">Estimated unlock</span><span class="strong">~38 days</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="pub-section" id="pricing">
      <div class="inner">
        <h2>Simple pricing. Paper is free.</h2>
        <p class="sub">Start with paper capital. Upgrade when you are ready to go live.</p>
        <div class="pub-price">
          ${[
            { n: "Free", p: "$0", s: "Learn the system, no expiry", f: ["Paper trading", "1 open position", "Community support", "30 req/min"], c: "Current plan", x: "" },
            { n: "Pro", p: "$49", s: "For operators running live", f: ["Live trading (paper→live)", "20 open positions", "TOTP MFA", "Alerts on Telegram & e-mail", "300 req/min"], c: "Start 14-day trial", x: "true" },
            { n: "Elite", p: "$199", s: "For desks and funds", f: ["Unlimited positions", "Custom strategies", "Dedicated risk review", "White-glove onboarding", "3,000 req/min"], c: "Talk to us", x: "" },
          ]
            .map(
              (p) => `<div class="plan" data-featured="${p.x}">
            <h3>${p.n} ${p.x ? badge("Most popular", "brand") : ""}</h3>
            <div class="price">${p.p}<small>/month</small></div>
            <div class="plan-sub">${p.s}</div>
            <ul>${p.f.map((f) => `<li>${icon("check", { size: 14 })} ${f}</li>`).join("")}</ul>
            <a class="btn ${p.x ? "btn-primary" : "btn-secondary"}" href="#/signup">${p.c}</a>
          </div>`
            )
            .join("")}
        </div>
        <p class="pub-note" style="text-align:left">All plans include paper trading by default. Live trading requires Pro or Elite plus 50 paper cycles.</p>
      </div>
    </section>

    <footer class="pub-foot">
      <div class="row gap-2">${logo(22)}<span style="color:var(--text-2)">Auto Trader</span><span>· © 2026</span></div>
      <div class="fl">
        <a href="#/terms">Terms</a><a href="#/privacy">Privacy</a><a href="#/landing">Status</a><a href="#/landing">Docs</a><a href="#/landing">Contact</a>
      </div>
    </footer>
  </div>`;
  },
  mount(root) {
    root.querySelectorAll("[data-scroll]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById(a.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );
  },
};

/* ---------------- Auth ---------------- */
function authShell({ title, sub, form, foot = "", cta = "" }) {
  return `<div class="auth">
    <div class="auth-visual">
      <svg class="mesh" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="1.4" cy="1.4" r="1.1" fill="rgba(255,255,255,.07)"/>
          </pattern>
          <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="white" stop-opacity=".5"/><stop offset="1" stop-color="white" stop-opacity="0"/>
          </linearGradient>
          <mask id="m"><rect width="600" height="800" fill="url(#fade)"/></mask>
        </defs>
        <rect width="600" height="800" fill="url(#dots)" mask="url(#m)"/>
        <path d="M-20 620 C120 600 160 500 250 470 C340 440 380 360 470 300 C520 266 560 240 620 220" fill="none" stroke="rgba(91,108,255,.45)" stroke-width="1.6"/>
        <circle cx="470" cy="300" r="5" fill="#5B6CFF"/>
        <circle cx="250" cy="470" r="3.4" fill="rgba(255,255,255,.5)"/>
      </svg>
      <div class="row gap-3" style="position:relative">${logo(30)}<span class="rail-word" style="font-size:15px">Auto Trader<small>Meridian</small></span></div>
      <div class="auth-copy">
        <h2>“The first bot I actually trust with a spreadsheet of its own decisions.”</h2>
        <p>Risk-first automation for crypto. Paper capital, real prices, full audit trail — from day one.</p>
        <div class="auth-stats">
          <div><b>18</b><span>pairs scanned</span></div>
          <div><b>1,842</b><span>tokens checked</span></div>
          <div><b>99.97%</b><span>uptime 7d</span></div>
        </div>
      </div>
    </div>
    <div class="auth-panel">
      <div class="auth-card">
        <div class="auth-logo">${logo(26)}<span class="strong" style="font-size:13px">Auto Trader</span></div>
        <h1>${title}</h1>
        <p class="auth-sub">${sub}</p>
        ${form}
        ${foot}
      </div>
    </div>
  </div>`;
}

export const login = {
  title: "Sign in",
  html() {
    return authShell({
      title: "Welcome back",
      sub: "Sign in to your workspace to continue.",
      form: `<form class="auth-form" data-login>
        <div class="field"><label for="email">Email</label>
          <div class="input-wrap">${icon("mail", { size: 16 })}<input class="input" id="email" type="email" placeholder="you@company.com" autocomplete="email" /></div>
        </div>
        <div class="field"><label for="pw">Password</label>
          <div class="input-wrap">${icon("lock", { size: 16 })}<input class="input" id="pw" type="password" placeholder="••••••••••" autocomplete="current-password" />
            <span class="suffix"><button type="button" class="icon-btn" style="width:26px;height:26px" data-reveal aria-label="Show password">${icon("eye", { size: 14 })}</button></span>
          </div>
        </div>
        <div class="auth-meta">
          <label class="check"><input type="checkbox" /> <span>Keep me signed in</span></label>
          <a class="btn-link" href="#/reset" style="font-size:12.5px">Forgot password?</a>
        </div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Sign in ${icon("arrowRight", { size: 16 })}</button>
      </form>
      <div class="auth-sep">or</div>
      <div class="stack gap-2">
        <button class="btn btn-secondary btn-block">${icon("key", { size: 15 })} Continue with passkey</button>
        <button class="btn btn-ghost btn-block" data-demo>${icon("play", { size: 15 })} Explore the demo workspace</button>
      </div>
      <p class="auth-foot">New here? <a class="btn-link" href="#/signup">Create an account</a></p>
      <p class="auth-foot" style="margin-top:10px">Protected by TOTP MFA · session expires in 12h</p>`,
    });
  },
  mount(root) {
    root.querySelector("[data-reveal]")?.addEventListener("click", () => {
      const pw = root.querySelector("#pw");
      pw.type = pw.type === "password" ? "text" : "password";
    });
    root.querySelector("[data-login]")?.addEventListener("submit", (e) => {
      e.preventDefault();
      location.hash = "#/overview";
    });
    root.querySelector("[data-demo]")?.addEventListener("click", () => (location.hash = "#/overview"));
  },
};

export const signup = {
  title: "Create account",
  html() {
    return authShell({
      title: "Create your workspace",
      sub: "Paper capital included. No card required.",
      form: `<form class="auth-form" data-signup>
        <div class="field"><label for="name">Full name</label><div class="input-wrap">${icon("users", { size: 16 })}<input class="input" id="name" placeholder="Alex Duarte" /></div></div>
        <div class="field"><label for="email2">Work email</label><div class="input-wrap">${icon("mail", { size: 16 })}<input class="input" id="email2" type="email" placeholder="you@company.com" /></div></div>
        <div class="field"><label for="pw2">Password</label><div class="input-wrap">${icon("lock", { size: 16 })}<input class="input" id="pw2" type="password" placeholder="At least 10 characters" /></div>
          <div class="row gap-2" style="margin-top:2px">${["12+ chars", "number", "symbol"].map((t) => `<span class="badge neutral">${t}</span>`).join("")}</div>
        </div>
        <label class="check"><input type="checkbox" /> <span>I accept the <a class="btn-link" href="#/terms">Terms</a> and <a class="btn-link" href="#/privacy">Privacy Policy</a>. I understand trading involves risk.</span></label>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Create workspace ${icon("arrowRight", { size: 16 })}</button>
      </form>
      <p class="auth-foot">Already have an account? <a class="btn-link" href="#/login">Sign in</a></p>`,
    });
  },
  mount(root) {
    root.querySelector("[data-signup]")?.addEventListener("submit", (e) => {
      e.preventDefault();
      location.hash = "#/onboarding";
    });
  },
};

export const reset = {
  title: "Reset password",
  html() {
    return authShell({
      title: "Reset your password",
      sub: "We will email a single-use link that expires in 30 minutes.",
      form: `<form class="auth-form" data-reset>
        <div class="field"><label for="email3">Email</label><div class="input-wrap">${icon("mail", { size: 16 })}<input class="input" id="email3" type="email" placeholder="you@company.com" /></div></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Send reset link</button>
      </form>
      <div class="banner info" style="margin-top:16px">${icon("info", { size: 15 })}<div class="grow">For security, we never confirm whether an address is registered.</div></div>
      <p class="auth-foot"><a class="btn-link" href="#/login">${icon("arrowLeft", { size: 13 })} Back to sign in</a></p>`,
    });
  },
  mount(root) {
    root.querySelector("[data-reset]")?.addEventListener("submit", (e) => {
      e.preventDefault();
      window.__at?.toast?.({ title: "Check your inbox", desc: "If the address exists, a link is on the way.", iconName: "mail" });
    });
  },
};

/* ---------------- Onboarding ---------------- */
export const onboarding = {
  title: "Set up",
  html() {
    return `<div class="ob">
    <aside class="ob-side">
      <div class="row gap-2">${logo(28)}<span class="rail-word">Auto Trader<small>Meridian</small></span></div>
      <div class="ob-steps">
        ${[
          ["Risk profile", "How much can you lose?"],
          ["Strategy", "What should it trade?"],
          ["Connections", "Exchange & alerts"],
          ["Review", "Start in paper"],
        ]
          .map(
            ([t, d], i) => `<div class="ob-step ${i === 0 ? "active" : ""}">
          <span class="n">${i + 1}</span>
          <div><b>${t}</b><span>${d}</span></div>
        </div>`
          )
          .join("")}
      </div>
      <div class="grow"></div>
      <div class="banner info" style="margin-bottom:12px">${icon("info", { size: 15 })}<div class="grow">Takes about 2 minutes. You can change everything later.</div></div>
      <a class="btn btn-ghost btn-sm" href="#/overview">Skip for now</a>
    </aside>

    <main class="ob-main">
      <div class="t-caption" style="margin-bottom:10px">Step 1 of 4</div>
      <h1>How much risk should the engine take?</h1>
      <p class="ob-lede">This sets your default risk per trade and position size. The engine can tighten these limits, never loosen them.</p>
      <div class="ob-choices">
        ${[
          ["Conservative", "0.25% per trade", "2 positions · wider stops", false],
          ["Balanced", "0.50% per trade", "4 positions · recommended", true],
          ["Aggressive", "1.00% per trade", "6 positions · tighter stops", false],
        ]
          .map(
            ([t, f, d, on]) => `<button class="choice" aria-pressed="${on}">
          <span class="ico">${icon(t === "Conservative" ? "shield" : t === "Balanced" ? "gauge" : "zap", { size: 15 })}</span>
          <b>${t}</b><span>${f}</span><span style="color:var(--text-3)">${d}</span>
        </button>`
          )
          .join("")}
      </div>

      <div class="ob-preview">
        <div class="ring" style="--p:.5;width:46px;height:46px"><b>0.5%</b></div>
        <div class="pv"><b>Risk per trade</b><span>At $10,000 paper capital, one stop-out costs $50 — about 0.5% of equity.</span></div>
        ${badge("within envelope", "pos")}
      </div>

      <div class="ob-foot">
        <span class="dim t-xs">You can import an existing configuration instead.</span>
        <div class="row gap-2">
          <button class="btn btn-ghost">Import config</button>
          <button class="btn btn-primary">Continue ${icon("arrowRight", { size: 15 })}</button>
        </div>
      </div>
    </main>
  </div>`;
  },
  mount(root) {
    root.querySelectorAll(".choice").forEach((c) =>
      c.addEventListener("click", () => {
        root.querySelectorAll(".choice").forEach((x) => x.setAttribute("aria-pressed", "false"));
        c.setAttribute("aria-pressed", "true");
      })
    );
  },
};
