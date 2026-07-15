# `context/terminology.md` — Terminologia Interna do Projeto

> **Divisão de responsabilidade (vs `glossary.md`):**
>
> - **`terminology.md` (este arquivo):** convenções internas do
>   projeto. Nomes oficiais de módulos, acrônimos utilizados,
>   significado operacional.
> - **`glossary.md`:** dicionário alfabético de termos técnicos
>   externos (Blockchain, Trading, RPC, Ethereum, Segurança, IA).
>
> Não duplicar. Se um termo é interno do projeto, vai aqui. Se é
> técnico geral da indústria, vai em `glossary.md`.

---

## Nomes oficiais de módulos

Os nomes abaixo são canônicos. Qualquer referência em docs, commits,
ADRs, ou discussão DEVE usar exatamente estes nomes (casing
sensível).

### Camada de audit

| Nome              | Arquivo                          | Fase | Descrição operacional                          |
| ----------------- | -------------------------------- | ---- | ---------------------------------------------- |
| `AuditLog`        | `src/lib/audit/audit-log.ts`     | H0   | Audit log tamper-evident com hash-chain.       |

### Camada de chain (hardening)

| Nome                       | Arquivo                                       | Fase |
| -------------------------- | --------------------------------------------- | ---- |
| `RpcQuorum`                | `src/lib/chain/rpc-resilience.ts`             | H1.1 |
| `SimulationGate`           | `src/lib/chain/simulation-gate.ts`            | H1.2 |
| `ApprovalHardening`        | `src/lib/chain/approval-hardening.ts`         | H1.3 |
| `MevBaseline`              | `src/lib/chain/mev-baseline.ts`               | H1.4 |
| `ContractVerification`     | `src/lib/chain/contract-verification.ts`      | H2.1 |
| `LiquidityVerification`    | `src/lib/chain/liquidity-verification.ts`     | H2.2 |
| `TokenAuthority`           | `src/lib/chain/token-authority.ts`            | H2.3 |
| `SellSimulation`           | `src/lib/chain/sell-simulation.ts`            | H2.4 |
| `Pipeline`                 | `src/lib/chain/pipeline.ts`                   | H2.6 |
| `SignerAdapter`            | `src/lib/chain/signer-adapter.ts`             | M3.1 |
| `SignerRpc` (processo)     | `src/signer/main.ts` + sub-arquivos           | M3.2 |
| `Broadcaster`              | `src/lib/chain/broadcaster.ts`                | M3.3 |
| `WriterLease`              | `src/lib/chain/writer-lease.ts`               | M4   |
| `LeasedBroadcaster`        | `src/lib/chain/leased-broadcaster.ts`         | M4   |

### Camada de runtime (M5)

| Nome                  | Arquivo                                |
| --------------------- | -------------------------------------- |
| `Runtime` (factory)   | `src/lib/chain/runtime.ts`             |
| `Runtime` (principal) | `src/lib/runtime/runtime.ts`           |
| `CanaryBroadcaster`   | `src/lib/runtime/canary.ts`            |
| `ShadowHarness`       | `src/lib/runtime/shadow.ts`            |
| `ChaosInjector`       | `src/lib/runtime/chaos.ts`             |
| `LongDurationLoop`    | `src/lib/runtime/long-duration.ts`     |

### Camada de observability (M5.5)

| Nome       | Arquivo                                     |
| ---------- | ------------------------------------------- |
| `Registry` | `src/lib/observability/registry.ts`         |
| `Counter`  | `src/lib/observability/metrics.ts`          |
| `Gauge`    | `src/lib/observability/metrics.ts`          |
| `Histogram`| `src/lib/observability/metrics.ts`          |
| `Snapshot` | `src/lib/observability/snapshot.ts`         |

### Camada de trading (não-hardening)

