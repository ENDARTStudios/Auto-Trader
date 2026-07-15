# TRACEABILITY.md — Matriz de Rastreabilidade

> **STATE: ACTIVE** — matriz evolui conforme novos INV/ADR/MOD/REG
> são adicionados. Toda adição de invariante, ADR ou REG exige
> atualização correspondente aqui. Ver `IDS.md` para o catálogo
> completo de IDs.

---

## Objetivo

Estabelecer **cadeia de auditoria completa** entre os cinco
elementos da rastreabilidade:

```
INV-NNN     →    ADR-NNNN     →    MOD-NNN     →    REG-NNN     →    script de teste
(invariante)    (decisão)          (módulo)         (regressão)       (validação)
```

Permite responder rapidamente perguntas críticas:

- **"Qual teste garante este invariante?"** → olhar coluna REG-NNN + script.
- **"Qual ADR motivou este módulo?"** → olhar coluna ADR-NNNN.
- **"Este REG ainda defende algo?"** → olhar coluna INV-NNN; se vazio, órfão.
- **"Há invariante sem defesa adversarial?"** → coluna REG-NNN vazia = TD-NNN.

Esta matriz é a **prova de que o sistema defende o que afirma
defender**. Invariante sem REG é declaração sem evidência.

---

## Matriz principal — INV → ADR → MOD → REG → teste

| INV-NNN   | Título do invariante                                   | ADR-NNNN          | MOD-NNN cobertos                                          | REG-NNN                                              | Script de teste                                   |
| --------- | ------------------------------------------------------ | ----------------- | --------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| `INV-001` | Pipeline sempre executa H0 → H1 → H2 → M3 → M4        | `ADR-0001`        | `MOD-H2.6` + sub-gates `MOD-H1.2`, `MOD-H2.1`–`MOD-H2.4`, `MOD-H1.3`, `MOD-H1.4` | `REG-009` (H0/H1/H2 freeze)                          | `scripts/test-h2-integration-gate.ts`             |
| `INV-002` | Broadcaster nunca altera payload assinado              | `ADR-0001`, `DEC-005` | `MOD-M3.3`, `MOD-M4.2`                                  | `REG-014` (post-signature immutability)              | `scripts/test-m3-broadcaster.ts`                  |
| `INV-003` | Arquivos FROZEN não podem ser modificados sem ADR     | `ADR-0002`, `ADR-0003` | (procedural — todos os MOD-*)                            | (procedural)                                         | (procedural — revisão de PR)                      |
| `INV-004` | Todo erro deve preservar o motivo original (`cause`)  | `DEC-005`         | `MOD-M3.3`, `MOD-M4.2`                                    | `REG-005` (commit discipline — via revisão)          | `scripts/test-m3-broadcaster.ts`                  |
| `INV-005` | Audit é exatamente uma vez                             | `ADR-0001`, `DEC-001` | `MOD-H0`                                                 | `REG-001` (enteredHandler sentinel)                  | `scripts/test-h0-audit-hashchain.ts`              |
| `INV-006` | Signer nunca expõe chave privada                       | `ADR-0001`, `DEC-002` | `MOD-M3.1`, `MOD-M3.2`                                  | `REG-010` (protocol version), `REG-011` (payload integrity), `REG-012` (key-derived address) | `scripts/test-m3-signer-handlers.ts`, `scripts/test-signer-process.ts` |
| `INV-007` | WriterLease fencing token é monotônico crescente      | `ADR-0001`, `DEC-003` | `MOD-M4.1`, `MOD-M4.2`                                  | `REG-013` (lease hard precondition), `REG-015` (fence monotônico), `REG-016` (exclusivo), `REG-017` (renew), `REG-018` (reconnect) | `scripts/test-m4-writer-lease.ts` |
| `INV-008` | Canary bucketing é determinístico por txHash          | `ADR-0001`, `DEC-004` | `MOD-M5.3`                                              | (a adicionar — TD-013 proposto)                      | `scripts/test-m5-shadow.ts`                       |
| `INV-009` | Shadow compartilha a MESMA Pipeline                   | `ADR-0001`, `DEC-004` | `MOD-M5.2`                                              | (a adicionar — TD-014 proposto)                      | `scripts/test-m5-shadow.ts`                       |
| `INV-010` | Observability Registry é singleton injetado           | `DEC-004`         | `MOD-M5.5-R` + consumers `MOD-M5.2`/`M5.3`/`M5.4`/`M5.6` | (a adicionar — TD-015 proposto)                      | `scripts/test-m5-dry-run.ts`                      |

