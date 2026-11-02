// Login social com Google (OAuth 2.0 / OpenID Connect) — implementação mínima
// via fetch, sem SDK. Fluxo: /api/auth/google (state + redirect) →
// /api/auth/google/callback (code → token → userinfo → sessão opaca).

import { createHash, randomBytes } from "crypto";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3100")
  );
}

export function googleRedirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI?.trim() || `${appBaseUrl()}/api/auth/google/callback`;
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

export function stateCookie(state: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `g_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure}`;
}

export function clearStateCookie(): string {
  return "g_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax";
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<{ access_token: string; id_token?: string }> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; id_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error ?? `google_token_error_${res.status}`);
  }
  return { access_token: data.access_token, id_token: data.id_token };
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Partial<GoogleProfile> & { error?: string };
  if (!res.ok || !data.sub || !data.email) {
    throw new Error(data.error ?? `google_userinfo_error_${res.status}`);
  }
  return {
    sub: data.sub,
    email: data.email,
    email_verified: Boolean(data.email_verified),
    name: data.name,
    picture: data.picture,
  };
}

/** Hash opaco para auditoria do state sem guardar o valor em claro. */
export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex").slice(0, 16);
}
