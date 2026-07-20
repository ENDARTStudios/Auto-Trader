# `architecture/modules.md` — Lista de Módulos

> **STATE: ACTIVE** — catálogo evolui conforme módulos são
> adicionados (M6+) ou transições de FROZEN↔ACTIVE ocorrem.
>
> Catálogo canônico de todos os módulos do projeto, com
> **MOD-ID** permanente, responsabilidades, arquivos, status FROZEN
> e contrato público. Consulte também `interfaces.md` para
> assinaturas públicas e `dependencies.md` para quem consome quem.
> Para o mapeamento INV → ADR → MOD → REG → teste, consulte
> `TRACEABILITY.md`.

---

## MOD-ID Convention

Todo módulo recebe um **MOD-ID permanente** derivado da fase do
hardening roadmap em que foi introduzido:

- `MOD-H*` — fases H (hardening fundacional: audit, RPC, gates).
- `MOD-M3.*` — sub-fases M3 (signer isolation).
- `MOD-M4.*` — sub-fases M4 (writer lease).
- `MOD-M5.*` — sub-fases M5 (runtime harnesses + observability).
- `MOD-M6`+ — milestones futuros (ainda não implementados).
- `MOD-TR-*` — módulos da camada de trading (não-hardening).
- `MOD-API-*` — endpoints da API Next.js.
- `MOD-UI-*` — componentes do dashboard.

Uma vez emitido, o MOD-ID **não é reusado** nem renomeado, mesmo
após o módulo ser deprecado. Ver `IDS.md` para o catálogo
consolidado de todos os IDs do projeto.

---

## Camada de Chain (hardening H0 → M5)

| MOD-ID    | Fase  | Módulo                  | Arquivo                                            | FROZEN | Responsabilidade                                                       |
| --------- | ----- | ----------------------- | -------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `MOD-H0`  | H0    | Audit hash-chain        | `src/lib/audit/audit-log.ts`                       | ✅     | Audit log tamper-evident com hash-chain determinístico (replacer fn).  |
| `MOD-H1.1`| H1.1  | RPC resilience / quorum | `src/lib/chain/rpc-resilience.ts`                  | ✅     | Quorum RPC com fallback, retry, circuit breaker por endpoint.          |
| `MOD-H1.2`| H1.2  | Simulation gate         | `src/lib/chain/simulation-gate.ts`                 | ✅     | Pre-broadcast simulation; rejeita tx que revertem em simulação.       |
| `MOD-H1.3`| H1.3  | Approval hardening      | `src/lib/chain/approval-hardening.ts`              | ✅     | Verifica approvals ERC-20 com cap máximo e revogação.                  |
| `MOD-H1.4`| H1.4  | MEV baseline            | `src/lib/chain/mev-baseline.ts`                    | ✅     | Detecção básica de sandwich/front-run via mempool analysis.            |
| `MOD-H2.1`| H2.1  | Contract verification   | `src/lib/chain/contract-verification.ts`           | ✅     | Verifica source code + ABI via Etherscan/Sourcify.                     |
| `MOD-H2.2`| H2.2  | Liquidity verification  | `src/lib/chain/liquidity-verification.ts`          | ✅     | Valida liquidez mínima + slippage tolerável no par.                    |
| `MOD-H2.3`| H2.3  | Token authority         | `src/lib/chain/token-authority.ts`                 | ✅     | Lista de tokens autorizados (whitelist); rejeita unknown tokens.       |
| `MOD-H2.4`| H2.4  | Sell simulation         | `src/lib/chain/sell-simulation.ts`                 | ✅     | Simula saída antes de buy para garantir exit pathway.                  |
| `MOD-H2.6`| H2.6  | Pipeline                | `src/lib/chain/pipeline.ts`                        | ✅     | Composição canônica: gate → verify → approve → sign → broadcast.       |
| `MOD-M3.1`| M3.1  | SignerAdapter           | `src/lib/chain/signer-adapter.ts`                  | ✅     | Cliente IPC do signer; abstrai protocolo binário.                      |
| `MOD-M3.2`| M3.2  | Signer RPC (processo)   | `src/signer/main.ts` + `wallet-methods.ts` + `sign-methods.ts` + `audit.ts` | ✅ | Processo isolado que segura chave privada e assina mensagens.         |
| `MOD-M3.3`| M3.3  | Broadcaster             | `src/lib/chain/broadcaster.ts`                     | ✅     | Envia tx assinada para RPC quorum; trata retries + nonce.              |
| `MOD-M4.1`| M4    | WriterLease             | `src/lib/chain/writer-lease.ts`                    | ✅     | Lease exclusiva com fencing tokens monotônicos (Kleppmann).            |
| `MOD-M4.2`| M4    | LeasedBroadcaster       | `src/lib/chain/leased-broadcaster.ts`              | ✅     | Wrapper que verifica fencing token antes de delegar ao Broadcaster.    |

