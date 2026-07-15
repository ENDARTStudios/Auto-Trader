# `contracts/event-contracts.md` — Eventos do Sistema

> **STATE: FROZEN** — Contrato de eventos — adição ok; remoção/rename requer ADR.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> Catálogo de eventos emitidos e consumidos entre módulos.
> Diferentemente do audit log (que é persistente e append-only),
> eventos aqui são para **comunicação em runtime** entre módulos
> desacoplados. Para audit entries, ver `architecture/runtime.md`
> > Eventos de audit.

---

## Padrão de EventEmitter

O projeto usa `EventEmitter` nativo do Node.js para eventos
intra-processo. Cada módulo que emite eventos tem seu próprio
Emitter; consumers fazem `module.emitter.on('event', handler)`.

```typescript
// Convenção: todo Emitter é exportado como propriedade readonly
export const pipelineEvents = new EventEmitter();
export const leaseEvents = new EventEmitter();
export const broadcasterEvents = new EventEmitter();
export const registryEvents = new EventEmitter();
```

**Regras:**

- Handlers são `async` — o EventEmitter NÃO espera await. Use
  queue se precisar de ordenação estrita.
- Handlers NUNCA devem lançar — wrap em try/catch e logar.
- Event names são `SCREAMING_SNAKE_CASE`.

---

## Pipeline events (H2.6)

```typescript
type PipelineEvent =
  | { type: 'PIPELINE_START'; txHash: string; token: string; amount: string; timestamp: number }
  | { type: 'PIPELINE_PROGRESS'; txHash: string; stage: PipelineStage; timestamp: number }
  | { type: 'PIPELINE_RESULT'; txHash: string; status: PipelineResultStatus; receipt?: object; timestamp: number }
  | { type: 'PIPELINE_ERROR'; txHash: string; errorCode: string; errorMessage: string; stage: PipelineStage; timestamp: number };

type PipelineStage = 'sim' | 'verify' | 'liquidity' | 'authority' | 'sell_sim' | 'approval' | 'mev' | 'sign' | 'lease' | 'broadcast' | 'rpc';
type PipelineResultStatus = 'confirmed' | 'reverted' | 'sim_rejected' | 'lease_busy' | 'signer_unavailable' | 'broadcast_failed';
```

**Consumers típicos:**

- Dashboard (via WebSocket adapter, futuramente).
- Registry (M5.5): incrementa counters `pipeline_total`,
  `pipeline_<status>_total`, observa latência por stage no
  histogram `pipeline_stage_latency_ms`.
- Shadow harness (M5.2): ouve `PIPELINE_RESULT` para comparar
  Live vs. Shadow.

---

## Lease events (M4)

```typescript
type LeaseEvent =
  | { type: 'LEASE_ACQUIRED'; holder: string; fence: number; expiresAt: number; timestamp: number }
  | { type: 'LEASE_RENEWED'; holder: string; fence: number; newExpiresAt: number; timestamp: number }
  | { type: 'LEASE_RELEASED'; holder: string; fence: number; reason: 'manual' | 'expired' | 'revoked'; timestamp: number }
  | { type: 'LEASE_STOLEN'; victim: string; thief: string; fence: number; timestamp: number };
```

**Consumers típicos:**

- Registry: gauge `active_leases`, counter `lease_acquire_total`,
  `lease_steal_total`.
- CanaryBroadcaster: ouve `LEASE_STOLEN` para abortar broadcasts
  em flight (defensive — o LeasedBroadcaster já verifica token
  pré-broadcast).

---

## Broadcaster events (M3.3)

```typescript
type BroadcasterEvent =
  | { type: 'BROADCAST_ATTEMPT'; txHash: string; attempt: number; gasPrice: string; nonce: number; rpcEndpoint: string; timestamp: number }
  | { type: 'BROADCAST_RESULT'; txHash: string; confirmed: boolean; receipt?: object; attempts: number; latencyMs: number; timestamp: number }
  | { type: 'BROADCAST_RETRY'; txHash: string; attempt: number; reason: string; nextAttemptAt: number; timestamp: number }
  | { type: 'BROADCAST_GAS_BUMP'; txHash: string; oldGasPrice: string; newGasPrice: string; attempt: number; timestamp: number };
```

**Consumers típicos:**

- Registry: histogram `broadcast_latency_ms`, counter
  `broadcast_attempt_total`, `broadcast_gas_bump_total`.
- Dashboard: feed de tentativas em tempo real.

---

## Registry events (M5.5)

