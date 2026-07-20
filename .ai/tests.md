# tests.md — Catálogo de Testes

> **STATE: ACTIVE** — catálogo evolui conforme novos testes são
> escritos. Toda adição de script `scripts/test-*.ts` exige
> atualização deste catálogo. Ver `TRACEABILITY.md` para a matriz
> INV → ADR → MOD → REG → teste.

---

## Objetivo

Indexar todos os scripts de teste do projeto em um único lugar,
organizados por milestone. Para cada teste:

- **Script** — caminho absoluto.
- **Asserts** — contagem aproximada (assert/expect/throw/equal/deep).
- **Linhas** — tamanho do arquivo (proxy de complexidade).
- **Cobertura** — quais MOD-IDs e INV-NNN o teste exercita.
- **REG-NNN** — regressões de segurança que o teste valida.
- **Responsável** — milestone em que foi escrito (owner histórico).

> **Princípio:** teste sem entrada neste catálogo é teste órfão —
> ninguém sabe quando quebrar, qual invariante está em risco.

---

## Convenção de nomenclatura

```
scripts/test-<milestone>-<topic>.ts
```

- `<milestone>`: `h0`, `h1`, `h2`, `m3`, `m4`, `m5`, `signer`, `vault`, etc.
- `<topic>`: breve descrição do que é testado.

Exemplos: `test-h0-audit-hashchain.ts`, `test-m5-shadow.ts`,
`test-signer-process.ts`.

> Para adicionar novo teste: criar script em `scripts/`, rodar,
> adicionar entrada neste catálogo, atualizar `TRACEABILITY.md`
> se o teste cobre novo invariante.

---

## H0 — Audit & Crypto Fundacional

| Script                                       | Asserts | Linhas | Cobertura (MOD / INV / REG)                    | Responsável |
| -------------------------------------------- | ------- | ------ | ---------------------------------------------- | ----------- |
| `scripts/test-h0-audit-hashchain.ts`         | 21      | 270    | `MOD-H0` / `INV-005` / `REG-001`               | H0.3        |
| `scripts/test-h0-kdf-versioning.ts`          | 14      | 224    | `MOD-H0` (KDF versioning) / — / —              | H0          |
| `scripts/test-h0-key-rotation.ts`            | 21      | 278    | `MOD-H0` (key rotation) / — / —                | H0          |

**Total H0:** 3 scripts, 56 asserts, 772 linhas.

---

## H1 — RPC Resilience, Simulation, Approval, MEV

| Script                                       | Asserts | Linhas | Cobertura (MOD / INV / REG)                    | Responsável |
| -------------------------------------------- | ------- | ------ | ---------------------------------------------- | ----------- |
| `scripts/test-h1-rpc-resilience.ts`          | 56      | 395    | `MOD-H1.1` / `INV-001` (componente) / —        | H1.1        |
| `scripts/test-h1-simulation-gate.ts`         | 76      | 527    | `MOD-H1.2` / `INV-001` (componente) / `REG-009`| H1.2        |
| `scripts/test-h1-approval-hardening.ts`      | 39      | 341    | `MOD-H1.3` / `INV-001` (componente) / `REG-009`| H1.3        |
| `scripts/test-h1-mev-baseline.ts`            | 50      | 338    | `MOD-H1.4` / `INV-001` (componente) / `REG-009`| H1.4        |

**Total H1:** 4 scripts, 221 asserts, 1.601 linhas.

---

## H2 — Contract / Liquidity / Token Authority / Sell Sim / Integration

| Script                                          | Asserts | Linhas | Cobertura (MOD / INV / REG)                      | Responsável |
| ----------------------------------------------- | ------- | ------ | ------------------------------------------------ | ----------- |
| `scripts/test-h2-contract-verification.ts`      | 122     | 815    | `MOD-H2.1` / `INV-001` (componente) / `REG-009` | H2.1        |
| `scripts/test-h2-liquidity-verification.ts`     | 47      | 659    | `MOD-H2.2` / `INV-001` (componente) / `REG-009` | H2.2        |
| `scripts/test-h2-token-authority.ts`            | 43      | 687    | `MOD-H2.3` / `INV-001` (componente) / `REG-009` | H2.3        |
| `scripts/test-h2-sell-simulation.ts`            | 70      | 560    | `MOD-H2.4` / `INV-001` (componente) / `REG-009` | H2.4        |
| `scripts/test-h2-integration-gate.ts`           | 123     | 1.143  | `MOD-H2.6` (Pipeline) / `INV-001` / `REG-009`   | H2.6        |
| `scripts/test-h2-adversarial.ts`                | 46      | 568    | `MOD-H2.1`–`MOD-H2.4` / `INV-001` / `REG-009`   | H2.6        |

**Total H2:** 6 scripts, 451 asserts, 4.432 linhas.

---

## M3 — SignerAdapter, Signer RPC, Broadcaster

