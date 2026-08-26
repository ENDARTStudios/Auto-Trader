// src/lib/observability/otel.ts — OpenTelemetry (OTLP) — no-op if endpoint not set
// Supports Sentry, Datadog, New Relic, Grafana Tempo — all speak OTLP.

let sdk: any | null = null;

export async function initOTel(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    await sdk.start();
    console.log(`[otel] OTEL started → ${endpoint}`);
  } catch (e) {
    console.warn('[otel] Failed to start OTEL:', (e as Error).message);
  }
}

export async function shutdownOTel(): Promise<void> {
  try {
    await sdk?.shutdown();
  } catch {
    // ignore
  }
}
