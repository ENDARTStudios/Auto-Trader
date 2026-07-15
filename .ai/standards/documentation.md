# `standards/documentation.md` — Padrões de Documentação

> Regras detalhadas de documentação. `README.md` (raiz do `.ai/`)
> é o ponto de entrada; este arquivo é a referência para manter
> todos os documentos sincronizados e consistentes.

---

## Estrutura de documentação

```
.ai/                           # Governance layer (este diretório)
├── INDEX.md                   # Ponto de entrada único
├── README.md                  # Visão geral + protocolo
├── *.md (root level)          # Regras e estado
├── architecture/*.md          # Mapa estrutural
├── contracts/*.md             # Contratos de integração
├── standards/*.md             # Padrões detalhados (este arquivo)
├── context/*.md               # Contexto imutável
├── memory/*.md                # Memória histórica
└── decisions/*.md             # ADRs

docs/                          # Design docs (raiz do projeto)
├── signer-isolation-design.md # M3.2 design
├── CRYPTO.md                  # Documentação crypto
└── key-rotation.md            # (a criar em M6)

README.md                      # Visão geral do projeto (raiz)
SECURITY.md                    # Regressões REG-NNN (raiz)
HARDENING-ROADMAP.md           # Roadmap canônico (raiz)
worklog.md                     # Log multi-agente (raiz)
```

---

## Padrões por tipo de documento

### `.ai/*.md` (root level)

- **Formato:** Markdown puro. Sem HTML inline (exceto `<br>` se
  estritamente necessário).
- **Idioma:** Português (PT-BR), salvo para termos técnicos em
  inglês consagrados (ex.: "audit log", "fencing token", "broadcast").
- **Tamanho:** sem limite, mas preferir modularizar em subpastas
  quando passar de ~500 linhas.
- **Headers:** H1 para título, H2 para seções principais, H3 para
  sub-seções. Não pular níveis.

### `.ai/architecture/*.md`

- **Diagramas:** ASCII art em blocos de código ``` ```. Para
  diagramas complexos, considerar Mermaid (mas testar renderização
  no GitHub primeiro).
- **Tabelas:** para listas estruturadas (módulos, dependências).
- **Code blocks:** sempre com linguagem especificada
  (`typescript`, `prisma`, `json`, etc.).

### `.ai/contracts/*.md`

- **Code blocks:** TypeScript para interfaces, JSON para exemplos
  de request/response.
- **Versionamento:** cada contrato tem seção "Evolução" explicando
  o que é breaking change.

### `.ai/decisions/ADR-*.md`

Template obrigatório (ver ADR-0001 para exemplo real):

```markdown
# ADR-NNNN — <Título curto>

**Data:** YYYY-MM-DD
**Status:** Ativa | Depreciada | Supercedida por ADR-NNNN
**Supersedes:** ADR-NNNN (se aplicável)
**Superseded by:** ADR-NNNN (se aplicável)

## Contexto

<por que esta decisão foi necessária. Estado do sistema antes.
Forças em jogo. Restrições.>

## Decisão

<qual foi a decisão tomada. Específica, não vaga.>

## Alternativas consideradas

<lista de alternativas, com motivo de descarte.>

## Consequências

### Positivas
- <benefício 1>
- <benefício 2>

### Negativas
- <trade-off 1>
- <trade-off 2>

### Neutras
- <implicação que não é boa nem ruim>

## REG-NNN associados
- REG-NNN: <descrição>

## Referências
- <links para docs externos, papers, etc.>
```

### `.ai/memory/*.md`

- **Append-only:** nunca editar entradas antigas. Se informação
  mudou, adicionar nova entrada com nota "supercede entrada
  anterior datada de YYYY-MM-DD".
- **Formato entrada:** heading H3 `### YYYY-MM-DD — <Título>`,
  seguido de bullets.
- **Proibido:** apagar entradas mesmo que obsoletas. Manter para
  histórico.

### `worklog.md`

