# `architecture/modules.md` — Lista de Módulos

> Catálogo canônico de todos os módulos do projeto, com
> responsabilidades, arquivos, status FROZEN e contrato público.
> Consulte também `interfaces.md` para assinaturas públicas e
> `dependencies.md` para quem consome quem.

---

## Camada de Chain (hardening H0 → M5)

| Fase  | Módulo                  | Arquivo                                            | FROZEN | Responsabilidade                                                       |
| ----- | ----------------------- | -------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| H0    | Audit hash-chain        | `src/lib/audit/audit-log.ts`                       | ✅     | Audit log tamper-evident com hash-chain determinístico (replacer fn).  |
| H1.1  | RPC resilience / quorum | `src/lib/chain/rpc-resilience.ts`                  | ✅     | Quorum RPC com fallback, retry, circuit breaker por endpoint.          |
| H1.2  | Simulation gate         | `src/lib/chain/simulation-gate.ts`                 | ✅     | Pre-broadcast simulation; rejeita tx que revertem em simulação.       |
| H1.3  | Approval hardening      | `src/lib/chain/approval-hardening.ts`              | ✅     | Verifica approvals ERC-20 com cap máximo e revogação.                  |
| H1.4  | MEV baseline            | `src/lib/chain/mev-baseline.ts`                    | ✅     | Detecção básica de sandwich/front-run via mempool analysis.            |
| H2.1  | Contract verification   | `src/lib/chain/contract-verification.ts`           | ✅     | Verifica source code + ABI via Etherscan/Sourcify.                     |
| H2.2  | Liquidity verification  | `src/lib/chain/liquidity-verification.ts`          | ✅     | Valida liquidez mínima + slippage tolerável no par.                    |
| H2.3  | Token authority         | `src/lib/chain/token-authority.ts`                 | ✅     | Lista de tokens autorizados (whitelist); rejeita unknown tokens.       |
| H2.4  | Sell simulation         | `src/lib/chain/sell-simulation.ts`                 | ✅     | Simula saída antes de buy para garantir exit pathway.                  |
| H2.6  | Pipeline                | `src/lib/chain/pipeline.ts`                        | ✅     | Composição canônica: gate → verify → approve → sign → broadcast.       |
| M3.1  | SignerAdapter           | `src/lib/chain/signer-adapter.ts`                  | ✅     | Cliente IPC do signer; abstrai protocolo binário.                      |
| M3.2  | Signer RPC (processo)   | `src/signer/main.ts` + `wallet-methods.ts` + `sign-methods.ts` + `audit.ts` | ✅ | Processo isolado que segura chave privada e assina mensagens.         |
| M3.3  | Broadcaster             | `src/lib/chain/broadcaster.ts`                     | ✅     | Envia tx assinada para RPC quorum; trata retries + nonce.              |
| M4    | Writer Lease            | `src/lib/chain/writer-lease.ts`                    | ✅     | Lease exclusiva com fencing tokens monotônicos (Kleppmann).            |
| M4    | LeasedBroadcaster       | `src/lib/chain/leased-broadcaster.ts`              | ✅     | Wrapper que verifica fencing token antes de delegar ao Broadcaster.    |

## Camada de Runtime (M5)

| Módulo                | Arquivo                                     | FROZEN | Responsabilidade                                                       |
| --------------------- | ------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| Runtime factory       | `src/lib/chain/runtime.ts`                  | ❌     | `buildRuntime()` compõe stack completa (Pipeline + Signer + Lease).    |
| Runtime principal     | `src/lib/runtime/runtime.ts`                | ❌     | Loop principal `tick()` com `while(running)` (não setInterval).        |
| Canary                | `src/lib/runtime/canary.ts`                 | ❌     | Bucketing determinístico `bucket = keccak256(txHash) % 100`.           |
| Shadow                | `src/lib/runtime/shadow.ts`                 | ❌     | Fork Live + Shadow sobre MESMA Pipeline; incrementa `shadowDiffs`.     |
| Chaos                 | `src/lib/runtime/chaos.ts`                  | ❌     | ChaosInjector classes com `before/after/cleanup` (sem `if(chaos)`).    |
| Long-Duration         | `src/lib/runtime/long-duration.ts`          | ❌     | Loop `while(running) { tick(); sleep(); }` para runs 24h/72h/7d.       |

## Camada de Observability (M5.5)

