/* pages/ops.js — alerts, data sources, settings, billing, admin */
import { icon } from "../icons.js";
import { pageHead, card, badge, meter, empty, avatar, dot } from "../ui.js";
import { alerts as alertItems, channels, sources, integrations, users, auditLog, invoices, fmt } from "../data.js";

/* ---------------- Alerts ---------------- */
export const alerts = {
  title: "Alerts",
  crumb: ["System", "Alerts"],
  html() {
    return `
  ${pageHead({
    title: "Alerts",
    sub: "Everything the engine wants you to know — ranked by consequence, not by recency.",
    actions: `<button class="btn btn-ghost btn-sm" data-mute>${icon("bell", { size: 15 })} Mute 1h</button>
      <button class="btn btn-secondary btn-sm">${icon("sliders", { size: 15 })} Rules</button>
      <button class="btn btn-primary btn-sm">${icon("check", { size: 15 })} Mark all read</button>`,
  })}

  <div class="al-layout">
    <section class="card">
      <div class="al-filters">
        <button class="chip" aria-pressed="true">All 6</button>
        <button class="chip">Critical 1</button>
        <button class="chip">Warnings 2</button>
        <button class="chip">Info 3</button>
        <span class="grow"></span>
        <button class="btn btn-ghost btn-sm">${icon("filter", { size: 14 })} More</button>
      </div>
      ${alertItems.map(
          (a) => `<div class="al-item ${a.unread ? "unread" : ""}">
        <span class="al-ico" style="color:${a.sev === "crit" ? "var(--crit)" : a.sev === "warn" ? "var(--warn)" : a.sev === "pos" ? "var(--pos)" : "var(--brand)"}">${icon(a.icon, { size: 15 })}</span>
        <div class="al-main">
          <div class="al-title">${a.title} ${a.unread ? `<span class="dot brand"></span>` : ""}</div>
          <div class="al-desc">${a.desc}</div>
          <div class="row gap-2 mt-2">
            <button class="btn btn-ghost btn-sm">${a.sev === "crit" ? "Review" : "Open"}</button>
            <button class="btn btn-ghost btn-sm">Dismiss</button>
          </div>
        </div>
        <time>${a.time}</time>
      </div>`
        )
        .join("")}
      <div class="table-foot"><span>6 alerts · 2 unread</span><span>Retention 90 days</span></div>
    </section>

    <aside class="stack gap-4">
      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Delivery</div><a class="card-link" href="#/settings">Manage</a></div>
        <div>
          ${channels
            .map(
              (c) => `<div class="channel">
          <span class="li-ico" style="width:30px;height:30px">${icon(c.icon, { size: 14 })}</span>
          <div class="grow" style="min-width:0"><div class="strong t-sm">${c.name}</div><div class="dim t-xs">${c.desc}</div></div>
          <input type="checkbox" class="switch" ${c.on ? "checked" : ""} aria-label="${c.name}" />
        </div>`
            )
            .join("")}
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Alert rules</div>${badge("4 active", "pos")}</div>
        <div>
          ${[
            ["Critical risk events", "always", true],
            ["Drawdown > 3.5%", "instant", true],
            ["Rejected trades", "hourly digest", true],
            ["New strategy promotion", "instant", true],
            ["RPC latency > 250ms", "digest", false],
          ]
            .map(
              ([n, f, on]) => `<div class="channel">
            <div class="grow"><div class="strong t-sm">${n}</div><div class="dim t-xs">${f}</div></div>
            <input type="checkbox" class="switch" ${on ? "checked" : ""} aria-label="${n}" />
          </div>`
            )
            .join("")}
        </div>
      </section>
    </aside>
  </div>`;
  },
  mount(root) {
    root.querySelectorAll("[data-mute]").forEach((b) =>
      b.addEventListener("click", () => window.__at.toast({ title: "Muted for 1 hour", desc: "Critical alerts still break through.", tone: "warn", iconName: "bell" }))
    );
    root.querySelectorAll(".switch").forEach((s) =>
      s.addEventListener("change", () => window.__at.toast({ title: s.checked ? "Channel enabled" : "Channel paused", desc: "Saved to your notification preferences.", iconName: "checkCircle" }))
    );
  },
};

