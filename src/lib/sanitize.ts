// src/lib/sanitize.ts — Fase 5.8 DOMPurify wrapper (S32 Etapa 5)
// Usa isomorphic-dompurify se instalado, senão fallback para escape simples.
// Todos os HTML dinâmicos (AI insights, descrições de token) devem passar por aqui antes de dangerouslySetInnerHTML.

let purify: { sanitize: (dirty: string) => string } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const createDOMPurify = require('isomorphic-dompurify');
  purify = createDOMPurify as { sanitize: (dirty: string) => string };
} catch {
  // fallback — sem DOMPurify, usa escape
}

/** Escapa HTML se DOMPurify não estiver disponível */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function sanitizeHtml(dirty: string): string {
  if (purify) return purify.sanitize(dirty);
  return escapeHtml(dirty);
}

/** Sanitiza texto de AI insights antes de renderizar */
export function sanitizeInsightText(text: string): string {
  // AI insights são plain text, mas sanitizamos por defesa em profundidade
  return sanitizeHtml(text);
}
