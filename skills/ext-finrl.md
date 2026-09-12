---
name: ext-finrl
description: FinRL como disciplina de RL financeiro — pipeline train→test→trade, envs gym, turbulence index, ensemble A2C/DDPG/PPO/TD3/SAC, dados Binance/CCXT/Yahoo. Spec-level (MIT).
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/AI4Finance-Foundation/FinRL (acessado 2026-09-12; 16.3k★, MIT; sucessor prod: FinRL-X/FinRL-Trading)
license: MIT — spec-level (nada copiado; stack Python fora do processo Next)
---

# Skill ext-finrl — Disciplina DRL

## 1. Função (evidência do repo)
Primeiro framework open-source de RL financeiro: pipeline **train.py→test.py→trade.py**, envs gym (`env_stock_trading`, `env_cryptocurrency_trading`, `env_portfolio_allocation`), agentes (A2C/DDPG/PPO/TD3/SAC via Stable-Baselines3, ElegantRL, RLlib), processadores de dados (Binance, **CCXT**, Yahoo, Alpaca, Tushare...), indicadores + **VIX + turbulence index**, ensemble (ICAIF 2020), benchmarks MVO/DJIA. FinRL-X é o sucessor produção (ML+DRL+LLM, Pydantic, risk em 3 níveis).

## 2. Papel na arquitetura v1.6
- **Gates train→test→trade:** = nosso champion/challenger/canary (§5.4/5.11) — treina, valida OOS, canary 10→50→100 com kill, nunca direto em produção.
- **Turbulence index → regime:** medida de turbulência como input do detector de regime (§3/§3.5 `P(transição)`) e do `unknown_regime` (§3.7).
- **Ensemble → debate:** múltiplos algos votando = nosso bull/bear/Juiz (§4.5) — com a correção que o FinRL não tem: pesos por calibração (Brier/ECE §5.9b), não por voto.
- **Dados:** Binance/CCXT como processadores = reforça CCXT como transporte + ETL cripto (`src/lib/etl/*:1`).
- **FinRL-X:** acompanhar como referência de stack produção (risk ordem→portfólio→estratégia espelha nossa Camada 4).

## 3. Guardrails vinculantes
- RL decide **tamanho/ação só dentro** do envelope (risk_config tetos + kill-switches); env constraints (estilo gym) são piso, não teto.
- Backtest de policy RL exige custos (fees/slippage) — sem custo, Sharpe é fictício (§5.4c sizing real).
- Paper do FinRL (NeurIPS/ICAIF) ≠ garantia: validação é forward OOS (§5.12), não citação.

## 4. Contrato de integração (status: SPEC-ONLY)
Sem stack Python acoplada. Adoção = gates + turbulence como feature de regime + ensemble calibrado. Treino externo, se houver, via job isolado com artefatos (pesos versionados em `model_registry.json:1`).

## 5. O que NÃO incorporar
Trade.py live próprio, pesos sem validação OOS, TensorFlow legado, promessa de retorno.

## 6. Licença
**MIT — spec permitido. (Nota de marca: "FinRL" é trademark da FinRL LLC — citar como referência, não usar no nome do produto.)**
