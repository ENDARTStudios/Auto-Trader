# architecture/runtime.md — Fluxo Completo do Sistema

> Diagramas, pipeline, entradas, saídas, eventos.
> Para mapa de módulos ver `modules.md`; para dependências ver
> `dependencies.md`; para histórico de evolução ver
> `memory/implementation-history.md`.

---

## Visão geral

O sistema é um **trading engine autônomo de criptomoedas em paper mode
default**, com camada de hardening defense-in-depth (H0 → M5) que o
prepara para eventual live trading. O runtime principal é composto
pela factory `buildRuntime()` que instancia a stack completa descrita
abaixo.

```
┌────────────────────────────────────────────────────────────────────┐
│                      NEXT.JS 16 APP (porta 3000)                   │
│                                                                    │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐ │
│  │ Dashboard UI     │◄──►│ API Routes       │◄──►│ Engine de    │ │
│  │ (shadcn/ui)      │    │ /api/*           │    │ Trading      │ │
│  └──────────────────┘    └──────────────────┘    └──────┬───────┘ │
│                                                          │         │
│  /api/runtime/status ◄── observability/snapshot.ts ◄─────┤         │
│                                                          │         │
└──────────────────────────────────────────────────────────┼─────────┘
                                                            │
                                                            ▼
┌────────────────────────────────────────────────────────────────────┐
│                     RUNTIME (buildRuntime)                         │
│                                                                    │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ Market  │→ │ Pipeline │→ │  Signer    │→ │ Writer Lease     │  │
│  │ Data    │  │ (H2.6)   │  │ Adapter    │  │ (M4 fencing)     │  │
│  └─────────┘  └──────────┘  │ (M3.1)     │  └────────┬─────────┘  │
│                              └─────┬──────┘            │            │
│                                    │ IPC               │ verify    │
│                                    ▼                   │ token     │
│                              ┌──────────┐              │            │
│                              │ Signer   │              ▼            │
│                              │ Process  │      ┌──────────────────┐│
│                              │ (M3.2)   │      │ LeasedBroadcaster││
│                              │ FROZEN   │      │ (M4)             ││
│                              └──────────┘      └────────┬─────────┘│
│                                                         │           │
│                                                         ▼           │
│                                                ┌────────────────┐  │
│                                                │ Broadcaster    │  │
│                                                │ (M3.3)         │  │
│                                                └────────┬───────┘  │
│                                                         │           │
│                                                         ▼           │
│                                                ┌────────────────┐  │
│                                                │ RPC Quorum     │  │
│                                                │ (H1.1)         │  │
│                                                └────────┬───────┘  │
│                                                         │           │
└─────────────────────────────────────────────────────────┼───────────┘
                                                          ▼
                                                   ┌─────────────┐
                                                   │ Blockchain  │
                                                   │ (EVM L2)    │
                                                   └─────────────┘
```

---

## Pipeline (H2.6) — sequência de gates

Entrada: market data (token address, pool address, preço, volume).
Saída: `PipelineResult` com `approved: boolean` e `reason: GateName | null`.

```
Input (token, pool)
    │
    ▼
1. liquidity-verification.ts  [H2.2]
    REJECT se: LP lock expirado / concentração LP em poucos holders / liquidez < minLiquidity
    │
    ▼
2. token-authority.ts  [H2.3]
    REJECT se: mint authority não renunciada / freeze authority ativa / upgradeability não justificada
    │
    ▼
3. contract-verification.ts  [H2.1]
    REJECT se: source code não-verificado / proxy oculto / selfdestruct / delegatecall
    │
    ▼
4. simulation-gate.ts  [H1.2]
    REJECT se: simulação de buy reverte / state-diff divergente do esperado
    │
    ▼
5. mev-baseline.ts  [H1.4]
    REJECT se: sandwich opportunity detectada / slippage alto + liquidez baixa
    │
    ▼
6. approval-hardening.ts  [H1.3]
    REJECT se: approval type(uint256).max / approval > cap / approval > saldo on-chain
    │
    ▼
7. sell-simulation.ts  [H2.4]
    REJECT se: simulação de sell reverte / slippage de sell acima do limiar (honeypot)
    │
    ▼
PipelineResult { approved: true, reason: null }
```

Cada gate REJECT produz `PipelineResult { approved: false, reason:
<GateName> }` e o contador `gateRejects.<gate>` é incrementado no
Registry (M5.5).

---

## Signer IPC (M3.2) — protocolo de comunicação

O signer é um **processo separado** (não uma função importada). Toda
comunicação é via mensagens serializadas definidas em
`src/lib/signer-protocol.ts`.

```
Engine (processo principal)              Signer (processo isolado)
        │                                         │
        │  SignRequest { method, params, reqId }  │
        │ ──────────────────────────────────────► │
        │                                         │ verify domain
        │                                         │ load key (Vault/KMS)
        │                                         │ sign
        │                                         │ append audit
        │                                         │
        │  SignResponse { reqId, result, error }  │
        │ ◄────────────────────────────────────── │
        │                                         │
```

**Invariantes:**
- Chave privada **nunca** sai do processo signer.
- Engine nunca carrega a chave privada.
- Toda operação de sign é registrada no audit log interno do signer
  (`src/signer/audit.ts`, hash-chain H0.3 separada da audit-chain do
  engine principal).
- Domain separator aplicado em `sign-methods.ts` para evitar
  cross-protocol signature reuse.

---

## Writer Lease (M4) — fencing tokens Kleppmann

