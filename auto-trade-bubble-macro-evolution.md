---
name: auto-trade-bubble-macro-evolution
description: Motor de inteligência para Auto Trade multi-ativos com M_param-only sem viés de seleção, debate condicional por regime com veto de coerência isolado, sizing ponto-fixo robusto, forward OOS com cura completa (modelo + vocabulário), integridade de feed como emergência, precedência monótona e envelope humano com SLA.
version: 1.6.0
type: agent-skill
language: pt-BR
requires:
  - price-feed-api
  - macro-data-feed
  - sentiment-feed (opcional)
  - execution-broker-api (opcional, para modo autônomo)
  - vector-store / time-series-db
license-note: Uso educacional e institucional. Não é recomendação de investimento. Exige gestão de risco, kill-switch e conformidade regulatória.
---

# Auto Trade – Bubble / Macro Intelligence Engine

> ⚠️ **Nota responsável:** mercados são sistemas adaptativos complexos. Esta skill **não promete previsão determinística 100% precisa, nem elimina risco**. Ela opera por **probabilidades calibradas, regimes de mercado, erro controlado e limites rígidos de risco**. Exige `risk-limits`, `kill-switches automáticos` e `conformidade regulatória` (CVM / SEC / MiFID conforme jurisdição). Em caso de incerteza alta, a ação padrão é **NÃO OPERAR / REDUZIR**.

## [skill] nome
`auto-trade-bubble-macro-evolution`

## [objetivo] missão
Operar, ou gerar recomendações para operação, em múltiplas classes de ativos usando uma inteligência que combina:

- histórico de bolhas passadas e presentes
- análise macroeconômica global e local
- identificação de sinais do mercado especulativo
- lógica de política monetária e fiscal
- análise estrutural, política, social e cultural
- inferência causal, não apenas estatística superficial
- gestão adaptativa de risco
- auto-aprendizagem, auto-crítica e evolução **autônoma dentro de envelope humano explícito** (risk-limits, vocabulário DAG vivo e cauda de cenários são humanos; pesos, calibração e quarentena evoluem sozinhos — ver princípio 0/0.5 e 5.13)

**Saída padrão:** decisão estruturada em JSON com `ação, probabilidade, regime, tese causal, invalidação, sizing, stop, take, holding esperado, risco e confiança calibrada`.

**Modos de operação:**
1. `advisory` (default): só recomenda, não executa.
2. `semi-auto`: executa com aprovação humana se risco > limiar.
3. `full-auto`: executa via broker API somente se todos os kill-switches = `pass` e `regime != caos/illiquid`.

---

## [principais-classes] domínios suportados
- Ações (individual, setorial e broad market)
- Câmbio e pares de moedas
- Renda fixa e yields governamentais / soberanos
- Commodities e energia
- Mercado imobiliário, FIIs/REITs, construção
- Criptoativos e tokens especulativos
- Startups / tech / narrativa de futuro tecnológico
- Hedge e risco político / geopolítico
- ETFs temáticos e alavancados

## [premissa-base] modelo do mundo

1. **Mercados não movem-se apenas por preço e volume.**
   Movem-se por expectativa, liquidez, poder, psicologia coletiva, estruturas de capital, governos, instituições, cultura e incentivos de agentes dominantes.

2. **Toda bolha tem lógica interna antecipável com boa estrutura.**
   Receita típica:
   - narrativa poderosa + novo paradigma
   - excesso de liquidez
   - alavancagem sistêmica
   - validação de mídia e influência social
   - entrada progressiva de novatos no fim do ciclo
   - descolamento entre valor econômico real e ativo financeiro negociado

3. **Crises setoriais frequentemente começam no extremo mais especulativo.**
   Cripto, small-caps, tech narrativa, real estate alavancado, crédito high-yield / emergentes são ponteiros precoces.

4. **Nem todo descolamento é irracionalidade.**
   Salto de preço pode ser correto se muda estrutura de lucro futuro de forma permanente. A skill não detecta só "está alto", testa se a alta é **sustentável e justificável**.

5. **Ativos não existem sozinhos.**
   Todo ativo vive num grafo causal:
   `câmbio → juros → liquidez global → custo de capital → valuation → fluxo de capital → risco político → preço`

6. **Previsão sem erro controlado é perigosa.**
   Portanto o motor deve: produzir probabilidades, reconhecer regimes, monitorar erro próprio, aplicar autocensura lógica, recalibrar com evidência nova.

---

## [princípio 0] dois modelos, dois loops [v1.2 - anti-confusão, v1.3 com degradação 5.13]
O sistema contém **DOIS modelos independentes**, com evolução separada. Nunca fundir:

- **M_param (estatístico):** `P(up/down/flat)`, EV, Kelly fracionário, sizing, Brier/ECE, Sharpe, MaxDD. Validação: walk-forward purged + Monte Carlo 10k calibrado (5.4b) + Brier real. Mutação: pesos/thresholds ±5-10%.
- **M_lang (linguístico):** `causal_thesis`, debate Bull/Bear, mapeamento DAG, red-team. Validação primária: **forward falsification out-of-sample (5.12)**, não red-team. Mutação: prompts, instruções de debate, exemplos few-shot — nunca "pesos numéricos".

**Regra de interseção com degradação graciosa (v1.3):** decisão DEEP plena só opera se **M_param dá EV_real>0 E M_lang produz tese DAG-válida E red-team não refuta**. Mas **não é trava absoluta** — ver 5.13 `lang_degraded`: se M_lang instável >T_lang dias, M_param pode evoluir/operar sozinho em FAST sizing -50%, DEEP alavancado proibido. Cada um tem `champion/challenger` próprio (`model_param_vNN`, `model_lang_vNN`).

Monte Carlo valida números, não valida causalidade. Red-team filtra plausibilidade, não julga verdade (5.12).

## [princípio 0.5] hierarquia de probabilidade [v1.3 anti-ambiguidade, v1.4 condicional 0.5b]
- **TODA probabilidade numérica vem EXCLUSIVAMENTE de M_param (passo 5, calibrado por 5.9/5.9b sobre todo ciclo, inclusive NO_TRADE).**
- Debate (4.5) **NÃO produz prob final**. Produz apenas: direção proposta, `conviction (0-1)`, tese DAG, `forward_prediction` (5.12/5.12c).
- EV (passo 6) usa `P(win)` do M_param com ponto-fixo pós-impacto (4.7b). Debate entra só em: (a) **VETO condicional** (0.5b) e (b) **SIZING** via conviction.
- `bull/bear conviction` são auxiliares diagnósticos, nunca input do EV.
- Regra: números calibráveis num lugar só; narrativa modula risco, nunca o EV.

## [princípio 0.5b] prob_disagreement_conditional [v1.4 anti-matar-assimetria, v1.5 drift-aware 0.5c]
- `prob_disagreement = |P_debate_aux - P_Mparam| >25pp` **só veta DEEP se regime estável** ∈ `{goldilocks, disinflation-bull, reflation, stagflation}` **E `drift_flag(M_param)=false`**.
- Se regime em transição/unknown/pivot OU `P(transição)>0.4` OU `drift_flag=true` (PSI>0.2 ou erro condicional subindo): divergência **NÃO veta** → (a) `conviction/=2`, (b) `time_stop`/`forward_deadline` -50%, (c) só não-alavancado, (d) `divergence_as_signal=true` + `M_param_lagging` se forward do debate alto (0.5d).
- Racional: divergência em virada/drift = um modelo captando o novo (informação); em estável sem drift = incerteza real (veta).

## [princípio 0.5c] drift_aware_veto [v1.5]
Em estável, veto por divergência assume M_param certo. Se `drift_flag` ativo, debate pode estar captando o presente. Ver 0.5b: com drift, não veta; reduz e marca `M_param_lagging`.

## [princípio 0.5d] divergence_feedback_to_param [v1.5 anti-métrica-morta, guarda 0.5e v1.6]
- Se `divergence_as_signal` alto + `forward_hit(debate)` alto por n_min → `M_param_lagging=true`.
- `challenger_param` prioriza features que o debate usa **somente via `edge_to_feature_map.json` (0.5e)**. Sem mapa = no-op declarado.

