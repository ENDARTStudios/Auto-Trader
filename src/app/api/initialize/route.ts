// Initialize database singletons on first request.
import { NextResponse } from "next/server";
import { ensureInitialized } from "@/lib/trading/portfolio";

export async function POST() {
  await ensureInitialized();
  return NextResponse.json({ ok: true });
}
