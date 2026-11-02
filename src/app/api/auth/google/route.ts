import { NextResponse } from "next/server";
import { buildGoogleAuthUrl, googleConfigured, newState, stateCookie } from "@/lib/auth/google";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// GET /api/auth/google — inicia o fluxo OAuth com state anti-CSRF.
export async function GET(req: Request) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(ip, "/api/auth/google");
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", req.url));
  }

  const state = newState();
  const res = NextResponse.redirect(buildGoogleAuthUrl(state));
  res.headers.append("Set-Cookie", stateCookie(state));
  return res;
}
