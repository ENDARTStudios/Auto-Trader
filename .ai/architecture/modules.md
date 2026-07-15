# architecture/modules.md — Lista de Módulos

> Fonte canônica da estrutura modular do projeto. Cada módulo lista:
> responsabilidade, interface pública, dependências e fase do hardening
> roadmap. **Não confundir com `frozen-files.md`** — aqui focamos em
> responsabilidade e interface; lá focamos em motivo de congelamento.

---

## Camada de Chain (`src/lib/chain/`)

### `audit-log.ts` — Fase H0.3 — ⚠️ FROZEN

- **Responsabilidade:** append-only audit log com hash-chain determinística
  (replacer-function recursiva que ordena chaves em todos os níveis). Cada
  entrada inclui `seq`, `timestamp`, `payload`, `prevHash`, `hash`.
- **Interface pública:** `appendEntry(payload)`, `verifyChain()`,
  `getEntry(seq)`, `tail()`.
- **Dependências:** nenhuma externa (Prisma `AppLog` model para persistência).
- **Consumidores:** todos os módulos que precisam de audit trail
  (broadcaster, signer, risk-manager, etc.).

### `rpc-resilience.ts` — Fase H1.1 — ⚠️ FROZEN

- **Responsabilidade:** RPC quorum com detecção de endpoint malicioso
  (chain id errado, block stale, balance errado). Endpoint em quarentina
  é removido do quorum temporariamente.
- **Interface pública:** `QuorumReader`, `Endpoint` interface,
  `quorumCall(rpc, method, params)`.
- **Dependências:** ethers.js (`JsonRpcProvider`).
- **Consumidores:** `broadcaster.ts`, `liquidity-verification.ts`,
  `contract-verification.ts`, `token-authority.ts`.

### `simulation-gate.ts` — Fase H1.2 — ⚠️ FROZEN

- **Responsabilidade:** simula tx antes de broadcastar. Revert simulado
  bloqueia broadcast. State-diff divergente do esperado bloqueia broadcast.
- **Interface pública:** `simulateTransaction(tx)`, `SimulationResult`.
- **Dependências:** `rpc-resilience.ts`, ethers.js.
- **Consumidores:** `pipeline.ts`.

### `approval-hardening.ts` — Fase H1.3 — ⚠️ FROZEN

- **Responsabilidade:** rejeita approvals ilimitados
  (`type(uint256).max`), approvals acima do cap configurado, approvals
  acima do saldo on-chain.
- **Interface pública:** `checkApproval(token, spender, amount)`,
  `ApprovalResult`.
- **Dependências:** `rpc-resilience.ts`, ERC-20 ABI.
- **Consumidores:** `pipeline.ts`.

### `mev-baseline.ts` — Fase H1.4 — ⚠️ FROZEN

- **Responsabilidade:** baseline anti-MEV. Detecta sandwich
  opportunity (liquidez insuficiente + slippage alto), recomenda
  private mempool / Flashbots quando configurado.
- **Interface pública:** `assessMev(tx, poolState)`, `MevRisk`.
- **Dependências:** `rpc-resilience.ts`.
- **Consumidores:** `pipeline.ts`.

### `contract-verification.ts` — Fase H2.1 — ⚠️ FROZEN

- **Responsabilidade:** verifica source code do contrato via Etherscan /
  Sourcify. Rejeita contratos não-verificados, contratos com proxy
  oculto, contratos com funções `selfdestruct` / `delegatecall` não
  justificadas.
- **Interface pública:** `verifyContract(address)`, `ContractReport`.
- **Dependências:** `rpc-resilience.ts`, Etherscan API.
- **Consumidores:** `pipeline.ts`.

### `liquidity-verification.ts` — Fase H2.2 — ⚠️ FROZEN

- **Responsabilidade:** verifica liquidez on-chain (reserva real do LP,
  não só TVL reportada). Rejeita pools com LP lock expirado, pools com
  concentração de LP em poucos holders.
- **Interface pública:** `verifyLiquidity(pair, minLiquidity)`,
  `LiquidityReport`.
- **Dependências:** `rpc-resilience.ts`, `contract-verification.ts`.
- **Consumidores:** `pipeline.ts`.

### `token-authority.ts` — Fase H2.3 — ⚠️ FROZEN

- **Responsabilidade:** verifica autoridade do token (mint authority,
  freeze authority, blacklist function, upgradeability). Rejeita tokens
  com mint authority não renunciada, freeze authority ativa.
- **Interface pública:** `checkAuthority(token)`, `AuthorityReport`.
- **Dependências:** `rpc-resilience.ts`, `contract-verification.ts`.
- **Consumidores:** `pipeline.ts`.

### `sell-simulation.ts` — Fase H2.4 — ⚠️ FROZEN

- **Responsabilidade:** simula a saída (sell) antes de entrar. Rejeita
  tokens cuja simulação de sell reverte, ou cujo slippage de sell é
  acima do limiar (honeypot detection).
