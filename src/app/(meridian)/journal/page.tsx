import type { Metadata } from "next";
import { JournalView } from "@/components/meridian/journal-view";

export const metadata: Metadata = { title: "Journal · Auto Trader" };

export default function JournalPage() {
  return <JournalView />;
}
