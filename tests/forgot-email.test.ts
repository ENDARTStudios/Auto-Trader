import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const userFindUnique = vi.fn();
const resetCreate = vi.fn();
const sendEmailMock = vi.fn();
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    passwordReset: { create: (...a: unknown[]) => resetCreate(...a) },
  },
}));
vi.mock('@/lib/auth/session', () => ({
  generateToken: () => 'TOKEN-DE-TESTE',
  hashToken: (t: string) => 'hash-' + t,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true }),
  rateLimitResponse: () => new Response('{}', { status: 429 }),
}));
vi.mock('@/lib/notifications/email', () => ({
  sendEmail: (...a: unknown[]) => sendEmailMock(...a),
}));
vi.mock('@/lib/trading/logger', () => ({
  logger: {
    info: (...a: unknown[]) => loggerInfo(...a),
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: () => {},
    debug: () => {},
  },
}));

import { POST } from '@/app/api/auth/forgot/route';

const BASE_ENV = { ...process.env };
const originalNodeEnv = process.env.NODE_ENV;

function forgotRequest(email = 'user@example.com') {
  return new Request('http://localhost/api/auth/forgot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  userFindUnique.mockReset();
  resetCreate.mockReset();
  sendEmailMock.mockReset();
  loggerInfo.mockReset();
  loggerWarn.mockReset();
  process.env = { ...BASE_ENV };
  Reflect.set(process.env, 'NODE_ENV', originalNodeEnv);
  userFindUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
  resetCreate.mockResolvedValue({ id: 'reset-1' });
  sendEmailMock.mockResolvedValue({ ok: true, provider: 'resend', id: 'msg-1' });
});
afterEach(() => {
  process.env = { ...BASE_ENV };
});

describe('POST /api/auth/forgot — produção', () => {
  beforeEach(() => {
    Reflect.set(process.env, 'NODE_ENV', 'production');
  });

  it('chama sendEmail e NÃO devolve nem loga o token', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await POST(forgotRequest());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(body.token).toBeUndefined();

      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const mail = sendEmailMock.mock.calls[0][0] as { to: string; text: string; html?: string };
      expect(mail.to).toBe('user@example.com');
      expect(mail.text).toContain('TOKEN-DE-TESTE'); // o token vai NO E-MAIL, não no log
      // nada logado pode conter o token
      const logged = logSpy.mock.calls.flat().map(String).join('\n');
      expect(logged).not.toContain('TOKEN-DE-TESTE');
      expect(logged).not.toContain('/reset?token=');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('registra envio em logger sem token', async () => {
    await POST(forgotRequest());
    expect(loggerInfo).toHaveBeenCalledTimes(1);
    const [, , ctx] = loggerInfo.mock.calls[0];
    expect(JSON.stringify(ctx)).not.toContain('TOKEN-DE-TESTE');
  });

  it('falha do provider é logada SEM token e a resposta segue genérica', async () => {
    sendEmailMock.mockResolvedValue({ ok: false, provider: 'resend', code: 'EMAIL_PROVIDER_ERROR' });
    const res = await POST(forgotRequest());
    expect(await res.json()).toEqual({ ok: true });
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const [source, msg, ctx] = loggerWarn.mock.calls[0];
    expect(String(msg)).not.toContain('TOKEN-DE-TESTE');
    expect(JSON.stringify(ctx)).not.toContain('TOKEN-DE-TESTE');
    expect(source).toBe('api'); // LogSource válido para rotas de API
  });
});

describe('POST /api/auth/forgot — dev', () => {
  beforeEach(() => {
    Reflect.set(process.env, 'NODE_ENV', 'development');
  });

  it('devolve token/resetUrl fora de produção (E2E) e loga o link', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await POST(forgotRequest());
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.token).toBe('TOKEN-DE-TESTE');
      expect(body.resetUrl).toContain('/reset?token=TOKEN-DE-TESTE');
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('não chama sendEmail para e-mail inexistente (sem enumeração)', async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await POST(forgotRequest('naoexiste@example.com'));
    expect(await res.json()).toEqual({ ok: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
