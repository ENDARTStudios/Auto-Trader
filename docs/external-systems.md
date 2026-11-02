# Sistemas externos — análise e plano de adoção (2026-11-02)

Três referências pedidas: AutoHedge (Swarm), Vibe-Trading (HKUDS) e Fincept Terminal.
Este documento registra o que cada uma é, o que **pode** ser adotado e o que **não pode**,
com a licença como restrição de primeira classe (AGENTS.md: sistemas externos são
*advisory-only*; copyleft/desconhecido = **SPEC-ONLY**, sem código copiado).

## Matriz de licença e viabilidade

| Sistema | Stack | Licença | Pode copiar código? | Como usar |
|---|---|---|---|---|
| **AutoHedge** | Python, `swarms`, Solana/Jupiter | **MIT** | Sim, com atribuição | Inspiração de pipeline + eventual adaptador isolado |
| **Vibe-Trading** | Python/FastAPI + React, milhares de arquivos | **MIT** | Sim, com atribuição | Referência de contratos (paper lifecycle, grounding) — não embutir |
| **Fincept Terminal** | C++20/Qt6 + Python embutido | **AGPL-3.0-or-later** | **Não** (copyleft forte + marca registrada) | **SPEC-ONLY**: apenas ideias e contratos |

Fincept ainda restringe o uso das marcas "Fincept"/"Fincept Terminal" em derivados,
o que reforça: nenhum código, nenhum ativo visual, nenhum nome derivado.

## O que cada sistema realmente faz

### AutoHedge
Pipeline de agentes especializados: **Director** (tese/estratégia) → **Quant**
(análise técnica/estatística) → **Risk Manager** (sizing) → **Execution**
(ordens). Saída estruturada em JSON, logging enterprise, foco em Solana.

**Encaixe no Auto Trader:** nosso engine já tem as mesmas etapas (scan → score →
risco → execução → log) na telemetria. O que falta é a **separação explícita de
responsabilidades por estágio** com contrato de saída — hoje isso é um pipeline
único no engine.

### Vibe-Trading
Plataforma de pesquisa/trading com agente: paper trading com máquina de estados
de ordem (bar-agnóstica, replay determinístico), 478 fatores, 27 fontes de dados,
14 brokers, MCP, ledger de evidências ("número sem evidência não passa"), e uma
regra cultural forte: **valor que não pode ser calculado vira `null`, nunca um
número plausível**.

**Encaixe:** dois conceitos são diretamente aproveitáveis sem código:
1. **Ciclo de vida explícito da ordem em paper** (created → accepted → filled →
   settled/cancelled) com IDs de replay estáveis.
2. **Fail-closed de métrica indefinida** — já seguimos em parte; falta padronizar
   na API (`null` em vez de `0` para profit factor sem perdas etc.).

### Fincept Terminal
Terminal nativo de pesquisa financeira (C++/Qt), 37 agentes, 100+ conectores,
analytics institucional (DCF, VaR, QuantLib), node editor, MCP. Edição open sob
AGPL; edição Enterprise proprietária.

**Encaixe:** referência de **arquitetura de research desk** (módulos, catálogo de
dados, node editor). Nada copiável; serve para justificar roadmap de Analytics
avançado (fatores, atribuição, cenários) sem importar código.

## O que foi adotado agora

| Item | Origem conceitual | Implementação |
|---|---|---|
| Pipeline de estágios com contrato | AutoHedge | Já exposto na telemetria (`SCAN/SCORE/RISK/EXECUTE/LOG`); sem mudança |
| `null` em vez de número inventado | Vibe-Trading | Já praticado em telas (mostram `—`); documentado como regra |
| MCP read-only bridge | Vibe-Trading / Fincept | **Implementado** em `/api/mcp` (manifest + tools somente leitura) |

## O que foi deliberadamente recusado

- **Embutir Vibe-Trading**: stack Python/FastAPI/React com milhares de arquivos,
  dependências pesadas e ciclo próprio. Duplicaria o produto, não o complementaria.
- **Embutir Fincept**: AGPL + marca; qualquer cópia contaminaria a licença do
  Auto Trader e exigiria abrir o serviço inteiro.
- **AutoHedge como executor**: ele executa em Solana via Jupiter com chave de
  carteira; nosso modelo é paper-first com kill switch e envelope humano. Usar
  como *fonte de ideias* para o pipeline, não como motor.

## Roadmap proposto

1. **Fase A (agora):** MCP read-only bridge — permite que agentes externos
   (incluindo Vibe-Trading/Fincept) leiam posições, analytics e risco sem
   poder escrever nada.
2. **Fase B:** máquina de estados explícita para ordens em paper (spec do
   Vibe-Trading, implementação própria), com replay determinístico.
3. **Fase C:** ledger de evidências para o Copilot — toda afirmação numérica
   precisa citar a fonte (já temos citações de RAG; falta amarrar a números).
4. **Fase D:** research desk com fatores e atribuição (inspirado no Fincept,
   sem código), somente após B/C.

Nenhum item do roadmap exige copiar código de terceiros; todos são contratos e
comportamentos descritos aqui.

## Fase B implementada (2026-11-02)

`src/lib/trading/paper-order-lifecycle.ts` — máquina de estados própria (sem código de terceiros):

- estados `created → filled → settled | cancelled`, com tabela de transições explícita;
- invariantes: terminal não transiciona; não liquida antes de preencher; fill exige preço e quantidade positivos e finitos;
- `orderKey(positionId, side)` — hash determinístico de 24 chars para replay idempotente;
- `deriveLifecycle(position)` — projeta o ciclo a partir da posição persistida (aberta → `filled`, fechada → `settled`, kill switch → `cancelled`).

UI: card **Ciclo da ordem** no detalhe da posição, com a timeline real e a chave da ordem.
Testes: 12 casos em `tests/paper-order-lifecycle.test.ts`.
Persistência de uma tabela de ordens no engine fica para a próxima fase — a projeção atual não inventa etapas.
