import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseSessionCookieFromRequest, clearSessionCookie, hashToken } from '@/lib/auth/session';
import { handleApiError } from '@/lib/api/error-handler';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const token = parseSessionCookieFromRequest(req);
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
