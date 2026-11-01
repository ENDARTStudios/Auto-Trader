import type { Metadata } from "next";
import { StrategyView } from "@/components/meridian/strategy-view";

export const metadata: Metadata = { title: "Strategy & engine · Auto Trader" };

export default function StrategyPage() {
  return <StrategyView />;
}
