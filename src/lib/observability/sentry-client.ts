// src/lib/observability/sentry-client.ts — captura de erro CLIENT-SAFE.
//
// O wrapper de servidor (./sentry.ts) usa o transporte HTTP que depende de
// node:crypto; importá-lo de um Client Component (providers.tsx) quebra o bundle
// do browser com "Module not found: node:crypto" (visto no e2e-meridian da CI).
// Este módulo não importa nada de Node: apenas loga localmente. Telemetria de
// browser, quando configurada, deve ser feita por um endpoint same-origin — não
// por SDK (que não está no package.json).
export function captureClientError(
  error: Error,
  context?: Record<string, unknown>,
): void {
  console.error(
    "[captureError:client]",
    context?.label ?? "unknown",
    error.message,
    context ?? "",
  );
}
