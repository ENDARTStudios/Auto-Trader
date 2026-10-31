# ROADMAP — Sistemas Externos: Como Implementar

> **Versão:** 1.0 — 2026-10-31
> **Base:** `skills/EXTERNAL_SYSTEMS_INDEX.md` (evidência 2026-09-12 + Parte 3 2026-10-31) + `src/lib/trading/external-systems.ts` (registry tipado) + skills `ext-*.md`.
> **Regra-mãe (vinculante, AGENTS.md):** advisory-only — nenhum sistema externo decide, dimensiona ou executa. `P`/EV são sempre de `M_param`. Copyleft/fair-code/unverified = **SPEC-ONLY** (zero código copiado). Execução real só em S14 com envelope.

---

## 0. Estado real (o que já está absorvido — não refazer)

| Sistema | Status atual | Evidência no repo |
|---|---|---|
| **TradingAgents (Tauric)** | **WIRED Fases 1–4** (Apache-2.0) | `tradingagents-adapter.ts` — prosa do grafo TA → `TAAnalystReport[]` → conviction rebaixada (nunca P) + timeout + kill de integração §4.4d |
| **CCXT** | **DEPENDENCY viva** (MIT) — instalada `^4.5.64` | `package.json:83`; wired no `src/lib/chain/live-trader.ts` (execução, frozen S14-gated) |
| Backtrader | SPEC-ONLY | `skills/ext-backtrader.md` — Cerebro/analyzers/sizers/anti-look-ahead |
| Freqtrade | SPEC-ONLY | `skills/ext-freqtrade.md` — protections/hyperopt/FreqAI |
| Nautilus Agents | SPEC-ONLY | `skills/ext-nautilus-agents.md` — fronteira de autoridade (já virou doutrina §0/§8c) |
| VectorBT | SPEC-ONLY | `skills/ext-vectorbt.md` — varredura vetorizada/walk-forward |
| Lumibot | SPEC-ONLY | `skills/ext-lumibot.md` — precedente híbrido read-only + gates |
| Hummingbot | SPEC-ONLY | `skills/ext-hummingbot.md` — taxonomia de execução/triple-barrier |
| FinRL | SPEC-ONLY | `skills/ext-finrl.md` — disciplina DRL train→test→trade |
| OpenStock | SPEC-ONLY (novo, 2026-10-31) | `skills/ext-openstock.md` — referência UI/UX (AGPL, zero código) |

**Lição da evidência (Tauric, Fase B):** o TA core emite **prosa**, não JSON — por isso o adaptador tem 2 camadas (LLMExtractor + guardrails que rebaixam confidence→conviction). Esse é o padrão a replicar em qualquer integração futura: **insumo estruturado defensivo, nunca decisão**.

## Fase I — Fechar o que já está aberto (curto prazo, paper-safe)

| # | Trabalho | Sistema | Arquivos | Pronto quando |
|---|---|---|---|---|
| I.1 | Fechar TODOs do manifest B: confirmar keys do `TAGraphState` no fork real (investment/risk debate states, trader_plan, final_trade_decision) e checar se o fork expõe JSON-mode | Tauric | `tradingagents-adapter.ts:25-33` | Descriptor real injetado; extrator opcional se JSON-mode existir |
| I.2 | **CCXT na percepção** (hoje só execução): multi-exchange public OHLCV/orderbook no ETL, com `SourceHealth` + rate-limit de saída | CCXT (MIT) | `src/lib/etl/*`, `source-health.ts` | ≥2 fontes CEX além da Binance com health monitorado; kill switch `feed_stale` resiliente a 1 fonte |
| I.3 | Testes do adaptador cobrindo timeout/extractor degradado (enrichmentQuality cai → Juiz reduz convicção) | Tauric | `tests/tradingagents-adapter.test.ts` | Cenário "TA fora do ar" passa e degrada, nunca bloqueia |

