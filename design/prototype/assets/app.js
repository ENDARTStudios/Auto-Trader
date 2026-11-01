/* app.js — shell, router, overlays, command palette */
import { icon } from "./icons.js";
import { routes } from "./pages/index.js";

const NAV = [
  {
    group: "Operate",
    items: [
      { id: "overview", label: "Overview", icon: "home", route: "#/overview" },
      { id: "markets", label: "Markets", icon: "candles", route: "#/markets" },
      { id: "portfolio", label: "Portfolio", icon: "wallet", route: "#/portfolio" },
      { id: "strategy", label: "Strategy & engine", icon: "play", route: "#/strategy" },
      { id: "backtest", label: "Backtest", icon: "flask", route: "#/backtest" },
      { id: "analytics", label: "Analytics", icon: "chart", route: "#/analytics" },
      { id: "journal", label: "Journal", icon: "book", route: "#/journal" },
    ],
  },
  {
    group: "Guard",
    items: [
      { id: "risk", label: "Risk & safety", icon: "shieldCheck", route: "#/risk", count: "2" },
      { id: "copilot", label: "AI Copilot", icon: "sparkles", route: "#/copilot" },
    ],
  },
  {
    group: "System",
    items: [
      { id: "alerts", label: "Alerts", icon: "bell", route: "#/alerts", count: "2" },
      { id: "data", label: "Data & sources", icon: "database", route: "#/data" },
      { id: "settings", label: "Settings", icon: "settings", route: "#/settings" },
      { id: "billing", label: "Billing", icon: "card", route: "#/billing" },
    ],
  },
  {
    group: "Admin",
    items: [{ id: "admin", label: "Users & audit", icon: "users", route: "#/admin" }],
  },
];

const PUBLIC = new Set(["landing", "login", "signup", "reset", "onboarding"]);

const state = {
  rail: localStorage.getItem("at.rail") || "expanded",
  theme: localStorage.getItem("at.theme") || "dark",
  density: localStorage.getItem("at.density") || "comfortable",
  paletteOpen: false,
};

const app = document.getElementById("app");
const overlays = document.getElementById("overlays");

/* ---------- overlays ---------- */
export function toast({ title, desc, tone = "pos", iconName = "checkCircle" }) {
  const wrap = overlays.querySelector(".toasts") || (() => {
    const el = document.createElement("div");
    el.className = "toasts";
    overlays.appendChild(el);
    return el;
  })();
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `${icon(iconName, { size: 18, cls: "ti " + tone })}<div><b>${title}</b>${desc ? `<p>${desc}</p>` : ""}</div>`;
  wrap.appendChild(t);
  setTimeout(() => {
    t.dataset.leaving = "";
    setTimeout(() => t.remove(), 180);
  }, 4200);
}

let scrim;
export function openDrawer({ title, subtitle = "", body, footer = "", iconName = "info" }) {
  closeDrawer();
  scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.addEventListener("click", closeDrawer);
  const d = document.createElement("aside");
  d.className = "drawer";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.innerHTML = `
    <div class="drawer-hd">
      <span class="li-ico" style="width:34px;height:34px">${icon(iconName, { size: 16 })}</span>
      <div style="flex:1;min-width:0"><h3>${title}</h3>${subtitle ? `<div class="card-sub">${subtitle}</div>` : ""}</div>
      <button class="icon-btn" data-close aria-label="Close">${icon("x", { size: 16 })}</button>
    </div>
    <div class="drawer-body">${body}</div>
    ${footer ? `<div class="drawer-foot">${footer}</div>` : ""}`;
  overlays.append(scrim, d);
  requestAnimationFrame(() => {
    scrim.classList.add("show");
    d.classList.add("open");
  });
  d.querySelector("[data-close]").addEventListener("click", closeDrawer);
}

export function closeDrawer() {
  overlays.querySelectorAll(".drawer, .scrim").forEach((n) => {
    n.classList.remove("open", "show");
    setTimeout(() => n.remove(), 330);
  });
}

