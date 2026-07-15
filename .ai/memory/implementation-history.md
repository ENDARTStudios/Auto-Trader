# memory/implementation-history.md — Registro Cronológico

> O que foi implementado, quando, por quê. Append-only. Para decisões
> arquiteturais com contexto completo ver `DECISION_LOG.md` e
> `.ai/decisions/ADR-*.md`.

---

## 2026-07-XX (início do projeto) — fundação

- **Init projeto Next.js 16 + TypeScript + Tailwind + shadcn/ui.**
- **Prisma schema** com 8 models: `Config`, `Position`, `Reserve`,
  `TradingBalance`, `RiskEvent`, `ScamReport`, `Round`, `AppLog`.
- **Engine TypeScript modular:** `config.ts`, `logger.ts`,
  `risk-manager.ts` (5 circuit breakers), `scam-detector.ts`
  (6 sub-scorers), `token-selector.ts`, `price-feed.ts`,
  `paper-trader.ts`, `portfolio.ts`, `engine.ts` (loop state
  machine).
- **11 API routes REST** iniciais.
- **6 componentes de dashboard**.
- **Negociação de escopo com operador:** removido requisito
  "irrastreável" (incompatível com AML/KYC), trocado "100% seguro"
  por "scam-resistente".

## 2026-07-XX (fase enhancement-v2)

- **3 novos models Prisma:** `MarketSnapshot`, `AIInsight`,
  `SiteAudit`.
- **`goplus-scanner.ts`:** integração GoPlus Security API.
- **`site-integrity.ts`:** verificador de sites com 5 camadas (SSL,
  idade do domínio, headers, Safe Browsing, red flags).
- **`market-analysis.ts`:** RSI, MACD, EMA, Bollinger, Fear &
  Greed, CoinGecko trending.
- **`ai-agent.ts`:** 3 LLM agents via z-ai-web-dev-sdk (thesis,
  contract auditor, news/sentiment) com consensus veto.
- **Engine atualizado:** 4 camadas de análise sequenciais (regex
  → GoPlus → market signal → AI veto).
- **3 novas API routes, 3 novos componentes UI.**
- Dashboard passa a ter 8 tabs.

## H0 — Crypto Foundation

- **`kdf.ts`** — KDF versionada.
- **`audit-log.ts`** — hash-chain append-only.
- **`key-rotation.ts`** — rotação all-or-nothing.
- **Bug H0.3 corrigido:** `JSON.stringify(entry, sortedKeysArray)`
  (replacer-array) silenciosamente dropava nested keys dentro de
  `payload`. Atacante podia modificar payload sem quebrar a cadeia.
  Corrigido para replacer-function recursivo.
- **Lição permanente registrada:** todo primitivo criptográfico
  deve ter teste adversarial que tenta quebrar o invariant.

## H1 — RPC/Sim/Approval/MEV

- **`rpc-resilience.ts`** (H1.1) — quorum com detecção de endpoint
  malicioso (chain id, block stale, balance errado).
- **`simulation-gate.ts`** (H1.2) — simula tx antes de broadcast.
  Revert bloqueia.
- **`approval-hardening.ts`** (H1.3) — rejeita unlimited, cap
  excedido, saldo excedido.
- **`mev-baseline.ts`** (H1.4) — baseline anti-MEV.

## H2 — Contract/Liquidity/TokenAuthority/SellSim

- **`contract-verification.ts`** (H2.1).
- **`liquidity-verification.ts`** (H2.2).
- **`token-authority.ts`** (H2.3).
- **`sell-simulation.ts`** (H2.4).

## H2.6 — Pipeline

- **`pipeline.ts`** — composição dos gates H1+H2 em sequência.
  `PipelineResult` é contrato consumido por `signer-adapter`.

## M3.1 — SignerAdapter

- **`signer-adapter.ts`** — adaptador IPC entre engine e signer.
- **`signer-protocol.ts`** — contrato de mensagens IPC.

## M3.2 — Signer RPC (processo isolado)

- **`src/signer/main.ts`** — entrypoint.
- **`src/signer/wallet-methods.ts`** — handlers de carteira.
- **`src/signer/sign-methods.ts`** — handlers de assinatura (com
  domain separator).
- **`src/signer/audit.ts`** — audit log interno (hash-chain
  separada).
- **Design documentado em `docs/signer-isolation-design.md`.**

## M3.3 — Broadcaster

- **`broadcaster.ts`** — submete tx ao RPC quorum, aguarda receipt,
  classifica erros.

## M4 — Writer Lease

