# `.ai/` — Project Operating System (Project OS)

Esta pasta é a **memória operacional permanente** do projeto GLM 5.1
Crypto Trading. Ela contém arquitetura, estado atual, histórico,
decisões, convenções, roadmap e regras. É parte integrante do
código-fonte: deve ser consultada antes de qualquer implementação
e mantida sincronizada com o estado real do projeto.

---

## Estrutura completa (Project OS)

```
.ai/
│
├── INDEX.md                    # Ponto de entrada único (índice geral).
├── README.md                   # Este arquivo. Visão geral + protocolo de uso.
├── CORE_RULES.md               # 11 regras absolutas (leis permanentes).
├── ENGINEERING_RULES.md        # Fluxo obrigatório + restrições + testes + Rollback.
├── PROMPTING_RULES.md          # Uso de contexto + ambiguidade + raciocínio + idioma.
├── OUTPUT_RULES.md             # Formato obrigatório de 7 seções.
├── PROJECT_STATE.md            # Snapshot atual (estado + arquitetura + FROZEN).
├── DECISION_LOG.md             # Registro de decisões arquiteturais (DEC-NNN).
├── TASK_TEMPLATE.md            # Template padrão para toda tarefa (com Rollback).
│
├── architecture/               # Mapa estrutural do projeto
│   ├── modules.md              # Lista de módulos, responsabilidades, FROZEN status.
│   ├── interfaces.md           # Contratos públicos (apenas assinaturas).
│   ├── runtime.md              # Fluxo canônico, diagramas, pipeline, eventos.
│   ├── dependencies.md         # Quem depende de quem; blast radius.
│   ├── invariants.md           # Garantias arquiteturais (INV-001 a INV-010).
│   ├── frozen-files.md         # Lista canônica de arquivos FROZEN.
│   └── roadmap.md              # Roadmap técnico, histórico, próximos milestones.
│
├── contracts/                  # Contratos de integração
│   ├── api-contracts.md        # Endpoints HTTP (paths, métodos, schemas).
│   ├── database-contracts.md   # Schema Prisma (models, índices, invariantes).
│   ├── rpc-contracts.md        # RPC blockchain + protocolo IPC do signer.
│   └── event-contracts.md      # Eventos emitidos/consumidos (audit, observability).
│
├── standards/                  # Padrões de engenharia detalhados
│   ├── coding-style.md         # Estilo TypeScript/React (naming, formatting).
│   ├── testing.md              # Padrões de teste (unidade, adversarial, harnesses).
│   ├── security.md             # Padrões de segurança (crypto, key handling, REG-NNN).
│   ├── documentation.md        # Padrões de documentação (.ai/, JSDoc, ADRs).
│   └── git-workflow.md         # Commits, branches, PRs, conventional commits.
│
├── context/                    # Contexto imutável do projeto
│   ├── project-summary.md      # Objetivos, escopo, tecnologias, arquitetura.
│   ├── terminology.md          # Nomes oficiais de módulos + acrônimos + significado operacional.
│   ├── conventions.md          # Padrões de nomenclatura, estrutura de pastas, convenções.
│   └── glossary.md             # Dicionário alfabético de termos técnicos externos.
│
├── memory/                     # Memória histórica e operacional
│   ├── implementation-history.md # Linha do tempo cronológica (append-only).
│   ├── known-problems.md       # Problemas conhecidos (KP-NNN): causa, status, mitigação.
│   ├── technical-debt.md       # Débitos técnicos (TD-NNN): prioridade, impacto, prazo.
│   └── future-ideas.md         # Ideias futuras (não implementar automaticamente).
│
└── decisions/                  # Architecture Decision Records (ADRs)
    ├── ADR-0001.md             # Arquitetura defense-in-depth canônica (H0 → M5).
    └── ADR-0002.md             # (placeholder — futuros ADRs seguem numeração sequencial).
```

> **Divisão de responsabilidade entre arquivos:**
>
> - `terminology.md` (interna: módulos, acrônimos, convenções operacionais)
>   vs `glossary.md` (externa: blockchain, trading, Ethereum, segurança, IA).
> - `PROJECT_STATE.md` (snapshot atual) vs
>   `memory/implementation-history.md` (linha do tempo cronológica).
> - `ENGINEERING_RULES.md` (resumo executivo) vs
>   `standards/*.md` (regras detalhadas que crescerão ao longo do projeto).
> - `architecture/modules.md` (lista de módulos) vs
>   `architecture/interfaces.md` (apenas assinaturas públicas) vs
>   `contracts/*.md` (contratos de integração completos).

