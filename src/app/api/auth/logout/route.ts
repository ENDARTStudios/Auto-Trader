import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession, parseSessionTokenFromRequest, clearSessionCookie, hashToken } from '@/lib/auth/session';
import { handleApiError } from '@/lib/api/error-handler';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    // requireSession validates the signed cookie (401 for forged tokens) but logout
    // stays idempotent: a stale/expired session must still clear the cookie.
    try {
      await requireSession(req);
    } catch {
      /* idempotent logout — fall through and clear the cookie */
    }
    const token = parseSessionTokenFromRequest(req);
    if (token) {
      const tokenHash = hashToken(token);
      await db.session.delete({ where: { tokenHash } }).catch(() => {});
    }
    const res = NextResponse.json({ ok: true });
    res.headers.set('Set-Cookie', clearSessionCookie());
    return res;
  } catch (err) {
    return handleApiError(err, 'POST /api/auth/logout');
  }
}
