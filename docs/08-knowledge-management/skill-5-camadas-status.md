# Status honesto — Skill "Auto Trade Bubble/Macro Evolution" (5 camadas)

Data: 2026-11-03 · Rodada 4 · Escopo: registrar o que a skill promete × o que o
runtime realmente executa. **Não é uma reescrita da skill** — é um mapa de gaps
verificável por arquivo:linha.

> **Veredito curto: as 5 camadas da skill NÃO existem no runtime.** O que existe
> são módulos de pesquisa/evolução desconectados do `engine.ts` (nenhum é
> importado pelo loop de SCOUT→ANALYZE→EXECUTE→MONITOR→EXIT). A skill do
> `AGENTS.md` é um **envelope de processo/manual**, não um sistema executado em
> produção. Os documentos antigos que afirmam conformidade estão errados.

## 1. O que a skill promete (AGENTS.md §5 camadas)

`perception_layer → causal_bubble_intelligence → global_state_macro_reasoner →
action_policy_engine → self_evolution_feedback_core` — em ordem, com
`P` sempre de `M_param`, debate que só veta condicionalmente, teto monótono
(`crisis_lock > frozen_autonomy > unknown_regime > lang_degraded > ok`),
sizing ponto-fixo robusto, forward OOS e envelope humano com SLA.

## 2. O que existe HOJE no repositório

| Camada prometida | Módulo(s) existentes | Importado pelo engine? | Observação |
|---|---|---|---|
| 1. `perception_layer` | `src/lib/trading/perception-enrichment.ts`, `bootstrap.ts`, `tradingagents-adapter.ts`, `llm-extractor.ts` | **NÃO** | `bootstrap.ts` não tem **nenhum** importador em `src/`; `enrichPerception` só é chamado dentro do próprio bootstrap |
| 2. `causal_bubble_intelligence` | não existe | — | nenhum módulo implementa DAG causal/bubble 7 pilares |
| 3. `global_state_macro_reasoner` | não existe | — | não há reasoner de regime macro; `market-analysis.ts` é TA por token |
| 4. `action_policy_engine` | `sizing-fixed-point.ts`, `mc-posterior.ts`, `risk-manager.ts`, `diversification.ts` | `risk-manager`/`diversification` **sim**; `sizing-fixed-point`/`mc-posterior` **não** | o loop usa regras do `risk-manager`, não o sizing ponto-fixo da skill |
| 5. `self_evolution_feedback_core` | `challenger-loop.ts`, `cron-evolution.ts`, `envelope.ts`, `degraded-recovery.ts`, `factor-attribution.ts` | **NÃO** | `runWeeklyEvolution` não tem caller; `degraded-recovery` idem; `factor-attribution` só é usado em `/api/analytics/attribution` |

Evidência (grep em `src/`, 2026-11-03): `runWeeklyEvolution` = 1 ocorrência (a
própria definição); `sizing-fixed-point`/`mc-posterior`/`degraded-recovery` = 0
importadores; `loadEnvelope`/`runtimeSetMode` só são usados por
`cron-evolution.ts` (que ninguém chama). `engine.ts` importa apenas:
`scam-detector`, `token-selector`, `rising-tokens`, `price-feed`,
`goplus-scanner`, `market-analysis`, `ai-agent`, `position-surveillance`,
`exit-planner`, `platform-scanner`, `event-bus`, `performance-snapshot`,
`notifier`, `schedule`, `diversification`, `graduation`, `source-health`,
`risk-manager`, `paper-trader`, `portfolio` — **nenhum** módulo da skill.

## 3. O que o runtime REALMENTE executa (paper)

1. **SCOUT**: `token-selector` (Binance/DexScreener) + `rising-tokens`
   (CoinGecko) → `schedule.canScoutNow` + `source-health` (gate por escopo).
2. **ANALYZE**: `scam-detector` (heurísticas) → GoPlus (on-chain real) →
   `market-analysis` (Binance/GeckoTerminal OHLCV real; sem dado = erro) →
   `ai-agent` (provider real; sem chave = `AI_UNAVAILABLE`).
3. **EXECUTE/MONITOR/EXIT**: `risk-manager` → `paper-trader` →
   `portfolio` → `position-surveillance` → `exit-planner`.
4. **Live**: `live-gating` fail-closed (6 condições; `LIVE_*` ausentes) — nada
   é executado on-chain pelo engine.
5. **Evolução**: **manual/offline**. Os módulos existem e têm testes, mas não
   rodam no processo do engine; `cron-evolution`/`challenger-loop` precisariam
   de um cron/worker explícito.

## 4. O que precisaria para implementar de verdade

1. **Wire-up explícito**: `engine.ts` chamaria `bootstrap.ts` (perception) no
   início do ANALYZE e um worker/cron chamaria `runWeeklyEvolution` (evolução).
   Hoje ambos estão órfãos.
2. **Camada 2 (causal/bubble)**: não existe — implementar DAG causal +
   7 pilares + `P(transição)`/`P-unknown`/`drift` com `M_param`. É a maior
   lacuna: sem ela, `P` de entrada não pode ser "sempre de M_param".
3. **Camada 3 (macro)**: reasoner de regime global (rates, liquidez, geopolítica)
   + `global_state_macro_reasoner` — hoje só há sentimento pontual
   (`feargreed`/`trending`).
4. **Camada 4**: trocar o sizing ad-hoc por `sizing-fixed-point.ts` e usar
   `mc-posterior` no gate de EV; hoje nenhum é chamado.
5. **Camada 5**: montar cron real (Railway scheduler) chamando
   `runWeeklyEvolution` com `envelope` + `mode.json` + `logs/episodes.jsonl`;
   sem isso, "aprendizado" é só biblioteca testada.
6. **Gate de conformidade**: um teste de integração que falhe se a skill exigir
   passos que o engine não executa (ex.: assert de que o loop chama
   `enrichPerception` antes de decidir). Sem esse teste, a claim "skill
   absorvida como regra geral" continua **não verificável**.

## 5. Regra prática até lá

- Não afirmar que a skill é "executada" — ela é **regra manual de decisão** para
  o operador/agente.
- `config/risk_config.json`, `state/mode.json`, `logs/episodes.jsonl` são o
  envelope humano; o engine atual não os lê.
- O que protege capital hoje é o `risk-manager` + `live-gating` fail-closed +
  `schedule` + `source-health`, **não** as 5 camadas.
