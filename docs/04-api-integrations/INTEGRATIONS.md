# INTEGRATIONS — Integrações Externas

> **Versão:** 1.0 — 2026-09-23
> **Regra:** APIs 100% gratuitas; externo é **advisory-only** (`src/lib/trading/external-systems.ts:1`). Evidências: `skills/EXTERNAL_SYSTEMS_INDEX.md`.

---

## 1. Fontes de mercado (somente leitura)

| Serviço | Uso | Módulo | Limites/cuidados |
|---|---|---|---|
| **Binance public REST** (`api.binance.com/api/v3`) | Preços CEX | engine | Só endpoints públicos; rate-limit respeitado; feed stale → kill switch (`feed_stale_switch`). |
| **DexScreener** (`api.dexscreener.com`) | Candidatos DEX, liquidez, volume 24h | `src/lib/etl/dexscreener.ts` | Batch no ETL; nunca por-request da UI. |
| **GoPlus** | Security audit de token (honeypot, mint, blacklist) | `src/lib/etl/goplus.ts`, `goplus-scanner.ts` | Sinal forte, não prova — passa pelo scam detector multicamada. |
| **Etherscan family** (Arbiscan, Basescan, Optimistic Etherscan) | Verificação de source de contrato | `src/lib/etl/etherscan.ts` | Contrato não-verificado = sinal de risco (`hasMint`, `isProxy`). |
| **CoinGecko** | Market cap/preços agregados | `src/lib/etl/coingecko.ts` | ETL batch (10 tokens core). |

## 2. Infra local (docker-compose)

| Serviço | Uso | Notas |
|---|---|---|
| **Postgres 16 + pgvector** (`pgvector/pgvector:pg16`) | DB de produção/RAG | Dev usa SQLite (`db/custom.db`); `npx prisma migrate deploy` em prod. |
| **ollama** + `nomic-embed-text` | Embeddings locais (RAG) | Custo zero, sem dados saindo da máquina; healthcheck no compose. |

## 3. Observabilidade & billing

| Serviço | Uso | Módulo |
|---|---|---|
| **Sentry** | Error reporting (DSN em env) | `src/lib/observability/sentry-init.ts` |
| **OpenTelemetry** | Traces/metrics | `src/lib/observability/otel.ts`, `exporter.ts` |
| **Stripe** | Billing/pricing (planos em `plans.ts`) | `src/lib/billing/stripe-hmac.ts` — webhooks com verificação HMAC |

## 4. Sistemas de trading externos (analisados, não integrados)

TA, Backtrader, NautilusTrader, Freqtrade, CCXT, VectorBT, Lumibot, Hummingbot, FinRL + 11 de agent-infra — todos **advisory-only**: lemos design/evidência, zero código copiado (copyleft/fair-code = SPEC-ONLY). Execução real (ordens em exchange real) só na fase S14, com envelope humano e graduação completa.

## 5. Regras de integração (checklist para nova fonte)

1. É gratuita e tem API documentada? (senão: não integra)
2. Rate-limit conhecido e respeitado no cliente?
3. Health da fonte registrada em `SourceHealth` (degradação visível)?
4. Falha da fonte não derruba o engine (circuit breaker)?
5. Sem segredos no código — env/vault ([SECRETS.md](./SECRETS.md)).
6. Registro da decisão em `DECISOES.md` + entrada nesta página.

---

**Relacionados:** [RESEARCH.md](./RESEARCH.md) · [MONITORING.md](./MONITORING.md) · [COMPLIANCE.md](./COMPLIANCE.md)
