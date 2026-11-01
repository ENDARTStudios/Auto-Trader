import type { Metadata } from "next";
import { AlertsView } from "@/components/meridian/alerts-view";

export const metadata: Metadata = { title: "Alerts · Auto Trader" };

export default function Page() {
  return <AlertsView />;
}
