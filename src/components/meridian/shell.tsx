"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NAV } from "@/lib/meridian/nav";
import { clockUtc, duration } from "@/lib/meridian/format";
import { apiGet, type RuntimeStatus } from "./api";
import { Icon } from "./icons";
import { Dot } from "./ui";

interface ShellProps {
  user: { email: string; role: string };
  children: React.ReactNode;
}

const initials = (email: string) =>
  email
    .split("@")[0]
    .split(/[._-]/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "AT";

export function Shell({ user, children }: ShellProps) {
  const pathname = usePathname();
  const [rail, setRail] = useState<"expanded" | "collapsed">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("mrd.rail") === "collapsed" ? "collapsed" : "expanded"
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("mrd.theme") === "light" ? "light" : "dark"
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [clock, setClock] = useState<string>(() => clockUtc());

  const status = useQuery<RuntimeStatus>({
    queryKey: ["mrd", "status"],
    queryFn: () => apiGet<RuntimeStatus>("/api/runtime/status"),
    refetchInterval: 15_000,
    retry: 1,
  });


  useEffect(() => {
    const id = window.setInterval(() => setClock(clockUtc()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setRailPersisted = useCallback((next: "expanded" | "collapsed") => {
    setRail(next);
    window.localStorage.setItem("mrd.rail", next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      window.localStorage.setItem("mrd.theme", next);
      return next;
    });
  }, []);

  const runtime = status.data?.runtime ?? (status.isLoading ? "…" : "STOPPED");
  const running = runtime === "RUNNING";
  const currentLabel =
    pathname.startsWith("/overview") ? "Overview" : pathname.replace("/", "").replace("-", " ") || "Overview";

  const groups = useMemo(() => NAV, []);

  return (
    <div className="mrd" data-theme={theme} suppressHydrationWarning>
      <div className="mrd-shell" data-rail={mobileOpen ? "open" : rail}>
        <aside className="mrd-rail" aria-label="Primary">
          <div className="mrd-brand">
            <span className="mrd-logo" aria-hidden="true">
              <Icon name="activity" size={18} />
            </span>
            <span className="mrd-word">
              Auto Trader<small>Meridian</small>
            </span>
          </div>

          <button className="mrd-ws" type="button" aria-label="Workspace: paper, Pro plan">
            <span className="mrd-ws-badge">AT</span>
            <span className="mrd-ws-meta">
              <span className="mrd-ws-name">Paper workspace</span>
              <span className="mrd-ws-plan">Pro plan · BSC</span>
            </span>
          </button>

          <nav className="mrd-nav">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="mrd-nav-group">{group.label}</div>
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  if (item.soon) {
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="mrd-nav-item"
                        data-soon="true"
                        aria-disabled="true"
                        title={`${item.label} — arrive na fase 1 do plano`}
                      >
                        <Icon name={item.icon} />
                        <span className="mrd-nav-label">{item.label}</span>
                        <span className="mrd-nav-count">soon</span>
                      </button>
                    );
                  }
                  return (
                    <Link key={item.id} href={item.href} className="mrd-nav-item" aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)}>
                      <Icon name={item.icon} />
                      <span className="mrd-nav-label">{item.label}</span>
                      {item.count ? <span className="mrd-nav-count">{item.count}</span> : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="mrd-foot">
            <div className="mrd-mode">
              <Dot tone="warn" />
              <span>Paper mode · no capital</span>
            </div>
            <div className="mrd-user">
              <span
                className="mrd-asset-ico"
                style={{ width: 28, height: 28, fontSize: 11, background: "linear-gradient(145deg,#5B6CFF,#35D6E8)" }}
                aria-hidden="true"
              >
                {initials(user.email)}
              </span>
              <span className="mrd-user-meta">
                <span className="mrd-user-name">{user.email}</span>
                <span className="mrd-user-role">{user.role.replace("_", " ")}</span>
              </span>
            </div>
            <button
              type="button"
              className="mrd-collapse"
              onClick={() => setRailPersisted(rail === "expanded" ? "collapsed" : "expanded")}
              aria-label={rail === "expanded" ? "Collapse navigation" : "Expand navigation"}
            >
              <Icon name="panel" size={15} />
              <span>Collapse</span>
            </button>
          </div>
        </aside>

        <div className="mrd-main">
          <header className="mrd-topbar">
            <button
              type="button"
              className="mrd-icon-btn mrd-menu-btn"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Open navigation"
            >
              <Icon name="panel" />
            </button>
            <div className="mrd-crumbs">
              <span>Operate</span>
              <span aria-hidden="true">›</span>
              <b>{currentLabel}</b>
            </div>
            <button type="button" className="mrd-search" onClick={() => setPaletteOpen(true)} aria-label="Search (Command K)">
              <Icon name="search" size={16} />
              <span>Search</span>
              <span className="mrd-kbd">⌘K</span>
            </button>
            <div className="mrd-top-actions">
              <div className="mrd-mode-switch" role="group" aria-label="Trading mode">
                <button type="button" aria-pressed="true">
                  <Dot /> Paper
                </button>
                <button type="button" disabled title="Unlocks after 50 positive cycles">
                  <Dot /> Live
                </button>
              </div>
              <span className="mrd-engine">
                <Dot tone={running ? "pos" : status.data ? "warn" : "neutral"} live={running} />
                <b>{running ? "Running" : runtime === "…" ? "…" : "Stopped"}</b>
                <span className="sep hide-sm">·</span>
                <span className="hide-sm">
                  {status.data ? `${status.data.rounds.ok.toLocaleString("en-US")} ok` : "no runtime"}
                </span>
              </span>
              <button type="button" className="mrd-icon-btn" aria-label="Notifications" title="Alerts arrive in phase 1">
                <Icon name="alerts" />
                <span className="mrd-ping" />
              </button>
              <button type="button" className="mrd-icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
                <Icon name="sun" />
              </button>
              <span
                className="mrd-asset-ico"
                style={{ width: 28, height: 28, fontSize: 10, marginLeft: 2, background: "linear-gradient(145deg,#5B6CFF,#35D6E8)" }}
                aria-hidden="true"
              >
                {initials(user.email)}
              </span>
            </div>
          </header>

          <main className="mrd-content" id="content">
            {children}
          </main>

          <footer className="mrd-telemetry" aria-label="System telemetry">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Dot tone={running ? "pos" : "warn"} />Engine <b>{running ? "running" : "stopped"}</b>
            </span>
            <span className="hide-sm">
              RPC <b>{status.data ? (status.data.rpc.unhealthy > 0 ? "degraded" : "quorum ok") : "—"}</b>
            </span>
            <span className="hide-sm">
              Signer <b>paper</b>
            </span>
            <span className="hide-sm">
              Uptime <b>{status.data ? duration(status.data.uptime * 1000) : "—"}</b>
            </span>
            <span>BSC mainnet</span>
            <span className="spacer" />
            <span className="hide-sm">v1.0.0 · meridian</span>
            <span>{clock} UTC</span>
          </footer>
        </div>
      </div>

      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onToggleTheme={toggleTheme}
        />
      ) : null}
    </div>
  );
}

function CommandPalette({ onClose, onToggleTheme }: { onClose: () => void; onToggleTheme: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo(() => {
    const nav = NAV.flatMap((g) =>
      g.items
        .filter((i) => !i.soon)
        .map((i) => ({ id: i.id, label: i.label, href: i.href, icon: i.icon, group: "Navigate" }))
    );
    const actions = [
      { id: "theme", label: "Toggle theme", href: null, icon: "sun", group: "Actions" },
      { id: "copy", label: "Copy current view link", href: null, icon: "activity", group: "Actions" },
    ];
    const term = query.trim().toLowerCase();
    return [...nav, ...actions].filter((i) => i.label.toLowerCase().includes(term));
  }, [query]);

  const run = (item: { id: string; href: string | null }) => {
    if (item.href) {
      window.location.assign(item.href);
    } else if (item.id === "theme") {
      onToggleTheme();
    } else if (item.id === "copy") {
      void navigator.clipboard?.writeText(window.location.href);
    }
    onClose();
  };

  return (
    <div
      className="mrd-palette-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mrd-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="mrd-palette-input">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="Search pages and actions…"
            aria-label="Search"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && items[index]) {
                e.preventDefault();
                run(items[index]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
          />
          <span className="mrd-kbd">ESC</span>
        </div>
        <div className="mrd-palette-list" role="listbox" aria-label="Results">
          {items.length === 0 ? <div className="mrd-palette-group">No results</div> : null}
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="option"
              className="mrd-palette-item"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(item)}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