export function openModal({ title, desc = "", body = "", primary = "Confirm", tone = "primary", requireText = null, onConfirm }) {
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal-hd"><h3>${title}</h3>${desc ? `<p>${desc}</p>` : ""}</div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn ${tone === "danger" ? "btn-danger-solid" : "btn-primary"}" data-ok ${requireText ? "disabled" : ""}>${primary}</button>
    </div></div>`;
  overlays.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("open"));
  const okBtn = wrap.querySelector("[data-ok]");
  const close = () => {
    wrap.classList.remove("open");
    setTimeout(() => wrap.remove(), 220);
  };
  if (requireText) {
    const input = wrap.querySelector("input");
    input.autofocus = true;
    requestAnimationFrame(() => input.focus());
    input.addEventListener("input", () => {
      okBtn.disabled = input.value.trim().toUpperCase() !== requireText;
    });
  }
  wrap.querySelector("[data-cancel]").addEventListener("click", close);
  wrap.addEventListener("click", (e) => e.target === wrap && close());
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...wrap.querySelectorAll("button:not([disabled]), input, [href], select, textarea")];
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  okBtn.addEventListener("click", () => {
    close();
    onConfirm?.();
  });
}

/* ---------- command palette ---------- */
const ACTIONS = [
  { label: "Pause engine", icon: "pause", run: () => toast({ title: "Engine paused", desc: "Open positions keep managed exits.", tone: "warn", iconName: "pause" }) },
  { label: "Open kill switch", icon: "power", run: () => openKillSwitch() },
  { label: "New backtest", icon: "flask", go: "#/backtest" },
  { label: "Add integration", icon: "plus", go: "#/data" },
  { label: "Toggle theme", icon: "sun", run: toggleTheme },
  { label: "Toggle density", icon: "sliders", run: toggleDensity },
  { label: "Export journal (CSV)", icon: "download", run: () => toast({ title: "Export started", desc: "journal-2026-11.csv will be ready in a moment.", iconName: "download" }) },
  { label: "Copy current view link", icon: "link", run: () => { navigator.clipboard?.writeText(location.href); toast({ title: "Link copied", desc: location.hash || "#/overview", iconName: "link" }); } },
];

export function openKillSwitch() {
  openModal({
    title: "Trigger kill switch?",
    desc: "Immediately halts the engine and cancels every open order. Positions are flattened at market on the next tick.",
    tone: "danger",
    primary: "Trigger kill switch",
    requireText: "HALT",
    body: `<div class="banner danger" style="margin-bottom:14px">${icon("alert", { size: 16 })}<div>This is the only action that stops execution instantly. It is logged in the audit trail.</div></div>
      <div class="field"><label for="ks">Type <b>HALT</b> to confirm</label><input class="input" id="ks" placeholder="HALT" autocomplete="off" /></div>`,
    onConfirm: () => {
      toast({ title: "Kill switch triggered", desc: "Engine halted · 4 positions queued for flatten.", tone: "neg", iconName: "power" });
      document.querySelectorAll("[data-engine-state]").forEach((n) => (n.innerHTML = `<span class="dot neg"></span> Halted`));
    },
  });
}

function paletteMarkup(q = "") {
  const term = q.trim().toLowerCase();
  const navItems = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));
  const pages = navItems.filter((i) => i.label.toLowerCase().includes(term));
  const actions = ACTIONS.filter((a) => a.label.toLowerCase().includes(term));
  const row = (i) => `<div class="palette-item" data-run="${i.label}" ${i.go ? `data-go="${i.go}"` : ""} ${i.route ? `data-go="${i.route}"` : ""} ${i.run ? "data-act" : ""}>
      ${icon(i.icon, { size: 16 })}<span>${i.label}</span>
      ${i.route ? `<span class="kbd">↵</span>` : ""}
    </div>`;
  return `${pages.length ? `<div class="palette-group">Navigate</div>${pages.map(row).join("")}` : ""}
    ${actions.length ? `<div class="palette-group">Actions</div>${actions.map(row).join("")}` : ""}
    ${!pages.length && !actions.length ? `<div class="palette-group">No results</div><div class="palette-item">Try “risk”, “backtest” or “export”</div>` : ""}`;
}

function openPalette() {
  if (state.paletteOpen) return;
  state.paletteOpen = true;
  const wrap = document.createElement("div");
  wrap.className = "palette-wrap";
  wrap.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="palette-input">${icon("search", { size: 17 })}
      <input id="pq" placeholder="Search pages, positions, actions…" autocomplete="off" aria-label="Search" />
      <span class="kbd">ESC</span>
    </div>
    <div class="palette-list" id="pl">${paletteMarkup("")}</div>
    <div class="palette-foot"><span><b>↑↓</b> navigate</span><span><b>↵</b> open</span><span class="grow"></span><span>${icon("command", { size: 12 })} K</span></div>
  </div>`;
  overlays.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("open"));
  const input = wrap.querySelector("#pq");
  const list = wrap.querySelector("#pl");
  input.focus();

  const close = () => {
    state.paletteOpen = false;
    wrap.classList.remove("open");
    setTimeout(() => wrap.remove(), 200);
  };
  const select = (el) => {
    if (!el) return;
    close();
    if (el.dataset.go) location.hash = el.dataset.go;
    else {
      const act = ACTIONS.find((a) => a.label === el.dataset.run);
      act?.run?.();
    }
  };
  input.addEventListener("input", () => {
    list.innerHTML = paletteMarkup(input.value);
    if (list.firstElementChild && !list.querySelector("[aria-selected]")) {
      const first = list.querySelector(".palette-item");
      first?.setAttribute("aria-selected", "true");
    }
  });
  list.addEventListener("mousemove", (e) => {
    const item = e.target.closest(".palette-item");
    if (!item) return;
    list.querySelectorAll(".palette-item").forEach((n) => n.removeAttribute("aria-selected"));
    item.setAttribute("aria-selected", "true");
  });
  list.addEventListener("click", (e) => select(e.target.closest(".palette-item")));
  input.addEventListener("keydown", (e) => {
    const items = [...list.querySelectorAll(".palette-item")];
    const idx = items.findIndex((n) => n.getAttribute("aria-selected") === "true");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
      items.forEach((n) => n.removeAttribute("aria-selected"));
      items[next]?.setAttribute("aria-selected", "true");
      items[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(items[Math.max(0, idx)]);
    } else if (e.key === "Escape") close();
  });
  wrap.addEventListener("click", (e) => e.target === wrap && close());
}

