# ITERATION — Ciclo de Iteração e Evolução

> **Versão:** 1.0 — 2026-09-23
> **Fonte:** skill v1.6.0 (`self_evolution_feedback_core`, §5/§12) + `SPRINT.md` (iteração de produto).

---

## 1. Dois relógios de iteração

### A. Evolução do modelo (autônoma dentro do envelope)

```
episódio (logs/episodes.jsonl)
  → aprendizado taxonomizado (owner + causa: percepção|causal|macro|policy|feedback)
  → proposta: pesos em state/model_param_weights.json OU prompt em model_lang_prompts/**
              OU edge novo em dag_edges_quarantine.json
  → challenger avaliado com forward OOS (nunca in-sample)
  → promote via state/model_registry.json (challenger → champion) se Brier/métrica melhor
```

**Limites:** nunca escreve em `risk_config.json`/`mode.json`/`dag_edges.json` (write-fence `envelope.ts`); `crisis_lock` congela evolução (só humano sai); miscalibração dispara `model_miscalibration_switch` e o ciclo vira revisão humana.

### B. Iteração de produto (humano+agente)

```
aprendizado/bug/ideia → Issue ([TASKS.md])
  → sprint quebrada ([TASK_BREAKING_DOWN.md])
  → PR + CI + review ([DEVELOPMENT.md], [CODE_REVIEW.md])
  → registro: SPRINT.md + DECISOES.md + CHANGELOG
```

## 2. Loop semanal (ritmo mínimo)

1. **Segunda — replay:** revisar episódios da semana (`episodes.jsonl`); classificar falhas.
2. **Meio — proposals:** learner/humano propõe mudanças (quarentena ou issue).
3. **Pré-merge — forward:** toda proposta de modelo/edge só sobe com validação forward OOS.
4. **Sexta — retrospective curta:** o que o log ensinou? Atualiza [TASKS.md](./TASKS.md)/[RESEARCH.md](./RESEARCH.md).

## 3. Loop de 30 dias (envelope humano — SLO T_sla)

1. Review de `dag_edges_quarantine.json` → promote (vira `dag_edges.json`) ou rejeição registrada.
2. Review de `risk_config.json` — limites ainda corretos para o regime?
3. Review do `model_registry.json` — champion ainda bate challenger?
4. Saída de `frozen_autonomy` só com resposta humana ([RULES.md](./RULES.md) §1.2).

## 4. Regras anti-corrupção do ciclo

- **Nada de overfitting discreto:** métrica de promote é sempre forward, com shrinkage aplicado em P.
- **Rejeição é resultado:** edge/modelo rejeitado fica em `rejected.jsonl` com taxonomia — o sistema aprende o que NÃO usar.
- **Docs iteram junto:** mudança de comportamento → doc atualizado no mesmo PR.
- **Uma variável por iteração:** mudou P, sizing e prompt ao mesmo tempo = impossível atribuir causa.

## 5. Métricas da própria iteração

- Episódios/semana com aprendizado registrado (% de cobertura da taxonomia).
- Tempo médio quarentena→decisão (meta: ≤ T_sla 30d).
- Challenger promote rate (saudável: baixo — promote é exceção, não rotina).

---

**Relacionados:** [MEMORY.md](./MEMORY.md) · [RULES.md](./RULES.md) · [ANALYTICS.md](./ANALYTICS.md) · [../skills/auto-trade-bubble-macro-evolution.md](../skills/auto-trade-bubble-macro-evolution.md)
