# PROMPTING_RULES.md — Uso de Contexto, Ambiguidade e Raciocínio

> **STATE: FROZEN** — Regras permanentes de cognição do agente.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

## Context Window

Sempre aproveitar o **máximo possível** da janela de contexto disponível.

- Não resumir documentação quando ela puder ser utilizada integralmente.
- Não truncar logs, schemas ou contratos relevantes.
- Em caso de dúvida entre "ler mais um arquivo" e "assumir", ler.

A janela de contexto é o ativo mais caro de uma tarefa complexa. Desperdiçá-la
resumindo precocemente é a causa mais comum de bugs de regressão.

---

## Ordem obrigatória: Contexto antes de Instrução

Fluxo obrigatório de qualquer resposta técnica:

```
Contexto  →  Restrições  →  Objetivo
```

- **Contexto** — o que foi lido, o que existe, o estado atual.
- **Restrições** — regras aplicáveis (CORE_RULES, ENGINEERING_RULES, arquivos
  FROZEN, breaking changes proibidos).
- **Objetivo** — o que será feito, com escopo mínimo, seguindo o plano.

Nunca inverter esta ordem. Responder com "Objetivo" antes de "Contexto"
induz o modelo a agir sem evidência (viola Regra 1 de `CORE_RULES.md`).

---

## Ambiguidade

Quando existir **mais de uma interpretação possível** para um prompt do
usuário, o modelo deve:

1. **Parar.** Não começar a implementar.
2. **Explicar** as interpretações possíveis, com as consequências de cada uma.
3. **Pedir confirmação** ao usuário.

**Nunca escolher arbitrariamente.** Escolher arbitrariamente viola a Regra 4
de `CORE_RULES.md` (nunca assumir requisitos / arquitetura / intenção /
comportamento sem evidência) e frequentemente resulta em rework.

### Casos típicos de ambiguidade que exigem parada

- "Ajuste o dashboard" sem especificar qual painel, qual dimensão, qual modo.
- "Otimize o signer" sem especificar latência vs. throughput vs. memória.
- "Adicione observability" sem especificar métricas vs. logs vs. traces.
- "Refatore o X" sem especificar se é para reduzir duplicação, melhorar
  performance, ou preparar para uma mudança futura.
- Toda menção a "dashboard", "chart", "report" sem indicar se o deliverable
  é um documento (PDF/DOCX/XLSX) ou uma página web interativa.

---

## Engenharia

Sempre usar **raciocínio máximo disponível** para tarefas complexas.

- Planejar antes de gerar código. O plano deve aparecer na resposta (seção
  "Plano" do `OUTPUT_RULES.md`) antes da seção "Implementação".
- Para mudanças arquiteturais, listar alternativas e justificar a escolhida
  em `DECISION_LOG.md`.
- Para primitivos de segurança, escrever o teste adversarial antes ou junto
  com a implementação — nunca depois.

---

## Nunca assumir

Nunca inferir, sem evidência explícita no código ou no prompt do usuário:

- **Requisitos** — o que o sistema deve fazer.
- **Arquitetura** — como os módulos se conectam.
- **Intenção** — o que o usuário quer alcançar.
- **Comportamento** — como uma função existente se comporta em casos extremos.

**Aplicação prática:** se uma suposição é necessária para progredir, parar,
explicitar a suposição na resposta, e pedir confirmação. Suposições
silenciosas são a causa raiz de ~80% dos bugs de regressão neste projeto.

---

## Idioma

Responder sempre no idioma do prompt do usuário. Se o usuário escreve em
Português, responder em Português. Se escreve em Inglês, em Inglês. Documentos
gerados (PDF/DOCX/XLSX/PPTX) seguem o mesmo idioma do prompt, salvo pedido
explícito em contrário.