/* ---------- theme / density ---------- */
export function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem("at.theme", state.theme);
  document.getElementById("theme-btn")?.classList.toggle("on", state.theme === "light");
  toast({ title: state.theme === "light" ? "Light theme" : "Dark theme", desc: "Preference saved for this workspace.", iconName: "sun" });
}
export function toggleDensity() {
  state.density = state.density === "comfortable" ? "compact" : "comfortable";
  document.documentElement.dataset.density = state.density;
  localStorage.setItem("at.density", state.density);
  toast({ title: `Density: ${state.density}`, desc: "Tables and lists adapt instantly.", iconName: "sliders" });
}
export function toggleRail() {
  state.rail = state.rail === "expanded" ? "collapsed" : "expanded";
  document.querySelector(".app")?.setAttribute("data-rail", state.rail);
  localStorage.setItem("at.rail", state.rail);
}

/* ---------- shell ---------- */
function rail(current) {
  return `<aside class="rail" aria-label="Primary">
    <div class="rail-brand">
      <span class="rail-logo">${icon("activity", { size: 18, stroke: 2.2 })}</span>
      <span class="rail-word">Auto Trader<small>Meridian</small></span>
    </div>
    <button class="rail-workspace">
      <span class="ws-badge">AT</span>
      <span class="ws-meta"><span class="ws-name">Paper workspace</span><span class="ws-plan">Pro plan · BSC</span></span>
      <span class="chev">${icon("chevronDown", { size: 14 })}</span>
    </button>
    <nav class="rail-nav">
      ${NAV.map(
        (g) => `<div class="rail-group">${g.group}</div>
        ${g.items
          .map(
            (i) => `<a class="nav-item" href="${i.route}" ${current === i.id ? 'aria-current="page"' : ""} data-nav-item="${i.id}">
            ${icon(i.icon, { size: 17 })}
            <span class="nav-label">${i.label}</span>
            ${i.count ? `<span class="nav-count">${i.count}</span>` : ""}
          </a>`
          )
          .join("")}`
      ).join("")}
    </nav>
    <div class="rail-foot">
      <div class="rail-mode"><span class="dot warn"></span><span>Paper mode · no capital</span></div>
      <a class="rail-user" href="#/settings">
        <span class="asset-ico" style="width:28px;height:28px;border-radius:50%;background:linear-gradient(145deg,#5B6CFF,#35D6E8);font-size:11px">AD</span>
        <span class="u-meta"><span class="u-name">Alex Duarte</span><span class="u-role">super admin</span></span>
      </a>
      <button class="rail-collapse" data-rail-toggle aria-label="Collapse navigation">${icon("panel", { size: 15 })}<span>Collapse</span></button>
    </div>
  </aside>`;
}

