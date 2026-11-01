import type { Metadata } from "next";
import { RiskView } from "@/components/meridian/risk-view";

export const metadata: Metadata = { title: "Risk & safety · Auto Trader" };

export default function RiskPage() {
  return <RiskView />;
}
