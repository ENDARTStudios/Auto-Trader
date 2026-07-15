# IDS.md — Catálogo Consolidado de IDs

> **STATE: ACTIVE** — catálogo evolui conforme novos IDs são emitidos.
> Adição de nova entrada: obrigatória quando um novo INV/ADR/DEC/MOD/
> REG/STD/TD/KP/FI é criado. Remoção: proibida (IDs são permanentes).
> Ver `MANIFEST.md` para os princípios de ID canônico.

---

## Objetivo

Arquivo único que lista **todos os IDs canônicos** do projeto, com
ponteiro para o arquivo onde o ID é definido. Perite responder
rapidamente:

- "Onde está o ADR-0002?" → `decisions/ADR-0002.md`
- "Quais REG-NNN existem?" → listados abaixo + detalhe em `SECURITY.md`
- "Quais MOD-IDs têm status FROZEN?" → marcados com ✅ na tabela MOD
- "Há colisão de IDs?" — não deve haver; este arquivo é a fonte para verificação

IDs são **permanentes**: uma vez emitidos, não são reusados nem
renomeados. Documentos supercedidos mantêm seu ID original com nota
`Status: Supercedado por <novo-ID>`.

---

## Prefixos canônicos

| Prefixo  | Categoria                                     | Arquivo-fonte canônico                          |
| -------- | --------------------------------------------- | ------------------------------------------------ |
| `INV-`   | Invariantes arquiteturais                     | `architecture/invariants.md`                     |
| `ADR-`   | Architecture Decision Records (4 dígitos)     | `decisions/ADR-NNNN.md`                          |
| `DEC-`   | Decisões (resumos curtos)                     | `DECISION_LOG.md`                                |
| `MOD-`   | Módulos (código + responsabilidade)           | `architecture/modules.md`                        |
| `TD-`    | Débitos técnicos                              | `memory/technical-debt.md`                       |
| `KP-`    | Problemas conhecidos                          | `memory/known-problems.md`                       |
| `STD-`   | Padrões de engenharia                         | `standards/*.md`                                 |
| `REG-`   | Regressões de segurança (testes adversariais) | `SECURITY.md` (raiz do projeto)                  |
| `FI-`    | Ideias futuras                                | `memory/future-ideas.md`                         |

---

## ADR — Architecture Decision Records

| ID         | Título                                                            | Arquivo                       | Status    |
| ---------- | ----------------------------------------------------------------- | ----------------------------- | --------- |
| `ADR-0001` | Defense-in-Depth Architecture with Process-Isolated Signer (H0→M5)| `decisions/ADR-0001.md`       | Aceito    |
| `ADR-0002` | Project OS v2.1: MANIFEST, CHECKLIST, IDs, snapshot puro          | `decisions/ADR-0002.md`       | Aceito    |
| `ADR-0003` | Project OS v2.2: TRACEABILITY, IDS, tests.md, MOD-IDs, STATE markers | `decisions/ADR-0003.md`   | Aceito    |

> Próximo ADR usará `ADR-0004`. Numeração é sequencial e permanente.

---

## DEC — Decisões (resumos curtos)

| ID       | Título                                                            | Arquivo                | Status    |
| -------- | ----------------------------------------------------------------- | ---------------------- | --------- |
| `DEC-001`| Audit hash-chain com replacer-array corrigido (H0.3)             | `DECISION_LOG.md`      | Ativa     |
| `DEC-002`| Signer isolado em processo próprio (M3.2)                        | `DECISION_LOG.md`      | Ativa     |
| `DEC-003`| Writer Lease com fencing tokens Kleppmann (M4)                   | `DECISION_LOG.md`      | Ativa     |
| `DEC-004`| Ordem corrigida das sub-fases M5 (Observability primeiro)        | `DECISION_LOG.md`      | Ativa     |
| `DEC-005`| Prefixo `BROADCAST_*` em erros do signer (correção M5.4)         | `DECISION_LOG.md`      | Ativa     |
| `DEC-006`| Project OS v2.1: MANIFEST, CHECKLIST, IDs canônicos, snapshot    | `DECISION_LOG.md`      | Ativa     |
| `DEC-007`| Project OS v2.2: TRACEABILITY, IDS, tests.md, MOD-IDs, STATE     | `DECISION_LOG.md`      | Ativa     |

