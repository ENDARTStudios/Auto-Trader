# CHECKLIST.md — Checklist Obrigatório Pré-Implementação

> **Regra absoluta:** nenhum agente (GLM, Claude, ChatGPT, ou
> outro) deve iniciar implementação sem antes completar todos os
> itens abaixo. Pular etapas viola `CORE_RULES.md` Regra 1 e
> causa regressões. Itens marcados com `[ ]` devem ser lidos ou
> executados explicitamente; o agente deve declarar "li X" ou
> "executei Y" antes de prosseguir.

---

## Fase 1 — Leitura de contexto obrigatória

```
[ ] Ler MANIFEST.md                    (princípios do Project OS)
[ ] Ler CORE_RULES.md                  (regras absolutas)
[ ] Ler PROJECT_STATE.md               (snapshot atual + versão do Project OS)
[ ] Ler DECISION_LOG.md                (decisões vigentes — DEC-NNN)
[ ] Ler architecture/roadmap.md        (fase atual + próximos milestones)
[ ] Ler architecture/invariants.md     (garantias invioláveis — INV-NNN)
[ ] Ler architecture/frozen-files.md   (o que NÃO pode ser tocado)
[ ] Ler architecture/interfaces.md     (contratos públicos do escopo afetado)
[ ] Ler contracts/<relacionados>       (api.md, database.md, rpc.md, events.md conforme escopo)
[ ] Ler standards/<relacionados>       (coding-style, testing, security, etc.)
[ ] Ler ENGINEERING_RULES.md           (fluxo: Ler → Mapear → Planejar → Executar → Validar → Documentar)
[ ] Ler worklog.md (entradas recentes) (o que foi feito nas últimas tarefas)
```

> **Dica de eficiência:** se a tarefa é bem-escopada (ex.: alterar
> um componente de UI), os arquivos `architecture/` e `contracts/`
> podem ser apenas **skimmados** — mas não pulados. Para mudanças
> em `src/lib/chain/` ou `src/signer/`, leitura completa é
> obrigatória.

---

## Fase 2 — Mapeamento de impacto

```
[ ] Identificar arquivos diretamente afetados (lista explícita)
[ ] Para cada arquivo, marcar se é FROZEN (ver frozen-files.md)
[ ] Grep pelos símbolos exportados que serão tocados
[ ] Listar todos os dependentes diretos e indiretos relevantes
[ ] Verificar se algum dependente é FROZEN (exige ADR)
[ ] Verificar compatibilidade de contratos (api/database/rpc/events)
[ ] Identificar invariantes (INV-NNN) que podem ser tocados
[ ] Identificar decisões (DEC-NNN, ADR-NNNN) que se aplicam
```

---

## Fase 3 — Planejamento

```
[ ] Declarar objetivo em uma frase (escopo mínimo, sem ambiguidade)
[ ] Listar arquivos a criar/editar/deletar com motivo
[ ] Listar dependências e blast radius
[ ] Especificar impacto (contratos, performance, segurança, compat)
[ ] Especificar risco (severidade + probabilidade)
[ ] Especificar como validar (testes, build, lint, validação manual)
[ ] Especificar Rollback (mecanismo concreto: git revert / edit / feature flag / backup)
[ ] Especificar testes adversariais REG-NNN a adicionar (se crypto/segurança)
[ ] Identificar aprendizados a registrar (KP-NNN, DEC-NNN, ou ADR-NNNN)
```

Sem estes itens, a tarefa NÃO está pronta para execução (ver
`TASK_TEMPLATE.md`).

---

## Fase 4 — Implementação

```
[ ] Persistir scripts longos em /home/z/my-project/scripts/ antes de rodar
[ ] Executar seguindo o plano (sem invenções fora do escopo)
[ ] Não adicionar dependências sem necessidade (ver ENGINEERING_RULES > Restrições)
[ ] Não refatorar fora do escopo (Registrar em "Pendências" e criar tarefa separada)
[ ] Preservar contratos públicos (Regra 9 CORE_RULES.md)
[ ] Preservar cause em erros wrappados (INV-004)
[ ] Prefixar erros de subsistema (DEC-005: BROADCAST_SIGNER_*)
[ ] Não tocar arquivos FROZEN sem ADR (INV-003)
```

---

## Fase 5 — Validação

```
[ ] npm run typecheck (tsc --noEmit) — 0 erros
[ ] npm run lint (eslint) — 0 novos warnings
[ ] npm run build — sucesso
[ ] Rodar scripts/test-<modulo>.ts relevantes — N/N pass
[ ] Rodar testes adversariais relevantes (SECURITY.md REG-NNN)
[ ] Confirmar que nenhum dependente listado na Fase 2 quebrou
[ ] Verificação manual (curl / screenshot / snapshot) se aplicável
[ ] Validar que invariantes INV-NNN continuam verdadeiros
```

Se qualquer item falhou, a tarefa NÃO está completa.

---

## Fase 6 — Documentação pós-implementação

```
[ ] Atualizar worklog.md (raiz do projeto) com Task ID, Work Log, Stage Summary
[ ] Atualizar PROJECT_STATE.md se o estado mudou (nova fase, novo FROZEN, etc.)
[ ] Adicionar DEC-NNN em DECISION_LOG.md se houve decisão arquitetural
[ ] Criar ADR-NNNN em decisions/ se a decisão é estrutural (ver MANIFEST.md)
[ ] Adicionar REG-NNN em SECURITY.md se houve nova regressão de segurança
[ ] Adicionar KP-NNN em memory/known-problems.md se houve bug operacional
[ ] Adicionar TD-NNN em memory/technical-debt.md se ficou débito
[ ] Adicionar entrada em memory/implementation-history.md se estado mudou
[ ] Atualizar architecture/interfaces.md se contrato público mudou
[ ] Atualizar contracts/<relacionados>.md se contrato de integração mudou
[ ] Atualizar architecture/frozen-files.md se novo arquivo foi congelado
[ ] Atualizar architecture/roadmap.md se fase foi concluída
[ ] Atualizar INDEX.md e README.md se estrutura de .ai/ mudou
[ ] Bumpar versão do Project OS em PROJECT_STATE.md se estrutura mudou (com novo ADR)
```

---

## Fase 7 — Cross-links (regra de consistência)

```
[ ] Verificar que todo novo documento referencia IDs relacionados
    (INV-NNN, ADR-NNNN, DEC-NNN, TD-NNN, KP-NNN, STD-NNN, REG-NNN)
[ ] Verificar que documentos relacionados referenciam o novo documento
    (ex.: novo INV deve ser citado em interfaces.md, invariants.md, ADRs)
[ ] Verificar que nenhum ID foi reusado
[ ] Verificar que IDs supercedados mantêm nota "Supercedado por <novo-ID>"
```

---

## Atalho para tarefas triviais

Para mudanças triviais (typo, comment fix, atualização de versão
em package.json), as Fases 1-3 podem ser reduzidas a:

```
[ ] Ler MANIFEST.md
[ ] Ler PROJECT_STATE.md
[ ] Confirmar que nenhum FROZEN é tocado
[ ] Confirmar que nenhum contrato público muda
```

Mas Fases 5 (Validação) e 6 (Documentação — pelo menos worklog.md)
continuam obrigatórias.

---

## Referências

- `MANIFEST.md` — princípios do Project OS.
- `CORE_RULES.md` — 11 regras absolutas.
- `ENGINEERING_RULES.md` — fluxo detalhado.
- `TASK_TEMPLATE.md` — template para toda tarefa.
- `OUTPUT_RULES.md` — formato de 7 seções para respostas técnicas.
- `INDEX.md` — índice completo com IDs.