> **Lacunas identificadas** (coluna REG-NNN marcada "a adicionar")
> são pendências técnicas — registrar como TD-NNN em
> `memory/technical-debt.md`. Ver seção "Pendências" abaixo.

---

## Diagrama da cadeia de rastreabilidade

```
┌──────────────────────────────────────────────────────────────────┐
│                          INV-001                                  │
│  Pipeline sempre executa H0 → H1 → H2 → M3 → M4                  │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                          ADR-0001                                 │
│  Defense-in-Depth Architecture with Process-Isolated Signer      │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                          MOD-H2.6                                 │
│  Pipeline (src/lib/chain/pipeline.ts)                            │
│  + MOD-H1.2 (Sim Gate) + MOD-H2.1 (Contract Verify)              │
│  + MOD-H2.2 (Liquidity) + MOD-H2.3 (TokenAuth)                   │
│  + MOD-H2.4 (SellSim) + MOD-H1.3 (Approval)                      │
│  + MOD-H1.4 (MEV)                                                │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                          REG-009                                  │
│  H0/H1/H2/H2.6 freeze — M3 changes are regression-only           │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  scripts/test-h2-integration-gate.ts (123 asserts)               │
│  scripts/test-h2-adversarial.ts (46 asserts)                     │
└──────────────────────────────────────────────────────────────────┘
```

> Cada invariante tem cadeia análoga. O diagrama completo é a
> composição das 10 cadeias (uma por INV-NNN). Esta matriz é a
> prova de auditoria do Project OS.

---

## Tabela inversa — REG → INV (qual invariante cada REG defende)

| REG-NNN   | Título do REG                                            | INV-NNN defendido    |
| --------- | -------------------------------------------------------- | -------------------- |
| `REG-001` | `enteredHandler` sentinel                                | `INV-005`            |
| `REG-002` | per-IP rate limiter fallback                             | (operacional)        |
| `REG-003` | test suite self-cleanup                                  | (operacional)        |
| `REG-004` | pre-push git hook runs test:ci                           | (operacional)        |
| `REG-005` | commit discipline                                        | `INV-004` (implícito)|
| `REG-006` | schema reconstruction validated against CRUD             | (DB integrity)       |
| `REG-007` | dispatcher LAYER 2 — exceptions propagate                | (operacional)        |
| `REG-008` | dev SQLite DB not tracked in git                         | (operacional)        |
| `REG-009` | H0/H1/H2/H2.6 freeze — M3 changes are regression-only    | `INV-001`, `INV-003` |
| `REG-010` | Two-point protocol version validation                    | `INV-006`            |
| `REG-011` | Signer-side payload integrity re-verification            | `INV-006`            |
| `REG-012` | Wallet-by-address lookup must verify key-derived address | `INV-006`            |
| `REG-013` | Writer lease is a hard precondition (M4 SEAM)            | `INV-007`            |
| `REG-014` | Post-signature immutability (M3.3)                       | `INV-002`            |
| `REG-015` | Fencing token monotônico                                 | `INV-007`            |
| `REG-016` | Lease acquire exclusivo                                  | `INV-007`            |
| `REG-017` | Lease renew após timeout                                 | `INV-007`            |
| `REG-018` | Reconnect não reanima lease stale                        | `INV-007`            |

> REGs marcados "(operacional)" defendem processo, não invariantes
> arquiteturais. São úteis mas não compõem a cadeia de auditoria
> de segurança — apenas REGs com INV-NNN defendido compõem.

---

