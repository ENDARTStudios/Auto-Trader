import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/auth/errors';
import { handleApiError } from '@/lib/api/error-handler';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildGraph } from '@/lib/rag/graph';

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/graph');
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, 'dashboard:read')) throw new ForbiddenError('dashboard:read');
    const graph = await buildGraph();
    return NextResponse.json(graph);
  } catch (err) {
    return handleApiError(err, 'GET /api/graph');
  }
}
