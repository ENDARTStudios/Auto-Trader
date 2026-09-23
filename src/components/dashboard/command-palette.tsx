"use client";

import { useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Coins,
  FlaskConical,
  History,
  LineChart,
  LogOut,
  Play,
  Server,
  Square,
} from "lucide-react";
import { hasPermission, type Permission, type Role } from "@/lib/auth/rbac";
import { useTranslation } from "@/lib/i18n/hooks";
import {
  useMarketData,
  useWatchlist,
  type WatchlistToken,
  type MarketSnapshotRow,
} from "@/hooks/use-trading-data";
import { filterActions, filterCommands, filterSymbols, type PaletteEntry } from "./command-palette-utils";

export type ExplorerTab =
  | "history"
  | "rounds"
  | "site"
  | "platforms"
  | "backtest"
  | "analytics"
  | "notifications"
  | "system";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: ExplorerTab;
  onNavigate: (tab: ExplorerTab) => void;
  role: string | null;
  onStart: () => void;
  onStop: () => void;
  onKill: () => void;
  onLogout: () => void;
}

const NAV_ITEMS: { id: ExplorerTab; labelKey: string; icon: React.ReactNode }[] = [
  { id: "history", labelKey: "palette.nav.history", icon: <History className="size-4" /> },
  { id: "rounds", labelKey: "palette.nav.rounds", icon: <Coins className="size-4" /> },
  { id: "site", labelKey: "palette.nav.site", icon: <BarChart3 className="size-4" /> },
  { id: "platforms", labelKey: "palette.nav.platforms", icon: <Building2 className="size-4" /> },
  { id: "backtest", labelKey: "palette.nav.backtest", icon: <FlaskConical className="size-4" /> },
  { id: "analytics", labelKey: "palette.nav.analytics", icon: <LineChart className="size-4" /> },
  { id: "notifications", labelKey: "palette.nav.notifications", icon: <Bell className="size-4" /> },
  { id: "system", labelKey: "palette.nav.system", icon: <Server className="size-4" /> },
];

function can(role: string | null, perm: Permission): boolean {
  if (!role) return false;
  return hasPermission(role as Role, perm);
}

// T052: pure, unit-testable RBAC gate for privileged palette actions.
// Client-side hiding only — server routes still enforce permissions.
export type PaletteActionId = "start" | "stop" | "kill" | "logout";

export function getAvailableActionIds(role: string | null): PaletteActionId[] {
  const ids: PaletteActionId[] = [];
  if (can(role, "engine:control")) ids.push("start", "stop");
  if (can(role, "engine:kill")) ids.push("kill");
  ids.push("logout");
  return ids;
}

export function CommandPalette({
  open,
  onOpenChange,
  activeTab,
  onNavigate,
  role,
  onStart,
  onStop,
  onKill,
  onLogout,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const watchlist = useWatchlist();
  const market = useMarketData(30);
  const [query, setQuery] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (next) setQuery("");
    onOpenChange(next);
  };

  const actionMeta: Record<PaletteActionId, { labelKey: string; keywords: string[] }> = {
    start: { labelKey: "palette.action.start", keywords: ["start", "play", "iniciar"] },
    stop: { labelKey: "palette.action.stop", keywords: ["stop", "pause", "parar"] },
    kill: { labelKey: "palette.action.kill", keywords: ["kill", "emergency", "emergencia"] },
    logout: { labelKey: "palette.action.logout", keywords: ["logout", "sair", "exit"] },
  };

  const actions: PaletteEntry[] = getAvailableActionIds(role).map((id) => ({
    id,
    label: t(actionMeta[id].labelKey),
    keywords: actionMeta[id].keywords,
  }));

  const navEntries: PaletteEntry[] = NAV_ITEMS.map((n) => ({
    id: n.id,
    label: t(n.labelKey),
    keywords: [n.id],
  }));

  const symbolEntries: PaletteEntry[] = [
    ...(watchlist.data ?? []).map((w: WatchlistToken) => ({
      id: `wl-${w.symbol}`,
      label: w.symbol,
      detail: w.source,
      keywords: [w.chain ?? "", w.tokenId ?? ""],
    })),
    ...(market.data?.snapshots ?? []).map((s: MarketSnapshotRow) => ({
      id: `mkt-${s.symbol}-${s.id}`,
      label: s.symbol,
      detail: s.source,
      keywords: [s.chain ?? ""],
    })),
  ];

  const runAction = (id: string) => {
    handleOpenChange(false);
    if (id === "start") onStart();
    else if (id === "stop") onStop();
    else if (id === "kill") onKill();
    else if (id === "logout") onLogout();
  };

  const navigate = (tab: ExplorerTab) => {
    handleOpenChange(false);
    onNavigate(tab);
  };

  const filteredNav = filterCommands(navEntries, query);
  const filteredActions = filterActions(actions, query);
  const filteredSymbols = filterSymbols(symbolEntries, query);

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("palette.title")}
      description={t("palette.description")}
    >
      <CommandInput
        placeholder={t("palette.placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>

        {filteredNav.length > 0 && (
          <CommandGroup heading={t("palette.group.navigate")}>
            {filteredNav.map((entry) => (
              <CommandItem
                key={entry.id}
                value={`nav-${entry.id}`}
                onSelect={() => navigate(entry.id as ExplorerTab)}
                data-testid={`palette-nav-${entry.id}`}
              >
                {NAV_ITEMS.find((n) => n.id === entry.id)?.icon}
                <span>{entry.label}</span>
                {entry.id === activeTab && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {t("palette.active")}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {filteredActions.length > 0 && (
          <CommandGroup heading={t("palette.group.actions")}>
            {filteredActions.map((entry) => (
              <CommandItem
                key={entry.id}
                value={`act-${entry.id}`}
                onSelect={() => runAction(entry.id)}
                data-testid={`palette-action-${entry.id}`}
              >
                {entry.id === "start" && <Play className="size-4" />}
                {entry.id === "stop" && <Square className="size-4" />}
                {entry.id === "kill" && <Bell className="size-4" />}
                {entry.id === "logout" && <LogOut className="size-4" />}
                <span>{entry.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {filteredSymbols.length > 0 && (
          <CommandGroup heading={t("palette.group.symbols")}>
            {filteredSymbols.map((entry) => (
              <CommandItem
                key={entry.id}
                value={`sym-${entry.id}`}
                onSelect={() => handleOpenChange(false)}
                data-testid={`palette-symbol-${entry.id}`}
              >
                <Activity className="size-4" />
                <span className="font-mono">{entry.label}</span>
                {entry.detail && (
                  <span className="ml-auto text-[10px] text-muted-foreground uppercase">
                    {entry.detail}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
