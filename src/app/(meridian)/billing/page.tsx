import type { Metadata } from "next";
import { BillingView } from "@/components/meridian/billing-view";

export const metadata: Metadata = { title: "Billing · Auto Trader" };

export default function Page() {
  return <BillingView />;
}
