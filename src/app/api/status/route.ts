import { NextResponse } from "next/server";
import { getEngineSnapshot } from "@/lib/trading/engine";

export async function GET() {
  const snapshot = await getEngineSnapshot();
  return NextResponse.json(snapshot);
}