## [princípio 0.5e] edge_to_feature_map [v1.6 - anti-re-weighting-cego]
- 0.5d só opera se `edge_to_feature_map.json` (humano/envelope) mapeia aresta DAG → features M_param.
- Sem mapa para a aresta → no-op declarado, nunca re-weight cego.

---

# 1) ARQUITETURA OPERACIONAL — 5 CAMADAS

## [camada 1] perception_layer
**Responsabilidade:** coleta bruta e normalização de sinais.

### funções
- ingestão de dados estruturados (OHLCV, book, funding, OI, yields, DXY, VIX, crédito) e não-estruturados (notícias, atas BC, discursos, leis, earnings calls)
- monitoramento de preço, volume, funding rates, open interest, liquidações, liquidez bid/ask, slippage
- leitura de news feed, política monetária/fiscal, legislação
- captação de sentimento: temas, buscas, mídia social, influenciadores, Google Trends, app rankings, inflows ETF
- normalização temporal/fuso entre mercados 24/7 x 24/5
- criação de embeddings + séries históricas para ML
- detecção de anomalia de dado (feed quebrado, split, dividendo, halt)

### fontes ideais
- API preços + book L2/L3
- funding rates (perps / futuros / crédito / liquidações)
- yield curves soberanas (US, EU, BR, JP), breakeven inflation, CDS soberano
- fluxo ETF / mutual funds / buyback / insider
- DREs, guidance, margem, FCF, diluição
- BCs / CPI / PPI / payroll / câmbio / reservas / balança
- índices imobiliários, preço/m², crédito imobiliário, vacancy, launches
- menções temáticas + narrativa tracking

### saída
`MarketSnapshot { timestamp, assets[], macro_context, liquidity_state, sentiment_vector, data_quality_score }`
Se `data_quality_score < 0.6` → abortar decisão, marcar `stale_data`.

---

## [camada 2] causal_bubble_intelligence
**Responsabilidade:** dizer *em que fase da bolha estamos e por quê*, não só se subiu muito.

### 2.1 Bubble Phase Model (8 fases)
`1.stealth → 2.awareness → 3.mania → 4.blowoff → 5.distribution → 6.bull-trap → 7.panic → 8.capitulation/desalavancagem → (novo stealth)`

Mapear cada ativo para fase com evidências.

### 2.2 Score de Bolha — 7 pilares (0-100 cada)
1. **Narrative Power (N):** ubiquidade da tese "desta vez é diferente", capa de revista, celebridades, políticos falando.
2. **Liquidity Excess (L):** M2, Fed/ECB/BoJ balance, juros reais negativos, impulso de crédito.
3. **Leverage (A):** margin debt, OI/funding anormal, call skew, alavancagem imobiliária, z-score de crédito.
4. **Valuation Disconnect (V):** P/E, P/S, EV/EBITDA, capEx/receita, yield imobiliário vs CDI/Treasury, MVRV/NVT em cripto, DCF reverso: que crescimento está precificado?
5. **Retail Inflow Late (R):** novos CPFs/CNPJs, buscas, downloads corretora, "como comprar X", IPO/SPAC/meme volume.
6. **Reflexivity / Media Feedback (M):** preço alto → notícia positiva → mais compra. Medir Granger / lead-lag notícia-preço.
7. **Concentration / Fragility (F):** breadth (quantos ativos seguram índice), HHI, crowding hedge funds, basis trade, gaps de liquidez.

`BubbleRisk = 0.2*V + 0.2*A + 0.15*L + 0.15*R + 0.1*N + 0.1*M + 0.1*F`

- `0-25:` saudável
- `25-50:` aquecido
- `50-70:` bolha em formação — reduzir alavancagem, exigir invalidação curta
- `70-85:` blowoff/distribution — só short tático / hedge / cash, nada de long alavancado
- `>85:` fragilidade extrema — modo `capital-preservation`, kill-switch parcial

### 2.3 Teste de sustentabilidade (anti-falso-positivo)
Toda alta com `BubbleRisk > 50` deve passar no teste:
- Lucro incremental cobre custo de capital (ROIC > WACC)?
- Margem / FCF acompanha preço (últimos 2 trimestres)?
- Há mudança estrutural permanente (regulação, tecnologia, monopólio) ou só múltiplo expandindo?
- Se só múltiplo: classificar como `multiple-expansion-fragile`, não como `earnings-compounding`.

### 2.4 Biblioteca de bolhas
Comparar vetor atual com embeddings históricos: `1929, 1989 JP, 2000 dotcom, 2008 subprime, 2015 China, 2017/2021 crypto, 2020-21 SPAC/meme, 2021-22 tech durational, bolhas imobiliárias locais`.
Saída: `top_3_analogues { bolha, similaridade, o_que_aconteceu_depois, lead_time_medio_ate_topo }`.

### 2.5 strict_causal_dag_validation [v1.1 - anti-alucinação]
**Responsabilidade:** Evitar alucinação causal do LLM. Proibir causas livres.

Toda `causal_thesis` deve ser decomposta em nós e arestas de um DAG pré-definido. Se não mapear, retorna `ERROR: INVALID_CAUSAL_LOGIC` e força reescrita.

**Vocabulário válido de nós (extensível via config, não via improviso):**
`Rate_Hike | Rate_Cut | WACC_Up | WACC_Down | Valuation_Down | Valuation_Up | Liquidity_Drain | Liquidity_Flood | Fiscal_Expansion | Inflation_Up | Central_Bank_Hawkish | Central_Bank_Dovish | Crypto_Correlation_100% | Crypto_Down | Retail_FOMO | Options_Call_Buying | Gamma_Squeeze | Price_Up | Price_Down | Credit_Spread_Widen | RiskOff_Flow | DXY_Up | Yields_Up | Earnings_Up | Margin_Compression`

**Exemplos de arestas válidas:**
- `Rate_Hike -> WACC_Up -> Valuation_Down`
- `Fiscal_Expansion -> Inflation_Up -> Central_Bank_Hawkish`
- `Liquidity_Drain -> Crypto_Correlation_100% -> Crypto_Down`
- `Retail_FOMO -> Options_Call_Buying -> Gamma_Squeeze -> Price_Up`
- `Credit_Spread_Widen -> RiskOff_Flow -> Price_Down`
- `DXY_Up + Yields_Up -> Valuation_Down`

**Regra de validação:**
1. Cada bullet da tese deve citar `nós [A -> B -> C]`.
2. Aresta fora do `dag_edges.json` = tese inválida.
3. Correlação sem mecanismo (`BTC subiu junto com Nasdaq, logo causa`) = inválida. Exigir `mecanismo + lead-lag + base-rate`.
4. Logar `dag_validation: {pass, failed_edges, rewrite_attempts}` no episódio.

### 2.6 dag_evolution_and_obsolescence [v1.2 - DAG vivo]
**Problema que resolve:** DAG fixo vira mapa antigo em território novo e trava em `ERROR` loop.

- Novas arestas propostas pelo agente entram em `dag_edges_quarantine.json`, **nunca** direto no DAG vivo.
- Promoção quarantine → vivo só se em N casos reais: mecanismo plausível + lead-lag (Granger p<0.05) + base-rate >0.6 + red-team não refuta + forward_hit (5.12) não piora.
- Meta-métrica: `dag_fail_rate = reescritas / teses (30d)`. Se `>0.30` → `DAG_OBSOLESCENCE_WARNING` → modo conservador, **PROÍBE long alavancado** até humano revisar vocabulário.
- Correlação sem mecanismo continua inválida. Quarentena não afrouxa isso, só permite aprender mapa novo com freio.

### 2.7 causal_hypothesis_generator [v1.3 - anti-quarentena-lixo]
Arestas candidatas à quarentena **não vêm do improviso do LLM**.
- Gerador primário: descoberta causal nos dados (PC algorithm / Granger em pares / lead-lag + base-rate) → candidata aresta com evidência estatística.
- LLM só **NOMEIA** o mecanismo plausível para a aresta detectada. Sem evidência estatística, não entra na quarentena.
- Separa "descobrir correlação causal" (dados) de "explicar mecanismo" (linguagem). Evita quarentena cheia de alucinação.

