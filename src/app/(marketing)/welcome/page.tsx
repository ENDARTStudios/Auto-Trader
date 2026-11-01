import type { Metadata } from "next";
import "../../(meridian)/meridian-tokens.css";
import "../../(meridian)/meridian.css";
import { Landing } from "@/components/marketing/landing";

export const metadata: Metadata = {
  title: "Auto Trader · Meridian",
  description:
    "Motor de trading multi-ativo com risco humano no comando, journal exportável e paper trading antes de capital real.",
};

export default function WelcomePage() {
  return <Landing />;
}
