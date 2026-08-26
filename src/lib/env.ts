// src/lib/env.ts — Centralized env validation (Zod)
// SPRINT: expandir conforme docs/SECRETS.md
// This module is the single source of truth for environment variables.
// Import `getEnv()` instead of reading `process.env` directly.

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").default("file:./prisma/dev.db"),
  ENCRYPTION_KEY: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  SIGNER_SOCKET_PATH: z.string().default("/tmp/signer.sock"),

  // Optional — extra layers
  GOOGLE_SAFE_BROWSING_KEY: z.string().optional(),
  ETHERSCAN_API_KEY: z.string().optional(),
  ARBISCAN_API_KEY: z.string().optional(),
  BASESCAN_API_KEY: z.string().optional(),
  OPTIMISM_ETHERSCAN_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  REDIS_URL: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),

  // Operational
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CRASH_LOG_DIR: z.string().default("./logs"),
  SIGNER_TEST_HOOKS: z.enum(["0", "1"]).default("0"),
  SIGNER_PROXY_SHARED_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // In dev/test we log but don't throw for optional vars — only for truly required ones
    // DATABASE_URL has default, so this only throws if schema itself is malformed
    console.error("[env] Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables — check .env.example");
  }
  _env = parsed.data;
  if (_env.NODE_ENV === "production" && _env.SIGNER_TEST_HOOKS === "1") {
    throw new Error("SIGNER_TEST_HOOKS=1 is forbidden in production");
  }
  return _env;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const v = getEnv()[key];
  if (v == null || v === "") throw new Error(`Missing required env: ${String(key)}`);
  return v as NonNullable<Env[K]>;
}

// For testing — reset cached env (e.g., after mocking process.env)
export function __resetEnvCache(): void {
  _env = null;
}