| Script                                          | Asserts | Linhas | Cobertura (MOD / INV / REG)                                | Responsável |
| ----------------------------------------------- | ------- | ------ | ---------------------------------------------------------- | ----------- |
| `scripts/test-m3-signer-adapter.ts`             | 108     | 831    | `MOD-M3.1` / `INV-006` / `REG-010`                         | M3.1        |
| `scripts/test-m3-signer-handlers.ts`            | 91      | 794    | `MOD-M3.2` / `INV-006` / `REG-010`, `REG-011`, `REG-012`   | M3.2        |
| `scripts/test-m3-broadcaster.ts`                | 67      | 987    | `MOD-M3.3` / `INV-002`, `INV-004` / `REG-014`              | M3.3        |
| `scripts/test-signer-process.ts`                | 40      | 382    | `MOD-M3.2` (processo isolado) / `INV-006` / `REG-010`      | M3.2        |
| `scripts/test-signer-dispatcher-structural.ts`  | 41      | 463    | `MOD-M3.2` (dispatcher) / `INV-006` / —                    | M3.2        |
| `scripts/test-signer-vault-integration.ts`      | 47      | 514    | `MOD-M3.2` (vault) / — / —                                 | M6 prep     |

**Total M3:** 6 scripts, 394 asserts, 3.971 linhas.

---

## M4 — Writer Lease + LeasedBroadcaster

| Script                                       | Asserts | Linhas | Cobertura (MOD / INV / REG)                                              | Responsável |
| -------------------------------------------- | ------- | ------ | ------------------------------------------------------------------------ | ----------- |
| `scripts/test-m4-writer-lease.ts`            | 110     | 973    | `MOD-M4.1`, `MOD-M4.2` / `INV-007` / `REG-013`, `REG-015`, `REG-016`, `REG-017`, `REG-018` | M4 |

**Total M4:** 1 script, 110 asserts, 973 linhas.

---

## M5 — Runtime Harnesses (Dry-Run, Shadow, Canary, Chaos, Long-Duration)

| Script                                       | Asserts | Linhas | Cobertura (MOD / INV / REG)                                | Responsável |
| -------------------------------------------- | ------- | ------ | ---------------------------------------------------------- | ----------- |
| `scripts/test-m5-dry-run.ts`                 | 45      | 799    | `MOD-M5.0`, `MOD-M5.1`, `MOD-M5.5-R` / `INV-010` / —       | M5.1        |
| `scripts/test-m5-shadow.ts`                  | 41      | 810    | `MOD-M5.2`, `MOD-M5.3` / `INV-008`, `INV-009` / —          | M5.2, M5.3  |
| `scripts/test-m5-chaos.ts`                   | 135     | 1.419  | `MOD-M5.4` / (resiliência) / —                             | M5.4        |
| `scripts/test-m5-long-duration.ts`           | 34      | 982    | `MOD-M5.6` / (leak detection) / —                          | M5.6        |

**Total M5:** 4 scripts, 255 asserts, 4.010 linhas.

---

## Resumo consolidado

| Milestone | Scripts | Asserts | Linhas | Cobertura INV-NNN                          |
| --------- | ------- | ------- | ------ | ------------------------------------------ |
| H0        | 3       | 56      | 772    | `INV-005`                                  |
| H1        | 4       | 221     | 1.601  | `INV-001` (componentes)                    |
| H2        | 6       | 451     | 4.432  | `INV-001`                                  |
| M3        | 6       | 394     | 3.971  | `INV-002`, `INV-004`, `INV-006`            |
| M4        | 1       | 110     | 973    | `INV-007`                                  |
| M5        | 4       | 255     | 4.010  | `INV-008`, `INV-009`, `INV-010`            |
| **Total** | **24**  | **1.487** | **15.759** | 8 de 10 INV têm teste direto            |

> **2 INV sem teste direto:** `INV-003` (procedural — revisão de PR),
> `INV-004` (cobertura indireta via REG-005). Não são lacunas
> críticas — `INV-003` é processo, `INV-004` é coberto por padrão
> de código. Ver `TRACEABILITY.md > Pendências` para as lacunas
> reais (INV-008/009/010 sem REG-NNN adversarial).

---

## Cobertura por invariante (resumo)

| INV-NNN   | Título                                          | Teste principal                                  | Status        |
| --------- | ----------------------------------------------- | ------------------------------------------------ | ------------- |
| `INV-001` | Pipeline order H0→H1→H2→M3→M4                  | `test-h2-integration-gate.ts`                    | ✅ Coberto    |
| `INV-002` | Broadcaster nunca altera payload assinado       | `test-m3-broadcaster.ts`                         | ✅ Coberto    |
| `INV-003` | FROZEN não pode mudar sem ADR                   | (procedural — revisão de PR)                     | ✅ Processual |
| `INV-004` | Preservar `cause` original                      | `test-m3-broadcaster.ts` (indireto)              | ⚠️ Indireto   |
| `INV-005` | Audit exatamente uma vez                        | `test-h0-audit-hashchain.ts`                     | ✅ Coberto    |
| `INV-006` | Signer nunca expõe chave                        | `test-m3-signer-handlers.ts` + `test-signer-process.ts` | ✅ Coberto |
| `INV-007` | Fencing token monotônico                        | `test-m4-writer-lease.ts`                        | ✅ Coberto    |
| `INV-008` | Canary determinístico                           | `test-m5-shadow.ts`                              | ⚠️ Sem REG-NNN |
| `INV-009` | Shadow compartilha Pipeline                     | `test-m5-shadow.ts`                              | ⚠️ Sem REG-NNN |
| `INV-010` | Registry singleton                              | `test-m5-dry-run.ts`                             | ⚠️ Sem REG-NNN |

