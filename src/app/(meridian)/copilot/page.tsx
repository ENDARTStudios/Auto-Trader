import type { Metadata } from "next";
import { CopilotView } from "@/components/meridian/copilot-view";
export const metadata: Metadata = { title: "AI Copilot · Auto Trader" };
export default function CopilotPage() { return <CopilotView />; }
