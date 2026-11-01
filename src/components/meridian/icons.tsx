"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CandlestickChart,
  CreditCard,
  Database,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  PanelLeft,
  Play,
  Power,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  markets: CandlestickChart,
  portfolio: Wallet,
  strategy: Play,
  backtest: FlaskConical,
  analytics: LineChart,
  journal: BookOpen,
  risk: ShieldCheck,
  copilot: Sparkles,
  alerts: Bell,
  data: Database,
  settings: Settings,
  billing: CreditCard,
  admin: Users,
  power: Power,
  search: Search,
  sun: Sun,
  panel: PanelLeft,
  activity: Activity,
  up: ArrowUpRight,
  down: ArrowDownRight,
};

export function Icon({ name, size = 17, className }: { name: string; size?: number; className?: string }) {
  const Cmp = ICONS[name] ?? Activity;
  return <Cmp size={size} strokeWidth={1.75} className={className} aria-hidden="true" />;
}