| Nome             | Arquivo                                |
| ---------------- | -------------------------------------- |
| `ConfigManager`  | `src/lib/trading/config.ts`            |
| `Logger`         | `src/lib/trading/logger.ts`            |
| `RiskManager`    | `src/lib/trading/risk-manager.ts`      |
| `ScamDetector`   | `src/lib/trading/scam-detector.ts`     |
| `TokenSelector`  | `src/lib/trading/token-selector.ts`    |
| `PriceFeed`      | `src/lib/trading/price-feed.ts`        |
| `PaperTrader`    | `src/lib/trading/paper-trader.ts`      |
| `Portfolio`      | `src/lib/trading/portfolio.ts`         |
| `Engine`         | `src/lib/trading/engine.ts`            |

---

## Acrônimos utilizados no projeto

| Acrônimo | Significado operacional no projeto                          |
| -------- | ----------------------------------------------------------- |
| `ADR`    | Architecture Decision Record (em `.ai/decisions/ADR-NNNN.md`)|
| `DEC`    | Decisão arquitetural resumida (em `DECISION_LOG.md`, DEC-NNN)|
| `REG`    | Regressão de segurança (em `SECURITY.md`, REG-NNN)         |
| `KP`     | Known Problem (em `memory/known-problems.md`, KP-NNN)      |
| `TD`     | Technical Debt (em `memory/technical-debt.md`, TD-NNN)     |
| `INV`    | Invariante arquitetural (em `architecture/invariants.md`, INV-NNN) |
| `H0`-`H2`| Fases de hardening hierárquico (H = Hardening)             |
| `M3`-`M5`| Fases de hardening de milestones (M = Milestone)           |
| `LLM`    | Large Language Model (GLM-4.6 via z-ai-web-dev-sdk)        |
| `KMS`    | Key Management Service (M6+, ainda não integrado)          |
| `IPC`    | Inter-Process Communication (stdin/stdout entre engine e signer)|
| `RPC`    | Remote Procedure Call (JSON-RPC para nodes blockchain)     |
| `CEX`    | Centralized Exchange (Binance)                             |
| `DEX`    | Decentralized Exchange (PancakeSwap via DexScreener)       |
| `BSC`    | Binance Smart Chain (rede mainnet primária do projeto)     |
| `USDC`   | Stablecoin USDC (unidade de reserve e trading)             |
| `SL`     | Stop Loss (em Strategy do Portfolio)                       |
| `TP`     | Take Profit (em Strategy do Portfolio)                     |
| `DD`     | Drawdown (um dos 5 circuit breakers do RiskManager)        |

---

## Fases do hardening (ordem canônica)

| Fase  | Nome                          | Significado operacional                              |
| ----- | ----------------------------- | --------------------------------------------------- |
| H0    | Crypto foundation             | KDF, audit hash-chain, key rotation.                |
| H1.1  | RPC resilience / quorum       | Quorum de RPCs com fallback e retry.                |
| H1.2  | Simulation gate               | Pre-broadcast simulation rejeita txs que revertem. |
| H1.3  | Approval hardening            | Verificação de approvals ERC-20 com cap.            |
| H1.4  | MEV baseline                  | Detecção básica de sandwich/front-run.              |
| H2.1  | Contract verification         | Verifica source + ABI via Etherscan/Sourcify.       |
| H2.2  | Liquidity verification        | Valida liquidez mínima + slippage.                  |
| H2.3  | Token authority               | Whitelist de tokens autorizados.                    |
| H2.4  | Sell simulation               | Simula saída antes de buy.                          |
| H2.6  | Pipeline                      | Composição canônica dos gates.                      |
| M3.1  | SignerAdapter                 | Cliente IPC do signer.                              |
| M3.2  | Signer RPC (processo)         | Processo isolado que segura a chave.                |
| M3.3  | Broadcaster                   | Envia tx assinada para RPC quorum.                  |
| M4    | Writer Lease + LeasedBroadcaster | Lease com fencing tokens (Kleppmann).            |
| M5.0  | Runtime factory               | `buildRuntime()` compõe stack completa.             |
| M5.1  | Dry Run                       | 26/26 testes — lease invariants preservadas.        |
| M5.5  | Observability                 | Registry único + `/api/runtime/status`.             |
| M5.4  | Chaos                         | 99/99 — ChaosInjector pattern.                      |
| M5.2  | Shadow                        | 11/11 — 600 RPC reais, 0 diffs.                     |
| M5.3  | Canary                        | `keccak256(txHash) % 100` determinístico.           |
| M5.6  | Long-Duration                 | 7/7 — 74k ops, 0 leak.                              |
| M5.7  | Finalização                   | 0 regressões H0-M4.                                 |
| M6+   | Live Trading                  | (futuro) canaryPct ramp com rollback automático.    |

