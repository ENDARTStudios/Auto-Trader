import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendEmail, getEmailProvider, isEmailConfigured } from '@/lib/notifications/email';

const BASE_ENV = { ...process.env };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_WEBHOOK_URL;
  delete process.env.EMAIL_WEBHOOK_TOKEN;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_TIMEOUT_MS;
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...BASE_ENV };
});

describe('sendEmail — seleção de provider', () => {
  it('sem provider configurado -> EMAIL_NOT_CONFIGURED e nenhum fetch', async () => {
    expect(getEmailProvider()).toBe('none');
    expect(isEmailConfigured()).toBe(false);
    const r = await sendEmail({ to: 'a@b.co', subject: 's', text: 't' });
    expect(r).toEqual({ ok: false, provider: 'none', code: 'EMAIL_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendEmail — Resend', () => {
  it('POST api.resend.com com Bearer e body correto', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'Auto Trader <no-reply@auto-trader.app>';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }));

    const r = await sendEmail({ to: 'user@example.com', subject: 'Reset', text: 'corpo', html: '<p>corpo</p>' });
    expect(r).toEqual({ ok: true, provider: 'resend', id: 'msg_123', status: 200 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_test_key');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      from: 'Auto Trader <no-reply@auto-trader.app>',
      to: ['user@example.com'],
      subject: 'Reset',
      text: 'corpo',
      html: '<p>corpo</p>',
    });
  });

  it('status 4xx/5xx -> EMAIL_PROVIDER_ERROR (não lança)', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'nope' }), { status: 422 }));
    const r = await sendEmail({ to: 'a@b.co', subject: 's', text: 't' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('EMAIL_PROVIDER_ERROR');
    expect(r.status).toBe(422);
  });
});

describe('sendEmail — webhook próprio', () => {
  it('POST EMAIL_WEBHOOK_URL com Bearer quando token setado', async () => {
    process.env.EMAIL_WEBHOOK_URL = 'https://relay.example.com/send';
    process.env.EMAIL_WEBHOOK_TOKEN = 'whsec_abc';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'relay-1' }), { status: 202 }));

    const r = await sendEmail({ to: 'a@b.co', subject: 'S', text: 'T', html: '<b>T</b>' });
    expect(r).toEqual({ ok: true, provider: 'webhook', id: 'relay-1', status: 202 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://relay.example.com/send');
    expect(init.headers.Authorization).toBe('Bearer whsec_abc');
    expect(JSON.parse(init.body)).toEqual({ to: 'a@b.co', subject: 'S', text: 'T', html: '<b>T</b>' });
  });

  it('sem token não envia header Authorization', async () => {
    process.env.EMAIL_WEBHOOK_URL = 'https://relay.example.com/send';
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await sendEmail({ to: 'a@b.co', subject: 'S', text: 'T' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });
});

describe('sendEmail — falhas nunca lançam', () => {
  it('erro de rede -> EMAIL_SEND_FAILED', async () => {
    process.env.EMAIL_WEBHOOK_URL = 'https://relay.example.com/send';
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await sendEmail({ to: 'a@b.co', subject: 's', text: 't' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('EMAIL_SEND_FAILED');
  });

  it('timeout aborta -> EMAIL_TIMEOUT', async () => {
    process.env.EMAIL_WEBHOOK_URL = 'https://relay.example.com/send';
    process.env.EMAIL_TIMEOUT_MS = '60';
    fetchMock.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const r = await sendEmail({ to: 'a@b.co', subject: 's', text: 't' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('EMAIL_TIMEOUT');
  }, 10_000);

  it('resposta não-JSON no Resend não quebra o parse', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    const r = await sendEmail({ to: 'a@b.co', subject: 's', text: 't' });
    expect(r.ok).toBe(true);
    expect(r.id).toBeUndefined();
  });
});
