# TASK_TEMPLATE.md — Template Padrão de Tarefa

> Todo trabalho futuro neste projeto deve seguir este modelo. Copiar a
> seção "Template" abaixo para a resposta da tarefa e preencher cada campo.
> Este template está alinhado com `OUTPUT_RULES.md` (7 seções) e com o
> fluxo obrigatório de `ENGINEERING_RULES.md`.

---

## Template

```markdown
## Tarefa: <Título>

### Objetivo

<Uma frase declarando o que será entregue. Escopo mínimo. Sem ambiguidade.>

### Contexto

<Estado atual do projeto relevante para esta tarefa. Quais módulos existem,
quais estão FROZEN, quais decisões em DECISION_LOG.md se aplicam, qual a
fase do hardening roadmap. Referenciar arquivos lidos.>

### Arquivos envolvidos

<Lista explícita com ação (criar/editar/deletar) e motivo. Marcar com ⚠️
FROZEN qualquer arquivo FROZEN.>

- [criar/editar/deletar] `/home/z/my-project/<path>` — <motivo>
- ...

### Dependências

<Símbolos exportados que serão tocados e quem os consome. Validar via Grep.
Listar dependências diretas e indiretas relevantes.>

- `<símbolo>` é usado por: <lista de arquivos>
- ...

### Plano

<Sequência numerada de passos. Cada passo atômico e verificável. Incluir
pontos de validação intermediários.>

1. Ler <arquivo X> para confirmar estado atual.
2. Mapear dependentes de <símbolo Y> via Grep.
3. Editar <arquivo Z> adicionando <mudança>.
4. Rodar `tsc --noEmit` — espera-se 0 erros.
5. Rodar `scripts/test-<modulo>.ts` — espera-se N/N pass.
6. Atualizar `worklog.md` e (se aplicável) `PROJECT_STATE.md`,
   `DECISION_LOG.md`, `SECURITY.md`.

### Implementação

<Diffs ou blocos de código. Para mudanças grandes, fracionar por arquivo.
Persistir scripts longos em `/home/z/my-project/scripts/` antes de rodar.>

### Validação

<Resultados concretos da execução dos passos de validação.>

- `tsc --noEmit`: <passou / erros>
- `eslint`: <passou / warnings novos>
- `scripts/test-<modulo>.ts`: <N/M pass>
- Testes adversariais relevantes: <N/M pass>
- Verificação manual (se aplicável): <screenshot / curl / snapshot>

### Resultado

<Sumário do que foi entregue. Estado final do módulo. Métricas-chave
(testes passando, latência, memória, etc.).>

### Rollback

<Como reverter esta mudança se a validação falhar ou se regressão for
detectada em produção. Especificar o mecanismo concreto:>

- Mecanismo: <git revert / Edit manual para restaurar versão anterior /
  feature flag / restaurar backup de banco / etc.>
- Arquivos a reverter: <lista>
- Validação pós-rollback: <quais testes rodar para confirmar que o
  rollback restaurou o comportamento anterior>
- Janela de observação: <quanto tempo monitorar após rollback antes
  de considerar estável>

Se a mudança for trivialmente reversível (ex.: typo), afirmar
explicitamente: "Reversível via git revert do commit <hash>."

### Pendências

<Itens identificados durante a tarefa mas fora do escopo. Cada um vira
tarefa separada. Inclua "nada" se não houver.>

- <pendência 1>
- <pendência 2>
```

---

## Regras de uso

1. **Sempre começar pela leitura de contexto** (Regra 1 de `CORE_RULES.md`).
   A seção "Contexto" do template deve referenciar arquivos efetivamente
   lidos, não genéricos.

2. **Mapear dependências antes de executar** (Regra 6 de `CORE_RULES.md`).
   A seção "Dependências" deve ser preenchida via Grep, não por memória.

3. **Escopo mínimo** (Regra 7 de `CORE_RULES.md`). Se durante a execução
   surgir uma melhoria fora do escopo, registrar em "Pendências" e criar
   tarefa separada — não incorporar à tarefa atual.

4. **Validar antes de declarar completo** (Regra de fluxo de
   `ENGINEERING_RULES.md`). A seção "Validação" deve ter resultados
   concretos. Se algo falhou, a tarefa NÃO está completa.

5. **Documentar ao final** (Regra de fluxo de `ENGINEERING_RULES.md`).
   Toda tarefa concluída deve:
   - Adicionar entrada em `worklog.md` (raiz do projeto).
   - Atualizar `PROJECT_STATE.md` se o estado do projeto mudou.
   - Adicionar entrada em `DECISION_LOG.md` se houve decisão arquitetural.
   - Adicionar REG-NNN em `SECURITY.md` se houve nova regressão de segurança.

6. **Formato de 7 seções** (`OUTPUT_RULES.md`). As seções "Objetivo",
   "Contexto", "Arquivos envolvidos", "Plano", "Implementação",
   "Validação" e "Pendências" (mapeadas para as 7 seções de OUTPUT_RULES
   com "Riscos" e "Próximos passos" cobertos por "Pendências" + "Resultado")
   são obrigatórias para toda resposta técnica.
