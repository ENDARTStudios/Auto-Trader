# memory/implementation-history.md — Registro Cronológico

> **STATE: APPEND-ONLY** — Linha do tempo cronológica — nunca editar entradas antigas.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

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

## 2026-07-15 (final) — Refinamento Project OS v2 (7 ajustes do operador)

- **Refinamento #1 (terminology vs glossary):** confirmada divisão clara
  de responsabilidade. `terminology.md` = interna (módulos, acrônimos,
  significado operacional). `glossary.md` = externa (blockchain, trading,
  Ethereum, segurança, IA). Headers explicativos adicionados em ambos.
- **Refinamento #2 (standards/):** criada pasta `standards/` com 5
  arquivos: `coding-style.md`, `testing.md`, `security.md`,
  `documentation.md`, `git-workflow.md`. `ENGINEERING_RULES.md`
  permanece como resumo executivo; `standards/` contém regras
  detalhadas.
- **Refinamento #3 (INDEX.md):** criado `INDEX.md` como ponto de
  entrada único. Lista todas as seções (CORE, STATE, ARCHITECTURE,
  CONTRACTS, STANDARDS, CONTEXT, MEMORY, DECISIONS) com função de
  cada arquivo, precedência em conflito, e sequência obrigatória de
  10 passos antes de implementar.
- **Refinamento #4 (separar estado de histórico):** `PROJECT_STATE.md`
  refinado para conter APENAS snapshot corrente. Seção "Histórico de
  estado" removida (já estava migrada para este arquivo). Seções
  "Roadmap" e "Decisões importantes" substituídas por pointers breves
  para `architecture/roadmap.md` e `DECISION_LOG.md`. Header atualizado
  com regra de manutenção: mudança de estado = atualizar snapshot +
  adicionar entrada datada aqui.
- **Refinamento #5 (contracts/):** criada pasta `contracts/` com 4
  arquivos: `api-contracts.md`, `database-contracts.md`,
  `rpc-contracts.md`, `event-contracts.md`. Cada um com convenções,
  schemas, invariantes, e regras de evolução.
- **Refinamento #6 (invariants.md):** criado `architecture/invariants.md`
  com 10 invariantes (INV-001 a INV-010): pipeline order, broadcaster
  immutability, FROZEN protection, error cause preservation, audit
  exactly-once, signer key isolation, fence monotonicity, canary
  determinism, shadow shared pipeline, registry singleton.
- **Refinamento #7 (interfaces.md):** criado `architecture/interfaces.md`
  com contratos públicos de Pipeline, SignerSink, Broadcaster,
  WriterLease, Registry, Runtime, SignerProtocol. Apenas assinaturas
  (sem implementação) para reduzir necessidade de abrir múltiplos
  arquivos.
- **README.md atualizado:** árvore de estrutura expandida para mostrar
  todas as 6 subpastas (architecture, contracts, standards, context,
  memory, decisions) + INDEX.md. Adicionada seção "Divisão de
  responsabilidade entre arquivos" documentando os 4 pares de arquivos
  com escopo deliberadamente separado.
- **Total de arquivos `.ai/` após refinamento:** 9 raiz + 7 architecture
  + 4 contracts + 5 standards + 4 context + 4 memory + 1 decisions =
  34 arquivos de governança.
- Nenhum arquivo FROZEN do código-fonte foi tocado. Nenhuma
  dependência adicionada. Escopo mínimo respeitado.

---

## 2026-07-16 — Project OS v2.1: MANIFEST, CHECKLIST, IDs canônicos, snapshot puro

- **Versão do Project OS bumpada:** v2 → v2.1. `PROJECT_STATE.md`
  agora declara `Project OS: v2.1` explicitamente.
- **Decisão registrada:** `DEC-006` em `DECISION_LOG.md`.
  Detalhe completo em `decisions/ADR-0002.md`.