> Próxima decisão usará `DEC-008`. Resumos curtos ficam aqui;
> detalhes estruturais em `decisions/ADR-NNNN.md`.

---

## INV — Invariantes arquiteturais

| ID        | Título                                                  | Arquivo                            | Teste adversarial           |
| --------- | ------------------------------------------------------- | ----------------------------------- | --------------------------- |
| `INV-001` | Pipeline sempre executa H0 → H1 → H2 → M3 → M4         | `architecture/invariants.md`        | REG-009 (H0/H1/H2 freeze)   |
| `INV-002` | Broadcaster nunca altera payload assinado               | `architecture/invariants.md`        | REG-014 (post-sig immut.)   |
| `INV-003` | Arquivos FROZEN não podem ser modificados sem ADR       | `architecture/invariants.md`        | (procedural)               |
| `INV-004` | Todo erro deve preservar o motivo original (`cause`)    | `architecture/invariants.md`        | (implícito em REG-005)     |
| `INV-005` | Audit é exatamente uma vez                              | `architecture/invariants.md`        | REG-001 (sentinel)         |
| `INV-006` | Signer nunca expõe chave privada                        | `architecture/invariants.md`        | REG-011, REG-012           |
| `INV-007` | WriterLease fencing token é monotônico crescente       | `architecture/invariants.md`        | REG-015, 016, 017, 018     |
| `INV-008` | Canary bucketing é determinístico por txHash           | `architecture/invariants.md`        | (a adicionar REG-XXX)      |
| `INV-009` | Shadow compartilha a MESMA Pipeline                    | `architecture/invariants.md`        | (a adicionar REG-XXX)      |
| `INV-010` | Observability Registry é singleton injetado            | `architecture/invariants.md`        | (a adicionar REG-XXX)      |

> Invariantes sem REG-NNN associado são pendência técnica —
> registrar como TD-NNN. Ver `TRACEABILITY.md` para a matriz completa.

---

## MOD — Módulos (código + responsabilidade)

### Camada de Chain (hardening H0 → M5)

| MOD-ID     | Módulo                  | Arquivo                                            | FROZEN |
| ---------- | ----------------------- | -------------------------------------------------- | ------ |
| `MOD-H0`   | Audit hash-chain        | `src/lib/audit/audit-log.ts`                       | ✅     |
| `MOD-H1.1` | RPC resilience / quorum | `src/lib/chain/rpc-resilience.ts`                  | ✅     |
| `MOD-H1.2` | Simulation gate         | `src/lib/chain/simulation-gate.ts`                 | ✅     |
| `MOD-H1.3` | Approval hardening      | `src/lib/chain/approval-hardening.ts`              | ✅     |
| `MOD-H1.4` | MEV baseline            | `src/lib/chain/mev-baseline.ts`                    | ✅     |
| `MOD-H2.1` | Contract verification   | `src/lib/chain/contract-verification.ts`           | ✅     |
| `MOD-H2.2` | Liquidity verification  | `src/lib/chain/liquidity-verification.ts`          | ✅     |
| `MOD-H2.3` | Token authority         | `src/lib/chain/token-authority.ts`                 | ✅     |
| `MOD-H2.4` | Sell simulation         | `src/lib/chain/sell-simulation.ts`                 | ✅     |
| `MOD-H2.6` | Pipeline                | `src/lib/chain/pipeline.ts`                        | ✅     |
| `MOD-M3.1` | SignerAdapter           | `src/lib/chain/signer-adapter.ts`                  | ✅     |
| `MOD-M3.2` | Signer RPC (processo)   | `src/signer/`                                       | ✅     |
| `MOD-M3.3` | Broadcaster             | `src/lib/chain/broadcaster.ts`                     | ✅     |
| `MOD-M4.1` | WriterLease             | `src/lib/chain/writer-lease.ts`                    | ✅     |
| `MOD-M4.2` | LeasedBroadcaster       | `src/lib/chain/leased-broadcaster.ts`              | ✅     |

### Camada de Runtime (M5)