---

## [camada 3] global_state_macro_reasoner
**Responsabilidade:** conectar moeda, política e cultura global ao preço local.

### variáveis-mestre
- **Liquidez global:** Fed funds, QT/QE, TGA, reverse repo, BoJ YCC, ECB, PBoC, dólar (DXY), financial conditions index.
- **Juros reais e curva:** 10Y-2Y, terminal rate precificado, r* estimado, crédito IG/HY spread.
- **Fiscal:** déficit/PIB, impulso fiscal, eleição, subsídio setorial, tarifa, controle de capital.
- **Geopolítica:** guerra, sanção, cadeia de suprimento, energia, semicondutores, Taiwan, OPEP+.
- **Cultura local:** BR: Selic, IPCA, fiscal, câmbio, fluxo gringo B3, crédito bancário. US: tech dominance. Ásia: property + export.
- **Intermarket checks:** `DXY up + yields up + HY spread up = risk-off`. `BTC + ARKK + meme liderando queda = early warning`. `Cobre/ouro, petróleo, frete, semicondutores = ciclo real`.

### grafo causal mínimo (obrigatório citar na tese)
```
[BC juros/liquidez] → [juros reais] → [custo capital/WACC] → [valuation justo]
→ [apetite risco/fluxo] → [posicionamento/alavancagem] → [preço]
↑________[fiscal/geopolítica/câmbio/sentimento]___________|
```

### regime detector (sempre classificar um)
`goldilocks | reflation | stagflation | disinflation-bull | recession-fear | crisis-liquidity | policy-pivot | war-risk-premium | bubble-blowoff | post-bubble-deleverage | range-illiquid`

Regra: parâmetros de trade mudam por regime. Ex: em `crisis-liquidity` e `range-illiquid`, `max_leverage = 0`, `max_risk_per_trade = 0.25%`.

### 3.5 leading_regime_transition [v1.1 - anti-lag]
**Responsabilidade:** Detectar mudança de regime ANTES da queda. Não esperar VIX subir.

Calcular a cada ciclo `P(transição em 5-20d)` a partir de divergências líderes, não de preço atrasado:

- `Divergence_Crypto_Equity`: BTC/ETH caem 10d enquanto Nasdaq faz topo = liquidez global secando → `P(recession-fear) ↑`
- `Credit_Spread_Anomaly`: HY spread abre +50bps com SPX no topo = `distribution` / `recession-fear`
- `Liquidity_Absorption`: volume >2x média mas preço não avança / pavio superior longo repetido = `blowoff` iminente
- `Breadth_Deterioration`: índice no topo com <30% ações acima MM50 + HHI alto = fragilidade
- `Basis_Funding_Stress`: funding persistentemente alto + OI recorde + long skew = squeeze-then-dump

**Regra:**
- Se `P(transição para crisis/recession/bubble-blowoff) > 0.4` → corta sizing 50%, proíbe add, aperta time-stop.
- Se `> 0.65` → trata como se já estivesse no novo regime (pré-posiciona hedge/CASH).
- Saída: `regime_transition { from, to_most_likely, prob_20d, triggers[] }`.

### 3.6 context_passing_to_debate [v1.2 - anti-inconsistência]
O debate (4.5) **DEVE** receber como input obrigatório:
`{regime, P(transicao_20d), bubble_phase, bubble_risk, data_quality}`.
Bull e Bear formam tese **CONDICIONADA** a esse estado (direção + conviction, não prob final — ver 0.5). Juiz veta por transição com conhecimento de causa. Sem esse contexto, o debate é inválido e deve retornar `ERROR: MISSING_REGIME_CONTEXT`.

### 3.7 unknown_regime_guard [v1.3 - recusar é operar]
- Se confiança do regime detector <0.5 OU distância para todos os 11 regimes > limiar → `unknown_regime`.
- `unknown_regime` → default `CASH` + check `DAG_OBSOLESCENCE` + só FAST permitido, DEEP proibido.
- Classificar à força regime novo em velho = erro mais caro possível.

### 3.8 transition_to_unknown [v1.5, redação v1.6]
- Calcular `P(transição para fora do espaço conhecido)` = distância de features ao cluster de regime **mais próximo**; se > limiar → fora do espaço conhecido.
- Se >0.4 → pré-`unknown_regime`: encurta time_stop/forward, só não-alavancado, mesmo com confiança >0.5.

---

## [camada 4] action_policy_engine
**Responsabilidade:** transformar inteligência em ação executável com risco limitado.

### 4.1 Pipeline de decisão (ordem fixa, pular = inválido) [v1.5 com coleta em degraded]
0. `load_state (8/8b)` → precedência `crisis_lock(absorvente) > unknown > frozen > lang_degraded > ok`. `crisis/frozen` = CASH + FAST only. `crisis_lock` só sai via humano, não escala para frozen.
1. `validate_data` → se dado ruim, `HOLD_CASH + alert`.
2. `detect_regime + leading (3.5) + unknown (3.7) + P-unknown (3.8)` → tabela + P(transição conhecida e desconhecida) + confiança + drift_flag. Vai para debate.
3. `score_bubble (2.2-2.4)` → fase + BubbleRisk + análogos.
4. `debate + dag + redteamx2 (4.5 + 2.5 + 5.8)` → direção + conviction + tese + forward (5.12c). Em `lang_degraded`, debate roda em **modo coleta 5.13b** (gera forward sem posição). Divergência aplica 0.5b/0.5c/0.5d.
5. `forecast [M_param ONLY + 5.9b/5.5b]` → única P + shrinkage. **Emite/loga P_Mparam sempre** (decision_source + lang_filter). Em crise/war: **mede sempre, não aplica pesos** (5.5b).
6. `EV + sizing ponto-fixo robusto (4.7b/4.7c)` → itera com `EV_real = EV - slippage - fees_prop - fees_fix/size`. Oscilação → menor do ciclo; abaixo floor → `NO_TRADE cost_floor`.
7. `risk + cluster + regime_corr + teto estado (8)` → lang_degraded -50%, crisis colapsa cluster.
8. `invalidation + forward` → stop/take/time-stop + forward direcional ou de risco.
9. `pre-trade veto + taxonomy + compliance + semiauto (5.7b/6.9/4.4c)` → veto EV = shadow_valid; veto causal = rejected. FAST OTT breach → advisory (4.6b).

### 4.2 Ações permitidas
`LONG_SPOT | SHORT | LONG_PROTECTIVE | HEDGE_MACRO | CASH | ADD | TRIM | SCALE_IN | SCALE_OUT | NO_TRADE`
Proibido por default: `martingale, averaging-down sem nova tese, alavancagem > limite regime, naked short ilíquido, hold earnings/binárias sem hedge, overtrade > max_trades_dia`.

### 4.3 Sizing e limites padrão (conservadores, ajustáveis em config)
- risco por trade: `0.5%` equity (max `1%` em goldilocks, min `0.25%` em crise)
- exposição líquida max: `60%` (bull) / `20%` (bolha >70) / `0%` (crise)
- gross max: `150%` / alavancagem max por regime
- max drawdown dia: `-2%` → halt dia. semana `-5%` → halt semana. mês `-8%` → `full-cash + freeze + review`.
- concentração: max `15%` por ativo, max `30%` por **cluster de tese** (ver 4.8, não por ticker)
- correlação base: se correlação 30d > 0.8 entre posições, somar risco como uma só (só vale fora de crise — ver 4.3b)

### 4.3b regime_aware_correlation [v1.3 - anti-diversificação-falsa-em-crise]
- Em `crisis-liquidity / recession-fear`: correlação efetiva forçada = **1** para ativos do mesmo lado de liquidez (tudo vira "long liquidez" ou "short liquidez").
- Limite de cluster **COLAPSA** em crise: controle vira exposição líquida total, não por tese.
- Correlação 30d só vale em regime não-crise. Em crise, 30d é retrovisor que esconde pânico intradiário.

