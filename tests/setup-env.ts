// tests/setup-env.ts — isola a suíte do .env LOCAL do desenvolvedor.
//
// O vitest carrega .env (dotenv) para obter DATABASE_URL etc. Porém o .env de
// dev agora também contém integrações LOCAIS (Redis com senha, Ollama, sinks de
// Sentry/e-mail, UPLOAD_DIR). Herdá-las tornaria os testes não determinísticos
// (rate-limit usaria Redis real, provider de IA apareceria configurado, ETL
// mudaria de comportamento). Aqui removemos apenas essas chaves de integração;
// DATABASE_URL e demais segredos de infra continuam disponíveis. Testes que
// exercitam essas integrações usam vi.stubEnv/process.env explicitamente.
import 'dotenv/config';

const LOCAL_INTEGRATION_KEYS = [
  'AI_PROVIDER',
  'AI_API_KEY',
  'OPENAI_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'AI_EMBEDDING_MODEL',
  'AI_EMBEDDING_DIMS',
  'OLLAMA_URL',
  'OLLAMA_MODEL',
  'RAG_ALLOW_HASH_FALLBACK',
  'REDIS_URL',
  'SENTRY_DSN',
  'SENTRY_ENVIRONMENT',
  'EMAIL_WEBHOOK_URL',
  'EMAIL_WEBHOOK_TOKEN',
  'EMAIL_FROM',
  'EMAIL_TIMEOUT_MS',
  'UPLOAD_DIR',
  'UPLOAD_ENABLED',
  'LIVE_TRADING_ENABLED',
  'S14_APPROVED',
  'RAILWAY_DEPLOY_ENABLED',
];

for (const key of LOCAL_INTEGRATION_KEYS) {
  delete process.env[key];
}