- **Interface pública:** `simulateSell(token, amount)`, `SellResult`.
- **Dependências:** `rpc-resilience.ts`, `simulation-gate.ts`.
- **Consumidores:** `pipeline.ts`.

### `pipeline.ts` — Fase H2.6 — ⚠️ FROZEN

- **Responsabilidade:** compõe os gates H1+H2 em sequência. Recebe
  market data, aplica liquidity → authority → simulation → mev →
  approval → sell-sim, e emite `PipelineResult` aprovando ou
  rejeitando com reason code.
- **Interface pública:** `Pipeline`, `PipelineResult`, `GateName`.
- **Dependências:** todos os gates H1+H2 acima.
- **Consumidores:** `signer-adapter.ts`, `runtime.ts`.

### `signer-adapter.ts` — Fase M3.1 — ⚠️ FROZEN

- **Responsabilidade:** adapta chamadas do engine para o protocolo de
  IPC do signer. Serializa params, envia via canal dedicado, aguarda
  resposta, desserializa. Não manipula chaves.
- **Interface pública:** `SignerAdapter`, `SignRequest`, `SignResponse`.
- **Dependências:** `signer-protocol.ts`.
- **Consumidores:** `runtime.ts`, `leased-broadcaster.ts`.

### `broadcaster.ts` — Fase M3.3 — ⚠️ FROZEN

- **Responsabilidade:** recebe tx assinada, submete ao RPC quorum,
  aguarda receipt, classifica erros. Erros do signer agora prefixados
  com `BROADCAST_SIGNER_*` (correção M5.4) para classificação correta
  pelo `LeasedBroadcaster`.
- **Interface pública:** `Broadcaster`, `BroadcastResult`,
  `BroadcastError` (prefixos `BROADCAST_*`).
- **Dependências:** `rpc-resilience.ts`.
- **Consumidores:** `leased-broadcaster.ts`.

### `writer-lease.ts` — Fase M4 — ⚠️ FROZEN

- **Responsabilidade:** lease distribuído com fencing tokens
  (Kleppmann pattern). Cada acquire recebe token monotônico.
  `LeasedBroadcaster` verifica token antes de broadcastar. LeaseStore
  é interface; InMemoryLeaseStore é a default.
- **Interface pública:** `WriterLease`, `LeaseStore`,
  `InMemoryLeaseStore`, `LeaseKey`, `LeaseOwner`, `FencingToken`,
  `LeaseRecord`, `LeaseOpResult`, `LeaseError`, `generateOwnerId`,
  `buildLeaseKey`.
- **Dependências:** nenhuma externa.
- **Consumidores:** `leased-broadcaster.ts`.
- **REG-NNN:** REG-015 (fencing monotônico), REG-016 (acquire
  exclusivo), REG-017 (renew após timeout), REG-018 (reconnect não
  reanima lease stale).

### `leased-broadcaster.ts` — Fase M4 — ⚠️ FROZEN

- **Responsabilidade:** wrapper sobre `Broadcaster` com pre-broadcast
  fencing check. Classifica erros: `LEASE_BUSY`/`STORE_UNAVAILABLE`
  → wrap com `LEASE_ACQUIRE_FAILED`; `BROADCAST_*`/
  `FENCING_TOKEN_STALE`/`CALLBACK_EXCEPTION` → pass-through.
- **Interface pública:** `LeasedBroadcaster` implements `SignerSink`.
- **Dependências:** `writer-lease.ts`, `broadcaster.ts`.
- **Consumidores:** `runtime.ts`.

### `runtime.ts` — Fase M5.0 — não congelado (validado)

- **Responsabilidade:** factory `buildRuntime()` compõe a stack
  completa: market data → pipeline → signer adapter → writer lease →
  leased broadcaster. Inclui `MetricsRecorder` interface e impls
  (`InMemoryMetricsRecorder`, `NoopMetricsRecorder`), e
  `CanaryBroadcaster` (com bucketing keccak256).
- **Interface pública:** `buildRuntime(config)`, `Runtime`,
  `RuntimeConfig`, `MetricsRecorder`, `MetricEvent`.
- **Dependências:** todos os módulos chain acima + `signer-protocol.ts`.
- **Consumidores:** `src/lib/runtime/` (M5 sub-módulos),
  `scripts/test-m5-*.ts`.

---

## Camada de Runtime (`src/lib/runtime/`)

### `runtime.ts` — Fase M5.0 — não congelado (validado)

- **Responsabilidade:** runtime principal exposto ao engine de trading.
  Após M5.0, factory oficial está aqui; `chain/runtime.ts` mantém
  exportações por compatibilidade.
- **Consumidores:** engine de trading, API `/api/runtime/status`.

### `canary.ts` (ou `CanaryBroadcaster` em `chain/runtime.ts`) — Fase M5.3 — não congelado (validado)