## Cobertura por módulo

| MOD-NNN    | Módulo                | INV cobertos                              | REG cobrindo | Teste principal                            |
| ---------- | --------------------- | ----------------------------------------- | ------------ | ------------------------------------------ |
| `MOD-H0`   | Audit hash-chain      | `INV-005`                                 | `REG-001`    | `test-h0-audit-hashchain.ts`               |
| `MOD-H1.1` | RPC resilience        | `INV-001` (componente)                    | (indireto)   | `test-h1-rpc-resilience.ts`                |
| `MOD-H1.2` | Simulation gate       | `INV-001` (componente)                    | `REG-009`    | `test-h1-simulation-gate.ts`               |
| `MOD-H1.3` | Approval hardening    | `INV-001` (componente)                    | `REG-009`    | `test-h1-approval-hardening.ts`            |
| `MOD-H1.4` | MEV baseline          | `INV-001` (componente)                    | `REG-009`    | `test-h1-mev-baseline.ts`                  |
| `MOD-H2.1` | Contract verification | `INV-001` (componente)                    | `REG-009`    | `test-h2-contract-verification.ts`         |
| `MOD-H2.2` | Liquidity verification| `INV-001` (componente)                    | `REG-009`    | `test-h2-liquidity-verification.ts`        |
| `MOD-H2.3` | Token authority       | `INV-001` (componente)                    | `REG-009`    | `test-h2-token-authority.ts`               |
| `MOD-H2.4` | Sell simulation       | `INV-001` (componente)                    | `REG-009`    | `test-h2-sell-simulation.ts`               |
| `MOD-H2.6` | Pipeline              | `INV-001`                                 | `REG-009`    | `test-h2-integration-gate.ts`              |
| `MOD-M3.1` | SignerAdapter         | `INV-006`                                 | `REG-010`    | `test-m3-signer-adapter.ts`                |
| `MOD-M3.2` | Signer RPC            | `INV-006`                                 | `REG-010`, `REG-011`, `REG-012` | `test-m3-signer-handlers.ts`, `test-signer-process.ts` |
| `MOD-M3.3` | Broadcaster           | `INV-002`, `INV-004`                      | `REG-014`    | `test-m3-broadcaster.ts`                   |
| `MOD-M4.1` | WriterLease           | `INV-007`                                 | `REG-013`, `REG-015`–`REG-018` | `test-m4-writer-lease.ts`                  |
| `MOD-M4.2` | LeasedBroadcaster     | `INV-002`, `INV-007`                      | `REG-013`, `REG-014` | `test-m4-writer-lease.ts`, `test-m3-broadcaster.ts` |
| `MOD-M5.0` | Runtime factory       | `INV-010` (cria Registry)                 | (a adicionar) | `test-m5-dry-run.ts`                      |
| `MOD-M5.1` | Runtime principal     | (orquestração)                            | (indireto)   | `test-m5-dry-run.ts`                       |
| `MOD-M5.2` | Shadow harness        | `INV-009`                                 | (a adicionar) | `test-m5-shadow.ts`                       |
| `MOD-M5.3` | Canary harness        | `INV-008`                                 | (a adicionar) | `test-m5-shadow.ts`                       |
| `MOD-M5.4` | Chaos harness         | (validação de resiliência)                | (indireto)   | `test-m5-chaos.ts`                         |
| `MOD-M5.5-R` | Registry            | `INV-010`                                 | (a adicionar) | `test-m5-dry-run.ts`                      |
| `MOD-M5.6` | Long-Duration         | (validação de leak)                       | (indireto)   | `test-m5-long-duration.ts`                 |

---

## Pendências (lacunas de rastreabilidade)

As seguintes lacunas foram identificadas pela análise desta matriz.
Cada uma deve ser registrada como TD-NNN em `memory/technical-debt.md`:

| Lacuna                                                            | INV afetado | Ação recomendada                                |
| ----------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| `INV-008` (canary determinístico) sem REG-NNN adversarial         | `INV-008`   | Criar `REG-019` em SECURITY.md                  |
| `INV-009` (shadow compartilha Pipeline) sem REG-NNN adversarial   | `INV-009`   | Criar `REG-020` em SECURITY.md                  |
| `INV-010` (Registry singleton) sem REG-NNN adversarial            | `INV-010`   | Criar `REG-021` em SECURITY.md                  |
| `MOD-H1.1` (RPC resilience) sem REG-NNN direto                    | `INV-001`   | Criar `REG-022` (RPC quorum under partition)    |
| `MOD-M5.4` (Chaos) sem REG-NNN que valide resiliência             | (resiliência) | Criar `REG-023` (chaos injection survives)    |

> **Princípio:** invariante sem defesa adversarial é declaração
> sem evidência. A lacuna deve ser fechada antes do M6 (live
> trading) — ver `architecture/roadmap.md`.

---

## Como usar esta matriz

### Cenário 1: "Estou mudando o Broadcaster, o que pode quebrar?"

1. Olhar coluna "MOD-NNN cobertos" para `MOD-M3.3`.
2. Ver que INV-002 e INV-004 dependem deste módulo.
3. Ver que REG-014 é o teste adversarial correspondente.
4. Rodar `scripts/test-m3-broadcaster.ts` antes e depois da mudança.
5. Se a mudança quebra INV-002, abrir ADR antes de prosseguir.

### Cenário 2: "Estou criando um novo invariante, o que preciso?"

1. Adicionar entrada em `architecture/invariants.md` como `INV-NNN`.
2. Adicionar entrada em `IDS.md` (tabela INV).
3. Adicionar linha nesta matriz (TRACEABILITY.md) com REG-NNN
   planejado (mesmo que ainda não exista — marque como "a adicionar").
4. Criar ADR em `decisions/ADR-NNNN.md` justificando o novo INV.
5. Criar entrada em `DECISION_LOG.md` (DEC-NNN) com resumo.
6. Criar teste adversarial em `SECURITY.md` (REG-NNN).
7. Criar script de teste em `scripts/test-*.ts`.
8. Atualizar `tests.md` com o novo script.

### Cenário 3: "Um teste está falhando, qual invariante está quebrado?"

1. Identificar o script que falhou (ex.: `test-m4-writer-lease.ts`).
2. Olhar coluna "Script de teste" nesta matriz.
3. Ver que INV-007 é o invariante defendido.
4. Ler `architecture/invariants.md` INV-007 para entender o contrato.
5. Investigar falha como possível violação de INV-007 (não como
   bug isolado) — se confirmado, criar KP-NNN + DEC-NNN.

---

## Regras de manutenção

1. **Toda adição de INV** exige atualização desta matriz + IDS.md.
2. **Toda adição de REG** exige atualização desta matriz + IDS.md.
3. **Toda adição de MOD** exige atualização desta matriz + IDS.md +
   `architecture/modules.md`.
4. **Toda adição de ADR** exige atualização desta matriz + IDS.md +
   `DECISION_LOG.md`.
5. **Toda adição de script de teste** exige atualização desta matriz
   + `tests.md`.
6. **Lacunas identificadas** devem ser registradas como TD-NNN.
7. **Numeração:** IDs são permanentes; nunca reusar.

---

## Relacionado

- `IDS.md` — catálogo consolidado de todos os IDs.
- `tests.md` — catálogo de testes por milestone.
- `architecture/invariants.md` — definição dos INV-NNN.
- `architecture/modules.md` — definição dos MOD-NNN.
- `architecture/dependencies.md` — árvore canônica de módulos.
- `DECISION_LOG.md` — definição dos DEC-NNN.
- `decisions/ADR-0001.md` — ADR fundacional (H0→M5).
- `decisions/ADR-0002.md` — ADR da governança v2.1.
- `decisions/ADR-0003.md` — ADR da governança v2.2 (introduz esta matriz).
- `SECURITY.md` (raiz) — definição dos REG-NNN.
- `memory/technical-debt.md` — lacunas de rastreabilidade viram TD-NNN.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.