### 4.4 Kill-switches automáticos (checagem pré e intra-trade) [v1.3 sem streak]
- `drawdown_switch`, `volatility_switch` (VIX spike > +30% dia, ou ATR 3x), `liquidity_switch` (spread > 3x mediana, book fino), `feed_stale_switch`, `macro_shock_switch` (guerra, BC surpresa, halt), `model_miscalibration_switch` (Brier 30d pior que baseline), `manual_panic_button`, `order_pattern_compliance_switch` (6.9), `unknown_regime_switch`.
Implementação app: função `check_kill_switches(state) -> {pass: bool, triggered: []}` chamada antes de qualquer ordem e a cada N segundos em posição aberta.

### 4.4b kill_switch_correcao [v1.3 - anti-assimetria]
- **REMOVIDO:** `consecutive_loss_switch` (4 losses → half, 6 → halt). Com p=0.4 e payoff 3:1, P(4 losses)=13% — dispara por variância normal, mata edge assimétrico. Streak sem degradação de calibração = ruído, não sinal.
- **SUBSTITUTO:** `calibration_drift_switch`: só corta se `Brier/ECE 7d piorar >10%` OU drawdown breach. Streak + calibração estável = manter tamanho.
- Canary kill (5.11) usa mesma lógica: 3 losses só rebaixa se em regimes diversos E/OU Brier piorou.

### 4.4c semiauto_kill_semantics [v1.5, integridade em 4.4d v1.6]
- Semi-auto: kill de `drawdown/liquidez/macro_shock` **FECHA automaticamente** (emergência).
- Kill de `calibration/model/OTT` **só ALERTA** (revisão). `feed_stale` ver 4.4d (emergência de integridade, não dúvida).

### 4.4d feed_integrity_is_emergency [v1.6 - anti-operar-com-lixo]
- `feed_stale` = EMERGÊNCIA de integridade (não dúvida). Semi-auto **FECHA/neutraliza** exposição, como drawdown/liquidez.
- Linha correta: incerteza de OPINIÃO (calibração/modelo/OTT) → alerta; falha de PERCEPÇÃO (stale/dado inválido) → fecha. Coerente com Camada 1 (`data_quality<0.6` aborta decisão → também não mantém exposição).

### 4.5 adversarial_multi_agent_debate [v1.1 Tribunal, v1.2 contexto, v1.3 sem prob final, v1.4 condicional]
**Responsabilidade:** Eliminar viés de confirmação. Nenhuma decisão DEEP sai de um único agente.

**Input obrigatório (3.6):** `{regime, regime_confidence, P(transicao_20d), bubble_phase, bubble_risk, data_quality, mode_state}`. Sem isso → `ERROR: MISSING_REGIME_CONTEXT`.

1. **Agent_Bull:**
   - Missão: tese LONG mais forte **condicionada ao regime**.
   - Output: `bull_thesis (com DAG)`, `bull_target`, `bull_conviction (0-1)`, `bull_forward_prediction`.

2. **Agent_Bear:**
   - Missão: destruir tese Bull, tese SHORT/HEDGE mais forte **mesmo regime**.
   - Output: `bear_thesis (com DAG)`, `bear_target`, `bear_conviction (0-1)`, `bear_forward_prediction`.

3. **Agent_Risk (Juiz):**
   - Aplica `BubbleRisk`, `regime_transition`, vetos causais e **0.5b**: divergência conviction >0.30 / prob_disagreement >25pp **só veta DEEP em regime estável**; em transição/unknown/pivot reduz conviction/2, encurta time_stop/forward 50%, só não-alavancado, loga `divergence_as_signal=true`.
   - Se tese vencedora `dag_validation.fail` ou red-teamx2 refuta → veto (`rejected_thesis`).
   - Sizing: `size_base(M_param ponto-fixo) * conviction (0.3-1.0) * redteam_factor`.
   - Output: `debate_summary {winner, conviction, veto_reason?, regime_ctx_hash, forward_prediction, divergence_as_signal}`.

**Anti-teatro:** citar evidências/arestas distintas. Acordo sem confronto = inválido, segunda rodada seed distinta.

### 4.6 execution_depth_tiers [v1.2 - custo/latência]
- **FAST path (intraday / latência crítica / full-auto scalping):** só M_param + kill-switches + shadow. **Sem debate, sem DAG.** Sizing -50%, time-stop curto. Uso obrigatório em `crisis-liquidity / range-illiquid`.
- **DEEP path (swing 5-20d / position 1-6m):** pipeline completo 4.1 (10 passos).
- Roteamento por `timeframe + regime + liquidez`. FAST nunca faz long alavancado em BubbleRisk >70.

### 4.6b fast_ott_cap [v1.5 - OTT×FAST]
- FAST full-auto tem teto de OTT por sessão. Breach → degrada FAST→advisory (não trava tudo).
- Compliance não mata o modo de latência; degrada com segurança (ver 6.9).

### 4.7 market_impact_sizing [v1.2 EV real, cálculo final em 4.7b]
Sizing base = `Kelly_frac_0.25`, mas **tamanho final só vale após ponto-fixo 4.7b**.
- Estima `slippage_est ~ k * sqrt(order_size / ADV)` calibrado por book L2 (k: líquidas ~0.5, small/cripto ~1.0-1.5).
- EV que ignora impacto = fictício. `edge` no critério = EV_real pós-impacto.

### 4.7b sizing_fixed_point [v1.4 anti-circularidade, robustez em 4.7c]
- Iterar 2-3x: `size_{k+1} = min(Kelly_frac_0.25, max size tal que slippage_est(size_k) ≤ 0.3·edge_pós_impacto(size_k))`.
- `edge` = `EV_real(size_k)` com custo fixo (4.7c), não bruto. Impacto com tamanho FINAL convergido, não Kelly base.

### 4.7c fixed_point_robust [v1.5 - anti-oscilação/anti-cegueira-ilíquida]
- `convergence_tol = 1 tick / 0.5% ADV`. Se oscilar período 2 (comum em ilíquidos): toma **MENOR** tamanho do ciclo (conservador), NÃO NO_TRADE.
- `EV_real = EV − slippage_est(order_size) − fees_prop − fees_fix/order_size` (custo fixo incluído).
- `floor_operacional`: size_convergido < mínimo que paga custos fixos → `NO_TRADE reason=cost_floor` (distinto de não-convergência). Evita cegueira em small/cripto ponteiros de bolha.

### 4.8 thesis_clustering [v1.2 - anti-diversificação-falsa]
Agrupe posições por embedding da `causal_thesis` (cosine >0.85 = mesmo cluster).
- Limite 30% por **CLUSTER**, não por ticker. Ex: 10 longs em 10 tickers "IA + liquidez" = 1 tese.
- Correlação >0.8 soma risco (4.3) + mesmo cluster soma exposição. Vale o menor limite dos dois.

---

## [camada 5] self_evolution_feedback_core
**Responsabilidade:** aprender, autocriticar e evoluir sem intervenção humana manual, com guardrails.

### 5.1 Loop de aprendizagem (todo trade, ganho ou perda) [v1.2 dual]
```
[M_param] predict prob → execute/log → observe → score Brier/log-loss/PnL → attribute (sorte/skill/regime) → update weights → promote/demote param → report
[M_lang] generate thesis/debate → dag_validate → redteam attack → observe outcome → score dag_pass/refutation/tese-vs-outcome → propose quarantine edge or prompt mutation → promote/demote lang → report
```
Dois loops rodam em paralelo, interseção na decisão (princípio 0).

### 5.2 Memórias (3 níveis)
- **Episodic:** log imutável de cada decisão: snapshot, tese, **P_Mparam emitido (sempre, mesmo em NO_TRADE)**, `decision_source`, `lang_filter_applied`, probs, sizing ponto-fixo, fills, slippage, MFE/MAE, forward_prediction + outcome/hit, mode_state, outcome.
- **Semantic:** regras extraídas. Ex: "blowoff + funding > 0.1% + retail spike = reversal 68% em 10d".
- **Procedural:** pesos do policy, thresholds por regime, tabela de sizing. Versionado como `model_param_vNN / model_lang_vNN`.

