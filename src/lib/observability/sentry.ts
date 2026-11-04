// src/lib/observability/sentry.ts — wrapper de error tracking usado pelas rotas.
//
// Contrato: NUNCA lança (chamado no caminho de erro de requests) e sempre registra
// localmente. Telemetria: transporte HTTP por envelope (./sentry-http.ts), sem SDK
// — o antigo require('@sentry/nextjs') foi removido (pacote nunca esteve no
// package.json e quebrava o bundle do browser via providers.tsx).
// Este módulo é SERVER-ONLY (node:crypto); clientes usam ./sentry-client.ts.
import { captureErrorHttp, captureSentryEvent } from '@/lib/observability/sentry-http';

export function captureError(error: Error, context?: Record<string, unknown>): void {
  // Log local sempre (fonte de verdade para quem lê logs/crash.log).
  console.error('[captureError]', context?.label ?? 'unknown', error.message, context ?? '');
  // Envia por HTTP (envelope), fire-and-forget. Sem SDK por contrato.
  captureErrorHttp(error, context);
}

export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, unknown>,
): void {
  console.log('[captureMessage:' + level + ']', message, context ?? '');
  void captureSentryEvent({ level, message, extra: context });
}
