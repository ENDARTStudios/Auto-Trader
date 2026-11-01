import type { Metadata } from "next";
import { PortfolioView } from "@/components/meridian/portfolio-view";

export const metadata: Metadata = {
  title: "Portfolio · Auto Trader",
};

export default function PortfolioPage() {
  return <PortfolioView />;
}