- **`writer-lease.ts`** — `WriterLease`, `LeaseStore` interface,
  `InMemoryLeaseStore`, fencing tokens (Kleppmann).
- **`leased-broadcaster.ts`** — wrapper com pre-broadcast fencing
  check.
- **REG-015/016/017/018** travam invariants.
- **88/88 testes** em `scripts/test-m4-writer-lease.ts`.

## M5 — Production Validation

### M5.0 — Runtime factory

- **`src/lib/chain/runtime.ts`** — `buildRuntime()` compõe stack
  completa.

### M5.1 — Dry Run

- **`scripts/test-m5-dry-run.ts`** — 26/26 testes pass.
- **Mocks happy-path:** `HappyChainReader`, `HappyLiquiditySource`,
  `HappyAuthoritySource`, `HappyTradeSimulator`, `HappySimulator`,
  `MockRpcTransport`, `MockSignerTransport`, `CountingAuditSink`.
- **1000 ops executadas**, lease invariants preservadas, memória
  estável.

### M5.5 — Observability

- **`src/lib/observability/metrics.ts`** — interface
  `RuntimeMetrics` com Histograms, Counters, Gauges.
- **`src/lib/observability/registry.ts`** — Registry único.
- **`src/lib/observability/snapshot.ts`** — snapshot read-only.
- **`src/lib/observability/exporter.ts`** — export JSON.
- **`/api/runtime/status`** — endpoint read-only.
- **Princípio DEC-004:** observability antes de chaos/shadow/
  canary/long-duration para evitar duplicação de coleta de
  métricas.

### M5.4 — Chaos

- **`src/lib/runtime/chaos.ts`** — ChaosInjector classes
  independentes com `before()/after()/cleanup()`.
- **`scripts/test-m5-chaos.ts`** — 99/99 testes pass.
- **Bug fix em `broadcaster.ts`:** erros do signer não estavam
  prefixados com `BROADCAST_*`, fazendo `LeasedBroadcaster`
  misclassificá-los. Corrigido (DEC-005).

### M5.2 — Shadow

- **`src/lib/runtime/shadow.ts`** — compartilha a MESMA Pipeline,
  fork output para Live + Shadow, compara, incrementa
  `shadowDiffs`.
- **`scripts/test-m5-shadow.ts`** — 11/11 testes pass.
- **600 RPC reais BSC mainnet**, 0 diffs.

### M5.3 — Canary

- **`CanaryBroadcaster`** refatorado para
  `bucket = keccak256(txHash) % 100; bucket < canaryPct`
  (determinístico por txHash).
- **`setCanaryPct(pct)`** permite ramp dinâmica.

### M5.6 — Long-Duration

- **`src/lib/runtime/long-duration.ts`** — loop
  `while (running) { await runtime.tick(); await sleep(period); }`.
- **`scripts/test-m5-long-duration.ts`** — 7/7 testes pass.
- **74k ops em 60s**, 0 leak de heap, lease estável.
- **Runs 24h/72h/7d** podem ser disparadas pelo operador via
  `npx tsx scripts/test-m5-long-duration.ts --duration 86400000`.

### M5.7 — Finalização

- **Critérios objetivos atendidos:** todos os critérios da tabela
  em `architecture/roadmap.md` marcados ✅.
- **0 regressões H0–M4.**
- **Próximo milestone proposto:** M6 Live Trading (canaryPct ramp
  1% → 5% → 10% → 25% → 100% com rollback automático).

## 2026-07-15 — Camada de governança `.ai/` criada

- 8 arquivos base: README, CORE_RULES, ENGINEERING_RULES,
  PROMPTING_RULES, OUTPUT_RULES, PROJECT_STATE, DECISION_LOG,
  TASK_TEMPLATE.
- Antes desta entrada, decisões estavam dispersas no `worklog.md`
  (2385+ linhas) e no `HARDENING-ROADMAP.md`.

## 2026-07-15 (posterior) — Expansão para Project OS

- 4 subdiretórios adicionais: `architecture/`, `context/`,
  `memory/`, `decisions/`.
- 14 arquivos novos cobrindo: módulos, dependências, arquivos
  frozen, runtime, roadmap, project-summary, terminology,
  conventions, glossary, implementation-history, known-problems,
  technical-debt, future-ideas, ADR-0001.
- Edições direcionadas em README, CORE_RULES, ENGINEERING_RULES,
  TASK_TEMPLATE, PROJECT_STATE para alinhamento.

---

### [Entradas futuras vêm aqui — nunca sobrescrever acima]
