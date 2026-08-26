import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Liveness probe — no details, no auth, rate-limited via middleware
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
}