- **Mudanças estruturais aplicadas:**
  1. **`MANIFEST.md` criado** na raiz do `.ai/`. Documento central
     com 7 princípios fundamentais (fonte única de verdade,
     append-only, cross-links obrigatórios, IDs canônicos,
     snapshot vs histórico, precedência, versionamento do
     Project OS), tabela de prefixos de ID e tabela de divisão
     de responsabilidade.
  2. **`CHECKLIST.md` criado** na raiz do `.ai/`. Checklist
     operacional em 7 fases (Leitura → Mapeamento → Planejamento
     → Implementação → Validação → Documentação → Cross-links).
  3. **`README.md` reescrito como índice puro** (~70 linhas,
     antes ~190). Apenas aponta "onde cada informação fica".
     Regras removidas — ficam nos arquivos referenciados.
  4. **`PROJECT_STATE.md` reescrito como snapshot puro.**
     Removidas seções de roadmap, decisões ativas e histórico
     que duplicavam fontes canônicas. Mantido: versão do
     Project OS, versão do projeto, branch, milestone, stack,
     banco, modo, servidor, próximo milestone, data de
     atualização, módulos FROZEN (referência), módulos em
     andamento, status M5, fluxo canônico (referência),
     referências para fontes externas.
  5. **`INDEX.md` atualizado:** adicionada seção "MANIFEST &
     NAVIGATION" no topo, "Regra de IDs canônicos" formalizada,
     "Regra de cross-links" formalizada com exemplo, todos os
     arquivos agora mostram coluna de ID, atualizadas referências
     aos novos nomes de `contracts/`.
  6. **IDs STD-NNN adicionados** aos 5 arquivos de `standards/`:
     - `coding-style.md` — STD-001 a STD-009.4.
     - `testing.md` — STD-101 a STD-107.
     - `security.md` — STD-201 a STD-209.
     - `documentation.md` — STD-301 a STD-307.
     - `git-workflow.md` — STD-401 a STD-408.
     Numerados por bloco (001+, 101+, 201+, 301+, 401+) para
     evitar colisão entre categorias.
  7. **Prefixo `FI-NNN` formalizado** para ideias futuras
     (`memory/future-ideas.md`).
  8. **Renomeação de contracts/:**
     - `api-contracts.md` → `api.md`.
     - `database-contracts.md` → `database.md`.
     - `rpc-contracts.md` → `rpc.md`.
     - `event-contracts.md` → `events.md`.
     Sufixo `-contracts` removido por ser redundante com a pasta.
  9. **Seção `## Relacionado` adicionada** em todos os arquivos
     estruturados de `.ai/` (exceto índices e manifesto):
     - 7 arquivos em `architecture/`.
     - 4 arquivos em `contracts/`.
     - 5 arquivos em `standards/`.
     - 4 arquivos em `memory/`.
     - 3 arquivos em `context/` (terminology, conventions,
       glossary).
     - `decisions/ADR-0001.md`.
     Total: 24 arquivos com cross-link section adicionada.
- **Total de arquivos `.ai/` após v2.1:** 11 raiz (MANIFEST e
  CHECKLIST novos) + 7 architecture + 4 contracts + 5 standards
  + 4 context + 4 memory + 2 decisions (ADR-0002 novo) =
  37 arquivos de governança.
- **Validação pós-implementação:** nenhum arquivo FROZEN do
  código-fonte foi tocado. Nenhuma dependência adicionada.
  Escopo mínimo respeitado (mudança de governança, não de
  código). Renomeação de contracts/ quebrou referências internas
  em `INDEX.md` e `README.md` — ambas atualizadas na mesma
  operação.
- **Lição permanente registrada:** toda camada de governança
  precisa de (a) manifesto, (b) checklist operacional, (c) IDs
  canônicos por categoria, (d) cross-links obrigatórios, (e)
  versionamento explícito da própria governança. Formalizado
  em `MANIFEST.md`.

---

---

## 2026-07-16 — Project OS v2.2: Rastreabilidade, MOD-IDs, STATE markers, IDS/TRACEABILITY/tests

- **Versão do Project OS bumpada:** v2.1 → v2.2. `PROJECT_STATE.md`
  agora declara `Project OS: v2.2` explicitamente.
- **Decisão registrada:** `DEC-007` em `DECISION_LOG.md`.
  Detalhe completo em `decisions/ADR-0003.md`.
- **Motivo da mudança:** após um ciclo de uso operacional de v2.1,
  o operador identificou 7 lacunas de rastreabilidade: (1)
  `CORE_RULES.md` crescia com regras operacionais; (2) módulos
  sem IDs padronizados; (3) sem matriz de rastreabilidade;
  (4) testes sem catálogo; (5) documentação sem estado explícito;
  (6) sem diagrama de árvore de dependências; (7) IDs espalhados
  sem catálogo consolidado.