## Camada de Runtime (M5)

| MOD-ID     | Módulo                | Arquivo                                     | FROZEN | Responsabilidade                                                       |
| ---------- | --------------------- | ------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `MOD-M5.0` | Runtime factory       | `src/lib/chain/runtime.ts`                  | ❌     | `buildRuntime()` compõe stack completa (Pipeline + Signer + Lease).    |
| `MOD-M5.1` | Runtime principal     | `src/lib/runtime/runtime.ts`                | ❌     | Loop principal `tick()` com `while(running)` (não setInterval).        |
| `MOD-M5.2` | Shadow harness        | `src/lib/runtime/shadow.ts`                 | ❌     | Fork Live + Shadow sobre MESMA Pipeline; incrementa `shadowDiffs`.     |
| `MOD-M5.3` | Canary harness        | `src/lib/runtime/canary.ts`                 | ❌     | Bucketing determinístico `bucket = keccak256(txHash) % 100`.           |
| `MOD-M5.4` | Chaos harness         | `src/lib/runtime/chaos.ts`                  | ❌     | ChaosInjector classes com `before/after/cleanup` (sem `if(chaos)`).    |
| `MOD-M5.6` | Long-Duration         | `src/lib/runtime/long-duration.ts`          | ❌     | Loop `while(running) { tick(); sleep(); }` para runs 24h/72h/7d.       |

## Camada de Observability (M5.5)

| MOD-ID       | Módulo    | Arquivo                                     | FROZEN | Responsabilidade                                                       |
| ------------ | --------- | ------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `MOD-M5.5-M` | Metrics   | `src/lib/observability/metrics.ts`          | ❌     | Interface `RuntimeMetrics` (Counter, Gauge, Histogram).                |
| `MOD-M5.5-R` | Registry  | `src/lib/observability/registry.ts`         | ❌     | Registry único — fonte de verdade para todos os harnesses.             |
| `MOD-M5.5-S` | Snapshot  | `src/lib/observability/snapshot.ts`         | ❌     | Snapshot read-only para diagnóstico e export.                          |
| `MOD-M5.5-E` | Exporter  | `src/lib/observability/exporter.ts`         | ❌     | Export para API `/api/runtime/status` (JSON).                          |

## Camada de Trading (não-hardening)

| MOD-ID        | Módulo            | Arquivo                                     | Responsabilidade                                                       |
| ------------- | ----------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `MOD-TR-CFG`  | Config manager    | `src/lib/trading/config.ts`                 | Defaults seguros + overrides via DB.                                   |
| `MOD-TR-LOG`  | Logger            | `src/lib/trading/logger.ts`                 | Persistência em `AppLog` + console; respeita audit hash-chain.         |
| `MOD-TR-RSK`  | Risk manager      | `src/lib/trading/risk-manager.ts`           | 5 circuit breakers (kill switch, daily loss, per-trade, exposure, DD). |
| `MOD-TR-SCM`  | Scam detector     | `src/lib/trading/scam-detector.ts`          | 6 sub-scorers (honeypot, liquidity, audit, tax, holders, age) + LLM.   |
| `MOD-TR-TOK`  | Token selector    | `src/lib/trading/token-selector.ts`         | CEX (Binance REST) + DEX (DexScreener) por volume/liquidez.            |
| `MOD-TR-PRC`  | Price feed        | `src/lib/trading/price-feed.ts`             | Binance + DexScreener com cache 15s.                                   |
| `MOD-TR-PAP`  | Paper trader      | `src/lib/trading/paper-trader.ts`           | Simula ordens com slippage 0.3%.                                       |
| `MOD-TR-PRT`  | Portfolio         | `src/lib/trading/portfolio.ts`              | Open/close position + rebalance 50/50 (USDC cold reserve / reinvest).  |
| `MOD-TR-ENG`  | Engine            | `src/lib/trading/engine.ts`                 | State machine SCOUT → ANALYZE → EXECUTE → MONITOR → EXIT → REBALANCE.  |

## Camada de API (Next.js routes)

