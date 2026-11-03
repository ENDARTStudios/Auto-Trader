// src/lib/auth/session.ts — Opaque token session helpers
import { randomBytes, createHash } from 'crypto';
import { db } from '@/lib/db';
import { UnauthorizedError, ForbiddenError, RateLimitedError } from './errors';
import type { Permission } from './rbac';
import { checkRateLimit } from '@/lib/rate-limit';
import { signSessionToken, verifySignedSessionToken } from './session-token';

export { signSessionToken, verifySignedSessionToken, getSessionSecret } from './session-token';

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateToken(): string {
  return randomBytes(32).toString('hex'); // 64 hex chars = 256 bits
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSessionCookie(token: string, expiresAt: Date): string {
  // The cookie carries the SIGNED value: <token>.<hmac>. The raw token is never
  // exposed to the client, so the proxy can validate it statelessly (no DB) and
  // a forged cookie is rejected before any handler runs.
  const signed = signSessionToken(token);
  const expires = expiresAt.toUTCString();
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  // Secure only in production (localhost dev is http)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${signed}; HttpOnly; Path=/; Expires=${expires}; Max-Age=${maxAge}; SameSite=Lax${secure}`;
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

/**
 * Returns the raw (possibly signed) value of the session cookie, or null.
 * Use parseSessionTokenFromRequest when the opaque token is needed (DB lookup).
 */
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

/**
 * Returns the verified opaque session token (signature checked, no DB), or null
 * when the cookie is absent / malformed / tampered.
 */
export function parseSessionTokenFromRequest(req: Request): string | null {
  return verifySignedSessionToken(parseSessionCookieFromRequest(req));
}

export interface SessionUser {
  userId: string;
  email: string;
  role: string;
  isActive: boolean;
}

export async function requireSession(req: Request): Promise<SessionUser> {
  // Step 1 (stateless): the cookie must be signed with SESSION_SECRET. Forged or
  // tampered cookies are rejected here without touching the database.
  const token = parseSessionTokenFromRequest(req);
  if (!token) throw new UnauthorizedError('Missing or invalid session');
  // Step 2 (stateful): the Session row must still exist, be unexpired, and the
  // user must be active. The signature alone is not enough (revocation/logout).
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
  // Per-user rate limit (identity-aware): route-scoped sliding window keyed by
  // userId — aplica-se a TODAS as rotas autenticadas sem tocar handler por handler.
  // IP-keyed pre-gates seguem nos handlers de rotas públicas (login/forgot/reset).
  const route = new URL(req.url).pathname;
  const rl = checkRateLimit(`user:${user.id}`, route);
  if (!rl.allowed) throw new RateLimitedError(rl.retryAfter ?? 60);
  return { userId: user.id, email: user.email, role: user.role, isActive: user.isActive };
}

export async function getSession(req: Request): Promise<SessionUser | null> {
  try {
    return await requireSession(req);
  } catch (err) {
    // RateLimitedError degrada para null (soft-auth) — aceitável: quem usa getSession
    // trata ausência de sessão graciosamente; o gate duro é requireSession.
    if (err instanceof RateLimitedError) throw err;
    return null;
  }
}

// Guard server-side movido do rbac.ts (2026-10-31): o import dinâmico de
// './session' dentro do rbac puro arrastava db.ts (adapter nativo better-sqlite3)
// para bundles de client components e quebrava o build Turbopack.
// Uso em rotas: const session = await requirePermission('engine:kill')(req)
export function requirePermission(perm: Permission) {
  return async (req: Request) => {
    const session = await requireSession(req);
    const { hasPermission } = await import('./rbac');
    if (!hasPermission(session.role, perm)) {
      throw new ForbiddenError(perm);
    }
    return session;
  };
}
