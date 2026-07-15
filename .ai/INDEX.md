# `.ai/` — Índice Geral

> Ponto de entrada único para toda a memória operacional do projeto.
> Use este índice para navegação humana e leitura automática pelo
> modelo. A ordem abaixo reflete a **precedência semântica** (não a
> ordem alfabética): manifesto e regras primeiro, depois estado
> atual, depois arquitetura, depois contratos, depois padrões,
> depois contexto, depois memória, depois decisões.
>
> **Versão vigente:** Project OS v2.1 (ver `PROJECT_STATE.md`).

---

## Regra de IDs canônicos

Todo documento estruturado recebe um ID permanente. Uma vez
emitido, o ID **não é reusado** nem renomeado. Documentos
supercedidos mantêm o ID original com nota
`Status: Supercedado por <novo-ID>`.

| Prefixo  | Categoria                                     | Arquivo                                            |
| -------- | --------------------------------------------- | -------------------------------------------------- |
| `INV-`   | Invariantes arquiteturais                     | `architecture/invariants.md`                       |
| `ADR-`   | Architecture Decision Records (4 dígitos)     | `decisions/ADR-NNNN.md`                            |
| `DEC-`   | Decisões (resumos curtos)                     | `DECISION_LOG.md`                                  |
| `TD-`    | Débitos técnicos                              | `memory/technical-debt.md`                         |
| `KP-`    | Problemas conhecidos                          | `memory/known-problems.md`                         |
| `STD-`   | Padrões de engenharia                         | `standards/*.md`                                   |
| `REG-`   | Regressões de segurança (testes adversariais) | `SECURITY.md` (raiz do projeto)                    |
| `FI-`    | Ideias futuras                                | `memory/future-ideas.md`                           |

---

## Regra de cross-links

Todo documento DEVE apontar para documentos relacionados via IDs
canônicos. Exemplo em um ADR:

```
## Relacionado

- INV-003 — Arquivos FROZEN não podem ser modificados sem ADR
- ROADMAP M6 — Live Trading com canaryPct ramp
- DEC-014 — Decisão que motivou este ADR
- TD-007 — Débito técnico relacionado
- REG-015 — Teste adversarial que valida este contrato
```

Todo novo documento deve:

1. Referenciar IDs relacionados na seção `## Relacionado` (no fim).
2. Ser referenciado nos documentos relacionados (ex.: novo INV é
   citado em `interfaces.md`, `invariants.md`, e nos ADRs que
   justificam sua existência).

---

## MANIFEST & NAVIGATION — Ponto de entrada

| Arquivo            | ID         | Função                                                       |
| ------------------ | ---------- | ------------------------------------------------------------ |
| `MANIFEST.md`      | (manifesto)| Princípios do Project OS + tabela de IDs canônicos.          |
| `README.md`        | (índice)   | Índice mínimo humano (responde "onde cada informação fica"). |
| `INDEX.md`         | (este)     | Índice completo com IDs, descrições e regra de cross-link.   |
| `CHECKLIST.md`     | (checklist)| Checklist obrigatório pré-implementação (7 fases).           |

---

## CORE — Regras absolutas (precedência máxima)

| Arquivo                | ID         | Função                                                       |
| ---------------------- | ---------- | ------------------------------------------------------------ |
| `CORE_RULES.md`        | (regras)   | 11 regras absolutas (leis permanentes do projeto).           |
| `ENGINEERING_RULES.md` | (fluxo)    | Fluxo: Ler → Mapear → Planejar → Executar → Validar → Documentar. |
| `PROMPTING_RULES.md`   | (regras)   | Uso de contexto + ambiguidade + raciocínio + idioma.         |
| `OUTPUT_RULES.md`      | (regras)   | Formato obrigatório de 7 seções para toda resposta técnica.  |

Ordem de leitura: `CORE_RULES` → `ENGINEERING_RULES` → `PROMPTING_RULES` → `OUTPUT_RULES`.

---

## STATE — Estado atual (snapshot)