### 5.3 Auto-crítica obrigatória (pós-trade)
Gerar `postmortem` com:
- O que previ vs o que aconteceu?
- Erro foi de `tese causal / timing / sizing / regime / execução`?
- Qual sinal ignorei que era visível?
- O que mudo em `threshold` ou `peso`? Mudança proposta + backtest rápido.
- Score de calibração atualizado.

### 5.3b error_attribution_owner [v1.5]
- Cada erro carrega `owner ∈ {M_param, M_lang, both}`. Mutação só vai para o owner. Ex: timing/prob → M_param; tese/DAG/debate → M_lang; sizing/execução → both (com detalhe).
- Loops evoluem com atribuição limpa, não borrada.

### 5.4 Champion / Challenger dual [v1.2 dois loops, v1.3 com forward + gerador calibrado, v1.5 sizing real 5.4c]
- Dois pares: `champion_param/challenger_param [M_param]` + `champion_lang/challenger_lang [M_lang]`.
- **M_param:** muta pesos ±5-10%, walk-forward purged + 10k Monte Carlo **com gerador calibrado (5.4b) e sizing real 4.7b/4.7c (5.4c)**. Promove só se posterior `>0.95` em `Sharpe_real + Brier/ECE + MaxDD`.
- **M_lang:** muta prompts/debate. Promove só se `forward_hit_rate ↑ out-of-sample (5.12)` + `dag_pass_rate` não piora, com coleta contínua via 5.13b mesmo em degraded. `redteam_refutation ↓` auxiliar.
- Canary `10% → 50% → 100%` com kill 5.11. Promoção com degradação 5.13/5.13b, não trava.
- Rollback: `Brier 30d > baseline+15%` ou `MaxDD breach` ou `dag_fail_rate>0.30` ou `forward_hit` em queda → `*_last_stable` + CASH.

### 5.4b scenario_generator_calibration [v1.3 - anti-ficção]
- Choques sintéticos validados contra cauda empírica X anos (KS-test / tail-matching).
- Se gerador não reproduz cauda real → Monte Carlo **SÓ PODE REJEITAR**, nunca promover.
- Simulação aprova candidato; cauda real dá a palavra final sobre a simulação. Humano audita distribuição de choques (envelope).

### 5.4c mc_uses_real_sizing [v1.5 - anti-Sharpe-inflado]
- MC do challenger_param **DEVE** aplicar ponto-fixo 4.7b/4.7c (ou aproximação documentada) em cada simulação, com custo fixo.
- `Sharpe_MC = Sharpe com sizing real`. Posterior >0.95 sobre o sistema que existe, não ideal sem impacto.

### 5.5 Anti-overfit / drift guards
- Walk-forward + purged k-fold para qualquer mudança de parâmetro.
- Monitorar `feature drift (PSI > 0.2)`, `concept drift (erro por regime)` e `drift_flag relacional` (para 0.5c). Drift alimenta veto condicional, não só freeze.
- Congelar **APLICAÇÃO** de pesos em `war-risk-premium / crisis-liquidity` (ver 5.5b). Medição continua.
- Toda mutação autônoma deve respeitar `risk-limits imutáveis` (sizing max, vetos) — evolução nunca afrouxa risco, só aperta ou melhora calibração.

### 5.5b measure_vs_apply_separation [v1.5 - resolve 5.5×5.9b, escopo 5.5d v1.6]
- **MEDIR sempre:** Brier/ECE sobre TODO ciclo (5.9b), inclusive crise/war/NO_TRADE/rejected. Dado da crise não é perdido.
- **APLICAR nunca em crise/war:** atualização de pesos congelada no calor; erro medido alimenta challenger que só é aplicado quando regime sai de crise.
- Regra única: "medir sempre, atualizar nunca em crise". Escopo em 5.5d.

### 5.5c drift_brakes_application [v1.6 - anti-aplicar-no-calor]
- `drift_flag=true` fora de crise → challenger_param aplica com canary menor (5%, não 10%) + kill mais sensível.
- Não congela (drift ≠ crise), mas freia. Coerente com 5.5b.

### 5.5d measure_always_scope [v1.6 - declara exceção de crise]
- "Medir sempre" aplica-se ao M_param (roda em FAST). Ao M_lang, medir exige debate; em `crisis_lock` o M_lang congela por design (envelope), não é falha.
- Opcional: DEEP-coleta read-only em crisis_lock se feed saudável; nunca DEEP-operar.

### 5.6 Métricas de saúde (dashboard) [v1.4 governança, v1.6 +coherence]
`hit_rate, payoff, expectancy, Sharpe/Sortino, maxDD, Brier score, ECE calibração, profit factor, avg R, exposure, slippage médio, erro por regime/fase bolha, forward_hit_rate, dag_fail_rate_30d, redteam_overlap_with_bullbear, generator_tail_ks_p, mode_state, divergence_as_signal_count, coherence_veto_count, decision_source_mix`.

### 5.7 bayesian_evolution_and_shadow_trading [v1.1, gating 5.10, taxonomia 5.7b]
- Todo `NO_TRADE / VETO` classifica causa antes de logar (ver 5.7b).
- Monitora `Sharpe_real vs Sharpe_shadow_valid_only (30d)` + `omission_error` Brier.
- **M_param apenas:** challenger_param walk-forward + 10k MC com custos/slippage. Posterior >95% + gerador calibrado (5.4b).

### 5.7b shadow_taxonomy [v1.3 anti-contaminação, coerência 5.7c v1.6]
- Veto por **EV/risco/impacto/limite** (tese VÁLIDA, não paga) → `opportunity_veto` → `shadow_valid` → COWARDICE pode tocar.
- Veto por **DAG fail / red-team refuted** (tese INVÁLIDA) → `rejected_thesis` → NUNCA shadow.
- Veto por **coerência 0.5b estável sem drift** (tese válida mas em conflito) → `coherence_veto` → `coherence_log`, NUNCA shadow_valid (5.7c).

### 5.7c coherence_vs_opportunity_veto [v1.6 - anti-auto-sabotagem]
- `opportunity_veto` → shadow_valid → COWARDICE compara Sharpe_real vs shadow_valid.
- `coherence_veto` → coherence_log, fora do COWARDICE. Coerência não é covardia; afrouxá-la é o erro. COWARDICE nunca toca em coherence.

### 5.8 red_team_adversary [v1.2 anti-teatro, independência 5.8b, papel 5.8c]
Quarto agente sem interesse direcional, **filtro de plausibilidade, não juiz de verdade (5.12)**.
- Missão: atacar tese vencedora. Se aresta inválida OU contra-mecanismo base-rate >0.5 → veto ou conviction /2.
- Divergência Bull/Bear aplica 0.5b (condicional por regime); RedTeam corroboração só veta direto em regime estável.
- Métrica `redteam_refutation_rate` é auxiliar. Queda dela **não promove** lang sozinha.

### 5.8b redteam_independence [v1.3 - anti-lobo-com-lobo]
- Red-team = `{modelo de FAMÍLIA distinta} ∪ {heurística paramétrica não-LLM (Granger/base-rate direto)}`.
- Heurística não é enganável por retórica; roda direto nos dados.
- Métrica `redteam_overlap_with_bullbear`: se concorda >80% com Bull/Bear → não independente → trocar modelo/heu.

### 5.8c redteam_role_clarification [v1.4]
- Heurística não-LLM valida **COERÊNCIA CAUSAL da aresta** (existe nos dados?), não independência de probabilidade. Reetiquetar: `redteam_heuristic = causal_coherence_check`.
- Independência de probabilidade vem só de LLM família distinta. Heurística é redundante com M_param para direção; útil para "narrativa bate com estatística?".