| MOD-ID      | Módulo                | Arquivo                                     | FROZEN |
| ----------- | --------------------- | ------------------------------------------- | ------ |
| `MOD-M5.0`  | Runtime factory       | `src/lib/chain/runtime.ts`                  | ❌     |
| `MOD-M5.1`  | Runtime principal     | `src/lib/runtime/runtime.ts`                | ❌     |
| `MOD-M5.2`  | Shadow harness        | `src/lib/runtime/shadow.ts`                 | ❌     |
| `MOD-M5.3`  | Canary harness        | `src/lib/runtime/canary.ts`                 | ❌     |
| `MOD-M5.4`  | Chaos harness         | `src/lib/runtime/chaos.ts`                  | ❌     |
| `MOD-M5.6`  | Long-Duration         | `src/lib/runtime/long-duration.ts`          | ❌     |

### Camada de Observability (M5.5)

| MOD-ID        | Módulo    | Arquivo                                     | FROZEN |
| ------------- | --------- | ------------------------------------------- | ------ |
| `MOD-M5.5-M`  | Metrics   | `src/lib/observability/metrics.ts`          | ❌     |
| `MOD-M5.5-R`  | Registry  | `src/lib/observability/registry.ts`         | ❌     |
| `MOD-M5.5-S`  | Snapshot  | `src/lib/observability/snapshot.ts`         | ❌     |
| `MOD-M5.5-E`  | Exporter  | `src/lib/observability/exporter.ts`         | ❌     |

### Camada de Trading (não-hardening)

| MOD-ID        | Módulo            | Arquivo                                     |
| ------------- | ----------------- | ------------------------------------------- |
| `MOD-TR-CFG`  | Config manager    | `src/lib/trading/config.ts`                 |
| `MOD-TR-LOG`  | Logger            | `src/lib/trading/logger.ts`                 |
| `MOD-TR-RSK`  | Risk manager      | `src/lib/trading/risk-manager.ts`           |
| `MOD-TR-SCM`  | Scam detector     | `src/lib/trading/scam-detector.ts`          |
| `MOD-TR-TOK`  | Token selector    | `src/lib/trading/token-selector.ts`         |
| `MOD-TR-PRC`  | Price feed        | `src/lib/trading/price-feed.ts`             |
| `MOD-TR-PAP`  | Paper trader      | `src/lib/trading/paper-trader.ts`           |
| `MOD-TR-PRT`  | Portfolio         | `src/lib/trading/portfolio.ts`              |
| `MOD-TR-ENG`  | Engine            | `src/lib/trading/engine.ts`                 |

### Camada de API (Next.js routes)

| MOD-ID          | Endpoint                       |
| --------------- | ------------------------------ |
| `MOD-API-STAT`  | `/api/status`                  |
| `MOD-API-POS`   | `/api/positions`               |
| `MOD-API-HIST`  | `/api/history`                 |
| `MOD-API-LOG`   | `/api/logs`                    |
| `MOD-API-CFG`   | `/api/config`                  |
| `MOD-API-EST`   | `/api/engine/start`            |
| `MOD-API-ESP`   | `/api/engine/stop`             |
| `MOD-API-KS`    | `/api/kill-switch`             |
| `MOD-API-RES`   | `/api/reserve`                 |
| `MOD-API-SCM`   | `/api/scam-reports`            |
| `MOD-API-RND`   | `/api/rounds`                  |
| `MOD-API-INIT`  | `/api/initialize`              |
| `MOD-API-RTS`   | `/api/runtime/status`          |

### Camada de UI (Next.js dashboard)

| MOD-ID         | Componente          |
| -------------- | ------------------- |
| `MOD-UI-POS`   | Positions table     |
| `MOD-UI-HIST`  | History table       |
| `MOD-UI-SCM`   | Scam reports        |
| `MOD-UI-RND`   | Rounds table        |
| `MOD-UI-LOG`   | Logs feed           |
| `MOD-UI-CFG`   | Config editor       |

### Milestones futuros (placeholders)

| MOD-ID    | Milestone | Estado     |
| --------- | --------- | ---------- |
| `MOD-M6`  | M6        | Planejado  |
| `MOD-M7`  | M7        | Ideia      |
| `MOD-M8`  | M8        | Ideia      |

---

## REG — Regressões de segurança (testes adversariais)

> Fonte canônica: `SECURITY.md` (raiz do projeto, ~98KB).
> Esta tabela é espelho para navegação; detalhes em SECURITY.md.

