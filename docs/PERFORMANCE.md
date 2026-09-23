# PERFORMANCE — Orçamentos e Otimizações

> **Versão:** 1.0 — 2026-09-23
> **Baselines atuais (CI/lint audit S32):** next build **45 rotas**, vitest suite verde, lint 0 erros.

---

## 1. Orçamentos (budgets)

| Dimensão | Orçamento | Como medir |
|---|---|---|
| Build | `next build` sem warnings novos; 45 rotas é a referência atual | CI (build job) |
| Testes unitários | Suite `vitest run` < 60s local; coverage não regride | `npm run test:coverage` + Codecov |
| E2E | Playwright timeout 30s/spec; suite < 15min em CI | `npm run test:e2e` |
| API | Rotas críticas (`/api/status`, `/api/positions`) respondem < 300ms p95 em dev com SQLite | OTel metrics (`src/lib/observability/metrics.ts`) |
| Engine loop | 1 ciclo de scout→exit sem starvation do event loop (in-process singleton) | logs do engine + `performance-snapshot.ts` |

## 2. Frontend

- **Next.js 16 (App Router)** + React 19; standalone build para produção (`npm run build` copia `.next/static` + `public` para `.next/standalone`).
- Skeletons + motion em painéis (`market-panel.tsx` etc.) para percepção de velocidade — diretrizes em [MOTION.md](./MOTION.md).
- TanStack Query para cache/dedup de fetching; ErrorBoundary por painel evita re-render total.
- SSE realtime via `/api/stream` para atualizações sem polling agressivo.
- Imagens/fontes: sem assets pesados no bundle inicial; Tailwind purge por default.

## 3. Backend / Engine

- **Engine in-process** (singleton no Next) — sem overhead de rede; coordenado por `event-bus.ts` e `cron-evolution.ts`.
- **SQLite (dev)** via Prisma: índices no schema para queries de `Position`/`AppLog`; **PostgreSQL+pgvector** para produção/escala (ver [ROADMAP.md](./ROADMAP.md)).
- **Rate-limit** nas rotas críticas (`src/lib/rate-limit.ts`) — protege latência sob abuso (ver [WAF_RATE_LIMIT.md](./WAF_RATE_LIMIT.md)).
- **Cache de fontes externas:** ETL é batch (CoinGecko/DexScreener/GoPlus/Etherscan), não por-request — nunca chamar fonte externa dentro de request de UI.
- **RAG:** embeddings gerados offline pelo ETL; queries só vetam/pg_trgm.

## 4. Processo

- Toda PR que adiciona rota/painel deve citar impacto no orçamento na descrição.
- Regressão de performance é bug (triagem em [QA_TESTING.md](./QA_TESTING.md)).
- Métricas contínuas: ver [MONITORING.md](./MONITORING.md) (OTel exporter, snapshots `PerformanceSnapshot`).

---

**Relacionados:** [MONITORING.md](./MONITORING.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [TESTING.md](./TESTING.md)