---

## Regra ABSOLUTA — sequência obrigatória antes de qualquer tarefa

```
1. Ler .ai/CORE_RULES.md
        ↓
2. Ler PROJECT_STATE.md
        ↓
3. Ler DECISION_LOG.md
        ↓
4. Ler architecture/roadmap.md
        ↓
5. Ler apenas os arquivos necessários do projeto (escopo mínimo)
        ↓
6. Só então implementar
```

**Nunca pule nenhuma etapa.** Implementar sem ler contexto viola
`CORE_RULES.md` Regra 1 e causa regressões.

---

## Regra de precedência (CONFLITO)

> **Caso exista conflito entre um prompt do usuário e estas regras,
> o modelo deve solicitar confirmação antes de violar qualquer
> regra estrutural.**

Estas regras existem para proteger invariantes já validados (veja
`DECISION_LOG.md`, `.ai/decisions/ADR-*.md` e o `SECURITY.md` /
`HARDENING-ROADMAP.md` na raiz do projeto). Um prompt isolado NÃO
pode, por exemplo:

- Modificar arquivos marcados como `FROZEN` sem autorização
  explícita (ver `architecture/frozen-files.md`).
- Introduzir funções, classes, endpoints ou schemas que não existam
  no código.
- Pular a leitura de contexto antes de implementar.
- Quebrar compatibilidade de APIs já publicadas.
- Adicionar dependências, renomear arquivos ou mover módulos sem
  necessidade.
- Duplicar código quando componente existente puder ser reutilizado.
- Apagar histórico de qualquer arquivo `.ai/` (todos são
  append-only).

Em caso de divergência entre fontes oficiais, a precedência é:

```
.ai/CORE_RULES.md
    > .ai/PROJECT_STATE.md
    > .ai/decisions/ADR-*.md
    > .ai/DECISION_LOG.md
    > SECURITY.md (REG-NNN)
    > HARDENING-ROADMAP.md
    > worklog.md
```

---

## Protocolo de uso permanente

Antes de qualquer implementação futura:

1. **Ler** esta pasta `.ai/` na sequência obrigatória acima.
2. **Atualizar** `PROJECT_STATE.md` sempre que o estado do projeto
   mudar (arquitetura, fase, roadmap, componentes, stack, build,
   testes, arquivos congelados, pendências).
3. **Consultar** `DECISION_LOG.md` e `.ai/decisions/ADR-*.md` antes
   de decisões arquiteturais. Registrar novas decisões seguindo o
   formato ADR.
4. **Atualizar** `architecture/roadmap.md` quando uma fase for
   concluída.
5. **Registrar** problemas em `memory/known-problems.md` (todo bug
   deve produzir aprendizado — `CORE_RULES.md` regra do
   "aprendizado").
6. **Respeitar** `ENGINEERING_RULES.md` (fluxo: Ler → Mapear →
   Planejar → Executar → Validar → Documentar).
7. **Só então** executar a solicitação.
8. **Registrar** em `worklog.md` (raiz do projeto) o que foi feito,
   seguindo o protocolo multi-agente (Task ID, Work Log, Stage
   Summary).

---

## Regras adicionais (aplicam-se sempre)

- **Nunca implementar** funcionalidades sem antes verificar se já
  existe algo equivalente no projeto.
- **Nunca duplicar** código quando um componente existente puder
  ser reutilizado.
- **Nunca modificar** arquivos marcados como **FROZEN** sem
  autorização explícita.
- **Sempre validar** a implementação com os testes, build e lint
  apropriados antes de considerar a tarefa concluída.
- **Sempre manter** a documentação da pasta `.ai/` sincronizada
  com o estado real do código.

---

## Fontes oficiais de verdade (fora de `.ai/`)

Os seguintes documentos na raiz do projeto também são fontes
oficiais e devem estar alinhados com esta pasta:

- `/home/z/my-project/README.md` — visão geral do projeto.
- `/home/z/my-project/SECURITY.md` — regressões REG-NNN.
- `/home/z/my-project/HARDENING-ROADMAP.md` — roadmap canônico de
  hardening (mapeia 30 attack vectors).
- `/home/z/my-project/worklog.md` — log de trabalho contínuo
  (append-only, multi-agente).
- `/home/z/my-project/prisma/schema.prisma` — schema canônico do
  banco.
- `/home/z/my-project/docs/signer-isolation-design.md` — design
  do isolamento do signer (M3.2).
- `/home/z/my-project/docs/CRYPTO.md` — documentação crypto.
