# OUTPUT_RULES.md — Formato Obrigatório de Resposta Técnica

Toda resposta técnica deste projeto deve seguir, **sem omissões**, a estrutura
de 7 seções abaixo. A ordem é fixa.

---

## 1. Resumo da análise

Breve parágrafo (3–8 linhas) descrevendo o que foi lido, qual o estado
encontrado, e qual a conclusão técnica. Não antecipa a implementação —
apenas diagnostica.

## 2. Arquivos afetados

Lista explícita, em bullet points, dos arquivos que serão criados, editados
ou deletados. Para cada um, indicar:

- **caminho completo** (ex.: `/home/z/my-project/src/lib/chain/writer-lease.ts`)
- **ação** (criar / editar / deletar / renomear)
- **motivo** (uma frase)

Se a mudança toca arquivos `FROZEN`, marcar explicitamente com `⚠️ FROZEN`
e justificar a exceção perante a Regra 8 de `CORE_RULES.md`.

## 3. Plano

Sequência numerada de passos que serão executados. Cada passo é atomicamente
verificável. O plano deve incluir:

- Mapeamento de dependências (quem usa os símbolos tocados).
- Ordem de execução (se há paralelismo, indicar).
- Pontos de validação intermediários.

## 4. Implementação

O código ou diff propriamente dito. Para mudanças grandes, fracionar por
arquivo. Para mudanças pequenas, mostrar o bloco editado com contexto.

- Preferir `Edit`/`MultiEdit` sobre `Write` para arquivos existentes.
- Persistir scripts longos em `/home/z/my-project/scripts/` antes de rodar
  (ver `ENGINEERING_RULES.md` > Persistência de scripts).

## 5. Validação

Resultados concretos da execução dos passos de validação:

- `tsc --noEmit` — saída resumida (passou / erros).
- `eslint` — passou / warnings novos.
- Testes do módulo — `N/M pass` (liste os que falharam).
- Testes adversariais relevantes — `N/M pass`.
- Verificação manual (se aplicável) — screenshot, curl, browser snapshot.

Se algo falhou nesta seção, **não marcar a tarefa como completa**. Voltar
ao passo 4 (Implementação), corrigir, re-validar.

## 6. Riscos

Lista de riscos residuais após a mudança, com severidade (baixa/média/alta)
e mitigação. Inclui:

- Riscos de regressão (qual comportamento antigo pode ter mudado).
- Riscos de performance.
- Riscos de segurança.
- Riscos de compatibilidade (breaking changes implícitos).
- Dívidas técnicas introduzidas (se houver).

Se não houver riscos residuais, afirmar explicitamente: "Sem riscos
residuais identificados."

## 7. Próximos passos

Lista curta (1–5 itens) do que deve vir a seguir, em ordem de prioridade.
Cada item deve ser actionable — não "melhorar X" mas "escrever teste
adversarial para Y no arquivo Z".

---

## Regra suprema

> **Jamais responder apenas com código quando a tarefa envolver arquitetura.**

Toda mudança arquitetural (novo módulo, nova camada, novo padrão, novo
contrato, nova fase do hardening roadmap) deve vir acompanhada das 7 seções
acima. Responder só com código esconde o diagnóstico, o mapeamento de
dependências e os riscos — exatamente o que causa regressões.

Para mudanças triviais (typo, ajuste de constante, rename local), as seções
2, 4 e 5 podem ser condensadas, mas as seções 1, 3, 6 e 7 permanecem
obrigatórias.
