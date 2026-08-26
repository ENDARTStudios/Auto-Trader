// src/lib/auth/session.ts — Opaque token session helpers
import { randomBytes, createHash } from 'crypto';
import { db } from '@/lib/db';
import { UnauthorizedError } from './errors';

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateToken(): string {
  return randomBytes(32).toString('hex'); // 64 hex chars = 256 bits
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionCookie(token: string, expiresAt: Date): string {
  const expires = expiresAt.toUTCString();
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  // Secure only in production (localhost dev is http)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; Expires=${expires}; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

export function parseSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const p of parts) {
    const [k, ...v] = p.trim().split('=');
    if (k === SESSION_COOKIE_NAME) return v.join('=');
  }
  return null;
}

// For NextRequest (cookies API)
export function parseSessionCookieFromRequest(req: Request): string | null {
  // NextRequest has cookies, but we support plain Request too
  const anyReq = req as unknown as { cookies?: { get?: (name: string) => { value: string } | undefined }; headers: Headers };
  // Try NextRequest cookies API
  if (anyReq.cookies?.get) {
    const c = anyReq.cookies.get(SESSION_COOKIE_NAME);
    if (c) return c.value;
  }
  return parseSessionCookie(req.headers.get('cookie'));
}

export interface SessionUser {
  userId: string;
  email: string;
  role: string;
  isActive: boolean;
}

export async function requireSession(req: Request): Promise<SessionUser> {
  const token = parseSessionCookieFromRequest(req);
  if (!token) throw new UnauthorizedError('Missing session');
  const tokenHash = hashToken(token);
  const session = await db.session.findUnique({ where: { tokenHash } });
  if (!session) throw new UnauthorizedError('Invalid session');
  if (session.expiresAt.getTime() < Date.now()) {
    // Expired — delete it
    await db.session.delete({ where: { tokenHash } }).catch(() => {});
    throw new UnauthorizedError('Session expired');
  }
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) throw new UnauthorizedError('User not found');
  if (!user.isActive) throw new UnauthorizedError('User inactive');
  return { userId: user.id, email: user.email, role: user.role, isActive: user.isActive };
}

export async function getSession(req: Request): Promise<SessionUser | null> {
  try {
    return await requireSession(req);
  } catch {
    return null;
  }
}