### 5.9 hierarchical_calibration [v1.2 anti-ruído, v1.3 adaptativo, endogeneidade em 5.9b]
Brier/ECE com **partial pooling bayesiano**: bucket `regime×fase×horizonte×classe` herda prior do pai.
- Default n>40 para autonomia plena, mas **shrinkage adaptativo**: se prior do pai é fraco (alta variância / poucos dados pai) E bucket tem sinal consistente, permite autonomia parcial com n menor e intervalo largo. Bucket raro nunca fica zerado, nem vira verdade com n=5.
- Evita calibrar ruído e evita nunca aprender regime raro.

### 5.9b endogeneity_guard_calibration [v1.4 - anti-viés-de-seleção]
- M_param calibra Brier/ECE sobre **P_Mparam emitido em TODO ciclo (inclusive NO_TRADE/rejected)**, não só trades executados.
- Todo episódio loga `decision_source + lang_filter_applied`. Bucket ignora se lang vetou: outcome = o que mercado fez dado P_Mparam, não dado quem operou.
- Separa atribuição de CALIBRAÇÃO (M_param vs mundo) de atribuição de DECISÃO (interseção). Shadow/forward alimentam; P_Mparam em veto fecha o loop.

### 5.10 shadow_cowardice_gated [v1.2 anti-ruína, v1.3 com taxonomia]
`COWARDICE_WARNING` só dispara se regime ∈ `{goldilocks, disinflation-bull, reflation}` E `Sharpe_shadow_valid_only >> Sharpe_real` com vol similar.
- Em `{bubble-blowoff, crisis-liquidity, recession-fear, war-risk-premium, range-illiquid}`: shadow > real é ESPERADO, **NÃO afrouxa nada**.
- Afrouxamento sempre via challenger + canary + kill 5.11, nunca direto no champion.

### 5.11 canary_posterior_kill [v1.2 mundo-real > simulação, v1.3 sem streak puro]
Promoção em canary 10% tem kill sem esperar 60d:
- Se `Brier_real(7d)` piorar >10% vs champion OU drawdown breach → rebaixa imediato.
- 3 losses seguidas **só** rebaixa se em regimes diversos E/OU Brier piorou (ver 4.4b). Streak isolada = ruído.
- Monte Carlo aprova candidato; mundo real dá a palavra final.

### 5.12 forward_falsification_validador [v1.3 anti-Goodhart, latência 5.12b, não-direcionais 5.12c]
Red-team **não** é juiz de verdade causal.
- Toda tese aprovada emite `forward_prediction: {evento verificável, prazo ≤N dias, direção, preço-alvo/fronteira}` (5.12c para não-direcionais).
- Promoção `challenger_lang` = `forward_hit_rate` / Brier da previsão futura **out-of-sample**, não `redteam_refutation_rate`.
- Red-team = filtro barato pré-seleção. Verdade causal = prever desconhecido, não passar no teste do colega.
- Log obrigatório: `forward_prediction` + `outcome` + `hit` no episódio para auditoria.

### 5.12b lang_evolution_latency_declared [v1.4 - honestidade de ciclo]
- `min_evolution_period_lang = max(forward_deadline, 2·n_min_forward)`. M_lang não evolui mais rápido que isso — preço de não ser Goodhart.
- Champion em produção **NUNCA** fica em limbo por falta de dados do challenger; só challenger coleta. Durante coleta, opera champion estável.

### 5.12c forward_non_directional [v1.4]
- `HEDGE_MACRO`: forward = "correlação com risco coberto >0.7 por N dias" OU "drawdown do hedge ≤ X".
- `TRIM/SCALE_OUT`: forward = "drawdown posição restante ≤ Y" OU "exposição do cluster abaixo do limite".
- Regra "sem forward = NO_TRADE" vale só para LONG/SHORT direcionais; não-direcionais usam forward de risco.

### 5.13 graceful_degradation_teto [v1.3 anti-deadlock, recuperação em 5.13b]
Substitui "nunca promova um sem o outro estável":
- Se M_lang instável (`dag_fail_rate>0.30` OU `forward_hit_rate` em queda) por >T_lang dias (default 14d) → `MODE: lang_degraded`.
- Em `lang_degraded`: M_param **PODE** evoluir/operar sozinho, mas teto cai: DEEP-para-operar alavancado proibido, só FAST sizing -50% + CASH default, `unknown` mais sensível. **DEEP-para-coletar permitido (5.13b).**
- Interseção = condição de RISCO MÁXIMO, não trava absoluta. Recupera DEEP pleno quando lang estabiliza via canal de coleta.

### 5.13b forward_collection_channel [v1.5 anti-degradação-terminal, sem execução v1.6]
- Em `lang_degraded`, DEEP-para-operar proibido, DEEP-para-coletar PERMITIDO.
- Canal de coleta: debate em modo coleta → tese + `forward_prediction` sobre preço. NÃO compõe posição, NÃO executa fill (fill não informa forward), NÃO conta PnL.
- Challenger_lang coleta OOS na degradação → `forward_hit` pode recuperar → `lang_degraded→ok` SEM humano, **se 5.13c passar**.

### 5.13c degraded_exit_requires_both [v1.6 - anti-cura-falsa]
- Saída de `lang_degraded` exige AMBAS: `forward_hit` recupera n_min OOS **E** `dag_fail_rate < limiar`.
- Se `dag_fail` persiste >T_lang com forward bom → escala para `DAG_OBSOLESCENCE` (humano), NÃO para `ok`. Canal cura modelo; vocabulário obsoleto é fronteira.

### 5.14 envelope_human_SLA [v1.4 - anti-falha-silenciosa]
- Se revisão humana (DAG vivo / risk-limits / cauda de choques / saída de crisis_lock) não chega em `T_sla` (default 30d) após warning → `MODE: frozen_autonomy`: rollback total a `*_last_stable` + CASH + alert escalonado.
- Envelope humano tem tempo de resposta; sem resposta, congela conservador, nunca espera para sempre. Ver state machine camada 8.

---

# 2) MINDSET DO SISTEMA / FILOSOFIA OPERACIONAL

- **Buscar a causa profunda, não o candle.** Preço é sintoma. Perguntar sempre: quem está comprando, com que dinheiro, alavancado como, por qual narrativa, e quem fica com o prejuízo se reverter?
- **Probabilidade > opinião.** Nunca dizer "vai subir". Dizer "62% up / 25% flat / 13% down em 20d, EV +1.8R, invalidação em X".
- **Assimetria > acerto.** Prefere 40% de acerto com payoff 3:1 do que 70% com payoff 0.5:1.
- **Sobrevivência > brilho.** Primeiro não quebrar. Sem risco de ruína. Tamanho pequeno quando incerto.
- **Regime > sinal.** Mesmo setup bom é vetado em regime errado.
- **Falsificabilidade.** Toda tese precisa de `se X acontecer, estou errado e saio`. Sem invalidação = sem trade.
- **Ceticismo com narrativa quente.** Quanto mais consenso eufórico + mídia + novatos, menor o tamanho e mais curto o holding.
- **Autocensura.** Se calibração degradou, se dado está ruim/stale (4.4d fecha), se RedTeamx2 refuta, NO_TRADE. Divergência aplica 0.5b/0.5c (estável sem drift veta; virada/drift reduz). Coerência (coherence_veto) nunca entra em COWARDICE (5.7c).
- **Mapa vs território [v1.2].** Um sistema que nunca questiona o próprio mapa não evolui; um que questiona sem freio se destrói. `dag_fail_rate` alto = mapa errado, não agente errado. Questione o DAG em quarentena, nunca em produção sem validação.

---

# 3) PROTOCOLO DE ANÁLISE (PROMPT OPERACIONAL PARA O AGENTE) [v1.6]

Use este checklist em toda análise. Saída em português objetiva, depois JSON.
Roteamento: estado (8/8b/8c) > `FAST = 1,2,3,6,8,9,10,11` -50% sem debate. `DEEP = todos + coleta 5.13b se degraded`. `unknown/crisis/frozen` = CASH.

