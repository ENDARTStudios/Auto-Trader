import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/auth/errors';
import { handleApiError } from '@/lib/api/error-handler';
import { checkRateLimit } from '@/lib/rate-limit';
import { askRag } from '@/lib/rag/pipeline';

const schema = z.object({ question: z.string().min(3).max(500) });

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/ai/ask');
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, 'dashboard:read')) throw new ForbiddenError('dashboard:read');
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.flatten() }, { status: 400 });
    const result = await askRag(parsed.data.question);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err, 'POST /api/ai/ask');
  }
}
