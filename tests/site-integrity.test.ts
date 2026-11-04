// tests/site-integrity.test.ts — auditSite com TLS/fetch/db mockados (NENHUM TLS real)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const siteAuditCreate = vi.fn();
const tlsConnect = vi.fn();

vi.mock('@/lib/db', () => ({
  db: { siteAudit: { create: (...a: unknown[]) => siteAuditCreate(...a) } },
}));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});
vi.mock('tls', () => ({ default: { connect: (...a: unknown[]) => tlsConnect(...a) } }));

import { auditSite } from '@/lib/trading/site-integrity';

const NOW = Date.now();

/**
 * Mock de tls.connect: retorna um socket fake e chama o callback/eventos de
 * forma assíncrona (como o Node faz), evitando TDZ no consumidor.
 */
function mockTls(opts: { valid: boolean; daysToExpiry?: number; error?: string }) {
  tlsConnect.mockImplementation((_o: unknown, cb: () => void) => {
    const socket = {
      getPeerCertificate: () => {
        if (!opts.valid) return {};
        const validTo = new Date(NOW + (opts.daysToExpiry ?? 90) * 86_400_000).toUTCString();
        return { valid_to: validTo };
      },
      setTimeout: (_ms: number, onTimeout: () => void) => {
        if (opts.error === 'timeout') queueMicrotask(onTimeout);
      },
      on: (event: string, handler: (e: Error) => void) => {
        if (event === 'error' && opts.error && opts.error !== 'timeout') {
          queueMicrotask(() => handler(new Error(opts.error)));
        }
      },
      destroy: () => undefined,
    };
    if (!opts.error) queueMicrotask(() => cb());
    return socket;
  });
}

const LONG_HTML = `<html><head><title>Projeto Legítimo</title></head><body>${'<p>conteúdo real do site</p>'.repeat(120)}</body></html>`;

type Site = { html: string; headers: Record<string, string>; status?: number };

function mockFetch(opts: {
  site?: Site;
  rdapDays?: number | null;
  rdapStatus?: number;
  safeBrowsingMatches?: unknown[];
  safeBrowsingStatus?: number;
}) {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('rdap.org')) {
      if (opts.rdapStatus && opts.rdapStatus !== 200) return new Response('{}', { status: opts.rdapStatus });
      if (opts.rdapDays === null) return new Response(JSON.stringify({ events: [] }), { status: 200 });
      const days = opts.rdapDays ?? 400;
      return new Response(JSON.stringify({
        events: [{ eventAction: 'registration', eventDate: new Date(NOW - days * 86_400_000).toISOString() }],
      }), { status: 200 });
    }
    if (url.includes('safebrowsing.googleapis.com')) {
      if (opts.safeBrowsingStatus && opts.safeBrowsingStatus !== 200) {
        return new Response('{}', { status: opts.safeBrowsingStatus });
      }
      return new Response(JSON.stringify({ matches: opts.safeBrowsingMatches ?? [] }), { status: 200 });
    }
    // site alvo
    const site = opts.site ?? { html: LONG_HTML, headers: { 'strict-transport-security': 'max-age=1', 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY' } };
    return new Response(site.html, { status: site.status ?? 200, headers: site.headers });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  siteAuditCreate.mockReset().mockResolvedValue({});
  tlsConnect.mockReset();
  vi.stubEnv('GOOGLE_SAFE_BROWSING_KEY', '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('auditSite — URL inválida', () => {
  it('retorna score 0, passed false e findings de parse (sem I/O)', async () => {
    const res = await auditSite('não-é-url');
    expect(res.score).toBe(0);
    expect(res.passed).toBe(false);
    expect(res.redFlags).toEqual(['URL inválida']);
    expect(res.findings.url_parse).toBeDefined();
    expect(siteAuditCreate).not.toHaveBeenCalled();
  });
});

describe('auditSite — SSL', () => {
  it('SSL válido com >=30d => sslScore 100', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({});
    const res = await auditSite('https://projeto.example');
    expect(res.sslValid).toBe(true);
    expect(res.sslScore).toBe(100);
    expect(res.sslDaysToExpiry).toBeGreaterThanOrEqual(89);
  });

  it('SSL expirando em 10d => sslScore 60', async () => {
    mockTls({ valid: true, daysToExpiry: 10 });
    mockFetch({});
    expect((await auditSite('https://projeto.example')).sslScore).toBe(60);
  });

  it('SSL inválido => sslScore 0 + red flag + passed false', async () => {
    mockTls({ valid: false, error: 'certificate has expired' });
    mockFetch({});
    const res = await auditSite('https://projeto.example');
    expect(res.sslScore).toBe(0);
    expect(res.redFlags.some((r) => r.includes('SSL inválido'))).toBe(true);
    expect(res.passed).toBe(false);
  });
});

