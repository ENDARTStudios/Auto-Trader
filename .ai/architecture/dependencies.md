# architecture/dependencies.md — Mapa de Dependências

> Quem depende de quem. Quem pode ser alterado. Quem está congelado.
> Setas `A → B` significam "A depende de B" (A consome a interface de B).

---

## Mapa direto (topologia do fluxo canônico)

```
Market Data (Binance REST, DexScreener, GoPlus, alternative.me, CoinGecko)
        │
        ▼
src/lib/trading/*  (engine de trading — paper mode default)
        │
        ▼
src/lib/chain/pipeline.ts  [H2.6, FROZEN]
        │
        ├──► liquidity-verification.ts  [H2.2, FROZEN]
        │       └──► contract-verification.ts  [H2.1, FROZEN]
        │              └──► rpc-resilience.ts  [H1.1, FROZEN]
        │                     └──► ethers.js JsonRpcProvider
        │
        ├──► token-authority.ts  [H2.3, FROZEN]
        │       └──► contract-verification.ts
        │
        ├──► simulation-gate.ts  [H1.2, FROZEN]
        │       └──► rpc-resilience.ts
        │
        ├──► mev-baseline.ts  [H1.4, FROZEN]
        │       └──► rpc-resilience.ts
        │
        ├──► approval-hardening.ts  [H1.3, FROZEN]
        │       └──► rpc-resilience.ts
        │
        └──► sell-simulation.ts  [H2.4, FROZEN]
                └──► simulation-gate.ts

        ▼ (PipelineResult aprovado)
src/lib/chain/signer-adapter.ts  [M3.1, FROZEN]
        │
        └──► src/lib/signer-protocol.ts  (contrato IPC)
                │
                ▼ (IPC message)
src/signer/main.ts  [M3.2, FROZEN]  (processo isolado)
        ├──► wallet-methods.ts
        ├──► sign-methods.ts
        └──► audit.ts  [H0.3 hash-chain]

        ▼ (tx assinada)
src/lib/chain/writer-lease.ts  [M4, FROZEN]
        │  (fencing token emitido em acquire)
        ▼
src/lib/chain/leased-broadcaster.ts  [M4, FROZEN]
        │  (pre-broadcast fencing check)
        ├──► writer-lease.ts (verifyToken)
        └──► src/lib/chain/broadcaster.ts  [M3.3, FROZEN]
                │
                ├──► rpc-resilience.ts  (quorum broadcast)
                │
                ▼
            Blockchain

        ▼ (em paralelo: métricas)
src/lib/observability/registry.ts  [M5.5]
        ▲
        ├──► src/lib/runtime/runtime.ts  [M5.0]
        │       └──► (todos os módulos chain acima)
        ├──► src/lib/runtime/canary.ts  [M5.3]
        ├──► src/lib/runtime/shadow.ts  [M5.2]
        ├──► src/lib/runtime/chaos.ts  [M5.4]
        └──► src/lib/runtime/long-duration.ts  [M5.6]
                │
                ▼
        src/lib/observability/snapshot.ts  [M5.5]
                │
                ▼
        src/lib/observability/exporter.ts  [M5.5]
                │
                ▼
        src/app/api/runtime/status/route.ts  [M5.5]
```

---

## Matriz de dependências (inbound)

> "Quem me consome?" — lista arquivos que importam/exportam de cada módulo.

| Módulo                          | Inbound (consumidores)                                          |
| ------------------------------- | --------------------------------------------------------------- |
| `audit-log.ts`                  | broadcaster, signer/audit, risk-manager, logger                |
| `rpc-resilience.ts`             | broadcaster, liquidity-verif, contract-verif, token-authority, simulation-gate, mev-baseline, approval-hardening, sell-simulation |
| `simulation-gate.ts`            | pipeline, sell-simulation                                       |
| `approval-hardening.ts`         | pipeline                                                        |
| `mev-baseline.ts`               | pipeline                                                        |
| `contract-verification.ts`      | pipeline, liquidity-verif, token-authority                      |
| `liquidity-verification.ts`     | pipeline                                                        |
| `token-authority.ts`            | pipeline                                                        |
| `sell-simulation.ts`            | pipeline                                                        |
| `pipeline.ts`                   | signer-adapter, runtime, shadow                                 |
| `signer-adapter.ts`             | runtime, leased-broadcaster                                     |
| `signer-protocol.ts`            | signer-adapter, signer/main                                     |
| `signer/main.ts`                | (processo separado; spawnado por runtime)                       |
| `broadcaster.ts`                | leased-broadcaster                                              |
| `writer-lease.ts`               | leased-broadcaster                                              |
| `leased-broadcaster.ts`         | runtime                                                         |
| `runtime.ts`                    | engine de trading, scripts/test-m5-*, API /api/runtime/status   |
| `canary.ts`                     | runtime                                                         |
| `shadow.ts`                     | runtime, scripts/test-m5-shadow                                 |
| `chaos.ts`                      | scripts/test-m5-chaos                                           |
| `long-duration.ts`              | scripts/test-m5-long-duration                                   |
| `observability/registry.ts`     | runtime, canary, shadow, chaos, long-duration, snapshot         |
| `observability/snapshot.ts`     | exporter                                                        |
| `observability/exporter.ts`     | /api/runtime/status/route.ts                                    |

---

## Classificação de alterabilidade

### 🟥 FROZEN — só alterar com autorização explícita + entrada em DECISION_LOG.md

Toda a camada H0–M4 em `src/lib/chain/` + `src/signer/`. Lista completa
em `frozen-files.md`. Exceções só para correção de bug que **preserva**
o contrato público (CORE_RULES Regra 9 e 10).

### 🟨 Validado em M5 — não alterar sem nova entrada em DECISION_LOG.md

`src/lib/runtime/*`, `src/lib/observability/*`,
`src/app/api/runtime/status/route.ts`, `src/lib/chain/runtime.ts` (a
factory; mover para `src/lib/runtime/runtime.ts` exige decisão).

### 🟩 Livre para evoluir

`src/lib/trading/*` (engine de paper trading), `src/components/dashboard/*`
(UI), `src/app/api/*` (exceto `/api/runtime/status`), `prisma/schema.prisma`
(com migrations), `scripts/test-*.ts` (com coordenação — ver
`memory/known-problems.md`).

### 🟦 Externo — não alterar

`node_modules/`, `.next/`, `prisma/migrations/*` (já aplicadas),
`package.json` deps já instaladas.

---

## Ciclos proibidos

A topologia é **DAG** (grafo acíclico dirigido). Adicionar uma aresta
que crie ciclo é proibido e deve ser detectado em code review. Em
particular:

- `signer/*` **não pode** importar de `src/lib/chain/*` (processo
  isolado — comunicação só via `signer-protocol.ts`).
- `src/lib/observability/*` **não pode** importar de `src/lib/runtime/*`
  ou `src/lib/chain/*` (Registry é sink; não é source de dependência
  cíclica).
- `src/lib/runtime/*` **pode** importar de `src/lib/chain/*` e
  `src/lib/observability/*`, mas não o contrário.

Em caso de dúvida, validar via `Grep "from '@/.*/(runtime|chain|observability)/"` antes de adicionar import.