**Por que I antes de tudo:** é valor já pago (dependência instalada, adaptador escrito) com risco zero — tudo paper/advisory.

## Fase II — Spec-ports de metodologia (médio prazo, um por sprint)

Cada item nasce de Issue → sprint ([TASK_BREAKING_DOWN](../03-development-process/TASK_BREAKING_DOWN.md)), gates completos, e vale como **challenger** que só entra se bater o champion ([ITERATION](../08-knowledge-management/ITERATION.md)).

### II.1 Backtrader → analyzers + sizer (backtest.ts)
- Port de **conceitos** (GPL-3.0 — zero código): `SharpeRatio`, `DrawDown`, `TradeAnalyzer`, `SQN` como analyzers rodando sobre os trades do `backtest.ts`; abstração de `Sizer` (fixed/%-risk/Kelly-capped pelo `risk_config`).
- Checklist anti-look-ahead do Cerebro aplicado ao `BacktestResult` (execução no close seguinte, sem peeking de high/low).
- **Pronto quando:** métricas novas no `BacktestResult` + teste com série sintética conhecida (valores fechados a mão).

### II.2 Freqtrade → protections + hyperopt-like (risk/challenger)
- Protections como spec: `StoplossGuard`, `CooldownPeriod`, `MaxDrawdown`, `LowProfitPairs` → mapear para kill switches/`risk-manager.ts` já existentes (verificar sobreposição; só adicionar o que falta).
- Hyperopt → já coberto pelo challenger-loop; absorver só o formato de espaço de busca (categorical/integer) se ajudar.
- **Pronto quando:** tabela de proteções freqtrade × kill_switches nossa escrita no skill, com gaps implementados.

### II.3 VectorBT → varredura vetorizada (evolução)
- Fair-code (Commons Clause): proibido revenda baseada — spec de grade paramétrica (10k configs vetorizadas) e walk-forward split portados para TS puro em `mc-posterior.ts`/`backtest.ts`.
- **Pronto quando:** grid sweep rodando sobre episodes/BacktestResult com forward OOS obrigatório (nunca in-sample).

### II.4 Day Trader Skill → disciplina de ticket risk-first (risk/backtest)
- MIT, mas spec-only por doutrina. Port de **4 conceitos**:
  1. **Ticket com exit obrigatório**: gerador (§9) rejeita tese-sem-stop+alvo pré-definidos — o `exit-planner.ts` valida antes do EXECUTE.
  2. **Gate PASS/BLOCK pré-ordem**: checklist objetivo (max-loss, perda diária, trades/sessão, R:R mínimo, capital) como subconjunto objetivo dos kill switches no `risk-manager.ts`.
  3. **Replay histórico de setup**: no `mc-posterior.ts`/`backtest.ts` — dada uma tese-snapshot, listar episódios passados similares + desfechos (forward OOS, nunca in-sample).
  4. **Sizing expresso em max-loss**: episódios (`logs/episodes.jsonl`) sempre com "max loss $X = risco/unidade Y × N".
- Domínio divergente (ações US ≠ crypto 24/7): setups ORB/flags viram padrões de tese no token-selector — não portar literal.
- **Pronto quando:** checklist PASS/BLOCK com teste dedicado + replay documentado.

### II.5 iFixAi → gate de auditoria comportamental do agente (risco/operação)
- Apache-2.0, spec-only. O Doer autônomo tem bash + merge + escrita — as inspeções B01 (limite de papel), B08 (autorização de ação destrutiva) e P01 (injeção) mapeiam 1:1 os incidentes reais do repo (T092 `.env`, `git add -A` engolindo trabalho alheio).
- Adoção: rodar o audit contra endpoint efêmero do agente/squad (paper, `test.db`, sanitizado) → nota A-F como evidência em `episodes.jsonl`; D em mínimo obrigatório = ESCALATED. Futuro: job de CI com `--min-score`.
- **Pronto quando:** 1 audit executado com relatório anexado + critério de bloqueio documentado.

