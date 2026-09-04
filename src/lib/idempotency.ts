// src/lib/idempotency.ts — Fase 4.12 Idempotency-Key (S32 Etapa 5)
// Middleware in-memory para endpoints de escrita. Armazena resposta por 24h.
// Uso: em route.ts POST/PUT, chamar `const cached = checkIdempotency(req); if(cached) return cached;` e após handler `storeIdempotency(key, response)`.

type Entry = { status: number; body: unknown; headers?: Record<string, string>; expiresAt: number };

const STORE = new Map<string, Entry>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getKey(req: Request): string | null {
  const key = req.headers.get('idempotency-key') ?? req.headers.get('Idempotency-Key');
  if (!key || key.length < 8 || key.length > 64) return null;
  // key deve ser UUID ou similar — validação leve
  if (!/^[a-zA-Z0-9-_]+$/.test(key)) return null;
  return key;
}

export function checkIdempotency(req: Request): Response | null {
  const key = getKey(req);
  if (!key) return null;
  const entry = STORE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    STORE.delete(key);
    return null;
  }
  return new Response(JSON.stringify(entry.body), {
    status: entry.status,
    headers: { 'Content-Type': 'application/json', 'X-Idempotent-Replayed': 'true', ...(entry.headers ?? {}) },
  });
}

export function storeIdempotency(req: Request, status: number, body: unknown, headers?: Record<string, string>): void {
  const key = getKey(req);
  if (!key) return;
  // só armazena 2xx/4xx, não 5xx
  if (status >= 500) return;
  STORE.set(key, { status, body, headers, expiresAt: Date.now() + TTL_MS });
  // GC simples: se >1000 entries, apaga expirados
  if (STORE.size > 1000) {
    for (const [k, v] of STORE.entries()) if (Date.now() > v.expiresAt) STORE.delete(k);
  }
}

// Para testes: limpar store
export function clearIdempotencyStore(): void {
  STORE.clear();
}
