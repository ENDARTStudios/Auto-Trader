import type { Metadata } from "next";
import { SettingsView } from "@/components/meridian/settings-view";

export const metadata: Metadata = { title: "Settings · Auto Trader" };

export default function Page() {
  return <SettingsView />;
}