function topbar(page) {
  const crumb = page.crumb || ["Operate", "Overview"];
  return `<header class="topbar">
    <button class="icon-btn menu-btn" data-menu aria-label="Open navigation">${icon("menu", { size: 17 })}</button>
    <div class="crumbs"><span>${crumb[0]}</span><span class="sep">${icon("chevronRight", { size: 12 })}</span><b>${crumb[1] || page.title}</b></div>
    <button class="topbar-search" data-palette aria-label="Search (Command K)">
      ${icon("search", { size: 16 })}<span>Search</span><span class="kbd">⌘K</span>
    </button>
    <div class="topbar-actions">
      <div class="mode-switch" role="group" aria-label="Trading mode">
        <button aria-pressed="true">${icon("dot", { size: 10 })} Paper</button>
        <button disabled title="Unlocks after 50 positive cycles">${icon("dot", { size: 10 })} Live</button>
      </div>
      <span class="engine-pill"><span class="dot pos live"></span><b data-engine-state>Running</b><span class="sep hide-sm">·</span><span class="hide-sm">round 4,128</span></span>
      <button class="icon-btn" data-nav="#/alerts" aria-label="Notifications">${icon("bell", { size: 17 })}<span class="ping"></span></button>
      <button class="icon-btn" id="theme-btn" data-theme-toggle aria-label="Toggle theme">${icon("sun", { size: 17 })}</button>
      <button class="icon-btn" data-tip="Alex Duarte · super admin" aria-label="Account" style="margin-left:2px">
        <span class="asset-ico" style="width:26px;height:26px;border-radius:50%;background:linear-gradient(145deg,#5B6CFF,#35D6E8);font-size:10px">AD</span>
      </button>
    </div>
  </header>`;
}

function telemetry() {
  return `<footer class="telemetry" aria-label="System telemetry">
    <span class="t-item"><span class="dot pos"></span>Engine <b>running</b></span>
    <span class="t-item hide-sm">RPC <b>20ms</b> · quorum 100%</span>
    <span class="t-item hide-sm">Signer <b>paper</b></span>
    <span class="t-item hide-sm">DB <b>ok</b> · 1.5M rows</span>
    <span class="t-item hide-sm">Block <b>44,182,904</b></span>
    <span class="t-item">BSC mainnet</span>
    <span class="spacer"></span>
    <span class="t-item hide-sm">v1.0.0 · meridian</span>
    <button class="t-toggle t-item" data-tip="Open system status">${icon("activity", { size: 13 })} Status</button>
  </footer>`;
}

