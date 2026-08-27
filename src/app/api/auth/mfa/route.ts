import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { handleApiError } from '@/lib/api/error-handler';
import { checkRateLimit } from '@/lib/rate-limit';

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

export const dynamic = 'force-dynamic';

// DELETE /api/auth/mfa — disable MFA
export async function DELETE(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/auth/mfa');
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    await db.user.update({ where: { id: session.userId }, data: { mfaEnabled: false, mfaSecret: null } });
    return NextResponse.json({ ok: true, enabled: false });
  } catch (err) {
    return handleApiError(err, 'DELETE /api/auth/mfa');
  }
}

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    const user = await db.user.findUnique({ where: { id: session.userId }, select: { mfaEnabled: true } });
    return NextResponse.json({ enabled: !!user?.mfaEnabled });
  } catch (err) {
    return handleApiError(err, 'GET /api/auth/mfa');
  }
}