- **Mudanças estruturais aplicadas (7 refinamentos):**
  1. **`CORE_RULES.md` reduzido a regras permanentes (10 regras).**
     Regra 11 ("todo bug deve produzir aprendizado") movida para
     `ENGINEERING_RULES.md > Cultura de aprendizado (pós-bug)` como
     seção operacional. Adicionado "Princípio de separação" no
     topo declarando o critério (regra entra em CORE_RULES só se
     for verdadeira em qualquer fase do projeto).
  2. **MOD-IDs introduzidos em `architecture/modules.md`.** Todo
     módulo recebe MOD-ID permanente derivado da fase: MOD-H*,
     MOD-M3.*, MOD-M4.*, MOD-M5.*, MOD-M6+ (placeholders),
     MOD-TR-* (trading), MOD-API-* (API), MOD-UI-* (UI). Coluna
     MOD-ID adicionada a todas as tabelas. ~45 MOD-IDs emitidos.
  3. **`TRACEABILITY.md` criado.** Matriz principal liga cada
     INV-NNN a ADR-NNNN, MOD-NNN, REG-NNN e script de teste.
     Tabela inversa liga cada REG-NNN ao INV-NNN defendido.
     Cobertura por módulo mostra quais MOD-IDs têm defesa
     adversarial. 5 lacunas identificadas (INV-008/009/010 sem
     REG; MOD-H1.1 e MOD-M5.4 sem REG direto) — pendências a
     registrar como TD-NNN.
  4. **`tests.md` criado.** Indexa 24 scripts test-*.ts por
     milestone (H0, H1, H2, M3, M4, M5). Para cada teste:
     script, contagem de asserts (1.487 total), linhas (15.759
     total), cobertura MOD-ID + INV-NNN + REG-NNN, responsável
     histórico. 8 de 10 INV têm teste direto.
  5. **STATE markers adicionados a 37 arquivos de governança.**
     Vocabulário: FROZEN (imutável), ACTIVE (evolui), SNAPSHOT
     (reescrito), APPEND-ONLY (entrada adicionada, nunca
     removida), DRAFT (rascunho). Script persistido
     `scripts/add-state-markers.py` aplicou markers em batch
     (idempotente).
  6. **Diagrama de árvore canônica de dependências adicionado**
     em `architecture/dependencies.md`. ASCII top-level mostrando
     Market Data → Pipeline → SignerAdapter → Signer RPC →
     Writer Lease → LeasedBroadcaster → Broadcaster → RPC Quorum
     → Blockchain → Audit Log. Cada nó tem MOD-ID e estado
     FROZEN. Diagrama é declarado "única topologia aceita" —
     desvio viola INV-001.
  7. **`IDS.md` criado.** Catálogo consolidado de todos os IDs
     emitidos em 9 categorias: ADR (3), DEC (7), INV (10), MOD
     (~45), REG (18), STD (41+), TD (12), KP (11), FI (13 ativas
     + 3 descartadas). Para cada ID: título, arquivo-fonte
     canônico, status. Regras de manutenção: adicionar entrada
     ao criar novo ID, nunca remover (permanência), numeração
     sequencial por bloco.
- **Arquivos criados:** 5 (`.ai/IDS.md`, `.ai/TRACEABILITY.md`,
  `.ai/tests.md`, `.ai/decisions/ADR-0003.md`,
  `scripts/add-state-markers.py`).
- **Arquivos editados:** 8 (`.ai/CORE_RULES.md`,
  `.ai/ENGINEERING_RULES.md`, `.ai/architecture/modules.md`,
  `.ai/architecture/dependencies.md`, `.ai/PROJECT_STATE.md`,
  `.ai/INDEX.md`, `.ai/README.md`, `.ai/DECISION_LOG.md`).
- **Arquivos com STATE marker adicionado via script:** 33
  (4 já tinham markers; total de 37 arquivos de governança com
  STATE explícito após v2.2).
- **Nenhum arquivo FROZEN do código-fonte foi tocado.** Nenhuma
  dependência adicionada. Nenhum arquivo renomeado.
- **Total de arquivos `.ai/` após v2.2:** 14 raiz (antes 11:
  +IDS, +TRACEABILITY, +tests) + 7 architecture + 4 contracts
  + 5 standards + 4 context + 4 memory + 3 decisions (antes 2:
  +ADR-0003) = 41 arquivos de governança.
- **Lição permanente registrada em DEC-007:** "Toda camada de
  governança precisa de rastreabilidade completa entre seus
  elementos. IDs canônicos por categoria resolvem consistência
  de referência, mas não resolvem rastreabilidade — é possível
  ter IDs consistentes sem matriz que mostre como eles se
  relacionam. Os 5 elementos (INV, ADR, MOD, REG, teste) formam
  cadeia; quebrar qualquer elo é pendência técnica."

---

### [Entradas futuras vêm aqui — nunca sobrescrever acima]

---

## Relacionado

- `PROJECT_STATE.md` — snapshot atual (referência cruzada com esta linha do tempo).
- `DECISION_LOG.md` DEC-NNN — decisões citadas nas entradas.
- `decisions/ADR-*.md` — ADRs citados nas entradas.
- `memory/known-problems.md` KP-NNN — bugs registrados após cada fase.
- `memory/technical-debt.md` TD-NNN — débitos identificados em cada fase.
- `architecture/roadmap.md` — fases canônicas referenciadas.
- `worklog.md` (raiz do projeto) — log operacional contínuo.
- `MANIFEST.md` — princípios do Project OS (append-only, fonte única).

