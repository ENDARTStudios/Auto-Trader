import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { handleApiError } from '@/lib/api/error-handler';
import { generateSecret, otpauthUrl } from '@/lib/auth/totp';
import { checkRateLimit } from '@/lib/rate-limit';

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/auth/mfa/setup');
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    const secret = generateSecret();
    const url = otpauthUrl(secret, session.email);
    await db.user.update({ where: { id: session.userId }, data: { mfaSecret: secret, mfaEnabled: false } });
    return NextResponse.json({ secret, otpauthUrl: url });
  } catch (err) {
    return handleApiError(err, 'POST /api/auth/mfa/setup');
  }
}
