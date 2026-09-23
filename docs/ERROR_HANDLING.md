# ERROR_HANDLING — Convenções de Erro

> **Versão:** 1.0 — 2026-09-23
> **Pilares:** erro tratado é erro tipado + logado + respondido com formato estável. Pipeline de report: [ERROR_REPORTING.md](./ERROR_REPORTING.md). Runbook: [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md).

---

## 1. Camadas e responsabilidade

| Camada | Mecanismo | Arquivo |
|---|---|---|
| API routes | `handleApiError` + Zod nos inputs | `src/lib/api/error-handler.ts` |
| React (painéis) | ErrorBoundary por painel + `captureError` no QueryCache | `src/app/providers.tsx`, componentes dashboard |
| Global | crash-logger persistente | `src/lib/crash-logger.ts` |
| Observabilidade | Sentry + OTel | `src/lib/observability/sentry.ts`, `otel.ts` |
| Engine | event-bus + RiskEvent no Prisma + kill switches | `src/lib/trading/event-bus.ts`, `risk_config.json` |

## 2. Regras

1. **Nunca engolir:** sem `catch {}` vazio; todo catch loga com contexto (rota, ownerId, requestId).
2. **Resposta estável de API:** shape único de erro (status + `error.code` + mensagem segura) — detalhes internos/stack nunca vazam para o client (sanitização em `src/lib/sanitize.ts`).
3. **Erros de domínio tipados:** `src/lib/auth/errors.ts` define o padrão; erros novos seguem o mesmo estilo (classe/marker + código estável).
4. **Fail-safe no engine:** erro de feed/dados → kill switch `feed_stale_switch` (`close_neutralize`), nunca "seguir com último preço".
5. **Erro de fonte externa:** retry com backoff + registro em `SourceHealth`; fonte degradada não bloqueia o loop inteiro.
6. **Boundaries por painel:** um painel quebrado não derruba o dashboard (padrão S01-T004).

## 3. Taxonomia (use estes códigos em novas APIs)

| Código | Significado | Status |
|---|---|---|
| `VALIDATION_ERROR` | Zod rejeitou input | 400 |
| `UNAUTHENTICATED` | Sem sessão/cookie inválido | 401 |
| `FORBIDDEN` | RBAC negou (ver [RBAC.md](./RBAC.md)) | 403 |
| `NOT_FOUND` | Recurso inexistente ou fora do RLS | 404 |
| `RATE_LIMITED` | Rate limit excedido | 429 |
| `INTERNAL` | Erro não-classificado (logado com requestId) | 500 |
| `UNAVAILABLE` | Dependência externa/feed degradado | 503 |

## 4. Fluxo de um erro (exemplo prático)

```
POST /api/kill-switch (viewer)
 → requireSession ok → hasPermission falha
 → AuthzError(FORBIDDEN) → handleApiError → 403 {error:{code:"FORBIDDEN"}}
 → appendAuditLog (hash-chain) → Sentry breadcrumb
```

## 5. Pós-incidente

- Erros 5xx recorrentes abrem incidente ([INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md)).
- Episódios do engine viram aprendizado taxonomizado ([MEMORY.md](./MEMORY.md) §4, [ITERATION.md](./ITERATION.md)).

---

**Relacionados:** [API.md](./API.md) · [ERROR_REPORTING.md](./ERROR_REPORTING.md) · [MONITORING.md](./MONITORING.md)
