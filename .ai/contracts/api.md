# `contracts/api-contracts.md` — Contratos HTTP API

> Endpoints HTTP expostos pelo Next.js App Router. Antes de alterar
> qualquer rota, consultar este arquivo para entender o contrato
> público. Mudanças breaking (remoção de campo, mudança de método,
> mudança de status code) requerem entrada em `DECISION_LOG.md`.

---

## Convenções gerais

- **Content-Type:** `application/json` para request e response
  (exceto onde notado).
- **Encoding:** UTF-8.
- **Error format:** sempre `{ "error": { "code": "STRING_CODE",
  "message": "string", "details"?: object } }`.
- **Success format:** sempre `{ "data": <payload> }` ou `{ "ok": true }`
  para endpoints de mutação sem retorno.
- **Status codes:** 200 (ok), 201 (created), 400 (bad request),
  401 (unauth), 404 (not found), 409 (conflict), 500 (server error),
  503 (signer unavailable — ver M3.2).
- **Versionamento:** atualmente sem versão explícita no path. Em
  futuro de breaking change, adicionar `/api/v2/...` e manter v1
  por período de depreciação.

---

## Endpoints de status e health

### `GET /api/status`

**Resposta (200):**
```json
{
  "data": {
    "engine": "running" | "stopped" | "paused",
    "phase": "M5-complete",
    "uptimeMs": 3600000,
    "paperMode": true,
    "version": "1.0.0"
  }
}
```

### `GET /api/runtime/status` (M5.5 — Observability)

**Resposta (200):** snapshot read-only do Registry. Sem side-effects.
Estrutura definida em `architecture/runtime.md` > Estado do runtime.

```json
{
  "data": {
    "phase": "M5-complete",
    "uptimeMs": 3600000,
    "tickCount": 14400,
    "lastTickAt": 1737000000000,
    "activeLease": { "holder": "runtime-main", "fence": 42, "expiresAt": 1737000005000 },
    "registry": {
      "counters": { "tx_total": 1500, "tx_confirmed": 1498 },
      "gauges": { "heap_used_mb": 87, "active_leases": 1, "canary_pct": 5 },
      "histograms": { "broadcast_latency_ms": { "count": 1500, "sum": 125000, "buckets": {} } }
    }
  }
}
```

---

## Endpoints de Engine

### `POST /api/engine/start`

Inicia o loop principal do engine (`runtime.start(periodMs)`).
Requer WriterLease ativa — se outra instância já tem a lease,
retorna 409.

**Request body:**
```json
{ "periodMs": 5000, "canaryPct"?: 5 }
```

**Resposta (200):** `{ "ok": true }`
**Erros:**
- 409: `{ "error": { "code": "LEASE_BUSY", "message": "engine already running" } }`
- 503: `{ "error": { "code": "SIGNER_UNAVAILABLE", "message": "signer process not ready" } }`

### `POST /api/engine/stop`

Sinaliza stop gracioso. O próximo tick NÃO é executado; loop
termina limpo. WriterLease é liberada.

**Resposta (200):** `{ "ok": true }`

### `POST /api/kill-switch`

Ativa kill-switch persistente. Engine para imediatamente no
próximo tick; novos `/api/engine/start` são rejeitados até
kill-switch ser desativado.

**Request body:**
```json
{ "reason": "manual operator trigger" }
```

**Resposta (200):** `{ "ok": true, "data": { "killedAt": 1737000000000 } }`

---

## Endpoints de Positions

### `GET /api/positions`

Lista posições abertas.

**Query params:**
- `?status=open|closed|all` (default: open)
- `?limit=50` (max 200)
- `?offset=0`

**Resposta (200):**
```json
{
  "data": [
    {
      "id": "pos_abc123",
      "token": "0x...",
      "amount": "1000000",
      "entryPrice": "1.234",
      "currentPrice": "1.345",
      "openedAt": 1737000000000,
      "stopLoss": "1.100",
      "takeProfit": "1.500",
      "status": "open"
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "total": 3 }
}
```

### `POST /api/positions`

