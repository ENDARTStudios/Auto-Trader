import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { hashToken } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { checkRateLimit } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/api/error-handler';

const schema = z.object({ token: z.string().min(1), newPassword: z.string().min(8) });

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/auth/reset');
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.flatten() }, { status: 400 });

    const tokenHash = hashToken(parsed.data.token);
    const reset = await db.passwordReset.findUnique({ where: { tokenHash } });
    if (!reset || reset.used || reset.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: 'invalid or expired token' }, { status: 400 });
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await db.$transaction([
      db.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      db.passwordReset.update({ where: { id: reset.id }, data: { used: true } }),
      // Invalidate all sessions for this user (force re-login)
      db.session.deleteMany({ where: { userId: reset.userId } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, 'POST /api/auth/reset');
  }
}