| ID        | Título                                                                 | Fase     |
| --------- | ---------------------------------------------------------------------- | -------- |
| `REG-001` | `enteredHandler` sentinel in `request-peer-capture.ts`                 | H0/ops   |
| `REG-002` | per-IP rate limiter fallback is `req.socket.remoteAddress`             | H0/ops   |
| `REG-003` | test suite self-cleanup via `hardCleanupBeforeSuite`                   | ops      |
| `REG-004` | pre-push git hook runs `test:ci` before any push                       | ops      |
| `REG-005` | commit discipline — no milestone stays working-tree-only               | ops      |
| `REG-006` | schema reconstruction validated against CRUD layer                     | H2/DB    |
| `REG-007` | dispatcher LAYER 2 — handler exceptions propagate, never swallowed     | ops      |
| `REG-008` | dev SQLite DB must not be tracked in git                               | ops      |
| `REG-009` | H0/H1/H2/H2.6 freeze — M3 changes are regression-only                 | H0–H2.6  |
| `REG-010` | Two-point protocol version validation                                  | M3.2     |
| `REG-011` | Signer-side payload integrity re-verification                          | M3.2     |
| `REG-012` | Wallet-by-address lookup must verify key-derived address               | M3.2     |
| `REG-013` | Writer lease is a hard precondition (M4 SEAM)                          | M4       |
| `REG-014` | Post-signature immutability (M3.3)                                     | M3.3     |
| `REG-015` | Fencing token monotônico                                               | M4       |
| `REG-016` | Lease acquire exclusivo                                                | M4       |
| `REG-017` | Lease renew após timeout                                               | M4       |
| `REG-018` | Reconnect não reanima lease stale                                      | M4       |

> Próximo REG usará `REG-019`. Detalhes (descrição, código, ataque
> defendido) ficam em `SECURITY.md`. REG-001 a REG-009 são
> operacionais; REG-010 a REG-018 são adversariais por módulo.

---

## STD — Padrões de engenharia

> Fonte canônica: `standards/*.md`. Cada arquivo define um bloco
> de STD-IDs.

| Bloco            | Arquivo                            | Range              | Count |
| ---------------- | ---------------------------------- | ------------------ | ----- |
| Coding style     | `standards/coding-style.md`        | STD-001 a STD-009.4| 9+    |
| Testing          | `standards/testing.md`             | STD-101 a STD-108  | 8     |
| Security         | `standards/security.md`            | STD-201 a STD-209  | 9     |
| Documentation    | `standards/documentation.md`       | STD-301 a STD-307  | 7     |
| Git workflow     | `standards/git-workflow.md`        | STD-401 a STD-408  | 8     |

> Numeração por bloco (coding=001+, testing=101+, security=201+,
> docs=301+, git=401+) evita colisão entre categorias. Ver cada
> arquivo para o detalhe de cada STD-NNN.

---

## TD — Débitos técnicos

| ID       | Título                                                              | Prioridade | Status     |
| -------- | ------------------------------------------------------------------- | ---------- | ---------- |
| `TD-001` | Possível duplicação `chain/runtime.ts` vs `runtime/runtime.ts`      | Alta       | Pendente   |
| `TD-002` | Live trading é stub                                                 | Alta       | Pendente   |
| `TD-003` | SQLite em produção                                                  | Média-alta | Pendente   |
| `TD-004` | Sem CI/CD                                                           | Média      | Pendente   |
| `TD-005` | Sem monitoramento externo                                           | Média      | Pendente   |
| `TD-006` | Falta de testes E2E de UI                                           | Média      | Pendente   |
| `TD-007` | Documentação de API inline                                          | Baixa      | Pendente   |
| `TD-008` | Logs estruturados vs texto livre                                    | Baixa      | Pendente   |
| `TD-009` | Magic numbers em configuração                                       | Baixa      | Pendente   |
| `TD-010` | Sem retry com backoff exponencial emissor de notificações           | Baixa      | Pendente   |
| `TD-011` | Sem framework de teste (jest/vitest)                                | Deliberado | Aceito     |
| `TD-012` | Sem ORM abstraído (Prisma direto)                                   | Deliberado | Aceito     |

> Próximo TD usará `TD-013`. Detalhes em `memory/technical-debt.md`.

---

## KP — Problemas conhecidos

