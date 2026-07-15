# `architecture/dependencies.md` — Quem Depende de Quem

> Mapa de dependências entre módulos. Use para calcular **blast
> radius** antes de alterar qualquer símbolo público.
> Símbolos marcados ⚠️ têm muitos consumers — alterar com cautela
> extrema e preferir extensão (não breaking change).

---

## Camada de Chain — dependências internas

```
Pipeline
  ├── SimulationGate        (H1.2)
  ├── ContractVerification  (H2.1)
  ├── LiquidityVerification (H2.2)
  ├── TokenAuthority        (H2.3)
  ├── SellSimulation        (H2.4)
  ├── ApprovalHardening     (H1.3)
  ├── MEVBaseline           (H1.4)
  ├── SignerAdapter         (M3.1)
  │     └── signer-protocol (IPC binário, FROZEN)
  ├── WriterLease           (M4)
  │     └── LeaseStore      (interface; InMemoryLeaseStore default)
  ├── LeasedBroadcaster     (M4)
  │     ├── Broadcaster     (M3.3)
  │     │     └── rpc-resilience (H1.1, RPC quorum)
  │     └── WriterLease.verifyToken()
  └── audit-log             (H0, hash-chain)
```

### Blast radius por módulo

| Módulo              | Consumers diretos                                            | Blast radius |
| ------------------- | ------------------------------------------------------------ | ------------ |
| `Pipeline`          | `runtime.ts`, `shadow.ts` (M5.2 fork), test harnesses        | ⚠️ Alto      |
| `SignerAdapter`     | `Pipeline`, test harnesses M3/M4/M5                          | ⚠️ Alto      |
| `signer-protocol`   | `SignerAdapter` (engine), `signer/main.ts` (signer)         | ⚠️ Crítico   |
| `WriterLease`       | `LeasedBroadcaster`, test harnesses M4/M5                    | Médio        |
| `LeasedBroadcaster` | `Pipeline`, `CanaryBroadcaster`, test harnesses             | Médio        |
| `Broadcaster`       | `LeasedBroadcaster`, test harnesses M3/M4                    | ⚠️ Alto      |
| `rpc-resilience`    | `Broadcaster`, `ContractVerification`, `LiquidityVerification` | ⚠️ Alto   |
| `audit-log`         | Praticamente todos (Pipeline, Signer, Lease, Broadcaster)    | ⚠️ Crítico   |

---

## Camada de Observability — Registry único (DEC-004)

```
Registry (src/lib/observability/registry.ts)  ← FONTE DE VERDADE
  ▲
  ├── metrics.ts          (define interfaces Counter/Gauge/Histogram)
  ├── snapshot.ts         (snapshot read-only)
  ├── exporter.ts         (exporta para /api/runtime/status)
  │
  └── Consumers (todos os harnesses M5):
        ├── runtime.ts            (factory: cria Registry e injeta)
        ├── chaos.ts              (ChaosInjector classes)
        ├── shadow.ts             (fork Live + Shadow)
        ├── canary.ts             (CanaryBroadcaster)
        └── long-duration.ts      (loop while(running))
```

**Invariante (DEC-004):** nenhum harness cria sua própria coleta de
métricas. Todos consomem o Registry injetado pelo `buildRuntime()`.

---

## Camada de Trading — dependências

```
Engine (state machine)
  ├── ConfigManager
  ├── Logger                  → audit-log (H0)
  ├── RiskManager             (5 circuit breakers)
  ├── ScamDetector            (6 sub-scorers + LLM squad)
  │     ├── TokenSelector     → Binance REST + DexScreener
  │     ├── PriceFeed         → Binance + DexScreener (cache 15s)
  │     └── LLM Squad         → z-ai-web-dev-sdk (GLM-4.6)
  ├── PaperTrader             (slippage 0.3%)
  ├── Portfolio               (split 50/50 USDC cold / reinvest)
  └── Pipeline                (camada de chain — descrita acima)
```

### Notas de alterabilidade