```
1. SNAPSHOT + TIER + ESTADO: ativo, preço, timeframe, ADV/book, spread, evento? FAST/DEEP/COLETA? mode_state (8c)? semiauto 4.4c/4.4d (feed_stale fecha)?
2. REGIME + TRANSIÇÃO + UNKNOWN: regime + confiança + P(conhecida) + P-unknown (3.8: distância ao cluster mais próximo) + drift_flag. <0.5 ou P-unknown>0.4 = pré-unknown.
3. BOLHA: fase + BubbleRisk 7 pilares + análogo.
4. SUSTENTABILIDADE: ROIC vs WACC? Lucro acompanha? Só múltiplo?
5. DEBATE + DAG + REDTEAMx2 + FORWARD [DEEP/COLETA]: Bull/Bear DAG-válidos + redteamx2. Winner, conviction, refutation?, forward (5.12c). Aplica 0.5b/0.5c/0.5e: estável sem drift veta; virada/drift/unknown reduz + divergence_as_signal + M_param_lagging (só com edge_to_feature_map)?
6. PROBABILIDADE [M_param ONLY + 5.9b/5.5b/5.5d]: P 3 horizontes + shrinkage. Emite/loga SEMPRE. Crise/war: M_param mede, não aplica; M_lang congela (5.5d).
7. CENÁRIOS: bull/base/bear com gatilhos.
8. EV_REAL + PONTO-FIXO [4.7b/4.7c]: EV - slippage - fees_prop - fees_fix/size, tol 1tick/0.5%ADV. Oscila = menor ciclo; <floor = cost_floor.
9. DECISÃO: ação + sizing convergido (conviction/redteam/cluster/4.3b/teto 8c/OTT 4.6b/drift canary 5% em 5.5c) + entry/stop/take/time-stop.
10. INVALIDAÇÃO + FORWARD: preço/evento + forward (direcional ou risco).
11. RISCO: kill 4.4b/4.4c/4.4d + corr regime-aware + cluster + compliance 6.9/OTT + custo fixo.
12. APRENDIZADO + TAXONOMIA + OWNER: opportunity->shadow_valid; coherence (0.5b estável)->coherence_log (5.7c, fora COWARDICE); causal->rejected. Owner pós-outcome (5.3b)? dag_fail? forward_hit? overlap?
```

**Regra de veto rápido (se qualquer um = NO_TRADE):**
- BubbleRisk >85 e long alavancado
- `EV_real <= 0` ponto-fixo com custo fixo
- data_quality <0.6 / feed_stale (4.4d fecha exposição) / MISSING_CTX / unknown + DEEP/alavancado / frozen/crisis_lock
- dag fail ou OBSOLESCENCE + long alavancado
- refutação redteamx2, ou divergência em ESTÁVEL sem drift (>25pp/>0.30)
- ponto-fixo `cost_floor` ou `slippage_final > 0.3*edge_pós`
- P(conhecida)>0.65 ou P-unknown>0.4 e long sem hedge
- crisis/range + alavancagem, cluster/colapso breach
- risco > limite regime/cluster/estado (teto 8c mais conservador)
- OTT/pattern fail (FAST→advisory 4.6b)
- sem stop/invalidação/forward definível (5.12c)

---

# 4) CONTRATO DE INTEGRAÇÃO APP (INPUT → OUTPUT)

## Input esperado
```json
{
  "symbol": "PETR4.SA",
  "timeframes": ["1d", "1h"],
  "exec_mode": "advisory",
  "equity": 100000,
  "currency": "BRL",
  "risk_profile": "moderate",
  "open_positions": [],
  "macro_snapshot_id": "2026-09-05T12:00Z"
}
```

## Output obrigatório
```json
{
  "symbol": "PETR4.SA",
  "timestamp": "2026-09-05T12:00:00Z",
  "depth_tier": "DEEP",
  "mode_state": "ok",
  "regime": "reflation",
  "regime_confidence": 0.72,
  "regime_transition": { "to_most_likely": "recession-fear", "prob_20d": 0.32, "triggers": ["HY +40bps", "BTC -12% vs SPX flat"] },
  "p_unknown_transition": 0.08,
  "drift_flag": false,
  "M_param_lagging": false,
  "bubble_phase": "awareness",
  "bubble_risk": 38,
  "probabilities_Mparam_only": {
    "swing_20d": { "up": 0.55, "flat": 0.25, "down": 0.20 }
  },
  "prob_disagreement": false,
  "divergence_as_signal": false,
  "decision_source": "intersection_full",
  "lang_filter_applied": false,
  "decision": "LONG_SPOT",
  "confidence_calibrated": 0.58,
  "calibration_note": "shrinkage_adaptive_n=12_parent_weak",
  "entry": [38.2, 37.5],
  "stop": 35.8,
  "take": [41.5, 44.0],
  "time_stop_days": 20,
  "risk_pct": 0.5,
  "size_qty": 650,
  "ev_real_Mparam": 1.4,
  "slippage_final": 0.12,
  "fees_fix": 0.02,
  "size_iterations": 3,
  "size_converged": true,
  "thesis_cluster_id": "c_liquidez_07",
  "thesis_causal": ["Earnings_Up -> FCF_Up -> Valuation_Up [DAG: Earnings_Up->Valuation_Up]"],
  "dag_validation": { "pass": true, "failed_edges": [], "dag_fail_rate_30d": 0.12 },
  "debate_aux": {
    "bull_conviction": 0.68,
    "bear_conviction": 0.45,
    "winner": "bull",
    "veto": false,
    "regime_ctx_hash": "abc123",
    "divergence_as_signal": false
  },
  "redteam": { "refuted": false, "llm_family_b": "no invalid edge", "heuristic_coherence": "Granger_ok_base-rate_0.42", "overlap": 0.35 },
  "forward_prediction": { "event": "close > 41.5 em ≤20d", "deadline_days": 20 },
  "counter_thesis": ["...", "..."],
  "invalidation": "fechamento < 35.8 ou Brent < $70 com DXY > 105",
  "kill_switches": { "pass": true, "triggered": [] },
  "compliance": { "order_pattern": "pass", "ott_ratio": "pass" },
  "model_param_version": "model_param_v17",
  "model_lang_version": "model_lang_v10",
  "expected_owner_of_next_check": "M_lang",
  "veto_class": "opportunity_veto | coherence_veto | none",
  "shadow_valid_trade": null,
  "coherence_log": null,
  "rejected_thesis": null,
  "postmortem_plan": "reavaliar se ..."
}
```

## Ferramentas que o app deve expor ao agente
- `get_ohlcv(symbol, timeframe)` / `get_book_depth(symbol)` / `get_ADV(symbol)` / `get_fees(venue)`
- `get_macro(indicators[])`
- `get_sentiment(symbol)`
- `get_fundamentals(symbol)`
- `get_dag_edges()` / `validate_thesis_dag(thesis)` -> {pass, failed_edges}
- `propose_dag_edge(edge, stat_evidence)` -> quarantine_id (exige Granger/base-rate, 2.7)
- `discover_causal_edges(data)` -> candidatas PC/Granger (2.7)
- `run_debate(bull_ctx, bear_ctx, regime_ctx, mode=operate|collect)` -> {convictions, judge, forward} (collect em degraded 5.13b)
- `run_redteam_llm(winning_thesis)` + `run_redteam_heuristic(data)` -> {refuted, reason, overlap}
- `montecarlo_stress(challenger_param_id, scenarios[])` + `validate_generator_tail()` -> {posterior_P, Sharpe_real_sizing, MaxDD, generator_ok} (sizing real 5.4c)
- `embed_thesis(thesis)` / `cluster_exposure()` / `effective_correlation(regime)` / `p_unknown_transition(features)` -> {cluster, corr_eff, p_unknown}
- `place_order(...) / close_position(...)` (full-auto + kill + compliance + tier; semi-auto: emergência auto-fecha, dúvida alerta — 4.4c)
- `log_episode(decision, outcome)` (inclui P_Mparam sempre + debate_aux + DAG + redteamx2 + forward + ponto-fixo + shadow_valid/coherence/rejected + owner pós-outcome 5.3b + mode 8c)
- `log_shadow_valid(...)` / `log_coherence(...)` (5.7c, fora COWARDICE) / `log_rejected(...)` / `log_forward_minimal(...)` (coleta 5.13b) / stats + `get_Mparam_lagging()` + `get_edge_map(edge)`
- `check_kill_switches()` / `panic_close_all(reason)` / `get_mode()` / `set_mode(8/8b/8c)`

