import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  clearStateCookie,
  exchangeGoogleCode,
  fetchGoogleProfile,
  googleConfigured,
} from "@/lib/auth/google";
import { createSessionCookie, generateToken, hashToken } from "@/lib/auth/session";
import { appendAuditLog } from "@/lib/auth/audit";
import { logger } from "@/lib/trading/logger";

export const dynamic = "force-dynamic";

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function fail(req: Request, reason: string) {
  const url = new URL(`/login?error=${reason}`, req.url);
  const res = NextResponse.redirect(url);
  res.headers.append("Set-Cookie", clearStateCookie());
  return res;
}

// GET /api/auth/google/callback — troca o code, valida o e-mail e abre sessão.
export async function GET(req: Request) {
  if (!googleConfigured()) return fail(req, "google_not_configured");

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return fail(req, error === "access_denied" ? "google_denied" : "google_failed");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(req, "g_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return fail(req, "google_state");
  }

  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? null;

  try {
    const { access_token } = await exchangeGoogleCode(code);
    const profile = await fetchGoogleProfile(access_token);

    if (!profile.email_verified) return fail(req, "google_unverified");

    const normalizedEmail = profile.email.toLowerCase();
    let user = await db.user.findFirst({
      where: { OR: [{ googleId: profile.sub }, { email: normalizedEmail }] },
    });

    if (user && !user.isActive) return fail(req, "google_inactive");

    if (!user) {
      user = await db.user.create({
        data: {
          email: normalizedEmail,
          // Sem senha utilizável: login por senha não funciona para conta social.
          passwordHash: "!google-oauth",
          role: "viewer",
          googleId: profile.sub,
          avatarUrl: profile.picture ?? null,
          lastLoginAt: new Date(),
        },
      });
      await appendAuditLog({
        actorId: user.id,
        actorRole: user.role,
        action: "auth:register_google",
        ip,
      }).catch(() => {});
    } else {
      user = await db.user.update({
        where: { id: user.id },
        data: {
          googleId: profile.sub,
          avatarUrl: profile.picture ?? user.avatarUrl,
          lastLoginAt: new Date(),
        },
      });
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.session.create({
      data: { userId: user.id, tokenHash, expiresAt, ip, userAgent },
    });

    await appendAuditLog({
      actorId: user.id,
      actorRole: user.role,
      action: "auth:login",
      ip,
    }).catch(() => {});

    const res = NextResponse.redirect(new URL("/overview", req.url));
    res.headers.append("Set-Cookie", createSessionCookie(token, expiresAt));
    res.headers.append("Set-Cookie", clearStateCookie());
    return res;
  } catch (err) {
    logger.warn("api", "Google OAuth callback falhou", { message: (err as Error).message });
    return fail(req, "google_failed");
  }
}
