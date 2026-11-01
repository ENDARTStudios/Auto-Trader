import type { Metadata } from "next";
import { AnalyticsView } from "@/components/meridian/analytics-view";

export const metadata: Metadata = { title: "Analytics · Auto Trader" };

export default function AnalyticsPage() {
  return <AnalyticsView />;
}
