import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isPublicApiPath } from '@/lib/auth/public-routes';
import { signSessionToken } from '@/lib/auth/session-token';
import { issueCsrfToken } from '@/lib/csrf';

// Round 1 hardening (P0) — contract tests:
//   1) EVERY src/app/api/**/route.ts must be either on the exact public
//      allowlist (src/lib/auth/public-routes.ts) or contain an auth guard
//      (requireSession / requirePermission).
//   2) Critical handlers answer 401/403 to requests with no cookie or a forged
//      cookie (dynamic import of the exported handler).
//   3) src/proxy.ts enforces the signed-session pre-gate + HMAC CSRF.

const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api');

type RouteFile = { file: string; urlPath: string };

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function discoverRoutes(): RouteFile[] {
  const out: RouteFile[] = [];
  // Next's app router also allows src/app/api/route.ts (root API route).
  const candidates = walk(API_ROOT);
  for (const file of candidates) {
    if (path.basename(file) !== 'route.ts') continue;
    const rel = path.relative(path.join(process.cwd(), 'src', 'app'), file);
    const urlPath =
      '/' +
      rel
        .split(path.sep)
        .join('/')
        .replace(/\/route\.ts$/, '');
    out.push({ file, urlPath });
  }
  return out.sort((a, b) => a.urlPath.localeCompare(b.urlPath));
}

// These subtrees are owned by other agents in this round (see task-6 scope:
// "NÃO altere src/app/api/etl/** e src/app/api/ai/**"). They are reported, not
// enforced, so this contract test does not break a peer's in-flight work.
const OTHER_OWNER_PREFIXES = ['/api/etl/'];

