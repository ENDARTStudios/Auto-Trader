import type { Metadata } from "next";
import { AdminView } from "@/components/meridian/admin-view";

export const metadata: Metadata = { title: "Users & audit · Auto Trader" };

export default function Page() {
  return <AdminView />;
}
