import { NextResponse } from "next/server";
import { requireSession, parseSessionCookieFromRequest } from "@/lib/auth/session";
import { issueCsrfToken } from "@/lib/csrf";
import { handleApiError } from "@/lib/api/error-handler";

/**
 * GET /api/auth/csrf — issues the double-submit token for state-mutating calls.
 *
 * The proxy (src/proxy.ts) requires `x-csrf-token` to match the `csrf` cookie.
 * The cookie is readable by the app (not httpOnly) so the client can mirror it;
 * the value is HMAC-bound to the session and expires with the 1h tolerance.
 */
export async function GET(req: Request) {
  try {
    await requireSession(req);
    // The token is HMAC-bound to the SIGNED session cookie value (not the user
    // id and not the raw token) — the value the browser sends back on every
    // request. A token issued for one session cannot be replayed with another.
    const sessionCookieValue = parseSessionCookieFromRequest(req);
    if (!sessionCookieValue) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const token = issueCsrfToken(sessionCookieValue);
    const res = NextResponse.json({ token });
    res.cookies.set("csrf", token, {
      httpOnly: false,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60,
    });
    return res;
  } catch (err) {
    return handleApiError(err, "GET /api/auth/csrf");
  }
}
