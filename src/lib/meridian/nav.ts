export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: "overview" | "markets" | "portfolio" | "strategy" | "backtest" | "analytics" | "journal" | "risk" | "copilot" | "alerts" | "data" | "settings" | "billing" | "admin";
  count?: number;
  soon?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Fase 1 do plano (design/docs/05-IMPLEMENTATION.md): apenas Overview está
 * implementado. Os demais itens aparecem desabilitados com "soon" em vez de
 * levar a uma rota 404 — navegação quebrada é pior que navegação incompleta.
 */
export const NAV: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { id: "overview", label: "Overview", href: "/overview", icon: "overview" },
      { id: "markets", label: "Markets", href: "/markets", icon: "markets" },
      { id: "portfolio", label: "Portfolio", href: "/portfolio", icon: "portfolio" },
      { id: "strategy", label: "Strategy & engine", href: "/strategy", icon: "strategy" },
      { id: "backtest", label: "Backtest", href: "/backtest", icon: "backtest" },
      { id: "analytics", label: "Analytics", href: "/analytics", icon: "analytics" },
      { id: "journal", label: "Journal", href: "/journal", icon: "journal" },
    ],
  },
  {
    label: "Guard",
    items: [
      { id: "risk", label: "Risk & safety", href: "/risk", icon: "risk", count: 0 },
      { id: "copilot", label: "AI Copilot", href: "/copilot", icon: "copilot" },
    ],
  },
  {
    label: "System",
    items: [
      { id: "alerts", label: "Alerts", href: "/alerts", icon: "alerts", count: 0, },
      { id: "data", label: "Data & sources", href: "/data", icon: "data", },
      { id: "settings", label: "Settings", href: "/settings", icon: "settings", },
      { id: "billing", label: "Billing", href: "/billing", icon: "billing", },
    ],
  },
  {
    label: "Admin",
    items: [{ id: "admin", label: "Users & audit", href: "/admin", icon: "admin", }],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);

/** Rotas já migradas para o shell Meridian (o chrome legado se esconde nelas). */
export const MERIDIAN_ROUTES = ["/overview", "/markets", "/portfolio", "/strategy", "/risk", "/analytics", "/journal", "/backtest", "/copilot", "/alerts", "/data", "/settings", "/billing", "/admin", "/positions", "/onboarding"];

export function isMeridianPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return MERIDIAN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/** Rotas sem o chrome legado (shell Meridian OU página pública nova). */
export function isChromelessPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return isMeridianPath(pathname) || ["/welcome", "/login", "/pricing", "/signup", "/forgot", "/reset"].includes(pathname);
}