- **Responsabilidade:** broadcaster canário com bucketing determinístico
  por txHash: `bucket = keccak256(txHash) % 100; bucket < canaryPct`.
  Permite ramp 1% → 5% → 10% → 25% → 100% via `setCanaryPct`.
- **Consumidores:** `runtime.ts`.

### `shadow.ts` — Fase M5.2 — não congelado (validado)

- **Responsabilidade:** compartilha a MESMA Pipeline, fork do output
  para Live + Shadow, compara resultados, incrementa `shadowDiffs`
  em divergência. Não roda duas pipelines paralelas.
- **Consumidores:** `runtime.ts`, `scripts/test-m5-shadow.ts`.

### `chaos.ts` — Fase M5.4 — não congelado (validado)

- **Responsabilidade:** ChaosInjector classes independentes
  (`LatencyInjector`, `RpcFailureInjector`, `LeaseFailureInjector`,
  `SignerFailureInjector`, `BroadcastFailureInjector`,
  `NetworkPartitionInjector`) com `before()/after()/cleanup()`. Sem
  `if (chaos)` espalhado.
- **Consumidores:** `scripts/test-m5-chaos.ts`.

### `long-duration.ts` — Fase M5.6 — não congelado (validado)

- **Responsabilidade:** loop `while (running) { await runtime.tick();
  await sleep(period); }` (não setInterval). Suporta flag
  `--duration N` para runs de 24h/72h/7d.
- **Consumidores:** `scripts/test-m5-long-duration.ts`.

---

## Camada de Observability (`src/lib/observability/`)

### `metrics.ts` — Fase M5.5 — não congelado (validado)

- **Responsabilidade:** interface `RuntimeMetrics` com Histograms
  (`signerLatencyMs`, `pipelineLatencyMs`, `broadcastLatencyMs`,
  `leaseAcquireMs`), Counters (`rpcErrors`, `signerErrors`,
  `broadcastErrors`, `gateRejects.{liquidity,authority,simulation,
  mev,approval}`, `canaryAccepted`, `canarySkipped`, `shadowDiffs`),
  Gauges (`activeLeaseOwner`, `uptimeSeconds`), e counters de round
  (`roundsStarted`, `roundsSucceeded`, `roundsFailed`).

### `registry.ts` — Fase M5.5 — não congelado (validado)

- **Responsabilidade:** Registry único. Todos os harnesses (dry-run,
  chaos, shadow, long-duration) consomem o mesmo Registry. Fonte de
  verdade para todas as métricas.

### `snapshot.ts` — Fase M5.5 — não congelado (validado)

- **Responsabilidade:** snapshot read-only do Registry. Usado por
  `exporter.ts` e pelo endpoint `/api/runtime/status`.

### `exporter.ts` — Fase M5.5 — não congelado (validado)

- **Responsabilidade:** serializa o snapshot para o formato JSON
  consumido pela API.

---

## Camada de Signer (`src/signer/`)

### `main.ts` — Fase M3.2 — ⚠️ FROZEN

- **Responsabilidade:** entrypoint do processo signer isolado. Carrega
  chave privada do Vault/KMS, expõe RPC via canal dedicado.

### `wallet-methods.ts` — Fase M3.2 — ⚠️ FROZEN

- **Responsabilidade:** handlers de métodos de carteira (address,
  balance, etc.).

### `sign-methods.ts` — Fase M3.2 — ⚠️ FROZEN

- **Responsabilidade:** handlers de métodos de assinatura
  (`personal_sign`, `eth_signTypedData`, etc.). Aplica domain
  separator para evitar cross-protocol signature reuse.

### `audit.ts` — Fase M3.2 — ⚠️ FROZEN

- **Responsabilidade:** audit log interno do signer (append-only,
  hash-chain separada da audit-chain do engine principal).

---

## Camada de Trading (`src/lib/trading/`)

Fora do escopo do hardening roadmap. Consumidora final da camada de
chain. Módulos principais: `engine.ts`, `risk-manager.ts`,
`scam-detector.ts`, `goplus-scanner.ts`, `site-integrity.ts`,
`market-analysis.ts`, `ai-agent.ts`, `paper-trader.ts`, `portfolio.ts`,
`watchlist.ts`, `token-selector.ts`, `price-feed.ts`, `config.ts`,
`logger.ts`, `notifier.ts`. Detalhes em `src/lib/trading/` e no
README raiz do projeto.

---

## API Routes (Next.js) — `src/app/api/`

Endpoints REST. Lista não-exaustiva dos relevantes para M5:

- `/api/runtime/status` — read-only JSON, consome `snapshot.ts`.
- `/api/engine/start`, `/api/engine/stop` — controla o runtime.
- `/api/kill-switch` — ativa kill switch global.
- `/api/status` — status do engine de trading.
- Demais endpoints em `src/app/api/` seguem o padrão Next.js 16
  App Router (`route.ts`).
