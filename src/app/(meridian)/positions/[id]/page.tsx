import type { Metadata } from "next";
import { PositionDetailView } from "@/components/meridian/position-detail-view";

export const metadata: Metadata = { title: "Posição · Auto Trader" };

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PositionDetailView id={id} />;
}
