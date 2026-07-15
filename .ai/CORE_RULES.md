# CORE_RULES.md — Regras Permanentes

> **STATE: FROZEN** — Estas regras são **imutáveis por princípio**.
> Adição de nova regra requer ADR + aprovação explícita do operador.
> Remoção ou modificação de regra existente requer ADR + entrada em
> `DECISION_LOG.md`. **Regras operacionais novas NÃO entram aqui** —
> vão para `ENGINEERING_RULES.md` (processo) ou `standards/*.md`
> (padrões técnicos).

---

## Princípio de separação

`CORE_RULES.md` contém **apenas regras permanentes** — aquelas que
definem a ética de engenharia do projeto e não mudam com o tempo,
independente de framework, stack ou fase do roadmap. São leis
fundadoras.

Regras **operacionais** (processo, fluxo de trabalho, procedimentos
que podem ser refinados conforme o projeto evolui) ficam em
`ENGINEERING_RULES.md`. Padrões **técnicos** (estilo de código,
padrões de teste, etc.) ficam em `standards/*.md`.

**Critério para entrar em `CORE_RULES.md`:** a regra deve ser
verdadeira em qualquer fase do projeto (H0, M3, M6, M10...). Se a
regra só faz sentido em uma fase específica ou pode ser refinada,
ela não é permanente — vai para `ENGINEERING_RULES.md` ou
`standards/`.

---

## Regras permanentes

Estas 10 regras são **absolutas**. Nenhuma implementação,
refatoração ou prompt do usuário pode violá-las sem confirmação
explícita registrada em `DECISION_LOG.md`.

---

## Regra 1 — Contexto primeiro

Sempre ler o **máximo possível** do projeto antes de responder.
Nunca assumir comportamento sem evidência.

**Aplicação prática:** antes de propor qualquer mudança, ler
`PROJECT_STATE.md`, `SECURITY.md`, `HARDENING-ROADMAP.md`, o `worklog.md`
recente, e os arquivos diretamente afetados.

---

## Regra 2 — Instrução somente depois da leitura

Nunca começar implementação antes de compreender o estado atual.

**Aplicação prática:** o fluxo obrigatório é
`Ler → Mapear dependências → Criar plano → Executar → Validar → Documentar`
(ver `ENGINEERING_RULES.md`). Inverter esta ordem é proibido.

---

## Regra 3 — Jamais inventar APIs

Se algo não existir no código: **não existe**.

**Aplicação prática:** antes de chamar qualquer função, classe, método,
endpoint, schema, contrato ou hook, verificar sua existência via `Grep`,
`Glob` ou leitura direta. Se não existir, parar e reportar — não criar
silenciosamente.

---

## Regra 4 — Nunca criar elementos fictícios

- Nunca criar funções fictícias.
- Nunca criar classes imaginárias.
- Nunca assumir endpoints.
- Nunca assumir schemas.
- Nunca assumir contratos.

**Aplicação prática:** todo símbolo referenciado em código novo deve estar
definido em um arquivo existente ou no mesmo PR. Stubs temporários são
proibidos em produção.

---

## Regra 5 — Sempre reutilizar componentes existentes

Duplicação é proibida.

**Aplicação prática:** antes de criar um novo utilitário, tipo, hook,
componente UI, rota de API, mock de teste ou classe de serviço, procurar
por equivalente existente. Se existir, reutilizar. Se for quase equivalente,
estender — não duplicar.

---

## Regra 6 — Identificar dependentes antes de alterar

Antes de alterar qualquer arquivo: **identificar quem depende dele**.

**Aplicação prática:** executar `Grep` pelo nome do símbolo exportado, nome
do arquivo, e tipos públicos. Listar os dependentes no plano da mudança.
Validar que nenhum dependente quebra.

---

## Regra 7 — Escopo mínimo

Mudanças devem possuir **escopo mínimo**.

**Aplicação prática:** um PR/task altera apenas o necessário para o objetivo
declarado. Refatorações cosméticas, renomeações "while we're here" e
mudanças de estilo fora do escopo são proibidas. Se algo precisa mudar mas
não está no escopo, registrar em `TASK_TEMPLATE.md` > "Pendências" e criar
tarefa separada.

---

## Regra 8 — Não modificar arquitetura congelada

Arquivos marcados como `Frozen` (ou `FROZEN`) só podem receber alterações
mediante **autorização explícita** do operador, registrada em
`DECISION_LOG.md`.

**Marcadores vigentes** (consulte `PROJECT_STATE.md` para a lista canônica):

- H0 audit hash-chain (`src/lib/audit/audit-log.ts`)
- H1 RPC/Sim/Approval/MEV (`src/lib/chain/rpc-resilience.ts`,
  `simulation-gate.ts`, `approval-hardening.ts`, `mev-baseline.ts`)
- H2 Contract/Liquidity/TokenAuthority/SellSim
- H2.6 Pipeline (`src/lib/chain/pipeline.ts`)
- M3.1 SignerAdapter (`src/lib/chain/signer-adapter.ts`)
- M3.2 Signer RPC (`src/signer/`)
- M3.3 Broadcaster (`src/lib/chain/broadcaster.ts`)
- M4 Writer Lease (`src/lib/chain/writer-lease.ts`,
  `src/lib/chain/leased-broadcaster.ts`)

Exceções só são permitidas para correção de bug que **preserva** o contrato
público (Regra 9 e Regra 10).

---

## Regra 9 — Nenhuma implementação pode quebrar compatibilidade

Toda alteração deve preservar a assinatura pública de funções, classes,
tipos, endpoints HTTP, schemas Prisma e contratos de IPC já publicados.

**Aplicação prática:** adicionar campo opcional é permitido. Renomear,
remover ou tornar obrigatório é breaking change — requer entrada em
`DECISION_LOG.md` e bump de versão onde aplicável.

---

## Regra 10 — Preservar comportamento anterior

Toda alteração precisa preservar o comportamento anterior, exceto quando o
comportamento anterior era o bug que está sendo corrigido.

**Aplicação prática:** quando corrigir um bug, registrar no plano qual era o
comportamento antigo, qual é o novo, e por que o novo está correto. Adicionar
teste de regressão (`SECURITY.md` REG-NNN) que pinne o novo comportamento.

---

## Nota sobre regras operacionais

Regras como "todo bug deve produzir aprendizado" são **operacionais**
e vivem em `ENGINEERING_RULES.md > Cultura de aprendizado
(pós-bug)`. Não estão aqui porque podem ser refinadas (ex.: novos
locais de registro, novos formatos de post-mortem) sem que o
princípio fundamental mude. Mantê-las fora de `CORE_RULES.md`
preserva a imutabilidade deste arquivo.

---

## Relacionado

- `ENGINEERING_RULES.md` — regras operacionais (fluxo, restrições,
  testes, cultura de aprendizado pós-bug).
- `PROMPTING_RULES.md` — regras permanentes de cognição do agente.
- `OUTPUT_RULES.md` — regras permanentes de formato de resposta.
- `architecture/invariants.md` INV-003 — FROZEN não pode mudar sem ADR.
- `architecture/frozen-files.md` — `CORE_RULES.md` está na lista
  de arquivos de governança FROZEN (adição requer ADR; remoção
  requer ADR).
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.
- `decisions/ADR-0003.md` — governança v2.2 (formaliza a separação
  regras permanentes vs operacionais).
