# MANIFEST.md — Manifesto do Project OS

> **STATE: FROZEN** — Declaração de princípios do Project OS.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> **Versão atual:** Project OS v2.1 (ver `PROJECT_STATE.md` >
> `Project OS` para a versão vigente; ver `decisions/ADR-0002.md`
> para o histórico de mudanças estruturais).

---

## Objetivo

Este diretório (`.ai/`) contém **toda a memória permanente** do
projeto GLM 5.1 Crypto Trading. É parte integrante do código-fonte:
deve ser consultada antes de qualquer implementação e mantida
sincronizada com o estado real do projeto.

---

## Princípios fundamentais

1. **Fonte única de verdade.** Nenhum documento deve duplicar
   responsabilidade. Cada tipo de conhecimento deve existir em
   **um único local**. Demais documentos apenas **referenciam**
   essa fonte.

2. **Append-only.** Histórico nunca é apagado. Entradas
   supercedidas são marcadas com nota explicativa + data, mas
   permanecem no arquivo para auditoria.

3. **Cross-links obrigatórios.** Todo documento deve apontar para
   documentos relacionados via IDs canônicos (INV-NNN, ADR-NNNN,
   DEC-NNN, TD-NNN, KP-NNN, STD-NNN, REG-NNN). Isto reduz
   inconsistências e permite navegação por referência.

4. **IDs canônicos.** Todo documento estruturado recebe um ID
   permanente na sua categoria. Uma vez emitido, o ID não é
   reusado mesmo após o documento ser supercedido.

5. **Snapshot vs histórico.** `PROJECT_STATE.md` é **apenas**
   snapshot do estado corrente. Linha do tempo vai para
   `memory/implementation-history.md`. Decisões vão para
   `DECISION_LOG.md` + `decisions/ADR-*.md`.

6. **Precedência declarada.** Em caso de conflito, a precedência
   é (em ordem decrescente):
   `CORE_RULES > PROJECT_STATE > decisions/ADR-* > DECISION_LOG >
   architecture/invariants > architecture/frozen-files > SECURITY.md
   > HARDENING-ROADMAP.md > worklog.md`.

7. **Versionamento do próprio Project OS.** Toda mudança
   estrutural neste diretório bumpa a versão (v2.1, v2.2, ...) e
   produz:
   - Novo ADR em `decisions/ADR-NNNN.md`.
   - Nova entrada em `DECISION_LOG.md`.
   - Nova entrada em `memory/implementation-history.md`.

---

## Categorias de documento e prefixos de ID

| Prefixo  | Categoria                                  | Onde fica                             |
| -------- | ------------------------------------------ | ------------------------------------- |
| (sem ID) | Manifesto, índices, regras absolutas       | raiz de `.ai/`                        |
| `INV-`   | Invariantes arquiteturais                  | `architecture/invariants.md`          |
| `ADR-`   | Architecture Decision Records (4 dígitos)  | `decisions/ADR-NNNN.md`               |
| `DEC-`   | Decisões (resumos curtos no log)           | `DECISION_LOG.md`                     |
| `TD-`    | Débitos técnicos                           | `memory/technical-debt.md`            |
| `KP-`    | Problemas conhecidos                       | `memory/known-problems.md`            |
| `STD-`   | Padrões de engenharia                      | `standards/*.md`                      |
| `REG-`   | Regressões de segurança (testes adversariais) | `SECURITY.md` (raiz do projeto)    |
| `FI-`    | Ideias futuras                             | `memory/future-ideas.md`              |

IDs são **permanentes**: uma vez emitidos, não são reusados nem
renomeados. Um documento supercedido mantém seu ID original com
nota `Status: Supercedado por <novo-ID>`.

---

## Divisão de responsabilidade (evita duplicação)

| Tipo de informação              | Fonte canônica                              |
| ------------------------------- | -------------------------------------------- |
| Regras absolutas de processo    | `CORE_RULES.md`                              |
| Fluxo de engenharia             | `ENGINEERING_RULES.md`                       |
| Snapshot do estado atual        | `PROJECT_STATE.md`                           |
| Linha do tempo cronológica      | `memory/implementation-history.md`           |
| Decisões (resumo)               | `DECISION_LOG.md`                            |
| Decisões (detalhe)              | `decisions/ADR-NNNN.md`                      |
| Roadmap canônico                | `architecture/roadmap.md`                    |
| Invariantes do sistema          | `architecture/invariants.md`                 |
| Contratos públicos (assinaturas)| `architecture/interfaces.md`                 |
| Contratos de integração         | `contracts/{api,database,rpc,events}.md`     |
| Padrões de engenharia           | `standards/{coding-style,testing,security,documentation,git-workflow}.md` |
| Lista de arquivos FROZEN        | `architecture/frozen-files.md`               |
| Módulos e responsabilidades     | `architecture/modules.md`                    |
| Dependências e blast radius     | `architecture/dependencies.md`               |
| Fluxo runtime / eventos         | `architecture/runtime.md`                    |
| Nomes oficiais (interno)        | `context/terminology.md`                     |
| Dicionário técnico (externo)    | `context/glossary.md`                        |
| Convenções de nomenclatura      | `context/conventions.md`                     |
| Sumário executivo do projeto    | `context/project-summary.md`                 |
| Problemas conhecidos            | `memory/known-problems.md`                   |
| Débitos técnicos                | `memory/technical-debt.md`                   |
| Ideias futuras                  | `memory/future-ideas.md`                     |

---

## O que NÃO deve existir neste diretório

- Cópia de código-fonte (apenas referências a caminhos).
- Transcrição de logs (use `worklog.md` na raiz do projeto).
- Documentação de API externa (use `docs/` ou links externos).
- Rascunhos temporários (use `/home/z/my-project/scripts/` ou
  `/tmp/`).
- Múltiplas versões do mesmo documento (use versionamento Git +
  ADR para mudanças estruturais).
- Documentos sem dono (todo arquivo deve referenciar sua categoria
  no topo).

---

## Manutenção

- Toda mudança estrutural neste diretório DEVE:
  1. Bumpar a versão em `PROJECT_STATE.md > Project OS`.
  2. Criar novo ADR em `decisions/ADR-NNNN.md`.
  3. Adicionar entrada em `DECISION_LOG.md`.
  4. Adicionar entrada em `memory/implementation-history.md`.
  5. Atualizar `INDEX.md` e `README.md` para refletir novos
     arquivos.
- Mudanças de conteúdo (sem mudança estrutural) apenas atualizam
  o arquivo afetado e, se relevante, `memory/implementation-history.md`.
- Qualquer renomeação de arquivo é mudança estrutural — requer
  ADR.

---

## Referências

- `README.md` — índice mínimo (ponto de entrada humano).
- `INDEX.md` — índice completo com IDs e links.
- `CHECKLIST.md` — checklist obrigatório pré-implementação.
- `PROJECT_STATE.md` — snapshot corrente (inclui versão do
  Project OS).
- `decisions/ADR-0002.md` — documentação da transição v2 → v2.1.