```
Writer A                                  Writer B (após failover)
   │                                              │
   │  acquire() ────────────►  LeaseStore         │
   │  ◄──── token=42 ──────   (owner=A)           │
   │                                              │
   │  (network partition; A acha que tem lease)   │
   │                                              │  acquire() ────────────►
   │                                              │  ◄──── token=43 ──────
   │                                              │   (owner=B, A expirou)
   │                                              │
   │  broadcast(tx)                               │  broadcast(tx)
   │  ─► LeasedBroadcaster                        │  ─► LeasedBroadcaster
   │      verifyToken(42)                         │      verifyToken(43)
   │      ─► FENCING_TOKEN_STALE ✗                │      ─► ok ✓
   │          (token atual=43, recebido=42)       │          (token atual=43)
   │          REJECT                              │          BROADCAST ✓
   │                                              │
```

Padrão Kleppmann ("How to do distributed locking"): cada acquire
recebe um token **estritamente maior** que o anterior. O
`LeasedBroadcaster` verifica o token ANTES de broadcastar. Um writer
stale (que ainda acredita ter a lease) é rejeitado pelo broadcaster,
mesmo que o LeaseStore já tenha eleito outro writer.

**REG-NNN:**
- REG-015: fencing token é monotônico estrito.
- REG-016: acquire é exclusivo (apenas 1 owner por vez).
- REG-017: renew após timeout exige re-acquire (não extende stale lease).
- REG-018: reconnect não reanima lease stale (writer deve re-adquirir).

---

## Observability (M5.5) — Registry único

```
┌─────────────────────────────────────────────────────────────────┐
│                     observability/registry.ts                   │
│                          (Registry único)                        │
└────┬───────┬───────┬───────┬───────┬───────┬───────┬────────────┘
     │       │       │       │       │       │       │
     ▼       ▼       ▼       ▼       ▼       ▼       ▼
   runtime  canary  shadow  chaos  long-dur  API    scripts/
   tick()   bucket  fork    inject  loop     status  test-m5-*
                                                     │
                                                     ▼
                                            ┌──────────────┐
                                            │ snapshot.ts  │
                                            │ (read-only)  │
                                            └──────┬───────┘
                                                   │
                                                   ▼
                                            ┌──────────────┐
                                            │ exporter.ts  │
                                            │ (JSON shape) │
                                            └──────┬───────┘
                                                   │
                                                   ▼
                                            /api/runtime/status
                                            (HTTP GET, read-only)
```

**Princípio (DEC-004):** todos os harnesses consomem o mesmo Registry.
Sem Registry, cada harness reinventaria contadores — duplicação e
divergência. O Registry é a **fonte de verdade** para todas as
métricas do runtime.

---

## Eventos e cronologia de um round de trading

```
T0:   Market data tick chega (Binance WS / DexScreener REST / poll)
T1:   Engine decide analisar token → chama pipeline.run(token, pool)
T2:   Pipeline executa gates H2.2 → H2.3 → H2.1 → H1.2 → H1.4 → H1.3 → H2.4
        métricas: pipelineLatencyMs.observe(T2-T1)
                  gateRejects.<gate>.inc() se algum gate REJECT
T3:   Se approved: signerAdapter.sign(tx) → IPC → signer process
        métricas: signerLatencyMs.observe(T3-T_sign_done)
T4:   lease.acquire() → token N emitido
        métricas: leaseAcquireMs.observe(T4-T_acquire_start)
T5:   leasedBroadcaster.broadcast(signedTx, tokenN)
        verifyToken(tokenN) ✓
        broadcaster.submit → RPC quorum
        métricas: broadcastLatencyMs.observe(T5-T_broadcast_done)
                  rpcErrors.inc() se quorum falha
T6:   Receipt on-chain → round closes
        métricas: roundsSucceeded.inc()
T7:   (Canário) se keccak256(txHash) % 100 < canaryPct:
        canaryAccepted.inc()
        else: canarySkipped.inc()
T8:   (Shadow) fork do PipelineResult para shadow path; se diverge do live:
        shadowDiffs.inc()

Falha em qualquer etapa:
  roundsFailed.inc()
  <error-type>Errors.inc()
  audit-log.append({seq, op, error, ...})
```

---

## Entradas

- **Market data:** Binance REST (candles, ticker), DexScreener REST
  (DEX pools), GoPlus Security API (token security), Etherscan API
  (contract source), alternative.me (Fear & Greed), CoinGecko (trending).
- **Config:** `prisma/schema.prisma` model `Config`, editável via
  `/api/config` e dashboard.
- **Operator commands:** API routes (`/api/engine/start`, `/stop`,
  `/api/kill-switch`, `/api/runtime/status`, etc.).
- **Watchlist:** `prisma` model, editável via `/api/watchlist`.

## Saídas

- **On-chain:** tx broadcastada (em live mode; em paper mode é
  simulada).
- **Persistência:** `prisma` models (`Position`, `Round`, `Reserve`,
  `TradingBalance`, `RiskEvent`, `ScamReport`, `AppLog`,
  `MarketSnapshot`, `AIInsight`, `SiteAudit`).
- **Audit:** `audit-log.ts` (append-only, hash-chain).
- **Logs:** `AppLog` + console + `crash-logger.ts`.
- **UI:** SSE stream via `/api/stream` para dashboard em tempo real.
- **Métricas:** `/api/runtime/status` (JSON read-only).

## Eventos

- `round.started`, `round.succeeded`, `round.failed` — Registry.
- `gate.rejected` com `gateName` — Registry.
- `lease.acquired`, `lease.renewed`, `lease.lost` — Registry + audit-log.
- `broadcast.submitted`, `broadcast.confirmed`, `broadcast.failed` —
  Registry + audit-log.
- `canary.accepted`, `canary.skipped` — Registry.
- `shadow.diff` — Registry + audit-log.
- `kill-switch.activated` — audit-log + notifier.
