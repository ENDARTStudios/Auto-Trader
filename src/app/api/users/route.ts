import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { requireSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/auth/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/api/error-handler';

export const dynamic = 'force-dynamic';

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['super_admin', 'trader', 'viewer', 'service']).default('viewer'),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Você deve aceitar os Termos de Uso e a Política de Privacidade' }) }),
});

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/users');
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, 'users:manage')) throw new ForbiddenError('users:manage');
    const users = await db.user.findMany({
      select: { id: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ users });
  } catch (err) {
    return handleApiError(err, 'GET /api/users');
  }
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/users');
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, 'users:manage')) throw new ForbiddenError('users:manage');
    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.flatten() }, { status: 400 });
    const { email, password, role } = parsed.data;
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: 'email already exists' }, { status: 409 });
    const passwordHash = await hashPassword(password);
    const user = await db.user.create({ data: { email, passwordHash, role } });
    // Audit log with terms acceptance (LGPD art. 7º, I) — IP + timestamp
    const { appendAuditLog } = await import('@/lib/auth/audit');
    await appendAuditLog({ actorId: session.userId, actorRole: session.role, action: 'users:manage', target: user.id, ip }).catch(() => {});
    // Also log explicit terms acceptance
    const { db: auditDb } = await import('@/lib/db');
    await auditDb.appLog
      .create({
        data: {
          level: 'info',
          source: 'auth',
          message: `User ${user.email} created with terms acceptance`,
          context: JSON.stringify({ acceptTerms: true, ip, createdBy: session.userId }),
        },
      })
      .catch(() => {});
    return NextResponse.json({ user: { id: user.id, email: user.email, role: user.role } }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'POST /api/users');
  }
}
