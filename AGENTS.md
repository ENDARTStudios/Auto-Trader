## Skill — Auto Trade Bubble/Macro Evolution (regra geral vinculante)

> **Skill:** `skills/auto-trade-bubble-macro-evolution.md` v1.6.0 — Motor de inteligência multi-ativos com M_param/M_lang separados, veto de coerência isolado, sizing ponto-fixo robusto, forward OOS, precedência monótona e envelope humano com SLA.
> **Status:** **ABSORVIDA COMO REGRA GERAL** — toda decisão de trading, sizing e evolução deve respeitar esta skill. `risk_config.json`, `dag_edges.json`, `edge_to_feature_map.json` e `mode.json` são **envelope humano** (SLO: review T_sla 30d). Pesos, prompts e quarentena evoluem autonomamente dentro do envelope.
> **5 camadas obrigatórias:** `perception_layer → causal_bubble_intelligence → global_state_macro_reasoner → action_policy_engine → self_evolution_feedback_core` — pular ordem = inválido (`§4.1` 10 passos). `P` sempre de `M_param` (§0.5), debate só veta condicional (§0.5b/0.5c) e modula sizing via `conviction`.
> **Teto monótono:** `crisis_lock (absorvente, só humano sai) > frozen_autonomy (T_sla 30d sem resposta) > unknown_regime > lang_degraded > ok` — conflito = mais conservador (§8/8b/8c).
> **Checklist operacional (§3 + §4.1):** `1 SNAPSHOT/TIER/ESTADO 2 REGIME+P(transição)+P-unknown+drift 3 BOLHA 7 pilares 4 SUSTENTABILIDADE 5 DEBATE+DAG+REDTEAMx2+FORWARD 6 P[M_param only]+shrinkage 7 CENÁRIOS 8 EV_REAL ponto-fixo 9 DECISÃO+sizing convergido 10 INVALIDAÇÃO+FORWARD 11 RISCO kill/cluster/corr/OTT 12 APRENDIZADO owner+taxonomia` — sem `stop/invalidação/forward` definível = `NO_TRADE`.
> **Arquivos vivos:** `config/risk_config.json` (0.5% default), `config/dag_edges.json` (vivo) / `dag_edges_quarantine.json`, `config/edge_to_feature_map.json` (0.5e), `state/mode.json` (`ok|lang_degraded|unknown_regime|crisis_lock|frozen_autonomy`), `state/model_registry.json` (`param_vNN/lang_vNN`), `logs/episodes.jsonl` (`P_Mparam` sempre), `logs/shadow_valid/coherence/rejected/forward_collection.jsonl`.
> Em dúvida: **proteja capital, reduza tamanho, espere regime claro, aprenda com o log**.
> **Sistemas externos:** 9 repos analisados por evidência em `skills/EXTERNAL_SYSTEMS_INDEX.md` (TA/backtrader/nautilus/freqtrade/ccxt/vectorbt/lumibot/hummingbot/finrl) — todos **advisory-only** (`src/lib/trading/external-systems.ts:1`); copyleft/fair-code = SPEC-ONLY sem código copiado; execução só em S14 com envelope.

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
