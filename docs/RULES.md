# RULES — Regras Vinculantes do Auto Trader

> **Versão:** 1.0 — 2026-09-23
> **Status:** Obrigatórias — violar qualquer regra desta página invalida o PR/execução.
> **Fonte:** `skills/auto-trade-bubble-macro-evolution.md` v1.6.0 + `DECISOES.md` + `SECURITY.md` (REGs).

---

## 1. Skill de trade como regra geral

Toda decisão de **trading, sizing e evolução** respeita a skill `auto-trade-bubble-macro-evolution` v1.6.0 (`AGENTS.md` + `skills/`). Em dúvida: **proteja capital, reduza tamanho, espere regime claro, aprenda com o log.**

### 1.1 Cinco camadas obrigatórias, nesta ordem

```
perception_layer → causal_bubble_intelligence → global_state_macro_reasoner → action_policy_engine → self_evolution_feedback_core
```

Pular ordem = inválido (`§4.1`, 10 passos + 12 itens de checklist operacional `§3`).

### 1.2 Precedência monótona de estados (`state/mode.json`)

```
crisis_lock (só humano sai) > frozen_autonomy (T_sla 30d sem resposta) > unknown_regime > lang_degraded > ok
```

Conflito de estados = vale **o mais conservador** (`§8/8b/8c`). `mode.json` é escrito pelo runtime/cron, **nunca pelo learner**.

### 1.3 Sem invalidação definível = NO_TRADE

Toda decisão precisa de `stop / invalidação / forward` explícitos (`§3` item 10). Sem isso, a única saída válida é `NO_TRADE`.

## 2. Envelope humano (write-fence)

| Arquivo | Quem escreve | SLA de review |
|---|---|---|
| `config/risk_config.json` | **Só humano** (0.5% risco default, máx 1.0% goldilocks, 0.25% crise) | T_sla 30d |
| `config/dag_edges.json` | Humano promove; learner propõe via quarentena | T_sla 30d |
| `config/edge_to_feature_map.json` | Só humano | T_sla 30d |
| `state/mode.json` | Runtime/cron apenas | — |
| `state/model_registry.json` | Challenger-loop (promote com critério) | — |

O learner (evolução autônoma) só escreve em `evolution_envelope.learner_writable_paths` (pesos `model_param_weights.json`, prompts `model_lang_prompts/**`, `dag_edges_quarantine.json`). O write-fence é garantido em `src/lib/trading/envelope.ts` — **nunca contornar**.

## 3. Arquivos frozen

- **Módulos frozen:** `H0/H1/H2/M3/M4` (vault, signer, verificação, broadcaster) e diretórios `src/lib/chain`, `src/signer`, `src/lib/audit` — mudança só com decisão humana registrada em `DECISOES.md`.
- **Check de PR:** `git diff --name-only | grep -E 'chain|signer|audit'` deve vir vazio, salvo exceção aprovada.

## 4. Regras de execução

1. **Paper-first:** live mode só libera após graduação (`src/lib/trading/graduation.ts`) — N ciclos paper lucrativos. Nunca forçar live.
2. **Ambiente Linux** (Decisão #21): signer usa Unix domain sockets. Dev/test/deploy em Linux nativo, WSL2 ou Docker. No Windows: `SIGNER_SKIP_PRE_PUSH_HOOK=1` (backup apenas, não garante correção).
3. **Pre-push gate:** `npm run test:ci` (637 checks) deve passar antes de qualquer push (REG-004).
4. **Zero segredos no repo:** gitleaks no CI; segredos só via `.env` (fora do git) ou vault (H0).
5. **External systems são advisory-only** (`src/lib/trading/external-systems.ts`): nenhum código copiado de repos copyleft/fair-code; execução real só em S14 com envelope.
6. **Kill switches sempre ativos:** `risk_config.json → kill_switches` não se desliga em código; desligar exige edição humana do config + registro.

## 5. Regras de contribuição

- Novos agentes leem `AGENT_GUIDE.md` antes de abrir Issue/PR.
- Commits seguem Conventional Commits (`commitlint.config.cjs`).
- Docs em `docs/` atualizam junto com o código que mudam (`docs/README.md` é o índice).
- Contexto de código vem do graft (`graft ask`) antes de grepping — ver `AGENTS.md`.

---

**Relacionados:** [COMPLIANCE.md](./COMPLIANCE.md) · [ITERATION.md](./ITERATION.md) · [ADR.md](./ADR.md) · [../SECURITY.md](../SECURITY.md)
