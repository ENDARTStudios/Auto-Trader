import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { generateToken, hashToken } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/api/error-handler';

const schema = z.object({ email: z.string().email() });

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/auth/forgot');
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.flatten() }, { status: 400 });

    const user = await db.user.findUnique({ where: { email: parsed.data.email } });
    // Always return ok to avoid email enumeration
    if (!user) return NextResponse.json({ ok: true });

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await db.passwordReset.create({ data: { userId: user.id, tokenHash, expiresAt } });

    // Mock email — log to console and to AppLog
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/reset?token=${token}`;
    console.log(`[mock email] Password reset for ${user.email}: ${resetUrl}`);
    // In production, send via nodemailer / resend / etc.

    // For dev, return token in response when not production (helps E2E)
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({ ok: true, token, resetUrl });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, 'POST /api/auth/forgot');
  }
}