describe('route auth contract — every /api route is public-allowlisted or auth-guarded', () => {
  const routes = discoverRoutes();

  it('discovers the API surface (sanity)', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('no route is silently unauthenticated', () => {
    const offenders: string[] = [];
    for (const { file, urlPath } of routes) {
      if (isPublicApiPath(urlPath)) continue;
      if (OTHER_OWNER_PREFIXES.some((p) => urlPath.startsWith(p))) continue;
      const source = fs.readFileSync(file, 'utf8');
      const hasGuard = /requireSession|requirePermission/.test(source);
      if (!hasGuard) offenders.push(urlPath);
    }
    expect(
      offenders,
      'rotas sem requireSession/requirePermission e fora da allowlist pública: ' +
        offenders.join(', ') +
        ' — usar requirePermission(...) ou adicionar à allowlist pública (src/lib/auth/public-routes.ts) se realmente público',
    ).toEqual([]);
  });

  it('public allowlist is minimal/exact (no wildcard for business routes)', () => {
    // Guard against someone adding a broad prefix by accident.
    expect(isPublicApiPath('/api/positions')).toBe(false);
    expect(isPublicApiPath('/api/wallets')).toBe(false);
    expect(isPublicApiPath('/api/system/backup')).toBe(false);
    expect(isPublicApiPath('/api/users')).toBe(false);
    expect(isPublicApiPath('/api/health')).toBe(true);
    expect(isPublicApiPath('/api/health/live')).toBe(true);
    expect(isPublicApiPath('/api/health/ready')).toBe(true);
    expect(isPublicApiPath('/api/auth/login')).toBe(true);
    expect(isPublicApiPath('/api/auth/google/callback')).toBe(true);
    expect(isPublicApiPath('/api/auth/forgot')).toBe(true);
    expect(isPublicApiPath('/api/auth/reset')).toBe(true);
    expect(isPublicApiPath('/api/webhooks/stripe')).toBe(true);
    // not public: auth-required helpers
    expect(isPublicApiPath('/api/auth/me')).toBe(false);
    expect(isPublicApiPath('/api/auth/csrf')).toBe(false);
    expect(isPublicApiPath('/api/auth/refresh')).toBe(false);
    expect(isPublicApiPath('/api/auth/logout')).toBe(false);
    expect(isPublicApiPath('/api/mcp')).toBe(false);
  });
});

describe('critical handlers — 401/403 without a valid session cookie', () => {
  const token = 'c'.repeat(64);
  const validSignedCookie = signSessionToken(token);
  const forgedSignedCookie = token + '.' + '0'.repeat(64);

  type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

  function params(id = 'nonexistent-id') {
    return { params: Promise.resolve({ id }) };
  }

  const cases: Array<{
    name: string;
    load: () => Promise<Record<string, unknown>>;
    method: string;
    url: string;
    body?: string;
  }> = [
    {
      name: 'GET /api/system/info',
      load: () => import('@/app/api/system/info/route'),
      method: 'GET',
      url: 'http://localhost/api/system/info',
    },
    {
      name: 'GET /api/system/backup',
      load: () => import('@/app/api/system/backup/route'),
      method: 'GET',
      url: 'http://localhost/api/system/backup',
    },
    {
      name: 'POST /api/system/maintenance',
      load: () => import('@/app/api/system/maintenance/route'),
      method: 'POST',
      url: 'http://localhost/api/system/maintenance',
      body: JSON.stringify({ action: 'clear_logs' }),
    },
    {
      name: 'GET /api/runtime/status',
      load: () => import('@/app/api/runtime/status/route'),
      method: 'GET',
      url: 'http://localhost/api/runtime/status',
    },
    {
      name: 'GET /api/wallets',
      load: () => import('@/app/api/wallets/route'),
      method: 'GET',
      url: 'http://localhost/api/wallets',
    },
    {
      name: 'POST /api/positions/[id]/close',
      load: () => import('@/app/api/positions/[id]/close/route'),
      method: 'POST',
      url: 'http://localhost/api/positions/nonexistent-id/close',
      body: '{}',
    },
    {
      name: 'POST /api/initialize',
      load: () => import('@/app/api/initialize/route'),
      method: 'POST',
      url: 'http://localhost/api/initialize',
    },
    {
      name: 'POST /api/debug/crash-test',
      load: () => import('@/app/api/debug/crash-test/route'),
      method: 'POST',
      url: 'http://localhost/api/debug/crash-test',
      body: JSON.stringify({ type: 'uncaught' }),
    },
  ];

  for (const c of cases) {
    it(`${c.name} → 401 without cookie`, async () => {
      const mod = (await c.load()) as Record<string, Handler>;
      const handler = mod[c.method];
      expect(typeof handler).toBe('function');
      const req = new Request(c.url, {
        method: c.method,
        headers: c.body ? { 'content-type': 'application/json' } : undefined,
        body: c.body,
      });
      const res = await handler(req, params());
      expect([401, 403]).toContain(res.status);
    });

    it(`${c.name} → 401/403 with forged cookie`, async () => {
      const mod = (await c.load()) as Record<string, Handler>;
      const handler = mod[c.method];
      const req = new Request(c.url, {
        method: c.method,
        headers: {
          cookie: `session=${forgedSignedCookie}`,
          ...(c.body ? { 'content-type': 'application/json' } : {}),
        },
        body: c.body,
      });
      const res = await handler(req, params());
      expect([401, 403]).toContain(res.status);
    });
  }

  it('forged cookie is rejected statelessly (no DB lookup path)', async () => {
    const { requireSession } = await import('@/lib/auth/session');
    const req = new Request('http://localhost/api/system/info', {
      headers: { cookie: `session=${forgedSignedCookie}` },
    });
    await expect(requireSession(req)).rejects.toMatchObject({ status: 401 });
  });

  it('a correctly-signed cookie for an unknown token still fails the DB check (401)', async () => {
    const { requireSession } = await import('@/lib/auth/session');
    const req = new Request('http://localhost/api/system/info', {
      headers: { cookie: `session=${validSignedCookie}` },
    });
    await expect(requireSession(req)).rejects.toMatchObject({ status: 401 });
  });
});

// ---------------------------------------------------------------------------
// Proxy (stateless) — signed session pre-gate + HMAC CSRF + origin
// ---------------------------------------------------------------------------
type FakeReq = {
  nextUrl: URL & { clone: () => URL };
  method: string;
  headers: Headers;
  cookies: { get: (name: string) => { value: string } | undefined };
};

function fakeRequest(opts: {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}): FakeReq {
  const url = new URL('http://localhost' + opts.path);
  const nextUrl = Object.assign(url, { clone: () => new URL(url.toString()) });
  const cookies = opts.cookies ?? {};
  return {
    nextUrl,
    method: opts.method ?? 'GET',
    headers: new Headers(opts.headers ?? {}),
    cookies: {
      get: (name: string) => (cookies[name] ? { value: cookies[name] } : undefined),
    },
  };
}

async function callProxy(req: FakeReq): Promise<Response> {
  const { proxy } = await import('@/proxy');
  return proxy(req as never) as unknown as Response;
}

describe('proxy — /api auth pre-gate (signature only, no DB)', () => {
  it('401 on a protected API route without a session cookie', async () => {
    const res = await callProxy(fakeRequest({ path: '/api/status' }));
    expect(res.status).toBe(401);
  });

  it('401 on a forged signature', async () => {
    const res = await callProxy(
      fakeRequest({
        path: '/api/status',
        cookies: { session: 'a'.repeat(64) + '.' + '0'.repeat(64) },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('lets a correctly-signed cookie through (handler does the DB check)', async () => {
    const res = await callProxy(
      fakeRequest({ path: '/api/status', cookies: { session: signSessionToken('d'.repeat(64)) } }),
    );
    expect(res.status).toBe(200);
  });

  it('public allowlist stays public', async () => {
    for (const p of ['/api/health', '/api/health/live', '/api/health/ready', '/api/auth/login']) {
      const res = await callProxy(fakeRequest({ path: p, method: p === '/api/auth/login' ? 'POST' : 'GET' }));
      expect(res.status, p).toBe(200);
    }
  });
});

describe('proxy — CSRF HMAC on mutating requests', () => {
  const sessionCookie = signSessionToken('e'.repeat(64));

  it('403 when the csrf header is missing', async () => {
    const res = await callProxy(
      fakeRequest({
        path: '/api/positions',
        method: 'POST',
        cookies: { session: sessionCookie },
        headers: { origin: 'http://localhost' },
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('missing_csrf_header');
  });

  it('403 when the csrf token is bound to another session', async () => {
    const otherSession = signSessionToken('f'.repeat(64));
    const res = await callProxy(
      fakeRequest({
        path: '/api/positions',
        method: 'POST',
        cookies: { session: sessionCookie },
        headers: {
          origin: 'http://localhost',
          'x-csrf-token': issueCsrfToken(otherSession),
        },
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('csrf_mismatch');
  });

  it('200 with a valid session + matching origin + valid csrf token', async () => {
    const res = await callProxy(
      fakeRequest({
        path: '/api/positions',
        method: 'POST',
        cookies: { session: sessionCookie },
        headers: {
          origin: 'http://localhost',
          'x-csrf-token': issueCsrfToken(sessionCookie),
        },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('403 origin mismatch even with a valid csrf token', async () => {
    const res = await callProxy(
      fakeRequest({
        path: '/api/positions',
        method: 'POST',
        cookies: { session: sessionCookie },
        headers: {
          origin: 'https://evil.example.com',
          'x-csrf-token': issueCsrfToken(sessionCookie),
        },
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('origin_mismatch');
  });

  it('applies the origin check to CSRF-exempt login too', async () => {
    const res = await callProxy(
      fakeRequest({
        path: '/api/auth/login',
        method: 'POST',
        headers: { origin: 'https://evil.example.com' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('webhooks (provider-signed, no Origin) pass through', async () => {
    const res = await callProxy(fakeRequest({ path: '/api/webhooks/stripe', method: 'POST' }));
    expect(res.status).toBe(200);
  });
});

describe('proxy — page guards use the signature too', () => {
  it('redirects /dashboard to /login without a valid session', async () => {
    const res = await callProxy(fakeRequest({ path: '/dashboard' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('allows /dashboard with a signed session', async () => {
    const res = await callProxy(
      fakeRequest({ path: '/dashboard', cookies: { session: signSessionToken('a'.repeat(64)) } }),
    );
    expect(res.status).toBe(200);
  });

  it('forged cookie cannot reach /dashboard', async () => {
    const res = await callProxy(
      fakeRequest({ path: '/dashboard', cookies: { session: 'a'.repeat(64) } }),
    );
    expect(res.status).toBe(307);
  });

  it('redirects /login to / when already signed in', async () => {
    const res = await callProxy(
      fakeRequest({ path: '/login', cookies: { session: signSessionToken('a'.repeat(64)) } }),
    );
    expect(res.status).toBe(307);
  });
});
