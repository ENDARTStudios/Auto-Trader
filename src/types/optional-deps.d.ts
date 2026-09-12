// Ambient stubs for OPTIONAL integrations (lazy require() + try/catch).
// These packages are intentionally NOT installed: observability (Sentry/OTEL),
// Redis cache and socket.io examples degrade gracefully without them.
// If any of them becomes a hard dependency, delete the matching stub and
// add the real package to package.json instead.
declare module "@sentry/nextjs";
declare module "@opentelemetry/sdk-node";
declare module "@opentelemetry/auto-instrumentations-node";
declare module "@opentelemetry/exporter-trace-otlp-http";
declare module "redis";
declare module "socket.io";
declare module "socket.io-client";
