---
name: ext-backtrader
description: Backtrader (mementum) como referência de metodologia de backtest — motor Cerebro, 122+ indicadores, analyzers, sizers e simulação de broker. Spec-level, sem código copiado (GPL-3.0).
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/mementum/backtrader (acessado 2026-09-12; 23.2k★, 5.3k forks, GPL-3.0)
license: GPL-3.0 — SPEC-ONLY, nenhum código copiado (incompatível c/ repo proprietário)
---

# Skill ext-backtrader — Metodologia de backtest

## 1. Função (evidência do repo)
Plataforma Python de backtest + live trading: engine **Cerebro** (`addstrategy/adddata/run/plot`), **122 indicadores** built-in + custom + TA-Lib, **analyzers** (TimeReturn, Sharpe Ratio, SQN, pyfolio), **sizers** (staking automatizado), **broker simulado** (Market/Close/Limit/Stop/StopLimit/StopTrail/OCO, bracket, slippage, volume filling, ajuste de caixa), comissões flexíveis, multi-data/multi-strategy/multi-timeframe, resample/replay, Cheat-on-Close/Open, live via Interactive Brokers/Oanda.

## 2. Papel na arquitetura v1.6
- **Validação (Camada 5 / `BacktestResult`):** checklist do que todo backtest nosso deve conter — retornos temporais, Sharpe, SQN, comissões, slippage, volume-fill realista. Referência para `src/lib/trading/backtest.ts:1` e `tests/` (exigir `SQN` + `TimeReturn` nos relatórios).
- **Sizing (Camada 4):** padrão `sizer` separado da estratégia = precedente do nosso ponto-fixo `src/lib/trading/sizing-fixed-point.ts:1` (tamanho resolvido fora da tese).
- **Anti-viés:** modos Cheat-on-Close documentados = o que **proibir** por default (look-ahead); nosso `backtest` deve declarar o modo de execução por barra.

## 3. Guardrails vinculantes
- Backtest **não é garantia** (skill §6.7): exige paper 30–60d antes de subir sizing; MC com sizing real (§5.4c).
- Sem look-ahead: dados só até a barra fechada; qualquer exceção logada como `data_quality` degradado.
- Métricas mínimas por backtest: Sharpe, MaxDD, Profit Factor, win rate, expectancy, fees/slippage totais.

## 4. Contrato de integração (status: SPEC-ONLY)
Nenhum runtime Python acoplado. Adoção = interface de relatório (`BacktestResult` com os campos acima) + bateria de asserts em `tests/`. Se um dia for executado externamente, via job isolado com artefatos JSON (nunca importado no processo Next).

## 5. O que NÃO incorporar
Código-fonte (GPL-3.0 contamina repo proprietário), live via IB/Oanda, `pyfolio` (deprecated no próprio repo).

## 6. Licença
**GPL-3.0 — spec/interface apenas.** Reimplementação limpa de conceitos (indicadores são matemática pública) é permitida; cópia de código, não.