| Arquivo             | ID         | Função                                                       |
| ------------------- | ---------- | ------------------------------------------------------------ |
| `PROJECT_STATE.md`  | (snapshot) | Snapshot puro: versão, branch, milestone, módulos, FROZEN.   |
| `DECISION_LOG.md`   | DEC-NNN    | Registro cronológico de decisões arquiteturais.              |
| `TASK_TEMPLATE.md`  | (template) | Template padrão para toda tarefa (com campo Rollback).       |

> `PROJECT_STATE.md` é **apenas snapshot**. Histórico em
> `memory/implementation-history.md`. Roadmap em
> `architecture/roadmap.md`. Decisões em `DECISION_LOG.md` e
> `decisions/ADR-*.md`.

---

## ARCHITECTURE — Mapa estrutural

| Arquivo                          | ID         | Função                                                       |
| -------------------------------- | ---------- | ------------------------------------------------------------ |
| `architecture/modules.md`        | (lista)    | Lista de módulos, responsabilidades, FROZEN status.          |
| `architecture/interfaces.md`     | (contrato) | Contratos públicos (apenas assinaturas) para integrações.    |
| `architecture/runtime.md`        | (fluxo)    | Fluxo canônico, diagrama de pipeline, eventos, lifecycle.    |
| `architecture/dependencies.md`   | (mapa)     | Quem depende de quem; alterabilidade; blast radius.          |
| `architecture/invariants.md`     | INV-NNN    | Garantias arquiteturais que raramente mudam (INV-001 a INV-010). |
| `architecture/frozen-files.md`   | (lista)    | Lista canônica de arquivos FROZEN (Regra 8 CORE_RULES).      |
| `architecture/roadmap.md`        | ROADMAP    | Roadmap técnico canônico (H0 → M6+).                         |

---

## CONTRACTS — Contratos de integração

| Arquivo                  | ID         | Função                                                       |
| ------------------------ | ---------- | ------------------------------------------------------------ |
| `contracts/api.md`       | (contrato) | Endpoints HTTP (Next.js API routes) — paths, métodos, schemas.|
| `contracts/database.md`  | (contrato) | Schema Prisma — models, campos, índices, invariantes.       |
| `contracts/rpc.md`       | (contrato) | Contratos RPC blockchain + protocolo IPC do signer.         |
| `contracts/events.md`    | (contrato) | Eventos emitidos/consumidos (audit log, observability).     |

> Antes de alterar qualquer implementação que expõe um contrato,
> consultar a pasta `contracts/` correspondente.

---

## STANDARDS — Padrões de engenharia

| Arquivo                            | ID       | Função                                                       |
| ---------------------------------- | -------- | ------------------------------------------------------------ |
| `standards/coding-style.md`        | STD-001+ | Estilo de código TypeScript/React (naming, formatting).      |
| `standards/testing.md`             | STD-101+ | Padrões de teste (unidade, adversarial, integração, harnesses).|
| `standards/security.md`            | STD-201+ | Padrões de segurança (crypto, key handling, REG-NNN).        |
| `standards/documentation.md`       | STD-301+ | Padrões de documentação (`.ai/`, JSDoc, ADRs, READMEs).      |
| `standards/git-workflow.md`        | STD-401+ | Padrões de commits, branches, PRs, conventional commits.     |

> `ENGINEERING_RULES.md` é o resumo executivo; `standards/`
> contém as regras detalhadas. IDs STD-NNN são numerados por
> bloco (coding=001+, testing=101+, security=201+, docs=301+,
> git=401+).

---

## CONTEXT — Contexto imutável do projeto

| Arquivo                          | ID         | Função                                                       |
| -------------------------------- | ---------- | ------------------------------------------------------------ |
| `context/project-summary.md`     | (resumo)   | Objetivos, escopo, tecnologias, arquitetura em 1 página.    |
| `context/terminology.md`         | (interno)  | Nomes oficiais de módulos + acrônimos + significado operacional.|
| `context/conventions.md`         | (padrões)  | Padrões de nomenclatura, estrutura de pastas, convenções.   |
| `context/glossary.md`            | (externo)  | Dicionário alfabético de termos técnicos (blockchain, trading, RPC).|

