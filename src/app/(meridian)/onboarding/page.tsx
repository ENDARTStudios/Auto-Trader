import type { Metadata } from "next";
import { OnboardingView } from "@/components/meridian/onboarding-view";

export const metadata: Metadata = { title: "Primeiros passos · Auto Trader" };

export default function OnboardingPage() {
  return <OnboardingView />;
}
