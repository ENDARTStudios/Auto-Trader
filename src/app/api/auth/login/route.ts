import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { generateToken, hashToken, createSessionCookie } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/api/error-handler';
import { appendAuditLog } from '@/lib/auth/audit';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = (req.headers as unknown as Headers).get?.('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/auth/login');
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
      );
    }

    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'validation_error', details: parsed.error.flatten() }, { status: 400 });
    }
    const { email, password } = parsed.data;

    const user = await db.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.session.create({
      data: { userId: user.id, tokenHash, expiresAt, ip, userAgent: req.headers.get('user-agent') ?? null },
    });

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await appendAuditLog({ actorId: user.id, actorRole: user.role, action: 'auth:login', ip }).catch(() => {});

    const cookie = createSessionCookie(token, expiresAt);
    const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, role: user.role } });
    res.headers.set('Set-Cookie', cookie);
    return res;
  } catch (err) {
    return handleApiError(err, 'POST /api/auth/login');
  }
}
