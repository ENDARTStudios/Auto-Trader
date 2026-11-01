import type { Metadata } from "next";
import { DataView } from "@/components/meridian/data-view";

export const metadata: Metadata = { title: "Data & sources · Auto Trader" };

export default function Page() {
  return <DataView />;
}