| ID       | Título                                                              | Status           |
| -------- | ------------------------------------------------------------------- | ---------------- |
| `KP-001` | Hash-chain com replacer-array dropava nested keys                   | ✅ Resolvido     |
| `KP-002` | Signer errors não prefixados causavam misclassificação              | ✅ Resolvido     |
| `KP-003` | `process.hostname` não existe em TypeScript                         | ✅ Resolvido     |
| `KP-004` | `SimulationResult` shape errado em mock M5.1                        | ✅ Resolvido     |
| `KP-005` | CanaryBroadcaster txHash com espaço                                 | ✅ Resolvido     |
| `KP-006` | Lease concurrent test esperava 10/10 success                        | ✅ Resolvido     |
| `KP-007` | `src/lib/chain/runtime.ts` vs `src/lib/runtime/runtime.ts`          | Em observação    |
| `KP-008` | Live trading é stub                                                 | Em observação    |
| `KP-009` | SQLite em produção                                                  | Em observação    |
| `KP-010` | API keys em variáveis de ambiente                                   | Em observação    |
| `KP-011` | Caddy proxy configuration                                           | Em observação    |

> Próximo KP usará `KP-012`. Detalhes em `memory/known-problems.md`.

---

## FI — Ideias futuras

### Ativas

| ID       | Título                                                              |
| -------- | ------------------------------------------------------------------- |
| `FI-001` | Vault/KMS para chave privada do signer                              |
| `FI-002` | WebSocket streaming para dashboard                                  |
| `FI-003` | Replay de rounds para debugging                                     |
| `FI-004` | Anomaly detection baseado em Registry                               |
| `FI-005` | Multi-sig para broadcaster                                          |
| `FI-006` | Hardware wallet integration                                         |
| `FI-007` | Backtesting com histórico on-chain                                  |
| `FI-008` | Dashboard de auditoria forense                                      |
| `FI-009` | Rate limiting por IP em API routes                                  |
| `FI-010` | TPS limiter no broadcaster                                          |
| `FI-011` | Snapshot do estado do runtime para recovery rápido                  |
| `FI-012` | Internacionalização (i18n) do dashboard                             |
| `FI-013` | Mobile-first dashboard                                              |

### Descartadas

| ID        | Título                                    | Motivo do descarte                  |
| --------- | ----------------------------------------- | ----------------------------------- |
| `FI-D001` | "Irrastreável" / mixer integration        | Viola INV-005 (audit exatamente 1×) |
| `FI-D002` | Trading com alavancagem (margin/leverage) | Fora do escopo do projeto           |
| `FI-D003` | Custodial wallet (app mantém custódia)    | Viola INV-006 (signer isolation)    |

> Próxima FI ativa usará `FI-014`. Próxima FI descartada usará
> `FI-D004`. Detalhes em `memory/future-ideas.md`.

---

## Regras de manutenção

1. **Adicionar nova entrada:** quando um novo ADR/DEC/INV/MOD/REG/
   STD/TD/KP/FI é criado, adicionar linha correspondente neste
   arquivo **antes** de fechar a tarefa.
2. **Nunca remover entrada:** mesmo após supercessão, a linha
   permanece com nota `Status: Supercedado por <novo-ID>`.
3. **Numeração sequencial:** cada bloco tem contador independente.
   Numeração por bloco (STD-001+ vs STD-101+) previne colisão.
4. **Verificação de colisão:** se uma nova entrada colidir com
   ID existente, parar e renomear antes de publicar.
5. **Atualização em batch:** ao final de cada milestone, rodar
   script de verificação (a criar em `scripts/verify-ids.py`).
6. **Estado deste arquivo:** ACTIVE — evolui, mas nunca encolhe.

---

## Relacionado

- `MANIFEST.md` — princípios do Project OS e tabela de prefixos.
- `INDEX.md` — índice completo de arquivos (com IDs por arquivo).
- `TRACEABILITY.md` — matriz INV → ADR → MOD → REG → teste.
- `tests.md` — catálogo de testes por milestone.
- `architecture/modules.md` — definição canônica de MOD-IDs.
- `architecture/invariants.md` — definição canônica de INV-IDs.
- `DECISION_LOG.md` — definição canônica de DEC-IDs.
- `decisions/ADR-*.md` — definição canônica de ADR-IDs.
- `memory/technical-debt.md` — definição canônica de TD-IDs.
- `memory/known-problems.md` — definição canônica de KP-IDs.
- `memory/future-ideas.md` — definição canônica de FI-IDs.
- `standards/*.md` — definição canônica de STD-IDs.
- `SECURITY.md` (raiz) — definição canônica de REG-IDs.
- `decisions/ADR-0003.md` — governança v2.2 (introduz este arquivo).
