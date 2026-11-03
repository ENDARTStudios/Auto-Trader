// src/lib/observability/sentry-http.ts — transporte Sentry por ENVELOPE HTTP, sem SDK.
//
// Por que existe: o código chamava `require('@sentry/nextjs')`, que nunca esteve no
// package.json. O `require` falhava silenciosamente e NENHUM erro de produção saía da
// máquina. Este módulo fala o protocolo de ingestão do Sentry direto (envelope),
// então error tracking funciona sem adicionar dependência (e sem build step).
//
// Protocolo: POST <dsn.protocol>//<dsn.host>/api/<projectId>/envelope/
//   header HTTP: X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<key>, sentry_client=...
//   body: 3 linhas — envelope header (JSON), item header (JSON), evento (JSON).
//
// Regras de ouro: NUNCA lança, NUNCA bloqueia o request (timeout curto), e NUNCA
// envia segredo (scrubbing por nome de chave, recursivo, em extra/tags/headers).
import { randomBytes } from 'node:crypto';

export interface SentryDsn {
  protocol: 'http:' | 'https:';
  host: string;
  key: string;
  projectId: string;
}

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface SentryExceptionInput {
  type: string;
  value: string;
  stack?: string;
}

export interface SentryEventInput {
  level?: SentryLevel;
  message: string;
  exception?: SentryExceptionInput;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string; username?: string };
}

export interface SentryCaptureResult {
  sent: boolean;
  status?: number;
  reason?: string;
}

const REDACTED = '[Filtered]';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_SCRUB_DEPTH = 8;

// Chaves cujo VALOR nunca pode sair da máquina. Case-insensitive e por substring
// (authorizationHeader, x-api-key, privateKeyEncrypted etc. caem aqui).
const SECRET_KEY_PATTERN =
  /(encryption[_-]?key|session[_-]?secret|stripe[_-]?secret[_-]?key|password|passwd|authorization|api[_-]?key|apikey|secret|private[_-]?key|token|cookie|dsn)/i;

// Usado no teste e para reconfigurar em runtime (ex.: env trocada em dev).
let cachedDsn: SentryDsn | null | undefined;
let warnedAboutTransport = false;

export function parseSentryDsn(raw?: string | null): SentryDsn | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const key = decodeURIComponent(url.username || '');
  const projectId = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!key || !url.hostname || !projectId) return null;
  return { protocol: url.protocol as 'http:' | 'https:', host: url.host, key, projectId };
}

export function getSentryDsn(): SentryDsn | null {
  if (cachedDsn !== undefined) return cachedDsn;
  const raw = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || '';
  cachedDsn = parseSentryDsn(raw);
  return cachedDsn;
}

export function isSentryConfigured(): boolean {
  return getSentryDsn() !== null;
}

export function sentryEnvelopeUrl(dsn: SentryDsn): string {
  return dsn.protocol + '//' + dsn.host + '/api/' + dsn.projectId + '/envelope/';
}

// O header carrega a chave pública do DSN (é assim que o protocolo funciona), mas
// ele nunca é logado nem incluído em eventos.
export function sentryAuthHeader(dsn: SentryDsn): string {
  return (
    'Sentry sentry_version=7, sentry_key=' + dsn.key + ', sentry_client=auto-trader/1.0'
  );
}

export function scrubSecrets<T>(input: T, depth = 0): T {
  if (depth > MAX_SCRUB_DEPTH) return REDACTED as unknown as T;
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input.map((item) => scrubSecrets(item, depth + 1)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = scrubSecrets(value, depth + 1);
    }
    return out as unknown as T;
  }
  return input;
}

function parseStackFrames(stack: string): Array<{ filename: string; function: string; lineno?: number; in_app: boolean }> {
  const frames: Array<{ filename: string; function: string; lineno?: number; in_app: boolean }> = [];
  for (const line of stack.split('\n')) {
    const match = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (!match) continue;
    frames.push({
      function: match[1] || '<anonymous>',
      filename: match[2],
      lineno: Number(match[3]),
      in_app: !/node_modules|node:internal/.test(match[2]),
    });
    if (frames.length >= 50) break;
  }
  // Sentry espera frames do mais antigo para o mais recente.
  return frames.reverse();
}