Abre nova posição (paper ou live conforme modo).

**Request body:**
```json
{
  "token": "0x...",
  "amount": "1000000",
  "slippageBps": 30,
  "stopLoss": "1.100",
  "takeProfit": "1.500",
  "deadline": 1737000600
}
```

**Resposta (201):**
```json
{
  "data": {
    "id": "pos_abc123",
    "txHash": "0x...",
    "auditId": "audit_xyz",
    "status": "confirmed"
  }
}
```

**Erros:**
- 400: validação de schema falhou (zod).
- 422: token rejeitado por ScamDetector (score > threshold) ou
  RiskManager (circuit breaker triggered).
- 503: signer unavailable.

---

## Endpoints de History, Logs, Rounds, Scam Reports

### `GET /api/history`

**Query:** `?from=ISO_DATE&to=ISO_DATE&token=0x...&limit=100&offset=0`

**Resposta:** array de posições fechadas com PnL.

### `GET /api/logs`

**Query:** `?level=info|warn|error&limit=200&offset=0&since=ISO_DATE`

**Resposta:** array de entradas de `AppLog` (Prisma).

### `GET /api/rounds`

**Resposta:** array de rounds de trading (round = ciclo completo
SCOUT → ... → REBALANCE).

### `GET /api/scam-reports`

**Query:** `?token=0x...&minScore=50&limit=50`

**Resposta:** array de `ScamReport` com sub-scores por categoria.

---

## Endpoints de Config e Reserve

### `GET /api/config`

**Resposta:** objeto `Config` completo (defaults + overrides da DB).

### `PUT /api/config`

**Request body:** partial `Config` (apenas campos a atualizar).

**Resposta (200):** `{ "ok": true, "data": { <config atualizada> } }`

**Notas:**
- Campos FROZEN (ex.: `paperMode` em produção sem Vault) são
  rejeitados com 422.
- Mudança de `canaryPct` em runtime é permitida (sem restart).

### `GET /api/reserve` / `PUT /api/reserve`

Reserva USDC cold (split 50/50). GET retorna saldo atual; PUT
permite ajustar alvo (origina rebalanceamento automático).

---

## Endpoint de inicialização

### `POST /api/initialize`

Executa setup inicial: Prisma migrations + seed de config default.

**Request body:**
```json
{ "force": false }
```

**Resposta (200):**
```json
{ "ok": true, "data": { "migrations": "applied", "seed": "complete" } }
```

**Erros:**
- 409: já inicializado e `force=false`.

---

## Endpoints futuros (não implementados)

> Listados aqui para contrato futuro. Implementação depende de M6+.

### `GET /api/runtime/canary` (M6)

Inspects canary state: `canaryPct` atual, bucket distribution, tx
count por bucket.

### `PUT /api/runtime/canary` (M6)

Atualiza `canaryPct` em runtime. Requer auth de operador.

### `POST /api/runtime/rollback` (M6)

Força rollback para `canaryPct = 0` imediatamente (sem esperar
próximo tick).

---

## Regras de evolução

1. **Adição de endpoint:** sem breaking change. Registrar em
   `architecture/modules.md` > Camada de API.
2. **Adição de campo opcional em response:** sem breaking change.
3. **Remoção de campo, mudança de tipo, mudança de status code:**
   breaking change — requer DEC-NNN.
4. **Mudança de path:** breaking change — criar `/api/v2/...` e
   manter v1 por período de depreciação.
5. **Toda mudança DEVE atualizar este arquivo** antes do merge.

---

## Relacionado

- `architecture/interfaces.md` — assinaturas TypeScript canônicas.
- `contracts/events.md` — eventos emitidos por estes endpoints.
- `standards/security.md` STD-201.2 — least privilege em API.
- `standards/documentation.md` STD-302 — padrão de documentação de API.
- `CORE_RULES.md` Regra 9 — breaking changes exigem DEC-NNN.
- `DECISION_LOG.md` — registrar breaking changes de API.
- `memory/technical-debt.md` TD-007 — documentação OpenAPI pendente.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

