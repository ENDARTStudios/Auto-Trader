# `.ai/` — Project Operating System

Memória operacional permanente do projeto. Não explica regras —
apenas responde **onde cada informação fica**. Para regras, leia
os arquivos referenciados.

**Versão vigente:** Project OS v2.1 (ver `PROJECT_STATE.md`).

---

## Ponto de entrada

```
MANIFEST.md           → princípios do Project OS (leia primeiro)
INDEX.md              → índice completo com IDs e descrições
CHECKLIST.md          → checklist obrigatório pré-implementação
```

## Regras absolutas

```
CORE_RULES.md         → 11 regras absolutas
ENGINEERING_RULES.md  → fluxo: Ler → Mapear → Planejar → Executar → Validar → Documentar
PROMPTING_RULES.md    → uso de contexto, ambiguidade, raciocínio, idioma
OUTPUT_RULES.md       → formato de 7 seções para respostas técnicas
```

## Estado atual

```
PROJECT_STATE.md      → snapshot puro (fase, stack, módulos, FROZEN)
DECISION_LOG.md       → decisões vigentes (DEC-NNN)
TASK_TEMPLATE.md      → template para toda tarefa
```

## Estrutura de pastas

```
architecture/         → roadmap, modules, dependencies, runtime, interfaces,
                        invariants, frozen-files
contracts/            → api.md, database.md, rpc.md, events.md
standards/            → coding-style, testing, security, documentation, git-workflow
context/              → project-summary, terminology, conventions, glossary
memory/               → implementation-history, known-problems, technical-debt,
                        future-ideas
decisions/            → ADR-NNNN.md (Architecture Decision Records)
```

## Sequência obrigatória antes de qualquer implementação

```
1. MANIFEST.md
2. CHECKLIST.md
3. CORE_RULES.md
4. PROJECT_STATE.md
5. DECISION_LOG.md
6. architecture/roadmap.md
7. architecture/invariants.md
8. architecture/frozen-files.md
9. architecture/interfaces.md + contracts/<relacionados>
10. Ler código necessário (escopo mínimo)
11. Implementar seguindo TASK_TEMPLATE.md
12. Validar + Documentar (ver CHECKLIST.md Fases 5-7)
```

## Precedência em conflito

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

## Fontes externas de verdade

```
README.md (raiz)              → visão geral do projeto
SECURITY.md (raiz)            → REG-NNN adversariais
HARDENING-ROADMAP.md (raiz)   → mapeia 30 attack vectors
worklog.md (raiz)             → log de trabalho contínuo
prisma/schema.prisma          → schema canônico do banco
docs/                         → design docs (signer isolation, crypto)
```