---

## Termos operacionais específicos do projeto

### "FROZEN"

Arquivo ou módulo cuja modificação requer ADR + entrada em
`DECISION_LOG.md` + aprovação explícita do operador. Lista
canônica: `architecture/frozen-files.md`. Aplica-se a todos os
módulos da camada de chain H0-M4 + protocolo IPC do signer.

### "Audit hash-chain"

Sequência append-only de entradas onde cada entrada inclui o hash
da anterior. Tampering em qualquer entrada quebra a cadeia.
Implementado em H0 (`AuditLog`), corrigido em H0.3 (DEC-001 — bug
do `sortedKeysArray` que dropava nested keys).

### "Fencing token"

Inteiro monotônico crescente emitido pelo `WriterLease` a cada
`acquire()` bem-sucedido. Verificado pelo `LeasedBroadcaster`
antes de delegar ao `Broadcaster`. Garante que writer stale (com
token antigo) não consegue broadcastar tx com nonce já usado.
Padrão Kleppmann (DEC-003).

### "Canary bucket"

Bucket determinístico computado como `bucket = keccak256(txHash) %
100`. Se `bucket < canaryPct`, a tx é roteada para Live; caso
contrário, para Paper/Shadow. Garantia: a mesma txHash sempre cai
no mesmo bucket (INV-008), independente de instância ou timing.

### "Shadow diff"

Divergência detectada entre Live path e Shadow path no mesmo
`Pipeline.process()`. Incrementa counter `shadow_diffs`. Em
produção, qualquer diff > 0 em janela de 1 minuto deve disparar
rollback automático (M6).

### "ChaosInjector"

Classe com métodos `before()`, `after()`, `cleanup()` que injeta
falha controlada em um módulo alvo (RPC, signer, lease, etc.).
Substitui `if (chaos) { ... }` espalhado. Padrão obrigatório em
todo novo harness de teste M5.4+ (DEC-004).

### "Long-Duration loop"

Padrão `while (running) { await tick(); await sleep(period); }`
(em oposição a `setInterval`). Permite controle granular do sleep,
parada graciosa, e validação de leak de heap em runs 24h+. Padrão
obrigatório em `src/lib/runtime/long-duration.ts` (M5.6).

### "LLM squad"

Conjunto de 3 prompts LLM (bullish, bearish, neutral) para
validar tokens no ScamDetector. Score final = média dos 3.
Threshold de rejeição: score > 60 (configurável).

---

## Convenções de nomeação (resumo)

Para detalhes completos, ver `standards/coding-style.md` e
`context/conventions.md`.

| Tipo                | Convenção             |
| ------------------- | --------------------- |
| Módulo / classe     | PascalCase            |
| Função / variável   | camelCase             |
| Constante imutável  | SCREAMING_SNAKE_CASE  |
| Arquivo (módulo)    | kebab-case            |
| Arquivo (componente)| PascalCase.tsx        |
| Tipo / interface    | PascalCase            |

---

## Quando usar qual nome

- **Em código:** sempre o nome PascalCase da classe/export.
- **Em commits:** pode ser kebab-case do arquivo (ex.: `feat(chain):
  add writer-lease`).
- **Em ADRs/DECISION_LOG:** preferir nome PascalCase da classe
  (mais legível).
- **Em discussão oral:** qualquer um é aceito.

---

## Relacionado

- `context/glossary.md` — referência externa (blockchain, trading, etc.).
- `context/conventions.md` — convenções de nomenclatura derivadas destes termos.
- `architecture/modules.md` — nomes oficiais dos módulos.
- `architecture/interfaces.md` — tipos que usam estes nomes.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

