// src/app/api/auth/refresh/route.ts — S33 Refresh token rotation (PLANO 3.3)
// POST /api/auth/refresh — requer cookie session válido, rotaciona para novo token 7d, invalida antigo.
// Sem body. Retorna {ok:true}. Usado pelo interceptor 401 para refresh transparente.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession, generateToken, hashToken, createSessionCookie, parseSessionCookieFromRequest, SESSION_TTL_MS } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const oldToken = parseSessionCookieFromRequest(req as unknown as Request);
    if (!oldToken) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    // Valida sessão atual (lança 401 se inválida/expirada)
    const user = await requireSession(req as unknown as Request);

    const oldHash = hashToken(oldToken);
    const newToken = generateToken();
    const newHash = hashToken(newToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    // Cria nova sessão e deleta antiga atomicamente
    await db.$transaction(async (tx) => {
      await tx.session.create({
        data: {
          userId: user.userId,
          tokenHash: newHash,
          expiresAt,
          ip: (req as unknown as { ip?: string }).ip ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
          userAgent: req.headers.get('user-agent') ?? null,
        },
      });
      await tx.session.delete({ where: { tokenHash: oldHash } }).catch(() => {});
    });

    const res = NextResponse.json({ ok: true });
    res.headers.set('Set-Cookie', createSessionCookie(newToken, expiresAt));
    return res;
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'unauthorized';
    const status = msg.includes('expired') || msg.includes('Invalid') || msg.includes('Missing') ? 401 : 401;
    return NextResponse.json({ error: 'unauthorized', message: msg }, { status });
  }
}