/* ---------- router ---------- */
function parse() {
  const raw = (location.hash || "#/overview").replace(/^#\/?/, "");
  const [path, ...rest] = raw.split("/");
  return { path: path || "overview", param: rest[0] || null };
}

function render() {
  const { path, param } = parse();
  const key = path in routes ? path : "notfound";
  const page = routes[key];
  const isPublic = PUBLIC.has(key);

  if (isPublic) {
    document.body.classList.add("is-public");
    app.innerHTML = page.html(param);
  } else {
    document.body.classList.remove("is-public");
    app.innerHTML = `<div class="app" data-rail="${state.rail}">
      ${rail(key)}
      <div class="main">
        ${topbar(page)}
        <main id="content" class="content" tabindex="-1">${page.html(param)}</main>
        ${telemetry()}
      </div>
    </div>`;
  }

  document.title = `${page.title} · Auto Trader`;
  page.mount?.(app, param);
  bindCommon();
  if (!isPublic) app.querySelector("#content")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function bindCommon() {
  app.querySelectorAll("[data-nav]").forEach((n) =>
    n.addEventListener("click", () => (location.hash = n.dataset.nav))
  );
  app.querySelectorAll(".icon-btn").forEach((n) => {
    if (!n.getAttribute("aria-label")) n.setAttribute("aria-label", n.dataset.tip || "Action");
  });
  app.querySelectorAll(".table-wrap").forEach((n) => {
    if (!n.hasAttribute("tabindex")) n.tabIndex = 0;
    if (!n.getAttribute("aria-label")) {
      const t = n.closest(".card")?.querySelector(".card-title")?.textContent?.trim();
      n.setAttribute("aria-label", t ? `${t} table` : "Data table");
    }
  });
  app.querySelectorAll("[data-palette]").forEach((n) => n.addEventListener("click", openPalette));
  app.querySelectorAll("[data-menu]").forEach((n) =>
    n.addEventListener("click", () => {
      const shell = document.querySelector(".app");
      shell?.setAttribute("data-rail", shell.getAttribute("data-rail") === "open" ? "collapsed" : "open");
    })
  );
  app.querySelectorAll("[data-rail-toggle]").forEach((n) => n.addEventListener("click", toggleRail));
  app.querySelectorAll("[data-theme-toggle]").forEach((n) => n.addEventListener("click", toggleTheme));
  app.querySelectorAll("[data-action='pause-engine']").forEach((n) =>
    n.addEventListener("click", () => {
      toast({ title: "Engine paused", desc: "Open positions keep their managed exits. Resume whenever you want.", tone: "warn", iconName: "pause" });
      n.innerHTML = `${icon("play", { size: 15 })} Resume engine`;
    })
  );
  app.querySelectorAll("[data-action='export']").forEach((n) =>
    n.addEventListener("click", () => toast({ title: "Export started", desc: "We will email you when the file is ready.", iconName: "download" }))
  );
  app.querySelectorAll("[data-action='mute']").forEach((n) =>
    n.addEventListener("click", () => toast({ title: "Muted for 1 hour", desc: "Only critical alerts will break through.", tone: "warn", iconName: "bell" }))
  );
}

window.addEventListener("hashchange", render);
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
  }
  if (e.key === "Escape") {
    closeDrawer();
    overlays.querySelectorAll(".palette-wrap, .modal-wrap").forEach((n) => n.remove());
    state.paletteOpen = false;
  }
});

document.documentElement.dataset.theme = state.theme;
document.documentElement.dataset.density = state.density;

if (!location.hash) location.hash = "#/overview";
render();

/* expose for page modules */
window.__at = { toast, openDrawer, closeDrawer, openModal, openKillSwitch, openPalette };
