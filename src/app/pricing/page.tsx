import type { Metadata } from "next";
import "../(meridian)/meridian-tokens.css";
import "../(meridian)/meridian.css";
import { Pricing } from "@/components/marketing/pricing";

export const metadata: Metadata = {
  title: "Planos · Auto Trader",
  description: "Paper trading gratuito e ilimitado. Planos liberam infraestrutura, nunca limites de risco.",
};

export default function PricingPage() {
  return <Pricing />;
}
