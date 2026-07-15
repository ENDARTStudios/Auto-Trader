# `architecture/runtime.md` — Fluxo, Eventos, Lifecycle

> Documenta o fluxo canônico em runtime, o lifecycle do processo
> signer isolado, o loop principal de trading e os eventos de audit
> emitidos. Para módulos individuais, veja `modules.md`. Para
> assinaturas, veja `interfaces.md`.

---

## Fluxo canônico de transação (H0 → M5)

```
                  Market Data
                       │
                       ▼
                ┌──────────────┐
                │   Pipeline   │ (H2.6 — src/lib/chain/pipeline.ts)
                │   .process() │
                └──────┬───────┘
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
  ┌─────────┐    ┌──────────┐    ┌──────────────┐
  │ Sim Gate│    │Contract  │    │ Liquidity    │
  │  (H1.2) │    │Verify    │    │ Verify       │
  │         │    │ (H2.1)   │    │ (H2.2)       │
  └────┬────┘    └────┬─────┘    └──────┬───────┘
       │              │                 │
       └──────────────┼─────────────────┘
                      │
                      ▼
              ┌────────────────┐
              │Approval Hard.  │ (H1.3)
              │+ Token Authority│ (H2.3)
              │+ Sell Sim      │ (H2.4)
              │+ MEV Baseline  │ (H1.4)
              └────────┬───────┘
                       │
                       ▼
              ┌────────────────┐
              │ SignerAdapter  │ (M3.1 — src/lib/chain/signer-adapter.ts)
              │  .submit()     │
              └────────┬───────┘
                       │ IPC binário
                       ▼
              ┌────────────────┐
              │  Signer RPC    │ (M3.2 — processo isolado)
              │  (src/signer/) │ segura chave privada
              └────────┬───────┘
                       │ signedTx (string)
                       ▼
              ┌────────────────┐
              │ WriterLease    │ (M4 — src/lib/chain/writer-lease.ts)
              │  .acquire()    │ fencing token monotônico
              └────────┬───────┘
                       │ LeaseToken
                       ▼
              ┌────────────────────────┐
              │ LeasedBroadcaster      │ (M4 — leased-broadcaster.ts)
              │ verifyToken() THEN     │
              │ delegate to Broadcaster│
              └────────┬───────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  Broadcaster   │ (M3.3 — broadcaster.ts)
              │  .broadcast()  │ prefixa erros BROADCAST_*
              └────────┬───────┘
                       │
                       ▼
              ┌────────────────┐
              │ RPC Quorum     │ (H1.1 — rpc-resilience.ts)
              │ retry + fallback│
              └────────┬───────┘
                       │
                       ▼
                  Blockchain
                       │
                       ▼
              ┌────────────────┐
              │  Audit Log     │ (H0 — audit-log.ts)
              │  hash-chain    │ entrada append-only
              └────────────────┘
```

**Invariante:** Pipeline NUNCA pula etapas. Qualquer falha em qualquer
etapa lança `PipelineError` com código prefixado
(`SIM_*`, `VERIFY_*`, `APPROVAL_*`, `MEV_*`, `SIGNER_*`, `LEASE_*`,
`BROADCAST_*`, `RPC_*`). A classificação de erro é parte do contrato
público (DEC-005).

---

## Lifecycle do processo signer (M3.2)

```
┌─────────────────────────────────────────────────────┐
│  Engine principal (Next.js, processo Node)          │
│                                                     │
│  ┌─────────────────────┐                            │
│  │ SignerAdapter       │ ← cliente IPC              │
│  │  .submit(req)       │                            │
│  └──────────┬──────────┘                            │
└─────────────┼───────────────────────────────────────┘
              │ stdin/stdout (protocolo binário)
              │ magic + length + type + payload
              ▼
┌─────────────────────────────────────────────────────┐
│  Processo signer isolado (src/signer/main.ts)       │
│                                                     │
│  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │ wallet-methods.ts   │  │ sign-methods.ts     │  │
│  │ list/add/remove     │  │ personal_sign       │  │
│  │                     │  │ eth_signTypedData_v4│  │
│  └─────────────────────┘  └─────────────────────┘  │
│                                                     │
│  ┌─────────────────────┐                            │
│  │ audit.ts            │ hash-chain independente   │
│  │ (audit log interno) │ (entradas próprias)       │
│  └─────────────────────┘                            │
│                                                     │
│  Chave privada: NUNCA sai deste processo.           │
│  Mensagens assinadas saem via stdout.               │
└─────────────────────────────────────────────────────┘
```

**Lifecycle:**

1. Engine principal faz `spawn('tsx', ['src/signer/main.ts'])` na inicialização.
2. Signer lê mnemonic de variável de ambiente `SIGNER_MNEMONIC` (ou
   arquivo protegido via Vault/KMS em produção).