/* ---------------- Data & sources ---------------- */
export const data = {
  title: "Data & sources",
  crumb: ["System", "Data & sources"],
  html() {
    return `
  ${pageHead({
    title: "Data & sources",
    sub: "Where prices, liquidity and safety signals come from. If a source degrades, the engine lowers size instead of guessing.",
    actions: `<button class="btn btn-ghost btn-sm">${icon("refresh", { size: 15 })} Refresh health</button>
      <button class="btn btn-primary btn-sm">${icon("plus", { size: 15 })} Add integration</button>`,
  })}

  <div class="int-grid">
    <section class="card">
      <div class="card-hd with-border"><div><div class="card-title">Market data</div><div class="card-sub">4 sources · quorum 2-of-3</div></div>${badge("healthy", "pos")}</div>
      <div>
        ${sources
          .map(
            (s) => `<div class="int-row">
          <span class="int-logo">${icon(s.icon, { size: 15 })}</span>
          <div class="in-main">
            <div class="in-top">${s.name} <span class="badge ${s.status === "ok" ? "pos" : "warn"}">${s.status}</span></div>
            <div class="in-sub">${s.kind} · ${s.latency} · ${s.uptime}% uptime 30d</div>
          </div>
          <div class="health-bar">${s.health.map((h) => `<i class="${h ? "ok" : "miss"}"></i>`).join("")}</div>
          <button class="icon-btn" data-tip="Source details">${icon("more", { size: 15 })}</button>
        </div>`
          )
          .join("")}
      </div>
    </section>

    <section class="card">
      <div class="card-hd with-border"><div><div class="card-title">Venues & wallets</div><div class="card-sub">Trading connections</div></div>${badge("paper", "warn")}</div>
      <div>
        ${integrations
          .map(
            (i) => `<div class="int-row">
          <span class="int-logo" style="font-family:var(--font-mono);font-size:11px">${i.icon}</span>
          <div class="in-main"><div class="in-top">${i.name} ${i.status === "connected" ? badge("connected", "pos") : ""}</div><div class="in-sub">${i.kind}</div></div>
          ${i.status === "connected" ? `<span class="dim t-xs nowrap">${i.sub}</span>` : `<button class="btn btn-secondary btn-sm">Connect</button>`}
        </div>`
          )
          .join("")}
      </div>
      <div class="card-section"><div class="banner info">${icon("lock", { size: 15 })}<div class="grow">Keys are encrypted at rest; the signer runs in a separate process and never exposes secrets to the web tier.</div></div></div>
    </section>
  </div>

  <div class="grid g-12" style="margin-top:16px">
    <section class="card col-8">
      <div class="card-hd with-border"><div><div class="card-title">Source quality · last 24h</div><div class="card-sub">Latency p50/p99, error rate and failovers</div></div></div>
      <div class="table-wrap">
        <table class="table compact">
          <thead><tr><th>Source</th><th class="num">p50</th><th class="num">p99</th><th class="num">Errors</th><th class="num">Failovers</th><th>Used for</th><th class="num">Weight</th></tr></thead>
          <tbody>
            ${[
              ["Binance Public", "38ms", "112ms", "0.02%", 0, "Prices · order book", "50%"],
              ["DexScreener", "142ms", "640ms", "1.8%", 2, "DEX pairs · liquidity", "20%"],
              ["BSC RPC quorum", "20ms", "88ms", "0.00%", 0, "Chain · simulation", "20%"],
              ["CoinGecko", "96ms", "310ms", "0.11%", 0, "Reference prices", "10%"],
            ]
              .map(
                ([n, p50, p99, e, f, u, w]) => `<tr><td class="t-main">${n}</td><td class="num">${p50}</td><td class="num dim">${p99}</td><td class="num ${e !== "0.00%" ? "warn" : ""}">${e}</td><td class="num">${f}</td><td class="dim">${u}</td><td class="num">${w}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="card col-4">
      <div class="card-hd with-border"><div class="card-title">API access</div></div>
      <div class="card-body">
        <div class="field"><label>Public API key</label>
          <div class="row gap-2"><input class="input t-mono" value="at_live_8f21…c4d9" readonly /><button class="btn btn-secondary btn-sm">${icon("copy", { size: 14 })}</button></div>
        </div>
        <div class="divider" style="margin:16px 0"></div>
        <dl class="dl tight">
          <dt>Rate limit</dt><dd>1,204 / 1,200 rpm</dd>
          <dt>Webhook</dt><dd class="pos">healthy</dd>
          <dt>Last event</dt><dd>4s ago</dd>
        </dl>
        <button class="btn btn-secondary btn-sm btn-block" style="margin-top:14px">${icon("refresh", { size: 14 })} Rotate key</button>
      </div>
    </section>
  </div>`;
  },
};

/* ---------------- Settings ---------------- */
export const settings = {
  title: "Settings",
  crumb: ["System", "Settings"],
  html() {
    return `
  ${pageHead({
    title: "Settings",
    sub: "Profile, security and workspace preferences. Security changes require your password.",
    actions: `<button class="btn btn-secondary btn-sm">Discard</button><button class="btn btn-primary btn-sm" data-save>${icon("check", { size: 15 })} Save changes</button>`,
  })}

  <div class="set-layout">
    <nav class="set-nav" aria-label="Settings sections">
      ${["Profile", "Security", "Preferences", "Notifications", "API keys", "Danger zone"]
        .map((s, i) => `<button aria-selected="${i === 0}">${s}</button>`)
        .join("")}
    </nav>
    <div>
      <section class="card">
        <div class="card-section">
          <div class="row gap-4 wrap">
            ${avatar("AD", 56)}
            <div class="grow"><div class="strong">Alex Duarte</div><div class="dim t-xs">super admin · member since Oct 2026</div></div>
            <button class="btn btn-secondary btn-sm">Change avatar</button>
          </div>
          <div class="form-grid">
            <div class="field"><label>Full name</label><input class="input" value="Alex Duarte" /></div>
            <div class="field"><label>Email</label><input class="input" value="admin@local" /></div>
            <div class="field"><label>Role</label><input class="input" value="super_admin" readonly /></div>
            <div class="field"><label>Timezone</label><select class="select"><option>America/Sao_Paulo (UTC−3)</option><option>UTC</option></select></div>
          </div>
        </div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="card-section">
          <h3>Security</h3>
          <p class="sd">Two-factor authentication is required to unlock live trading.</p>
          <div class="set-row">
            <div class="sr-main"><div class="sr-title">Two-factor authentication</div><div class="sr-desc">TOTP · authenticator app</div></div>
            ${badge("enabled", "pos")}
            <button class="btn btn-secondary btn-sm">Reconfigure</button>
          </div>
          <div class="set-row">
            <div class="sr-main"><div class="sr-title">Active sessions</div><div class="sr-desc">2 devices · Chrome on Windows, iPhone</div></div>
            <button class="btn btn-ghost btn-sm">Revoke all</button>
          </div>
          <div class="set-row">
            <div class="sr-main"><div class="sr-title">Audit log</div><div class="sr-desc">Every privileged action is recorded with IP and timestamp</div></div>
            <a class="btn btn-ghost btn-sm" href="#/admin">Open ${icon("arrowRight", { size: 13 })}</a>
          </div>
        </div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="card-section">
          <h3>Preferences</h3>
          <p class="sd">Applies to this browser. Density and theme are stored locally.</p>
          <div class="set-row">
            <div class="sr-main"><div class="sr-title">Appearance</div><div class="sr-desc">Dark is the default for long sessions</div></div>
            <div class="segmented"><button aria-pressed="true" data-theme-set="dark">Dark</button><button data-theme-set="light">Light</button></div>
          </div>
          <div class="set-row">
            <div class="sr-main"><div class="sr-title">Density</div><div class="sr-desc">Compact fits ~20% more rows</div></div>
            <div class="segmented"><button aria-pressed="true">Comfortable</button><button>Compact</button></div>
          </div>
          <div class="set-row">
            <div class="sr-main"><div class="sr-title">Language</div><div class="sr-desc">Interface, alerts and AI answers</div></div>
            <select class="select" style="width:180px"><option>English</option><option>Português (BR)</option><option>Español</option></select>
          </div>
          <div class="set-row">
            <div class="sr-main"><div class="sr-title">Reduce motion</div><div class="sr-desc">Follows the system preference by default</div></div>
            <input type="checkbox" class="switch" aria-label="Reduce motion" />
          </div>
        </div>
      </section>
    </div>
  </div>`;
  },
  mount(root) {
    root.querySelectorAll("[data-theme-set]").forEach((b) =>
      b.addEventListener("click", () => {
        document.documentElement.dataset.theme = b.dataset.themeSet;
        localStorage.setItem("at.theme", b.dataset.themeSet);
        root.querySelectorAll("[data-theme-set]").forEach((x) => x.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
      })
    );
    root.querySelector("[data-save]")?.addEventListener("click", () =>
      window.__at.toast({ title: "Settings saved", desc: "Changes applied to this workspace.", iconName: "checkCircle" })
    );
  },
};

/* ---------------- Billing ---------------- */
export const billing = {
  title: "Billing",
  crumb: ["System", "Billing"],
  html() {
    return `
  ${pageHead({
    title: "Billing",
    sub: "Pro plan, billed monthly. Paper trading is free forever; live trading requires Pro or Elite.",
    actions: `<button class="btn btn-ghost btn-sm">${icon("file", { size: 15 })} Invoices</button>
      <button class="btn btn-primary btn-sm">${icon("card", { size: 15 })} Change plan</button>`,
  })}

  <div class="bill-layout">
    <div class="stack gap-4">
      <section class="card">
        <div class="card-section row between wrap gap-4">
          <div class="row gap-4">
            <span class="li-ico" style="width:44px;height:44px;border-radius:12px;background:var(--brand-soft);color:var(--brand)">${icon("zap", { size: 20 })}</span>
            <div>
              <div class="row gap-2"><span class="t-h3">Pro</span>${badge("current", "pos")}</div>
              <div class="dim t-xs" style="margin-top:3px">$49/month · renews 30 Nov 2026 · 20 positions</div>
            </div>
          </div>
          <div class="row gap-2"><button class="btn btn-secondary btn-sm">Manage payment</button><button class="btn btn-ghost btn-sm">Cancel</button></div>
        </div>
        <div class="card-section" style="background:var(--surface-2)">
          <div class="row between"><span class="t-sm muted">Live trading requires Pro or Elite + 50 paper cycles.</span><span class="row gap-2">${badge("12/50 cycles", "warn")}<a class="card-link" href="#/strategy">Details</a></span></div>
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div><div class="card-title">Usage this cycle</div><div class="card-sub">Resets 30 Nov</div></div></div>
        <div>
          ${[
            ["Open positions", "4 of 20", 20, "ok"],
            ["Backtests", "38 of 200", 19, "ok"],
            ["AI Copilot answers", "142 of 500", 28, "ok"],
            ["API requests", "1.2M of 2M", 60, "warn"],
          ]
            .map(
              ([l, v, m, tone]) => `<div class="usage-row">
            <div class="u-main"><div class="u-top"><span>${l}</span><b>${v}</b></div>${meter(m, tone)}</div>
          </div>`
            )
            .join("")}
        </div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Invoices</div><button class="btn btn-ghost btn-sm">${icon("download", { size: 14 })} Download all</button></div>
        <div>
          ${invoices
            .map(
              (i) => `<div class="invoice-row">
            <span class="i-date">${i.date}</span>
            <span>${i.desc}</span>
            <span class="num">${i.amount}</span>
            <span style="text-align:right"><span class="badge ${i.status === "paid" ? "pos" : "neutral"}">${i.status}</span></span>
          </div>`
            )
            .join("")}
        </div>
      </section>
    </div>

    <aside class="stack gap-4">
      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Payment method</div></div>
        <div class="card-body">
          <div class="row gap-3">
            <span class="int-logo" style="font-size:10px">VISA</span>
            <div class="grow"><div class="strong t-sm">•••• 4242</div><div class="dim t-xs">Expires 09/2028</div></div>
            ${badge("default", "neutral")}
          </div>
          <button class="btn btn-secondary btn-sm btn-block" style="margin-top:14px">Update card</button>
        </div>
      </section>
      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Need Elite?</div></div>
        <div class="card-body">
          <p class="t-sm muted" style="line-height:1.55">Unlimited positions, custom strategies and a dedicated risk review every month.</p>
          <div class="t-num-lg" style="margin:12px 0 4px">$199<span class="dim" style="font-size:13px;font-weight:400">/mo</span></div>
          <button class="btn btn-primary btn-sm btn-block">Upgrade to Elite</button>
        </div>
      </section>
      <div class="banner info">${icon("info", { size: 15 })}<div class="grow">Prices in USD. Taxes calculated at checkout.</div></div>
    </aside>
  </div>`;
  },
};

/* ---------------- Admin ---------------- */
export const admin = {
  title: "Users & audit",
  crumb: ["Admin", "Users & audit"],
  html() {
    return `
  ${pageHead({
    status: `<span class="badge brand">super_admin</span> <span class="dim t-xs">restricted area</span>`,
    title: "Users & audit",
    sub: "Create accounts, adjust roles and review every privileged action. Changes are written to the hash-chained audit log.",
    actions: `<button class="btn btn-secondary btn-sm">${icon("download", { size: 15 })} Export audit</button>
      <button class="btn btn-primary btn-sm" data-new-user>${icon("plus", { size: 15 })} Create user</button>`,
  })}

  <div class="adm-grid">
    <section class="card">
      <div class="card-hd with-border"><div><div class="card-title">Users ${badge(String(users.length), "neutral")}</div><div class="card-sub">4 seats · 3 active</div></div>
        <div class="input-wrap" style="width:200px">${icon("search", { size: 15 })}<input class="input" style="height:32px" placeholder="Search email" /></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th>Created</th><th></th></tr></thead>
          <tbody>
            ${users
              .map(
                (u) => `<tr>
              <td><div class="row gap-2">${avatar(u.initials, 28)}<div class="cell-stack"><span class="t-main">${u.email}</span><span class="t-sub">${u.initials.toLowerCase()}@workspace</span></div></div></td>
              <td><span class="role ${u.role === "super_admin" ? "admin" : ""}">${u.role}</span></td>
              <td><span class="badge ${u.active ? "pos" : "neutral"}">${u.active ? "active" : "disabled"}</span></td>
              <td class="dim">${u.last}</td>
              <td class="dim">${u.created}</td>
              <td class="num"><button class="icon-btn" data-tip="Edit user" data-user="${u.email}">${icon("more", { size: 15 })}</button></td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="table-foot"><span>Roles: viewer · trader · super_admin</span><span>MFA enforced for admins</span></div>
    </section>

    <aside class="stack gap-4">
      <section class="card">
        <div class="card-hd with-border"><div class="card-title">Audit log</div><span class="badge neutral">live</span></div>
        <div>
          ${auditLog
            .map(
              (a) => `<div class="audit-row">
            <span class="dot ${a.who === "system" ? "brand" : "pos"}"></span>
            <div class="ar-main"><b>${a.who}</b> ${a.what}<div class="dim t-xs">${a.detail}</div></div>
            <time>${a.time}</time>
          </div>`
            )
            .join("")}
        </div>
        <div class="card-section"><a class="card-link" href="#/journal">Full log ${icon("arrowRight", { size: 13 })}</a></div>
      </section>

      <section class="card">
        <div class="card-hd with-border"><div class="card-title">System</div></div>
        <div class="card-body">
          <dl class="dl tight">
            <dt>Version</dt><dd>1.0.0-meridian</dd>
            <dt>Region</dt><dd>gru1 · São Paulo</dd>
            <dt>Database</dt><dd>SQLite (dev) · ok</dd>
            <dt>Signer</dt><dd class="pos">paper · isolated</dd>
            <dt>Uptime</dt><dd>99.97% (7d)</dd>
          </dl>
        </div>
      </section>
    </aside>
  </div>`;
  },
  mount(root) {
    root.querySelector("[data-new-user]")?.addEventListener("click", () =>
      window.__at.openModal({
        title: "Create user",
        desc: "The user receives an email to set a password. Role changes are audited.",
        primary: "Create user",
        body: `<div class="field"><label>Email</label><input class="input" placeholder="name@company.com" /></div>
          <div class="field mt-3"><label>Role</label><select class="select"><option>viewer</option><option>trader</option><option>super_admin</option></select></div>
          <label class="check mt-4"><input type="checkbox" /> <span>Require MFA on first login</span></label>`,
        onConfirm: () => window.__at.toast({ title: "User created", desc: "Invitation sent · expires in 48h.", iconName: "users" }),
      })
    );
  },
};
