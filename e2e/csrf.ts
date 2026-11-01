import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Emite o token double-submit e devolve cookies + header para chamadas
 * autenticadas que passam pelo proxy (que exige x-csrf-token == cookie csrf).
 */
export async function csrfHeaders(
  request: APIRequestContext,
  sessionCookie: string,
): Promise<{ cookie: string; token: string }> {
  const res = await request.get('/api/auth/csrf', { headers: { Cookie: sessionCookie } });
  expect(res.ok(), `csrf ${res.status()}`).toBeTruthy();
  const { token } = (await res.json()) as { token: string };
  const setCookie = res.headers()['set-cookie'] ?? '';
  const csrfCookie = setCookie.split(';')[0];
  return { cookie: `${sessionCookie}; ${csrfCookie}`, token };
}