---

# 5) EXEMPLO MÍNIMO DE RACIOCÍNIO

> **Ativo:** ETF tech alavancado. Preço +120% em 6m, funding alto, buscas +300%, P/S 28x, margem estável, insider vendendo, breadth caindo.
> **Regime:** `bubble-blowoff` (yields subindo + DXY forte).
> **BubbleRisk:** 78 (V95/A80/R85). Análogo: `2021 ARKK blowoff, similaridade 0.81, topo em ~15d mediana`.
> **Teste sustentabilidade:** falha — só múltiplo, ROIC<WACC incremental.
> **Probs 20d [M_param only]:** up 22% / flat 18% / down 60%. EV_real short +2.1R (P_Mparam), long -1.4R. Debate: bear conviction 0.8, DAG pass, redteamx2 não refuta, forward "nova mínima em ≤10d".
> **Decisão:** `NO_TRADE long / HEDGE_MACRO` ou `SHORT tático` com `0.25% risco`, stop curto acima do high, time-stop 10d. Invalidação: novo high com volume + funding normalizando. Divergência debate-vs-M_param em blowoff aplica 0.5b (reduz/encurta, não veta — sinal de virada).
> **Auto-evolução:** logar forward + outcome; se romper invalidação, marcar erro timing vs tese; challenger_param só se Brier piorou (streak isolada não pune).

---

# 6) LIMITES, COMPLIANCE E SEGURANÇA

1. Nunca operar sem stop/invalidação + forward_prediction com prazo (5.12/5.12c, coleta 5.13b conta).
2. Nunca aumentar risco após loss para "recuperar".
3. Nunca usar sizing que permita ruína (>2% por trade).
4. Respeitar insider / front-running / market abuse laws. Não usar informação não-pública.
5. Registrar tudo para auditoria: decisão, M_param/M_lang versions, dados usados, fills, forward outcome, owner (5.3b), mode (8).
6. Botão `PANIC` sempre disponível: zera alavancagem, mantém só cash/hedge.
7. Backtest não é garantia. Exigir paper-trading 30-60d antes de subir sizing. Monte Carlo com sizing real + gerador calibrado (5.4b/5.4c).
8. Avisar usuário: risco de perda total em alavancados/derivativos/cripto.
9. Autonomia dentro de envelope com SLA: risk-limits, DAG vivo, cauda e saída de crise são humanos. Sem resposta T_sla → frozen (5.14), exceto crisis_lock absorvente (8b). Learner: pesos, prompts, quarentena.

### 6.9 order_pattern_compliance [v1.3 full-auto kill, v1.5 degradação 4.6b]
- `order_to_trade_ratio_switch`: limite por jurisdição/venue. FAST breach → FAST→advisory (não trava tudo).
- `order_pattern_switch`: spoofing/wash/layering próprio → kill + log + revisão humana.
- Compliance em full-auto é kill-switch, não nota de rodapé.

### Modos advisory / semi-auto / full-auto [v1.5 semântica 4.4c]
- `advisory`: nunca executa.
- `semi-auto`: emergência (drawdown/liquidez/macro) fecha auto; dúvida (calibração/modelo/feed/OTT) só alerta.
- `full-auto`: só com kill pass + compliance + tier + estado permitindo. `crisis/frozen` = CASH.

---

# 7) COMO EVOLUI SOZINHO (RESUMO EXECUTÁVEL P/ DEV) [v1.6]

- Cada decisão gera `episode_id` com `P_Mparam sempre` + tese + DAG + debate_aux + redteamx2 + forward + ponto-fixo robusto + shadow_valid/coherence/rejected + decision_source/lang_filter + owner pós-outcome + mode 8c.
- Cron diário: Brier todo ciclo (M_param sempre; M_lang só se debate roda — 5.5d) + shadow_valid vs real + coherence fora COWARDICE + dag_fail + forward_hit + overlap + tail + divergence/lagging.
- Cron semanal: `challenger_param` (MC sizing real, canary 10% ou 5% com drift — 5.5c) e `challenger_lang` (forward OOS via coleta, saída exige forward E dag — 5.13c) separados. Champion nunca em limbo.
- Degraded coleta sem execução → auto-recupera ou escala DAG_OBSOLESCENCE. Humano SLA 30d → frozen, exceto crisis absorvente. Teto 8c monótono.
- Envelope: risk, DAG vivo, cauda, saída crise + `edge_to_feature_map.json` (0.5e). Learner: pesos fora de crise, prompts, quarentena com evidência.

**Arquivos sugeridos no app:**
```
/skills/auto-trade-bubble-macro-evolution.md  <- este arquivo
/config/risk_config.json
/config/dag_edges.json
/config/dag_edges_quarantine.json
/config/edge_to_feature_map.json  // 0.5e, humano; sem ele 0.5d = no-op
/state/model_param_weights.json
/state/model_lang_prompts/
/state/model_registry.json
/state/mode.json  // ok | lang_degraded | unknown_regime | crisis_lock(absorvente) | frozen_autonomy + motivo + timestamp (8c)
/logs/episodes.jsonl       // P_Mparam sempre + forward + hit + decision_source + owner pós-outcome
/logs/shadow_valid.jsonl   // opportunity_veto
/logs/coherence.jsonl      // coherence_veto 5.7c, fora COWARDICE
/logs/rejected.jsonl
/logs/forward_collection.jsonl  // coleta 5.13b em degraded
```

---

# 8) STATE MACHINE EXPLÍCITA [v1.4, absorvente 8b, monótona 8c v1.6]

Precedência de TETO monótona em conservadorismo: `crisis_lock ≥ frozen_autonomy > unknown_regime > lang_degraded > ok`.

- `ok`: plena (FAST+DEEP, tetos por regime).
- `lang_degraded` (5.13/5.13b/5.13c): DAG fail>0.30 ou forward em queda T_lang dias → sem DEEP-operar alavancado, FAST -50%, DEEP-coletar permitido. Saída exige forward E dag_fail ok (5.13c).
- `unknown_regime` (3.7/3.8): confiança <0.5 ou P-unknown>0.4 → CASH default, só FAST/coleta, DEEP-operar proibido.
- `crisis_lock` (4.3b): regime crisis/range → corr=1, cluster colapsa, só FAST+CASH/hedge. **Só sai via humano.**
- `frozen_autonomy` (5.14): warning sem resposta T_sla 30d → rollback `*_last_stable` + CASH + escalação.

Transições (gatilho ≠ teto): `ok→lang_degraded` auto; `lang_degraded→ok` auto via coleta + 5.13c (sem humano) ou →`DAG_OBSOLESCENCE` se dag_fail persiste; `qualquer(não-absorvente)→frozen` se SLA estoura (unknown pode ir a frozen); `qualquer→crisis_lock` se entra crise; `crisis/frozen→ok` só humano. `mode.json` com estado + motivo + timestamp. Conflito de tetos = mais conservador, agora coerente com a ordem.

### 8b crisis_lock_absorbing [v1.5]
- `crisis_lock` é ABSORVENTE: não escala para `frozen_autonomy` (rollback poderia reabrir risco). Gatilho de SLA em crise = pedido de saída; sem resposta, permanece `crisis_lock` conservador, não degrada.

### 8c monotonic_precedence [v1.6 - anti-violar-próprio-princípio]
- Teto e transição separados: precedência acima é de TETO (risco aplicado). SLA→frozen é transição válida de unknown/lang_degraded/ok; crisis_lock absorvente não transiciona.
- `unknown` não esconde `frozen`: se ambos gatilhos ativos, aplica teto frozen (mais conservador).

---

**Fim da skill.** Quando em dúvida: proteja capital, reduza tamanho, espere regime claro, aprenda com o log.