| Módulo    | Arquivo                                     | FROZEN | Responsabilidade                                                       |
| --------- | ------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| Metrics   | `src/lib/observability/metrics.ts`          | ❌     | Interface `RuntimeMetrics` (Counter, Gauge, Histogram).                |
| Registry  | `src/lib/observability/registry.ts`         | ❌     | Registry único — fonte de verdade para todos os harnesses.             |
| Snapshot  | `src/lib/observability/snapshot.ts`         | ❌     | Snapshot read-only para diagnóstico e export.                          |
| Exporter  | `src/lib/observability/exporter.ts`         | ❌     | Export para API `/api/runtime/status` (JSON).                          |

## Camada de Trading (não-hardening)

| Módulo            | Arquivo                                     | Responsabilidade                                                       |
| ----------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| Config manager    | `src/lib/trading/config.ts`                 | Defaults seguros + overrides via DB.                                   |
| Logger            | `src/lib/trading/logger.ts`                 | Persistência em `AppLog` + console; respeita audit hash-chain.         |
| Risk manager      | `src/lib/trading/risk-manager.ts`           | 5 circuit breakers (kill switch, daily loss, per-trade, exposure, DD). |
| Scam detector     | `src/lib/trading/scam-detector.ts`          | 6 sub-scorers (honeypot, liquidity, audit, tax, holders, age) + LLM.   |
| Token selector    | `src/lib/trading/token-selector.ts`         | CEX (Binance REST) + DEX (DexScreener) por volume/liquidez.            |
| Price feed        | `src/lib/trading/price-feed.ts`             | Binance + DexScreener com cache 15s.                                   |
| Paper trader      | `src/lib/trading/paper-trader.ts`           | Simula ordens com slippage 0.3%.                                       |
| Portfolio         | `src/lib/trading/portfolio.ts`              | Open/close position + rebalance 50/50 (USDC cold reserve / reinvest).  |
| Engine            | `src/lib/trading/engine.ts`                 | State machine SCOUT → ANALYZE → EXECUTE → MONITOR → EXIT → REBALANCE.  |

## Camada de API (Next.js routes)

| Endpoint                       | Método(s)       | Arquivo                                                  |
| ------------------------------ | --------------- | -------------------------------------------------------- |
| `/api/status`                  | GET             | `src/app/api/status/route.ts`                            |
| `/api/positions`               | GET, POST       | `src/app/api/positions/route.ts`                         |
| `/api/history`                 | GET             | `src/app/api/history/route.ts`                           |
| `/api/logs`                    | GET             | `src/app/api/logs/route.ts`                              |
| `/api/config`                  | GET, PUT        | `src/app/api/config/route.ts`                            |
| `/api/engine/start`            | POST            | `src/app/api/engine/start/route.ts`                      |
| `/api/engine/stop`             | POST            | `src/app/api/engine/stop/route.ts`                       |
| `/api/kill-switch`             | POST            | `src/app/api/kill-switch/route.ts`                       |
| `/api/reserve`                 | GET, PUT        | `src/app/api/reserve/route.ts`                           |
| `/api/scam-reports`            | GET             | `src/app/api/scam-reports/route.ts`                      |
| `/api/rounds`                  | GET             | `src/app/api/rounds/route.ts`                            |
| `/api/initialize`              | POST            | `src/app/api/initialize/route.ts`                        |
| `/api/runtime/status`          | GET             | `src/app/api/runtime/status/route.ts` (read-only JSON)   |

## Camada de UI (Next.js dashboard)

| Componente          | Arquivo                                                     |
| ------------------- | ----------------------------------------------------------- |
| Positions table     | `src/components/dashboard/positions-table.tsx`             |
| History table       | `src/components/dashboard/history-table.tsx`               |
| Scam reports        | `src/components/dashboard/scam-reports.tsx`                |
| Rounds table        | `src/components/dashboard/rounds-table.tsx`                |
| Logs feed           | `src/components/dashboard/logs-feed.tsx`                   |
| Config editor       | `src/components/dashboard/config-editor.tsx`               |

---

## Regras de manutenção

- Toda adição/remoção de módulo DEVE atualizar este arquivo.
- Toda transição de `❌` para `✅` (congelamento) DEVE ter entrada
  correspondente em `DECISION_LOG.md` (DEC-NNN) justificando o
  congelamento.
- Toda transição de `✅` para `❌` (descongelamento) DEVE ter entrada
  em `DECISION_LOG.md` + aprovação explícita do operador.
