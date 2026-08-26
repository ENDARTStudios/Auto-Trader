import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { handleApiError } from '@/lib/api/error-handler';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    return NextResponse.json({ user: { id: session.userId, email: session.email, role: session.role } });
  } catch (err) {
    return handleApiError(err, 'GET /api/auth/me');
  }
}