> `terminology.md` = interno do projeto. `glossary.md` = referência
> técnica externa. Não duplicar.

---

## MEMORY — Memória histórica e operacional

| Arquivo                                | ID       | Função                                                       |
| -------------------------------------- | -------- | ------------------------------------------------------------ |
| `memory/implementation-history.md`     | (linha)  | Linha do tempo cronológica (o que, quando, por quê).        |
| `memory/known-problems.md`             | KP-NNN   | Problemas conhecidos: causa, status, mitigação.              |
| `memory/technical-debt.md`             | TD-NNN   | Débitos técnicos: prioridade, impacto, prazo.                |
| `memory/future-ideas.md`               | FI-NNN   | Ideias futuras (não implementar automaticamente).            |

> Toda entrada é **append-only**. Nunca apagar histórico — apenas
> marcar como supercedido com nota explicativa e data.

---

## DECISIONS — Architecture Decision Records

| Arquivo               | ID       | Função                                                       |
| --------------------- | -------- | ------------------------------------------------------------ |
| `decisions/ADR-0001.md`| ADR-0001 | Arquitetura defense-in-depth canônica (H0 → M5).            |
| `decisions/ADR-0002.md`| ADR-0002 | Project OS v2.1: MANIFEST, CHECKLIST, IDs, cross-links, snapshot puro. |
| (futuros)             | ADR-NNNN | Próximos ADRs seguem numeração sequencial.                  |

> ADRs são append-only. Cada ADR documenta uma decisão arquitetural
> significativa com Context, Decision, Consequences. Resumos
> curtos ficam em `DECISION_LOG.md` (DEC-NNN).

---

## Precedência em caso de conflito

```
CORE_RULES.md
  > PROJECT_STATE.md
  > decisions/ADR-*.md
  > DECISION_LOG.md
  > architecture/invariants.md
  > architecture/frozen-files.md
  > SECURITY.md (REG-NNN)
  > HARDENING-ROADMAP.md
  > worklog.md
```

---

## Sequência obrigatória antes de qualquer implementação

```
1. MANIFEST.md                    (princípios do Project OS)
2. CHECKLIST.md                   (checklist completo a seguir)
3. CORE_RULES.md                  (regras absolutas)
4. PROJECT_STATE.md               (snapshot atual)
5. DECISION_LOG.md                (decisões vigentes DEC-NNN)
6. architecture/roadmap.md        (fase atual + próximos)
7. architecture/invariants.md     (garantias invioláveis INV-NNN)
8. architecture/frozen-files.md   (o que NÃO pode ser tocado)
9. architecture/interfaces.md     (contratos públicos do escopo)
10. contracts/<relacionados>      (api.md / database.md / rpc.md / events.md)
11. standards/<relacionados>      (padrões STD-NNN aplicáveis)
12. Ler apenas os arquivos necessários do código (escopo mínimo)
13. Só então implementar seguindo TASK_TEMPLATE.md
```

Pular qualquer etapa viola `CORE_RULES.md` Regra 1 e causa
regressões. Ver `CHECKLIST.md` para o detalhamento completo.

---

## Regras de manutenção deste índice

- Toda adição/remoção/renomeação de arquivo em `.ai/` DEVE:
  1. Atualizar este `INDEX.md` com a nova entrada (ou remoção).
  2. Atualizar `README.md` (índice mínimo) correspondentemente.
  3. Bumpar a versão do Project OS em `PROJECT_STATE.md`.
  4. Criar novo ADR em `decisions/ADR-NNNN.md` justificando.
  5. Adicionar entrada em `DECISION_LOG.md` (DEC-NNN).
  6. Adicionar entrada em `memory/implementation-history.md`.
- Mudanças de conteúdo (sem mudança estrutural) não requerem
  atualização deste índice — apenas do arquivo afetado.
