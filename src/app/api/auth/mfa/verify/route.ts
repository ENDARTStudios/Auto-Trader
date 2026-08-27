import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth/session';
import { handleApiError } from '@/lib/api/error-handler';
import { verify } from '@/lib/auth/totp';
import { checkRateLimit } from '@/lib/rate-limit';

const schema = z.object({ token: z.string().regex(/^\d{6}$/) });

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/auth/mfa/verify');
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.flatten() }, { status: 400 });
    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user?.mfaSecret) return NextResponse.json({ error: 'mfa not setup' }, { status: 400 });
    if (!verify(parsed.data.token, user.mfaSecret)) {
      return NextResponse.json({ error: 'invalid token' }, { status: 401 });
    }
    await db.user.update({ where: { id: session.userId }, data: { mfaEnabled: true } });
    return NextResponse.json({ ok: true, enabled: true });
  } catch (err) {
    return handleApiError(err, 'POST /api/auth/mfa/verify');
  }
}
