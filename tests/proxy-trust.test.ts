// tests/proxy-trust.test.ts — decisão pura de IP confiável (sem I/O, sem TLS)
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  extractTrustedClientIp,
  isBehindTrustedProxy,
  resolveTrustedClientIp,
} from '@/lib/trading/proxy-trust';

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

const SECRET = 'segredo-de-proxy-64-hex';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveTrustedClientIp — modo direto (sem proxy)', () => {
  it('usa o peer address do socket quando não há secret', () => {
    expect(
      resolveTrustedClientIp({ headers: headers({}), peerAddress: '203.0.113.9', proxySecret: undefined })
    ).toBe('203.0.113.9');
  });

  it('NUNCA confia em XFF/X-Real-IP sem secret (spoof bloqueado)', () => {
    const ip = resolveTrustedClientIp({
      headers: headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' }),
      peerAddress: '203.0.113.9',
      proxySecret: undefined,
    });
    expect(ip).toBe('203.0.113.9');
  });

  it('peer nulo => bucket final "unidentifiable-socket"', () => {
    expect(resolveTrustedClientIp({ headers: headers({}), peerAddress: null, proxySecret: undefined })).toBe(
      'unidentifiable-socket'
    );
  });
});

describe('resolveTrustedClientIp — modo proxy confiável', () => {
  it('secret correto => usa o PRIMEIRO IP do XFF (cliente original)', () => {
    const ip = resolveTrustedClientIp({
      headers: headers({ 'x-internal-proxy-secret': SECRET, 'x-forwarded-for': '198.51.100.7, 10.0.0.1, 10.0.0.2' }),
      peerAddress: '10.0.0.3',
      proxySecret: SECRET,
    });
    expect(ip).toBe('198.51.100.7');
  });

  it('secret correto sem XFF => cai para x-real-ip', () => {
    expect(
      resolveTrustedClientIp({
        headers: headers({ 'x-internal-proxy-secret': SECRET, 'x-real-ip': ' 198.51.100.8 ' }),
        peerAddress: '10.0.0.3',
        proxySecret: SECRET,
      })
    ).toBe('198.51.100.8');
  });

  it('secret correto sem XFF nem X-Real-IP => peer (proxy) como bucket degradado', () => {
    expect(
      resolveTrustedClientIp({
        headers: headers({ 'x-internal-proxy-secret': SECRET }),
        peerAddress: '10.0.0.3',
        proxySecret: SECRET,
      })
    ).toBe('10.0.0.3');
  });

  it('secret correto e sem nada => unidentifiable-socket', () => {
    expect(
      resolveTrustedClientIp({
        headers: headers({ 'x-internal-proxy-secret': SECRET }),
        peerAddress: null,
        proxySecret: SECRET,
      })
    ).toBe('unidentifiable-socket');
  });

  it('SPOOF: secret errado => ignora XFF e usa peer (fail-closed)', () => {
    expect(
      resolveTrustedClientIp({
        headers: headers({ 'x-internal-proxy-secret': 'secret-errado', 'x-forwarded-for': '1.2.3.4' }),
        peerAddress: '203.0.113.9',
        proxySecret: SECRET,
      })
    ).toBe('203.0.113.9');
  });

  it('SPOOF: secret ausente no request => usa peer', () => {
    expect(
      resolveTrustedClientIp({
        headers: headers({ 'x-forwarded-for': '1.2.3.4' }),
        peerAddress: '203.0.113.9',
        proxySecret: SECRET,
      })
    ).toBe('203.0.113.9');
  });

  it('SPOOF: secret vazio/whitespace no header não casa', () => {
    expect(
      resolveTrustedClientIp({
        headers: headers({ 'x-internal-proxy-secret': '   ', 'x-forwarded-for': '1.2.3.4' }),
        peerAddress: '203.0.113.9',
        proxySecret: SECRET,
      })
    ).toBe('203.0.113.9');
  });

  it('segmento vazio no XFF não é aceito => cai para x-real-ip', () => {
    expect(
      resolveTrustedClientIp({
        headers: headers({ 'x-internal-proxy-secret': SECRET, 'x-forwarded-for': ' , 10.0.0.1', 'x-real-ip': '198.51.100.10' }),
        peerAddress: '10.0.0.3',
        proxySecret: SECRET,
      })
    ).toBe('198.51.100.10');
  });
});

describe('isBehindTrustedProxy / extractTrustedClientIp', () => {
  it('isBehindTrustedProxy reflete a env em runtime', () => {
    vi.stubEnv('SIGNER_PROXY_SHARED_SECRET', '');
    expect(isBehindTrustedProxy()).toBe(false);
    vi.stubEnv('SIGNER_PROXY_SHARED_SECRET', SECRET);
    expect(isBehindTrustedProxy()).toBe(true);
  });

  it('extractTrustedClientIp fora de request context => unidentifiable-socket (não confia em header)', async () => {
    vi.stubEnv('SIGNER_PROXY_SHARED_SECRET', '');
    const req = new Request('http://localhost/api/x', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(await extractTrustedClientIp(req)).toBe('unidentifiable-socket');
  });
});
