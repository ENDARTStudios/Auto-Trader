import type { Metadata } from "next";
import { MarketsView } from "@/components/meridian/markets-view";

export const metadata: Metadata = {
  title: "Markets · Auto Trader",
};

export default function MarketsPage() {
  return <MarketsView />;
}