- `Engine` é o orchestrador; mudanças no state machine (adicionar
  estados, alterar transições) têm blast radius médio — afeta
  dashboard e API.
- `ScamDetector` é composto por 6 sub-scorers independentes; adicionar
  novo sub-scorer é baixo risco (registra via factory pattern).
- `RiskManager` circuit breakers são independentes entre si; adicionar
  novo breaker é baixo risco. Remover breaker existente é médio risco
  (testes adversariais REG-NNN dependem dos breakers atuais).

---

## Camada de API — dependências HTTP

```
/api/engine/start, /api/engine/stop
  └── Engine (state machine)

/api/positions, /api/history, /api/rounds, /api/logs
  └── Prisma (read-only queries)

/api/config (GET, PUT)
  └── ConfigManager (PUT escreve em DB; GET lê com cache)

/api/kill-switch
  └── RiskManager (toggle flag persistente)

/api/reserve (GET, PUT)
  └── Portfolio (USDC cold reserve)

/api/scam-reports
  └── ScamDetector (read-only)

/api/runtime/status (M5.5)
  └── Registry.snapshot()  (read-only, sem side-effects)

/api/initialize
  └── Prisma migrations + seed
```

### Regras para novos endpoints

- Todo novo endpoint DEVE ser adicionado também em
  `contracts/api-contracts.md`.
- Endpoints `read-only` (GET) podem ler do Registry sem locks.
- Endpoints `write` (POST/PUT/DELETE) que tocam estado do Engine
  DEVE adquirir WriterLease antes de mutar (Regra 8 — frozen pattern).

---

## Dependências externas (npm)

| Pacote             | Versão  | Uso                                            | Substituível? |
| ------------------ | ------- | ---------------------------------------------- | ------------- |
| `next`             | 16.x    | Framework web (App Router)                     | ❌            |
| `react`            | 19.x    | UI                                             | ❌            |
| `typescript`       | 5.x     | Type system                                    | ❌            |
| `tailwindcss`      | 4.x     | Styling                                        | ❌            |
| `@prisma/client`   | 5.x     | ORM                                            | ❌            |
| `prisma`           | 5.x     | Schema migration CLI                           | ❌            |
| `zod`              | 3.x     | Runtime validation                             | ✅ (valibot)  |
| `ethers`           | 6.x     | Blockchain interaction, ABI encoding           | ✅ (viem)     |
| `viem`             | 2.x     | (alternativo) Lightweight blockchain client    | —             |
| `z-ai-web-dev-sdk` | latest  | LLM squad (GLM-4.6) para ScamDetector         | ❌            |

### Regras para novas dependências (ENGINEERING_RULES.md)

- Antes de `npm install X`, verificar se a funcionalidade já existe
  em dependências instaladas.
- Toda nova dependência DEVE ser justificada em `DECISION_LOG.md`.
- Toda remoção de dependência DEVE verificar consumers via Grep
  (imports do nome do pacote).

---

## Diagrama de módulos FROZEN (blast radius máximo)

```
              ┌──────────────────────────────────┐
              │      audit-log (H0) ⚠️ CRÍTICO    │
              │   consumido por ~todos os módulos│
              └──────────────────────────────────┘
                              ▲
              ┌───────────────┼───────────────┐
              │               │               │
   ┌──────────┴─────┐  ┌──────┴───────┐  ┌────┴────────────┐
   │ signer-protocol│  │  Pipeline    │  │  rpc-resilience │
   │  (M3.2) ⚠️     │  │  (H2.6) ⚠️   │  │  (H1.1) ⚠️      │
   └────────────────┘  └──────────────┘  └─────────────────┘
```

**Regra prática:** alterar qualquer um destes 4 módulos é
extremamente arriscado. Sempre que possível:

1. Estender (novo método, novo campo opcional) em vez de modificar.
2. Adicionar通路 paralelo (novo módulo) em vez de tocar o FROZEN.
3. Se realmente precisa modificar, abrir ADR antes e validar com
   o operador.
