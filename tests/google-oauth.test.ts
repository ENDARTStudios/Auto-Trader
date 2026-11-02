import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGoogleAuthUrl,
  googleConfigured,
  googleRedirectUri,
  newState,
  stateCookie,
} from "@/lib/auth/google";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "client-123.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "secret-456";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
  delete process.env.GOOGLE_REDIRECT_URI;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("Google OAuth", () => {
  it("só fica configurado com client id e secret", () => {
    expect(googleConfigured()).toBe(true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleConfigured()).toBe(false);
  });

  it("monta a URL de autorização com escopos e state", () => {
    const url = new URL(buildGoogleAuthUrl("abc123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123.apps.googleusercontent.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("abc123");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3100/api/auth/google/callback");
  });

  it("respeita GOOGLE_REDIRECT_URI quando definido", () => {
    process.env.GOOGLE_REDIRECT_URI = "https://app.example.com/api/auth/google/callback";
    expect(googleRedirectUri()).toBe("https://app.example.com/api/auth/google/callback");
  });

  it("state é aleatório e o cookie é httpOnly", () => {
    expect(newState()).not.toBe(newState());
    expect(newState()).toMatch(/^[a-f0-9]{32}$/);
    const cookie = stateCookie("abc");
    expect(cookie).toContain("g_state=abc");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });
});
