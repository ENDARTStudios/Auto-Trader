import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/api/error-handler';
import { requireSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/auth/errors';

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = (req.headers as unknown as Headers).get?.('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/feature-flags');
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
      );
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, 'dashboard:read')) throw new ForbiddenError('dashboard:read');
    const flags = await db.featureFlag.findMany({ orderBy: { key: 'asc' } });
    return NextResponse.json({ flags });
  } catch (err) {
    return handleApiError(err, 'GET /api/feature-flags');
  }
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/feature-flags');
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
      );
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, 'flags:manage')) throw new ForbiddenError('flags:manage');
    const body = (await req.json()) as { key?: string; enabled?: boolean; rolloutPct?: number };
    if (!body.key || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'key and enabled (boolean) required' }, { status: 400 });
    }
    if (body.rolloutPct !== undefined && (body.rolloutPct < 0 || body.rolloutPct > 100)) {
      return NextResponse.json({ error: 'rolloutPct must be 0..100' }, { status: 400 });
    }
    const flag = await db.featureFlag.upsert({
      where: { key: body.key },
      create: { key: body.key, enabled: body.enabled, rolloutPct: body.rolloutPct ?? 100 },
      update: { enabled: body.enabled, rolloutPct: body.rolloutPct ?? 100 },
    });
    // Invalidate in-memory cache (feature-flags.ts helper)
    try {
      const { __resetFlagCache } = await import('@/lib/trading/feature-flags');
      __resetFlagCache();
    } catch {
      // ignore
    }
    return NextResponse.json({ flag });
  } catch (err) {
    return handleApiError(err, 'POST /api/feature-flags');
  }
}
