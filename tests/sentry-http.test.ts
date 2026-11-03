import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildSentryEnvelope,
  captureSentryEvent,
  getSentryDsn,
  isSentryConfigured,
  parseSentryDsn,
  sentryAuthHeader,
  sentryEnvelopeUrl,
  scrubSecrets,
  __resetSentryHttp,
} from '../src/lib/observability/sentry-http';

const DSN = 'https://abc123publickey@o4507.ingest.sentry.io/4509876543210';

describe('sentry-http — DSN', () => {
  it('faz parse de um DSN válido', () => {
    const dsn = parseSentryDsn(DSN);
    expect(dsn).not.toBeNull();
    expect(dsn!.protocol).toBe('https:');
    expect(dsn!.host).toBe('o4507.ingest.sentry.io');
    expect(dsn!.key).toBe('abc123publickey');
    expect(dsn!.projectId).toBe('4509876543210');
    expect(sentryEnvelopeUrl(dsn!)).toBe('https://o4507.ingest.sentry.io/api/4509876543210/envelope/');
  });

  it('rejeita DSN ausente/inválido/sem projeto', () => {
    expect(parseSentryDsn(undefined)).toBeNull();
    expect(parseSentryDsn('')).toBeNull();
    expect(parseSentryDsn('nao-e-url')).toBeNull();
    expect(parseSentryDsn('ftp://key@host/1')).toBeNull();
    expect(parseSentryDsn('https://host-sem-key/1')).toBeNull();
    expect(parseSentryDsn('https://key@host/')).toBeNull();
  });

  it('X-Sentry-Auth segue o formato do protocolo', () => {
    const dsn = parseSentryDsn(DSN)!;
    const auth = sentryAuthHeader(dsn);
    expect(auth).toContain('Sentry sentry_version=7');
    expect(auth).toContain('sentry_key=abc123publickey');
    expect(auth).toContain('sentry_client=auto-trader/1.0');
  });
});

describe('sentry-http — envelope', () => {
  it('gera 3 linhas JSON (envelope header, item header, evento)', () => {
    const dsn = parseSentryDsn(DSN)!;
    const { body, eventId } = buildSentryEnvelope(
      dsn,
      {
        level: 'error',
        message: 'boom',
        exception: { type: 'Error', value: 'boom', stack: 'Error: boom\n    at fn (/app/src/x.ts:10:5)' },
        tags: { route: '/api/x' },
        extra: { userId: 'u1' },
      },
      { eventId: 'a'.repeat(32), timestamp: 1_700_000_000_000 },
    );
    const lines = body.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    const envelopeHeader = JSON.parse(lines[0]);
    expect(envelopeHeader.event_id).toBe('a'.repeat(32));
    expect(envelopeHeader.dsn).toContain('4509876543210');
    const itemHeader = JSON.parse(lines[1]);
    expect(itemHeader.type).toBe('event');
    expect(itemHeader.length).toBe(Buffer.byteLength(lines[2], 'utf8'));
    const event = JSON.parse(lines[2]);
    expect(event.level).toBe('error');
    expect(event.message).toBe('boom');
    expect(event.exception.values[0].type).toBe('Error');
    expect(event.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
    expect(event.tags.route).toBe('/api/x');
    expect(eventId).toHaveLength(32);
  });
});

describe('sentry-http — scrubbing de segredos', () => {
  it('remove valores sensíveis em extra/tags/headers (case-insensitive)', () => {
    const scrubbed = scrubSecrets({
      ENCRYPTION_KEY: 'chave-real',
      session_secret: 'segredo',
      stripeSecretKey: 'sk_live_x',
      Authorization: 'Bearer abc',
      apiKey: 'k',
      password: 'p',
      safe: 'mantido',
      nested: { SESSION_SECRET: 'x', ok: 1, list: [{ apiKey: 'y' }, 'texto'] },
    }) as Record<string, unknown>;
    expect(scrubbed.ENCRYPTION_KEY).toBe('[Filtered]');
    expect(scrubbed.session_secret).toBe('[Filtered]');
    expect(scrubbed.stripeSecretKey).toBe('[Filtered]');
    expect(scrubbed.Authorization).toBe('[Filtered]');
    expect(scrubbed.apiKey).toBe('[Filtered]');
    expect(scrubbed.password).toBe('[Filtered]');
    expect(scrubbed.safe).toBe('mantido');
    const nested = scrubbed.nested as Record<string, unknown>;
    expect(nested.SESSION_SECRET).toBe('[Filtered]');
    expect(nested.ok).toBe(1);
    expect((nested.list as Array<Record<string, unknown>>)[0].apiKey).toBe('[Filtered]');
    expect((nested.list as unknown[])[1]).toBe('texto');
  });
});

describe('sentry-http — envio (fetch mockado)', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    __resetSentryHttp();
    process.env.SENTRY_DSN = DSN;
    process.env.NEXT_PUBLIC_SENTRY_DSN = '';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    __resetSentryHttp();
  });

  it('é no-op sem DSN', async () => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    __resetSentryHttp();
    expect(isSentryConfigured()).toBe(false);
    const res = await captureSentryEvent({ message: 'x' });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSentryDsn()).toBeNull();
  });

  it('envia POST para o endpoint de envelope com auth e body correto', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    const res = await captureSentryEvent({ level: 'warning', message: 'oi', extra: { password: 'p' } });
    expect(res.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://o4507.ingest.sentry.io/api/4509876543210/envelope/');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-sentry-envelope');
    expect(init.headers['X-Sentry-Auth']).toContain('sentry_key=abc123publickey');
    expect(init.body.split('\n').filter(Boolean)).toHaveLength(3);
    // segredo não vaza no corpo
    expect(init.body).not.toContain('"p"');
    expect(init.body).toContain('[Filtered]');
  });

  it('status não-2xx não lança', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    const res = await captureSentryEvent({ message: 'x' });
    expect(res.sent).toBe(false);
    expect(res.status).toBe(500);
  });

  it('erro de rede não lança (retorna sent=false)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await captureSentryEvent({ message: 'x' });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('network_error');
  });

  it('timeout via AbortSignal também não lança', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    process.env.SENTRY_HTTP_TIMEOUT_MS = '50';
    __resetSentryHttp();
    const res = await captureSentryEvent({ message: 'slow' });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('network_error');
  }, 10_000);
});
