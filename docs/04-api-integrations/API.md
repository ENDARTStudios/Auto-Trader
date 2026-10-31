# API — Rotas internas `/api/*`

> **Versão:** 1.0 — 2026-09-23
> **Spec OpenAPI:** `docs/openapi.json` (subconjunto). **Estilo:** JSON, sessão por cookie HttpOnly, RBAC por permissão, rate-limit por rota.
> **Referência de código:** handlers em `src/app/api/**/route.ts`; helpers em `src/lib/api/error-handler.ts`, `src/lib/auth/*`, `src/lib/rate-limit.ts`.

---

## 1. Convenções transversais

- **Auth:** sessão opaca (token SHA-256 em cookie HttpOnly) — ver [RBAC.md](./RBAC.md). Rotas críticas exigem `requireSession` + `hasPermission`.
- **Validação:** Zod em todo corpo/query; falha → `400 {error:{code:"VALIDATION_ERROR"}}`.
- **Erros:** shape estável — códigos em [ERROR_HANDLING.md](./ERROR_HANDLING.md) §3.
- **Rate-limit:** login 5/60s; rotas críticas conforme [WAF_RATE_LIMIT.md](./WAF_RATE_LIMIT.md).
- **Auditoria:** ações sensíveis vão para `AuditLog` com hash-chain.

## 2. Grupos de rotas (45 grupos em `src/app/api/`)

### Engine & trading
| Rota | Métodos | Notas |
|---|---|---|
| `/api/status` | GET | Snapshot do engine (saldo, posições, estado) — `dashboard:read`. |
| `/api/positions` | GET/POST | Posições com RLS por `ownerId`. |
| `/api/engine/start` | POST | Inicia loop — papel privilegiado. |
| `/api/kill-switch` | POST | **Kill switch** — log audit; viewer recebe 403. |
| `/api/config` | GET/POST | Config editor; envelope humano ([RULES.md](./RULES.md) §2). |
| `/api/reserve`, `/api/risk-scale`, `/api/diversification`, `/api/schedule`, `/api/rounds` | GET/POST | Operação do portfolio/risco. |
| `/api/scam-reports`, `/api/site-audit`, `/api/surveillance` | GET | Scam detection/sitio-integrity. |
| `/api/platforms`, `/api/market`, `/api/news`, `/api/watchlist` | GET | Dados de mercado. |

### Auth & usuários
| Rota | Métodos | Notas |
|---|---|---|
| `/api/auth/login` | POST | bcrypt + TOTP se habilitado; rate-limit 5/60s. |
| `/api/auth/logout`, `/api/auth/me` | POST/GET | Sessão opaca. |
| `/api/users` | GET/POST | **super_admin only** (S03-T005). |

### Finanças & histórico
| Rota | Métodos |
|---|---|
| `/api/history`, `/api/analytics`, `/api/backtest`, `/api/graduation`, `/api/fees`, `/api/billing` | GET (algumas POST) |

### Sistema & infra
| Rota | Métodos | Notas |
|---|---|---|
| `/api/health` | GET | Público — usado pelo Playwright/Docker (`/ready` para staging). |
| `/api/feature-flags` | GET/POST | GET `dashboard:read`; POST `flags:manage`. |
| `/api/logs`, `/api/debug`, `/api/system`, `/api/runtime` | GET | Autenticados (middleware 401). |
| `/api/wallets`, `/api/exchanges`, `/api/vault` | CRUD | RLS por `ownerId`; vault isolado no signer. |
| `/api/notifications`, `/api/webhooks`, `/api/upload`, `/api/i18n`, `/api/preferences` | CRUD | Utilitários. |
| `/api/stream` | GET (SSE) | Realtime do dashboard. |
| `/api/ai/ask`, `/api/ai-insights` | POST/GET | RAG sobre scam/signal (`KnowledgeGraph`+pgvector). |
| `/api/graph`, `/api/source-health`, `/api/scout-skip-stats`, `/api/roadmap`, `/api/initialize` | GET/POST | Suporte operacional. |

## 3. Exemplo (fluxo canônico)

```bash
# 1. Login (guarda cookie de sessão)
curl -c jar.txt -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@local","password":"..."}'

# 2. Status autenticado
curl -b jar.txt localhost:3000/api/status

# 3. Kill switch (auditoria + RBAC)
curl -b jar.txt -X POST localhost:3000/api/kill-switch
```

## 4. Versionamento

- Rotas vivem em `/api/*` **sem** prefixo `/v1` (decisão registrada em `SPRINT.md` §1 — correção do PLANO_MESTRE).
- Mudança incompatível de shape = nova rota + deprecação da antiga; nunca quebrar consumer interno sem PR acordado.

---

**Relacionados:** [RBAC.md](./RBAC.md) · [ERROR_HANDLING.md](./ERROR_HANDLING.md) · [WAF_RATE_LIMIT.md](./WAF_RATE_LIMIT.md) · [openapi.json](./openapi.json)