### II.6 Hindsight → observations + mental models no pgvector (evolução)
- MIT, spec-only. Evolução da memória do learner sobre o stack atual (Postgres+pgvector): `Observation` (crença consolidada com **proof counts e citação de episódios, refinada — nunca sobrescrita**) e `MentalModel` (resposta de pé reescrita em background — leitura vira lookup), derivadas de `episodes.jsonl` (que permanece append-only).
- Recall 4-vias (semântica/BM25/grafo/temporal + RRF) sobre o RAG existente — converge com o skill `agent-agentmemory` (#12).
- **Pronto quando:** schema + worker de consolidação com teste dedicado; debate (§5) consumindo mental models.

### II.7 Paperclip → execution locks + budget por tarefa (operação)
- MIT, spec-only. Para as sessões paralelas do Doer: **lock atômico por tarefa** (issue assignee = lock — elimina a colisão T085/T093 na origem), **hard stop de custo** por tarefa (`BUDGET_OVERFLOW` com enforcement real), template de aprovação formal (governança) em `PENDENCIAS_OPERADOR.md`.
- **Pronto quando:** AGENT_GUIDE documentar o lock + 1 tarefa executada sob lock sem colisão.
### II.8 FinRL → disciplina DRL (evolução, linha de pesquisa)
- MIT. Port do **protocolo**, não do código: train→test→trade separado, turbulence index → `unknown_regime`, ensemble calibrado.
- Caminho realista: exportar features de `logs/episodes.jsonl` → treinar offline (Python, sandbox) → inferência via ONNX em TS como **challenger M_param** — só promove com Brier melhor que champion (§5.4).
- **Pronto quando:** experimento documentado em RESEARCH.md com resultado (provável: dados insuficientes no paper inicial — registrar e adiar, isso é resultado válido).

### II.9 Hummingbot + Nautilus → reservados a S14
- Execução real (S14-gated, frozen `live-trader.ts`/`chain/*`). Hummingbot: taxonomia de ordens/triple-barrier; Nautilus: traces versionados/shadow — a doutrina de autoridade §0/§8c JÁ foi absorvida (camada `doctrine`).
- **Não tocar antes do gate S14** (aprovado pelo Operador).

## Fase III — UI (baixa prioridade)

OpenStock (SPEC-ONLY): heatmap setorial para os 7 pilares de bolha, painel de sentimento N/R/M agregado, embed TradingView nos drawers de posição. UI não toca P/EV — pode entrar como polish de dashboard entre sprints de motor.

## O que NÃO fazer (bloqueios explícitos)

1. **Não "copiar sistemas"** — 5 dos 10 são GPL/LGPL/AGPL/fair-code (contaminação do repo proprietário); os permissiveis exceto CCXT seguem spec-only por doutrina (§0: externo não é o cérebro).
2. **Não usar ferramenta de RE/adquirir em massa** (ex.: REA/morluto): todos os 10 repos são open source — a "aquisição" correta é leitura+evidência (o que o índice já fez). REA é toolkit de engenharia reversa, papel zero aqui; usá-lo em software de terceiros viola inclusive a política do próprio REA.
3. **Não wire nada direto no envelope**: toda integração entra pelo registry (`external-systems.ts`) + skill `ext-*.md` + checklist [INTEGRATIONS](./INTEGRATIONS.md) §5 + ADR em `DECISOES.md`.
4. **Nada decide ordem/risco** — `place_order` só existe em S14 com envelope; externo produz insumo estruturado com qualidade penalizada (`enrichmentQuality`) se degradar.

## Ordem recomendada (resumo executivo)

```
I.1 (Tauric manifest) → I.2 (CCXT percepção) → I.3 (testes degradação)
  → II.1 (Backtrader analyzers) → II.2 (Freqtrade protections)
  → II.3 (VectorBT grid) → II.4 (FinRL, pesquisa) → III (OpenStock UI)
  → [S14] Hummingbot/CCXT-exec
```