Template multi-agente:

```markdown
---
Task ID: <id>
Agent: <nome do agente>
Task: <descrição curta da tarefa>

Work Log:
- <passo 1>
- <passo 2>
- ...

Stage Summary:
- <resultado 1>
- <resultado 2>
- <arquivos produzidos, métricas, etc.>
```

Separação entre entradas: linha com `---` no início. Não editar
entradas antigas.

---

## JSDoc

### Funções públicas

```typescript
/**
 * Descrição curta em uma linha.
 *
 * Descrição detalhada opcional, em múltiplas linhas se necessário.
 *
 * @param paramName - Descrição do parâmetro.
 * @returns Descrição do retorno.
 * @throws {ErrorType} Quando e por quê.
 *
 * @example
 * ```typescript
 * const result = await myFunction({ foo: 'bar' });
 * console.log(result.id);
 * ```
 *
 * @see {@link ./architecture/interfaces.md} para contrato público.
 * @see {@link ./architecture/invariants.md} INV-NNN para invariante.
 */
```

### Regras

- **Sempre** documentar funções exportadas (públicas).
- **Opcional** documentar funções internas (private) — preferir
  código auto-explicativo.
- **Sempre** documentar tipos/ interfaces exportados.
- **Nunca** JSDoc que repete o óbvio (ex.: `@param name - The name`).

---

## READMEs

### README.md raiz do projeto

Estrutura:

1. **Título + descrição** (1 parágrafo).
2. **Quick start** (comandos para rodar localmente).
3. **Arquitetura** (link para `.ai/architecture/`).
4. **Desenvolvimento** (comandos de build/test/lint).
5. **Roadmap** (link para `.ai/architecture/roadmap.md`).
6. **Contribuindo** (link para `.ai/CORE_RULES.md` e
   `.ai/ENGINEERING_RULES.md`).
7. **Licença**.

### README em subpastas

Apenas se a subpasta tiver complexidade própria (ex.: `src/signer/`
poderia ter um README explicando o processo isolado). Caso
contrário, omitir.

---

## Conventional commits

Ver `standards/git-workflow.md` para detalhes. Documentação
gerada a partir de commits (changelogs) segue o mesmo padrão.

---

## Manutenção

### Quando atualizar docs

- **Toda mudança em arquivo FROZEN:** atualizar
  `architecture/frozen-files.md` (mesmo que para adicionar nota
  de exceção).
- **Toda nova decisão arquitetural:** ADR + entrada em
  `DECISION_LOG.md`.
- **Toda mudança de API:** atualizar `contracts/api-contracts.md`.
- **Toda mudança de schema:** atualizar
  `contracts/database-contracts.md` + criar Prisma migration.
- **Toda conclusão de fase:** atualizar
  `architecture/roadmap.md` + `PROJECT_STATE.md`.

### Quando NÃO atualizar docs

- Mudança de implementação que preserva contrato público (ex.:
  refatoração interna). Documentação permanece.
- Bug fix que preserva comportamento anterior (apenas
  `memory/known-problems.md` se aplicável).

### Review de docs em PR

Toda PR que toca código DEVE incluir:

- Atualização de docs relevantes (se mudança de contrato).
- Entrada em `worklog.md` (sempre).
- Entrada em `memory/implementation-history.md` se for mudança
  significativa.

PR sem atualização de docs quando necessária é bloqueada por review.

---

## Idioma

- **Documentação `.ai/`:** Português (PT-BR).
- **Code comments / JSDoc:** Inglês (padrão da indústria, facilita
  contribuição internacional).
- **Mensagens de commit:** Inglês (Conventional Commits em inglês).
- **Mensagens de erro:** Inglês (mantém stack traces consistentes).
- **Worklog:** Português (consistente com a conversa técnica).

Exceção: termos técnicos consagrados em inglês ("audit log",
"fencing token", "lease", "broadcast") permanecem em inglês mesmo
em docs em português.