> ⚠️ marcados precisam de REG-NNN adversarial — registrar como
> TD-NNN em `memory/technical-debt.md`. Ver `TRACEABILITY.md >
> Pendências`.

---

## Como rodar os testes

### Teste individual

```bash
npx tsx scripts/test-h0-audit-hashchain.ts
```

### Todos os testes de um milestone

```bash
for f in scripts/test-h1-*.ts; do
  echo "=== $f ==="
  npx tsx "$f" || echo "FAILED: $f"
done
```

### Suite completa (regressão)

```bash
npm run test:ci
```

> `test:ci` é definido em `package.json` e roda todos os
> `scripts/test-*.ts` em sequência. Pre-push git hook
> (`scripts/git-hooks/pre-push`) roda `test:ci` antes de qualquer
> push (REG-004).

### Teste de longa duração (24h, 72h, 7d)

```bash
npx tsx scripts/test-m5-long-duration.ts --duration=24h
npx tsx scripts/test-m5-long-duration.ts --duration=72h
npx tsx scripts/test-m5-long-duration.ts --duration=7d
```

> Não rodar em CI — duração incompatível. Usar em máquina
> dedicada com observability ativa (Registry exportado em
> `/api/runtime/status`).

---

## Padrões de escrita de teste (ver `standards/testing.md`)

- **STD-101** — Estrutura: scripts em `scripts/test-*.ts`, unidade
  em `*.test.ts` ao lado do módulo.
- **STD-102** — Princípio adversarial: todo primitivo crypto/
  segurança deve ter teste que tenta quebrar a propriedade.
- **STD-103** — Sem mock para adversariais: usar implementação real
  ou fork de rede.
- **STD-104** — Nomes: `test-<milestone>-<topic>.ts`.
- **STD-105** — Isolamento: cada script é auto-contido (setup +
  teardown).
- **STD-106** — Saída: print final `PASS` ou `FAIL` com contagem.
- **STD-107** — Cleanup: `hardCleanupBeforeSuite` entre suites.
- **STD-108** — Cobertura: Registrar MOD-ID e INV-NNN cobertos no
  header do script.

---

## Pendências de teste

| Pendência                                                       | Ação                                            | TD-NNN      |
| --------------------------------------------------------------- | ----------------------------------------------- | ----------- |
| Criar `REG-019` para `INV-008` (canary determinístico)         | Escrever adversarial em SECURITY.md + script    | (a criar)   |
| Criar `REG-020` para `INV-009` (shadow compartilha Pipeline)   | Escrever adversarial em SECURITY.md + script    | (a criar)   |
| Criar `REG-021` para `INV-010` (Registry singleton)            | Escrever adversarial em SECURITY.md + script    | (a criar)   |
| Criar `REG-022` para `MOD-H1.1` (RPC under partition)          | Escrever adversarial em SECURITY.md + script    | (a criar)   |
| Criar `REG-023` para `MOD-M5.4` (chaos injection survives)     | Escrever adversarial em SECURITY.md + script    | (a criar)   |
| Adicionar teste E2E de UI                                       | `TD-006` em `memory/technical-debt.md`          | `TD-006`    |
| Adicionar teste de Vault/KMS integration (pré-M6)              | Estender `test-signer-vault-integration.ts`     | `TD-002`    |

---

## Regras de manutenção

1. **Todo novo teste** deve ser adicionado a este catálogo antes
   do PR ser mergeado.
2. **Todo teste removido** (raro) deve ter entrada marcada como
   "Removido em YYYY-MM-DD por <motivo>" — append-only.
3. **Contagem de asserts** é aproximada (grep); atualizar quando
   o script crescer significativamente.
4. **Cobertura** deve referenciar MOD-ID e INV-NNN; se o teste
   não cobre nenhum invariante, marcar como "—".
5. **REG-NNN** deve ser preenchido quando o teste é adversarial
   (defende INV-NNN).

---

## Relacionado

- `IDS.md` — catálogo consolidado de IDs (inclui REG-NNN).
- `TRACEABILITY.md` — matriz INV → ADR → MOD → REG → script.
- `standards/testing.md` STD-101 a STD-108 — padrões de escrita.
- `architecture/modules.md` — definição dos MOD-IDs cobertos.
- `architecture/invariants.md` — definição dos INV-NNN defendidos.
- `SECURITY.md` (raiz) — definição dos REG-NNN.
- `memory/technical-debt.md` — pendências viram TD-NNN.
- `decisions/ADR-0003.md` — governança v2.2 (introduz este catálogo).
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.