describe('auditSite — idade do domínio (RDAP)', () => {
  it.each([
    [500, 100],
    [120, 80],
    [45, 50],
  ])('domínio com %i dias => domainAgeScore %i', async (days, expected) => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ rdapDays: days });
    const res = await auditSite('https://projeto.example');
    expect(res.domainAgeDays).toBe(days);
    expect(res.domainAgeScore).toBe(expected);
  });

  it('domínio <7d => score 0 + red flag de scam provável', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ rdapDays: 3 });
    const res = await auditSite('https://projeto.example');
    expect(res.domainAgeScore).toBe(0);
    expect(res.redFlags.some((r) => r.includes('altíssimo risco'))).toBe(true);
  });

  it('RDAP indisponível => score neutro 50 e finding', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ rdapStatus: 503 });
    const res = await auditSite('https://projeto.example');
    expect(res.domainAgeScore).toBe(50);
    expect(res.domainAgeDays).toBeNull();
    expect(res.findings.domain_age.join(' ')).toMatch(/indisponível/);
  });
});

describe('auditSite — headers de segurança', () => {
  it('3/3 headers => headersScore 100', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({});
    const res = await auditSite('https://projeto.example');
    expect([res.hstsPresent, res.cspPresent, res.xfoPresent]).toEqual([true, true, true]);
    expect(res.headersScore).toBe(100);
  });

  it('nenhum header => headersScore 10', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ site: { html: LONG_HTML, headers: {} } });
    expect((await auditSite('https://projeto.example')).headersScore).toBe(10);
  });

  it('1/3 headers => headersScore 40', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ site: { html: LONG_HTML, headers: { 'x-frame-options': 'DENY' } } });
    expect((await auditSite('https://projeto.example')).headersScore).toBe(40);
  });
});

describe('auditSite — conteúdo e red flags', () => {
  it('HTML com padrão de drainer => contentScore reduz e passed false', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ site: { html: LONG_HTML + '<p>send ETH to receive double your ETH</p>', headers: { 'strict-transport-security': 'x' } } });
    const res = await auditSite('https://projeto.example');
    expect(res.contentScore).toBeLessThan(100);
    expect(res.redFlags.length).toBeGreaterThan(0);
    expect(res.passed).toBe(false);
  });

  it('aviso anti-scam legítimo ("never share your private key") NÃO vira red flag', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ site: { html: LONG_HTML + '<p>Never share your private key with anyone.</p>', headers: { 'strict-transport-security': 'x' } } });
    const res = await auditSite('https://projeto.example');
    expect(res.redFlags).toEqual([]);
    expect(res.contentScore).toBe(100);
  });

  it('página curta sem challenge => red flag de drainer stub', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ site: { html: '<html><title>x</title></html>', headers: {} } });
    const res = await auditSite('https://projeto.example');
    expect(res.redFlags.some((r) => r.includes('extremamente curta'))).toBe(true);
  });

  it('challenge Cloudflare => conteúdo neutro (75) e análise limitada', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ site: { html: '<html><head><title>Just a moment...</title></head><body>cf</body></html>', headers: { server: 'cloudflare' } } });
    const res = await auditSite('https://projeto.example', { symbol: 'X' });
    expect(res.contentScore).toBe(75);
    expect(res.findings.content.join(' ')).toMatch(/WAF/);
  });
});

describe('auditSite — Safe Browsing e persistência', () => {
  it('sem chave => safeBrowsingScore neutro 75 e finding de não configurado', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({});
    const res = await auditSite('https://projeto.example');
    expect(res.safeBrowsingScore).toBe(75);
    expect(res.findings.safe_browsing.join(' ')).toMatch(/não configurado/);
  });

  it('Safe Browsing com match => flagged, score 0, passed false', async () => {
    vi.stubEnv('GOOGLE_SAFE_BROWSING_KEY', 'chave-dummy');
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ safeBrowsingMatches: [{ threatType: 'MALWARE' }] });
    const res = await auditSite('https://projeto.example');
    expect(res.safeBrowsingFlagged).toBe(true);
    expect(res.safeBrowsingScore).toBe(0);
    expect(res.passed).toBe(false);
  });

  it('Safe Browsing com erro HTTP => 70 e finding de erro', async () => {
    vi.stubEnv('GOOGLE_SAFE_BROWSING_KEY', 'chave-dummy');
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ safeBrowsingStatus: 500 });
    const res = await auditSite('https://projeto.example');
    expect(res.safeBrowsingScore).toBe(70);
  });

  it('site limpo => score alto, passed true e persistência chamada', async () => {
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({ rdapDays: 500 });
    const res = await auditSite('https://projeto.example', { symbol: 'BTC', tokenId: '0xabc', chain: 'ethereum' });
    expect(res.score).toBeGreaterThanOrEqual(60);
    expect(res.passed).toBe(true);
    expect(res.redFlags).toEqual([]);
    expect(siteAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ url: 'https://projeto.example', symbol: 'BTC', tokenId: '0xabc', chain: 'ethereum', passed: true }),
    });
  });

  it('falha ao persistir não derruba a auditoria', async () => {
    siteAuditCreate.mockRejectedValue(new Error('db down'));
    mockTls({ valid: true, daysToExpiry: 90 });
    mockFetch({});
    const res = await auditSite('https://projeto.example');
    expect(res.url).toBe('https://projeto.example');
  });
});
