import type { Metadata } from "next";
import { OverviewView } from "@/components/meridian/overview-view";

export const metadata: Metadata = {
  title: "Mission control · Auto Trader",
};

export default function OverviewPage() {
  return <OverviewView />;
}