| MOD-ID          | Endpoint                       | Método(s)       | Arquivo                                                  |
| --------------- | ------------------------------ | --------------- | -------------------------------------------------------- |
| `MOD-API-STAT`  | `/api/status`                  | GET             | `src/app/api/status/route.ts`                            |
| `MOD-API-POS`   | `/api/positions`               | GET, POST       | `src/app/api/positions/route.ts`                         |
| `MOD-API-HIST`  | `/api/history`                 | GET             | `src/app/api/history/route.ts`                           |
| `MOD-API-LOG`   | `/api/logs`                    | GET             | `src/app/api/logs/route.ts`                              |
| `MOD-API-CFG`   | `/api/config`                  | GET, PUT        | `src/app/api/config/route.ts`                            |
| `MOD-API-EST`   | `/api/engine/start`            | POST            | `src/app/api/engine/start/route.ts`                      |
| `MOD-API-ESP`   | `/api/engine/stop`             | POST            | `src/app/api/engine/stop/route.ts`                       |
| `MOD-API-KS`    | `/api/kill-switch`             | POST            | `src/app/api/kill-switch/route.ts`                       |
| `MOD-API-RES`   | `/api/reserve`                 | GET, PUT        | `src/app/api/reserve/route.ts`                           |
| `MOD-API-SCM`   | `/api/scam-reports`            | GET             | `src/app/api/scam-reports/route.ts`                      |
| `MOD-API-RND`   | `/api/rounds`                  | GET             | `src/app/api/rounds/route.ts`                            |
| `MOD-API-INIT`  | `/api/initialize`              | POST            | `src/app/api/initialize/route.ts`                        |
| `MOD-API-RTS`   | `/api/runtime/status`          | GET             | `src/app/api/runtime/status/route.ts` (read-only JSON)   |

## Camada de UI (Next.js dashboard)

| MOD-ID         | Componente          | Arquivo                                                     |
| -------------- | ------------------- | ----------------------------------------------------------- |
| `MOD-UI-POS`   | Positions table     | `src/components/dashboard/positions-table.tsx`             |
| `MOD-UI-HIST`  | History table       | `src/components/dashboard/history-table.tsx`               |
| `MOD-UI-SCM`   | Scam reports        | `src/components/dashboard/scam-reports.tsx`                |
| `MOD-UI-RND`   | Rounds table        | `src/components/dashboard/rounds-table.tsx`                |
| `MOD-UI-LOG`   | Logs feed           | `src/components/dashboard/logs-feed.tsx`                   |
| `MOD-UI-CFG`   | Config editor       | `src/components/dashboard/config-editor.tsx`               |

## Milestones futuros (não implementados)

| MOD-ID    | Milestone | Descrição                                                        | Estado     |
| --------- | --------- | ---------------------------------------------------------------- | ---------- |
| `MOD-M6`  | M6        | Live Trading com `canaryPct` ramp (1%→5%→10%→25%→100%).          | Planejado  |
| `MOD-M7`  | M7        | Multi-chain (extensão do Pipeline para chains além da BSC).      | Ideia      |
| `MOD-M8`  | M8        | Observer mode (read-only forensic dashboard para auditoria).     | Ideia      |

> `MOD-M6`/`M7`/`M8` são **placeholders** — IDs reservados para
> referência futura em ADRs e roadmap. A implementação real criará
> sub-IDs (`MOD-M6.1`, etc.) conforme a estrutura do milestone se
> consolidar.

---

## Regras de manutenção

- Toda adição/remoção de módulo DEVE atualizar este arquivo.
- Toda transição de `❌` para `✅` (congelamento) DEVE ter entrada
  correspondente em `DECISION_LOG.md` (DEC-NNN) justificando o
  congelamento.
- Toda transição de `✅` para `❌` (descongelamento) DEVE ter entrada
  em `DECISION_LOG.md` + aprovação explícita do operador.

---

## Relacionado

- `IDS.md` — catálogo consolidado de todos os IDs (inclui todos os MOD-NNN).
- `TRACEABILITY.md` — matriz INV → ADR → MOD-NNN → REG-NNN → script de teste.
- `tests.md` — catálogo de testes por milestone (cobre módulos desta lista).
- `architecture/frozen-files.md` — lista canônica de FROZEN (subset desta lista).
- `architecture/dependencies.md` — blast radius por módulo (com diagrama de árvore).
- `architecture/interfaces.md` — contratos públicos por módulo.
- `architecture/runtime.md` — fluxo canônico que conecta os módulos.
- `PROJECT_STATE.md` — snapshot de quais módulos estão concluídos.
- `DECISION_LOG.md` DEC-001 a DEC-006 — decisões que congelaram módulos.
- `decisions/ADR-0001.md` — arquitetura defense-in-depth (H0 → M5).
- `decisions/ADR-0002.md` — governança v2.1 (introduziu IDs canônicos).
- `decisions/ADR-0003.md` — governança v2.2 (introduziu MOD-IDs, TRACEABILITY, tests.md, IDS.md).
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