3. Signer emite `ready` frame; engine passa a aceitar `submit()`.
4. Cada `submit()` gera:
   - Entrada de audit no signer (`audit.ts` — hash-chain interna).
   - Resposta com `signature` + `auditHash` (para correlação).
5. Em crash do signer: engine detecta EOF no stdout, marca signer
   como indisponível, rejeita novos `submit()` com `SIGNER_UNAVAILABLE`.
   Restart automático é responsabilidade do operador (não do engine).

**REG-NNN associados:** ver `SECURITY.md` (signer isolation tests).

---

## Loop principal de trading (M5.6 — Long-Duration)

```typescript
// Padrão OBRIGATÓRIO em src/lib/runtime/long-duration.ts
// e em qualquer novo harness de duração.

async function runLongDuration(durationMs: number, periodMs: number) {
  const runtime = buildRuntime({ /* opts */ });
  const deadline = Date.now() + durationMs;
  let running = true;

  // Signal handler — sinaliza stop gracioso
  const onSignal = () => { running = false; };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    while (running && Date.now() < deadline) {
      await runtime.tick();         // 1 tick
      await sleep(periodMs);        // espera controlada (NÃO setInterval)
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await runtime.stop();
  }
}
```

**Por que `while(running)` e não `setInterval`:**

- `setInterval` não respeita await — pode acumular ticks se um tick
  demorar mais que o intervalo.
- `setInterval` é difícil de parar gracioso em testes (precisa de
  `clearInterval` explícito + await pending).
- `while(running) { await tick(); await sleep(); }` garante que o
  próximo tick só começa após o anterior terminar + sleep.

---

## Eventos de audit (H0 — hash-chain)

Toda operação sensível gera uma entrada no audit log (`audit-log.ts`).
A entrada é append-only, com hash que encadeia à entrada anterior
(tamper-evident).

### Tipos de evento

| EventType           | Quem emite                | Campos principais                                       |
| ------------------- | ------------------------- | ------------------------------------------------------- |
| `PIPELINE_START`    | Pipeline                  | txHash, token, amount, slippage                         |
| `PIPELINE_RESULT`   | Pipeline                  | txHash, status, receipt, auditId                        |
| `SIM_REJECT`        | SimulationGate            | txHash, reason, gasEstimate                             |
| `SIGN_REQUEST`      | SignerAdapter             | requestId, method, auditContext                         |
| `SIGN_RESPONSE`     | SignerAdapter             | requestId, signature, signerAuditHash, latencyMs        |
| `LEASE_ACQUIRE`     | WriterLease               | holder, fence, ttlMs, expiresAt                         |
| `LEASE_RELEASE`     | WriterLease               | holder, fence, reason                                   |
| `BROADCAST_ATTEMPT` | Broadcaster               | txHash, attempt, gasPrice, nonce                        |
| `BROADCAST_RESULT`  | Broadcaster               | txHash, confirmed, attempts, latencyMs                  |
| `RPC_FALLBACK`      | rpc-resilience            | failedEndpoint, fallbackEndpoint, reason                |
| `CHAOS_INJECT`      | ChaosInjector             | type, target, severity                                  |
| `SHADOW_DIFF`       | ShadowHarness             | txHash, liveResult, shadowResult, diffType              |
| `CANARY_BUCKET`     | CanaryBroadcaster         | txHash, bucket, canaryPct, routed                       |

### Estrutura da entrada

```typescript
interface AuditEntry {
  seq: number;                  // monotônico crescente
  timestamp: number;            // unix ms
  type: EventType;
  payload: Record<string, unknown>;
  prevHash: string;             // hash da entrada seq-1 (chain)
  hash: string;                 // SHA-256(prevHash + canonical(payload))
  version: 2;                   // versão do schema (após H0.3 fix)
}
```

**Invariante (DEC-001):** o hash é computado com `JSON.stringify(entry,
sortedReplacerFunction)` — não `sortedKeysArray` (que silenciosamente
dropava nested keys pré-H0.3).

---

## Estado do runtime (snapshot M5.5)

O endpoint `/api/runtime/status` retorna um snapshot read-only com:

```json
{
  "phase": "M5-complete",
  "uptimeMs": 3600_000,
  "tickCount": 14400,
  "lastTickAt": 1737000000000,
  "activeLease": { "holder": "runtime-main", "fence": 42, "expiresAt": 1737000005000 },
  "registry": {
    "counters": { "tx_total": 1500, "tx_confirmed": 1498, "tx_reverted": 2 },
    "gauges": { "heap_used_mb": 87, "active_leases": 1, "canary_pct": 5 },
    "histograms": {
      "broadcast_latency_ms": { "count": 1500, "sum": 125000, "buckets": { /* ... */ } }
    }
  },
  "canary": { "pct": 5, "bucketSeed": "keccak256(txHash) % 100" },
  "shadow": { "enabled": true, "diffs": 0 }
}
```

Consumidores: dashboard, harnesses M5.4/5.2/5.3/5.6, alerting externo.
