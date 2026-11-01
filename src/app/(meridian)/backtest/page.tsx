import type { Metadata } from "next";
import { BacktestView } from "@/components/meridian/backtest-view";
export const metadata: Metadata = { title: "Backtest · Auto Trader" };
export default function BacktestPage() { return <BacktestView />; }