```typescript
type RegistryEvent =
  | { type: 'METRIC_REGISTERED'; name: string; kind: 'counter' | 'gauge' | 'histogram'; timestamp: number }
  | { type: 'METRIC_OBSERVED'; name: string; value: number; labels?: Record<string, string>; timestamp: number }
  | { type: 'SNAPSHOT_REQUESTED'; requestId: string; timestamp: number }
  | { type: 'SNAPSHOT_RETURNED'; requestId: string; metricCount: number; latencyMs: number; timestamp: number };
```

**Consumers típicos:**

- Exporter (M5.5): converte para JSON no endpoint
  `/api/runtime/status`.
- Alerting externo (M6+): conecta via WebSocket para alertas em
  tempo real.

---

## Chaos events (M5.4)

```typescript
type ChaosEvent =
  | { type: 'CHAOS_INJECT'; injectorId: string; target: string; severity: 'low' | 'medium' | 'high'; payload?: object; timestamp: number }
  | { type: 'CHAOS_CLEANUP'; injectorId: string; target: string; result: 'success' | 'failed'; timestamp: number };
```

**Consumers típicos:**

- Registry: counter `chaos_inject_total` por target, gauge
  `chaos_active_injectors`.
- Test harness: ouve `CHAOS_INJECT` para validar que o alvo
  correto foi atingido.

---

## Shadow events (M5.2)

```typescript
type ShadowEvent =
  | { type: 'SHADOW_FORK'; txHash: string; liveTarget: string; shadowTarget: string; timestamp: number }
  | { type: 'SHADOW_DIFF'; txHash: string; diffType: 'result' | 'latency' | 'gas' | 'revert_reason'; liveValue: unknown; shadowValue: unknown; timestamp: number }
  | { type: 'SHADOW_CONVERGENT'; txHash: string; latencyMs: number; timestamp: number };
```

**Consumers típicos:**

- Registry: counter `shadow_diff_total`, `shadow_convergent_total`,
  histogram `shadow_latency_ms`.
- Dashboard: feed de diffs em tempo real.

---

## Canary events (M5.3)

```typescript
type CanaryEvent =
  | { type: 'CANARY_BUCKETED'; txHash: string; bucket: number; canaryPct: number; routed: 'live' | 'shadow' | 'paper'; timestamp: number }
  | { type: 'CANARY_PCT_CHANGED'; oldPct: number; newPct: number; reason: 'manual' | 'auto_rollback' | 'auto_ramp'; timestamp: number };
```

**Consumers típicos:**

- Registry: counter `canary_routed_total{routed=...}`,
  `canary_rollback_total`.
- M6 rollback automático: ouve `CANARY_PCT_CHANGED` para validar
  que o rollback ocorreu dentro do SLO.

---

## Event ordering guarantees

| Emissor       | Ordenação garantida?                                       |
| ------------- | ---------------------------------------------------------- |
| Pipeline      | Sim, por txHash (single-threaded dentro de process()).     |
| Lease         | Sim, fence é monotônico (causal order).                   |
| Broadcaster   | Sim, por txHash (attempts sequenciais).                   |
| Registry      | Não — métricas são agregadas, não ordenadas.              |
| Chaos         | Não — injectors independentes.                             |
| Shadow        | Sim, por txHash (fork é sincronizado).                    |
| Canary        | Não — bucketing é por txHash mas eventos são independentes.|

**Regra:** se você precisa de ordenação estrita entre módulos,
use audit log (H0) — não events. Events são best-effort.

---

## Evolução

1. **Adicionar tipo de evento:** sem breaking change. Documentar
   aqui e no módulo emissor.
2. **Adicionar campo a evento existente:** sem breaking change
   (campo novo é opcional).
3. **Remover campo de evento:** breaking change — consumers podem
   depender dele. Requer ADR.
4. **Mudar tipo de campo:** breaking change — criar novo tipo de
   evento em vez de mutar.
5. **Renomear evento:** breaking change — manter alias por período
   de depreciação.

---

## Não-eventos (comunicação direta)

A comunicação entre os seguintes módulos NÃO usa events — é chamada
direta de método:

- `Pipeline` → `SimulationGate.process()` (chamada direta, síncrona)
- `SignerAdapter.submit()` → IPC → signer (request/response, não event)
- `LeasedBroadcaster.broadcast()` → `WriterLease.verifyToken()` +
  `Broadcaster.broadcast()` (chamada direta)

Events são para **notificação** (1 emitter, N consumers). Chamada
direta é para **comando** (1 caller, 1 callee com retorno).

---

## Relacionado

- `contracts/api.md` — endpoints que emitem estes eventos.
- `contracts/database.md` — tabelas que persistem estes eventos.
- `architecture/runtime.md` — lifecycle dos eventos.
- `architecture/invariants.md` INV-005 — audit exactly-once.
- `DECISION_LOG.md` DEC-001 — hash-chain do audit log.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

