# `.ai/` — Índice Geral

> Ponto de entrada único para toda a memória operacional do projeto.
> Use este índice para navegação humana e leitura automática pelo modelo.
> A ordem abaixo reflete a **precedência semântica** (não a ordem alfabética):
> regras absolutas primeiro, depois estado atual, depois arquitetura,
> depois contratos, depois padrões, depois contexto, depois memória,
> depois decisões.

---

## CORE — Regras absolutas (precedência máxima)

| Arquivo               | Função                                                       |
| --------------------- | ------------------------------------------------------------ |
| `CORE_RULES.md`       | 11 regras absolutas (leis permanentes do projeto).           |
| `ENGINEERING_RULES.md`| Fluxo obrigatório + restrições + testes + Rollback.          |
| `PROMPTING_RULES.md`  | Uso de contexto + ambiguidade + raciocínio + idioma.         |
| `OUTPUT_RULES.md`     | Formato obrigatório de 7 seções para toda resposta técnica.  |

Ordem de leitura obrigatória: `CORE_RULES` → `ENGINEERING_RULES` → `PROMPTING_RULES` → `OUTPUT_RULES`.

---

## STATE — Estado atual (snapshot)

| Arquivo             | Função                                                       |
| ------------------- | ------------------------------------------------------------ |
| `PROJECT_STATE.md`  | Snapshot atual: fase ativa, stack, módulos, FROZEN.         |
| `DECISION_LOG.md`   | Registro cronológico de decisões arquiteturais (DEC-NNN).    |
| `TASK_TEMPLATE.md`  | Template padrão para toda tarefa futura (com campo Rollback).|

> **Histórico de estado** (linha do tempo) foi migrado para
> `memory/implementation-history.md`. `PROJECT_STATE.md` contém
> apenas o snapshot corrente.

---

## ARCHITECTURE — Mapa estrutural

| Arquivo                              | Função                                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| `architecture/modules.md`            | Lista de módulos, responsabilidades, FROZEN status.          |
| `architecture/interfaces.md`         | Contratos públicos (apenas assinaturas) para integrações.    |
| `architecture/runtime.md`            | Fluxo canônico, diagrama de pipeline, eventos, lifecycle.    |
| `architecture/dependencies.md`       | Quem depende de quem; alterabilidade; blast radius.          |
| `architecture/invariants.md`         | Garantias arquiteturais que raramente mudam.                 |
| `architecture/frozen-files.md`       | Lista canônica de arquivos FROZEN (Regra 8 CORE_RULES).      |
| `architecture/roadmap.md`            | Roadmap técnico canônico (H0 → M6+).                         |

---

## CONTRACTS — Contratos de integração

| Arquivo                            | Função                                                       |
| ---------------------------------- | ------------------------------------------------------------ |
| `contracts/api-contracts.md`       | Endpoints HTTP (Next.js API routes) — paths, métodos, schemas.|
| `contracts/database-contracts.md`  | Schema Prisma — models, campos, índices, invariantes.       |
| `contracts/rpc-contracts.md`       | Contratos RPC blockchain + protocolo IPC do signer.         |
| `contracts/event-contracts.md`     | Eventos emitidos/consumidos (audit log, observability).     |

> Antes de alterar qualquer implementação que expõe um contrato,
> consultar a pasta `contracts/` correspondente.

---

## STANDARDS — Padrões de engenharia

| Arquivo                          | Função                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| `standards/coding-style.md`      | Estilo de código TypeScript/React (naming, formatting, etc.).|
| `standards/testing.md`           | Padrões de teste (unidade, adversarial, integração, harnesses).|
| `standards/security.md`          | Padrões de segurança (crypto, key handling, REG-NNN).       |
| `standards/documentation.md`     | Padrões de documentação (`.ai/`, JSDoc, ADRs, READMEs).     |
| `standards/git-workflow.md`      | Padrões de commits, branches, PRs, conventional commits.    |

> `ENGINEERING_RULES.md` permanece o resumo executivo; `standards/`
> contém as regras detalhadas que crescerão ao longo do projeto.

---

## CONTEXT — Contexto imutável do projeto

| Arquivo                          | Função                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| `context/project-summary.md`     | Objetivos, escopo, tecnologias, arquitetura em 1 página.    |
| `context/terminology.md`         | Nomes oficiais de módulos + acrônimos + significado operacional.|
| `context/conventions.md`         | Padrões de nomenclatura, estrutura de pastas, convenções.   |
| `context/glossary.md`            | Dicionário alfabético de termos técnicos (blockchain, trading, RPC, etc.).|

> **Divisão de responsabilidade:** `terminology.md` é interno do
> projeto (módulos, acrônimos, convenções operacionais);
> `glossary.md` é referência técnica externa (blockchain, trading,
> Ethereum, segurança, IA). Não duplicar.

---

## MEMORY — Memória histórica e operacional

| Arquivo                                | Função                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| `memory/implementation-history.md`     | Linha do tempo cronológica (o que, quando, por quê).        |
| `memory/known-problems.md`             | Problemas conhecidos (KP-NNN): causa, status, mitigação.    |
| `memory/technical-debt.md`             | Débitos técnicos (TD-NNN): prioridade, impacto, prazo.      |
| `memory/future-ideas.md`               | Ideias futuras (não implementar automaticamente).           |

> Toda entrada é **append-only**. Nunca apagar histórico — apenas
> marcar como supercedido com nota explicativa e data.

---

## DECISIONS — Architecture Decision Records

| Arquivo               | Função                                                       |
| --------------------- | ------------------------------------------------------------ |
| `decisions/ADR-0001.md`| Arquitetura defense-in-depth canônica (H0 → M5).            |
| `decisions/ADR-0002.md`| (placeholder — futuros ADRs seguem numeracao sequencial).   |

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
1. CORE_RULES.md                  (regras absolutas)
        ↓
2. PROJECT_STATE.md               (snapshot atual)
        ↓
3. DECISION_LOG.md                (decisões vigentes)
        ↓
4. architecture/roadmap.md        (fase atual + próximos)
        ↓
5. architecture/invariants.md     (garantias invioláveis)
        ↓
6. architecture/frozen-files.md   (o que não pode tocar)
        ↓
7. contracts/<relacionados>       (contratos da área afetada)
        ↓
8. standards/<relacionados>       (padrões aplicáveis)
        ↓
9. Ler apenas os arquivos necessários do código (escopo mínimo)
        ↓
10. Só então implementar
```

Pular qualquer etapa viola `CORE_RULES.md` Regra 1 e causa regressões.
