// src/lib/notifications/email.ts — e-mail transacional real (rodada 10).
//
// Providers (ordem de precedência, todos por env — sem dependência nova):
//   1. RESEND_API_KEY  -> POST https://api.resend.com/emails (Authorization: Bearer),
//      from = EMAIL_FROM (obrigatório).
//   2. EMAIL_WEBHOOK_URL -> POST JSON {to,subject,text,html} (Bearer EMAIL_WEBHOOK_TOKEN
//      quando setado) — use com um relay próprio.
//   3. nada configurado -> { ok:false, code:'EMAIL_NOT_CONFIGURED' } (nunca lança).
//
// Contrato: NUNCA lança; timeout curto (5s, EMAIL_TIMEOUT_MS override); nunca loga
// corpo/token; retorna {ok, provider, id?, code?}.
export type EmailProvider = 'resend' | 'webhook' | 'none';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  ok: boolean;
  provider: EmailProvider;
  id?: string;
  code?: string;
  status?: number;
}

const DEFAULT_FROM = 'Auto Trader <no-reply@auto-trader.local>';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function getEmailProvider(): EmailProvider {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.EMAIL_WEBHOOK_URL) return 'webhook';
  return 'none';
}

export function isEmailConfigured(): boolean {
  return getEmailProvider() !== 'none';
}

function timeoutMs(): number {
  const raw = Number(process.env.EMAIL_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 5000;
  return Math.min(Math.max(raw, 250), 15000);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const provider = getEmailProvider();
  if (provider === 'none') return { ok: false, provider, code: 'EMAIL_NOT_CONFIGURED' };
  if (typeof fetch !== 'function') return { ok: false, provider, code: 'EMAIL_FETCH_UNAVAILABLE' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  timer.unref?.();

  try {
    if (provider === 'resend') {
      const from = process.env.EMAIL_FROM || DEFAULT_FROM;
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          html: input.html ?? undefined,
        }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({} as { id?: string }));
      if (!res.ok) return { ok: false, provider, code: 'EMAIL_PROVIDER_ERROR', status: res.status };
      return { ok: true, provider, id: (body as { id?: string }).id, status: res.status };
    }

    // provider === 'webhook'
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.EMAIL_WEBHOOK_TOKEN) headers.Authorization = 'Bearer ' + process.env.EMAIL_WEBHOOK_TOKEN;
    const res = await fetch(process.env.EMAIL_WEBHOOK_URL as string, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: input.to, subject: input.subject, text: input.text, html: input.html ?? null }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, provider, code: 'EMAIL_PROVIDER_ERROR', status: res.status };
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, provider, id: body.id, status: res.status };
  } catch (err) {
    // AbortError (timeout), DNS, TLS…: falha silenciosa para o caller, sem stack no log.
    const code = (err as Error)?.name === 'AbortError' ? 'EMAIL_TIMEOUT' : 'EMAIL_SEND_FAILED';
    return { ok: false, provider, code };
  } finally {
    clearTimeout(timer);
  }
}