function buildEventPayload(event: SentryEventInput, eventId: string, timestamp: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    event_id: eventId,
    timestamp: timestamp / 1000,
    platform: 'node',
    level: event.level ?? 'error',
    logger: 'auto-trader',
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    message: event.message,
  };
  if (event.exception) {
    payload.exception = {
      values: [
        {
          type: event.exception.type,
          value: event.exception.value,
          stacktrace: event.exception.stack ? { frames: parseStackFrames(event.exception.stack) } : undefined,
        },
      ],
    };
  }
  if (event.tags) payload.tags = scrubSecrets(event.tags);
  if (event.extra) payload.extra = scrubSecrets(event.extra);
  if (event.user) payload.user = scrubSecrets(event.user);
  return payload;
}

export function buildSentryEnvelope(
  dsn: SentryDsn,
  event: SentryEventInput,
  options: { eventId?: string; timestamp?: number } = {},
): { body: string; eventId: string } {
  const eventId = options.eventId ?? randomBytes(16).toString('hex');
  const timestamp = options.timestamp ?? Date.now();
  const envelopeHeader = {
    event_id: eventId,
    dsn: dsn.protocol + '//' + dsn.key + '@' + dsn.host + '/' + dsn.projectId,
    sent_at: new Date(timestamp).toISOString(),
  };
  const itemHeader = { type: 'event', content_type: 'application/json', length: undefined as number | undefined };
  const payload = buildEventPayload(event, eventId, timestamp);
  const payloadJson = JSON.stringify(payload);
  itemHeader.length = Buffer.byteLength(payloadJson, 'utf8');
  const body =
    JSON.stringify(envelopeHeader) + '\n' + JSON.stringify(itemHeader) + '\n' + payloadJson + '\n';
  return { body, eventId };
}

function timeoutMs(): number {
  const raw = Number(process.env.SENTRY_HTTP_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(raw, 250), 15000);
}

// Fire-and-forget seguro: NUNCA lança e nunca segura o request por mais que o timeout.
export async function captureSentryEvent(input: SentryEventInput): Promise<SentryCaptureResult> {
  const dsn = getSentryDsn();
  if (!dsn) return { sent: false, reason: 'not_configured' };
  if (typeof fetch !== 'function') return { sent: false, reason: 'no_fetch' };
  const { body, eventId } = buildSentryEnvelope(dsn, input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  timer.unref?.();
  try {
    const res = await fetch(sentryEnvelopeUrl(dsn), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': sentryAuthHeader(dsn),
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok && !warnedAboutTransport) {
      warnedAboutTransport = true;
      console.warn('[sentry-http] ingest recusou o evento (status ' + res.status + ')');
    }
    return { sent: res.ok, status: res.status };
  } catch (err) {
    if (!warnedAboutTransport) {
      warnedAboutTransport = true;
      // Detalhe do erro não inclui DSN (a URL nunca vai para o log).
      console.warn('[sentry-http] envio falhou, seguindo sem telemetria:', (err as Error).message);
    }
    return { sent: false, reason: 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

export function captureErrorHttp(error: Error, extra?: Record<string, unknown>, tags?: Record<string, string>): void {
  if (!isSentryConfigured()) return;
  void captureSentryEvent({
    level: 'error',
    message: error.message,
    exception: { type: error.name || 'Error', value: error.message, stack: error.stack },
    tags,
    extra,
  }).catch(() => {
    /* captureSentryEvent já é à prova de falha */
  });
}

// Só para testes: reavalia SENTRY_DSN e zera o aviso único.
export function __resetSentryHttp(): void {
  cachedDsn = undefined;
  warnedAboutTransport = false;
}
