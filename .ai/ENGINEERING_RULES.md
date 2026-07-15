# ENGINEERING_RULES.md — Fluxo, Restrições e Testes

## Fluxo obrigatório

Toda implementação deve seguir, sem inverter, a sequência:

1. **Ler contexto.** — arquivos diretamente afetados, dependências, `PROJECT_STATE.md`, `SECURITY.md`, `HARDENING-ROADMAP.md`, `worklog.md` recente.
2. **Mapear dependências.** — quem usa os símbolos que serão tocados. Listar no plano.
3. **Criar plano.** — escopo mínimo, arquivos afetados, validações necessárias, riscos.
4. **Executar.** — implementar seguindo o plano. Sem invenções fora do plano.
5. **Validar.** — rodar build, rodar testes do módulo, rodar testes adversariais relevantes, confirmar que nenhum dependente quebra.
6. **Documentar.** — atualizar `worklog.md` (sempre), `PROJECT_STATE.md` (se o estado mudar), `DECISION_LOG.md` (se houver decisão arquitetural), `SECURITY.md` (se houver nova regressão REG-NNN).

**Nunca alterar esta ordem.** Em particular, nunca executar antes de mapear
dependências e nunca finalizar antes de validar + documentar.

---

## Restrições

As seguintes ações são **proibidas por padrão** e só são permitidas com
justificativa explícita no plano da tarefa:

- ❌ **Não adicionar dependências sem necessidade.** Antes de `npm install X`,
  verificar se a funcionalidade já existe em dependências instaladas
  (`ethers`, `viem`, `next`, `prisma`, `@prisma/client`, `zod`, etc.).
- ❌ **Não renomear arquivos sem necessidade.** Renomear quebra imports
  implícitos, snapshots de teste e links externos.
- ❌ **Não mover módulos sem necessidade.** Mover exige atualizar todos os
  imports e atualizar `PROJECT_STATE.md`. O hardening roadmap congelou
  os caminhos atuais.
- ❌ **Não criar abstrações prematuras.** Não introduzir interface/classe
  base abstrata antes de haver pelo menos 2 implementações concretas que
  precisem dela.
- ❌ **Não refatorar fora do escopo.** Refatoração cosmética é proibida em
  tarefas de correção de bug. Criar tarefa separada se houver necessidade.

---

## Toda alteração deve informar

Antes de executar, o plano da tarefa deve explicitar:

1. **Arquivos modificados** — lista completa com ação (criar/editar/deletar).
2. **Dependências** — quem usa os símbolos tocados (validar via `Grep`).
3. **Impacto** — o que muda no sistema (contratos, performance, segurança,
   compatibilidade).
4. **Risco** — severidade (baixa/média/alta) e probabilidade. Riscos de
   regressão, performance, segurança, compatibilidade.
5. **Como validar** — testes a rodar (unidade, adversariais, integração),
   build, lint, validação manual.
6. **Rollback** — como reverter a mudança se a validação falhar em produção.
   Especificar: git revert? Edit manual? Variável de feature flag? Restaurar
   backup de banco?

Sem estes 6 itens, a tarefa não está pronta para execução.

---

## Testes

Toda alteração deve indicar explicitamente, no plano da tarefa:

- **Testes necessários** — quais testes novos devem ser escritos, quais
  testes existentes devem ser atualizados, quais testes adversariais
  (REG-NNN) devem ser adicionados em `SECURITY.md`.
- **Build necessário** — `npm run build`, `tsc --noEmit`, `eslint`, e
  qualquer script de validação do módulo (`scripts/test-*.ts`).
- **Validações** — afirmar, antes de finalizar, que:
  - [ ] Build passa sem erros de tipo.
  - [ ] Lint passa sem novos warnings.
  - [ ] Todos os testes do módulo afetado passam.
  - [ ] Nenhum teste de regressão existente quebrou.
  - [ ] Nenhum dependente listado no passo 2 quebrou.
  - [ ] `worklog.md` foi atualizado com a entrada da tarefa.

### Princípio de teste adversarial (herdado do `HARDENING-ROADMAP.md`)

> Toda nova implementação criptográfica ou de segurança deve vir
> acompanhada de pelo menos um teste que **tenta explicitamente quebrar** a
> propriedade prometida.

Isto é mandatório para: hash-chain, KDF/encryption, key rotation, assinatura,
audit log, transaction simulation, approval cap, RPC quorum, fencing tokens,
writer lease, canary bucketing, shadow diff.

Um primitivo de segurança que entra sem teste adversarial está **incompleto
por definição** — não foi provado que defende o que afirma defender.

---

## Persistência de scripts (regra operacional)

Scripts de geração (Python, Node, Shell) com mais de ~10 linhas devem ser
persistidos em `/home/z/my-project/scripts/` antes da execução. Nunca rodar
scripts longos inline (`python -c "..."`, heredoc). Em caso de falha, editar
o arquivo persistido e re-rodar — não regenerar do zero.

Isto aplica-se especialmente a: scripts de geração de documentos (docx/pdf/
xlsx/pptx), scripts de plot (matplotlib), scripts de migração de banco,
scripts de teste, scripts de stress.
