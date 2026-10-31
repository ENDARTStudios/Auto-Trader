---
name: ext-vectorbt
description: VectorBT como metodologia de varredura vetorizada — 10k combinações de parâmetros de uma vez (NumPy/Numba/Rust), walk-forward, métricas QuantStats. Spec-level (fair-code Commons Clause).
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/polakowo/vectorbt (acessado 2026-09-12; 9.1k★, Apache-2.0 + Commons Clause fair-code)
license: Apache-2.0 + Commons Clause — SPEC-ONLY (cláusula proíbe vender produto primariamente baseado no software)
---

# Skill ext-vectorbt — Varredura em escala

## 1. Função (evidência do repo)
Backtesting vetorizado: milhares de configs em arrays NumPy (Numba + engine Rust opcional) em vez de loop barra-a-barra; `MA.run_combs` (10k janelas dual-SMA de uma vez), `Portfolio.from_signals` com fees, heatmaps Plotly, `stats()` por config (Total Return, MaxDD 70.7%, Profit Factor, Expectancy, Sharpe/Sortino/Calmar/Omega, Win Rate), walk-forward + labels p/ ML, QuantStats, dados sintéticos, Telegram.

## 2. Papel na arquitetura v1.6
- **Evolução (Camada 5):** varredura massiva = o `challenger_param` que escala — grade de thresholds/pesos avaliada de uma vez, promovida só por Sharpe **com sizing real** (§5.4c) + posterior >0.95 (`mc-posterior.ts:1`).
- **Métricas:** o set `stats()` espelha 1:1 nosso `PerformanceMetrics` (`equity-curve-panel`, `page.tsx:284`) — Sharpe, drawdown, profit factor, expectancy, win rate. Divergência entre os dois = bug a investigar.
- **Robustez:** walk-forward + dados sintéticos = nosso anti-overfit (§5.5) + calibração de gerador (§5.4b KS-test/tail-matching).

## 3. Guardrails vinculantes
- Grade massiva **não** é licença para overfit: exige walk-forward purged + forward OOS antes de qualquer promoção (§5.5/5.12).
- Custo de transação sempre incluído na varredura (`fees=0.001` no exemplo deles; nosso `EV_real` com `fees_fix` em `sizing-fixed-point.ts:1`).
- Broadcasting multi-ativo ≠ diversificação real: cluster de tese (§4.8) e correlação em crise = 1 (§4.3b) aplicam-se aos resultados da grade.

## 4. Contrato de integração (status: SPEC-ONLY)
Sem runtime Python acoplado. Adoção = disciplina de grade + set de métricas + `convergenceRate`-like por lote. Se executado externamente, job isolado com matriz de resultados JSON.

## 5. O que NÃO incorporar
Código (fair-code), live trading (não é o propósito da lib), heatmap sem walk-forward (ilusão de precisão).

## 6. Licença
**Apache-2.0 + Commons Clause — spec apenas; revenda baseada no software é proibida pela cláusula.**
