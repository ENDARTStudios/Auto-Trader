---
name: ext-freqtrade
description: Freqtrade como playbook operacional — dry-run-first, pairlists, protections, hyperopt, FreqAI adaptativo, controle via Telegram/WebUI. Spec-level, sem código copiado (GPL-3.0).
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/freqtrade/freqtrade (acessado 2026-09-12; 54.3k★, Python, GPL)
license: GPL-3.0 — SPEC-ONLY, nenhum código copiado
---

# Skill ext-freqtrade — Playbook operacional

## 1. Função (evidência do repo)
Bot cripto open-source completo: **dry-run** (opera sem dinheiro), **backtesting** + `backtesting-analysis` + `lookahead-analysis`/`recursive-analysis` (anti-viés embutido), **hyperopt** (otimização de parâmetros), **FreqAI** (ML adaptativo que se re-treina ao mercado), **whitelist/blacklist** + pairlists dinâmicas, **protections** (travas), **Telegram/WebUI** (start/stop/status/profit/forceexit), SQLite, Docker, 13 spot + 7 futures exchanges via CCXT.

## 2. Papel na arquitetura v1.6
- **Disciplina dry-run (§6.7/DoD):** "sempre dry-run antes de dinheiro" = nosso paper-first + graduação 50 ciclos (`graduation.ts:1`).
- **Pairlists → watchlist:** whitelist/blacklist dinâmicas = nosso `watchlist-screener`/`rising-tokens`/`platform-scanner` (curadoria com allow/deny explícitos).
- **Protections → kill-switches:** travas do Freqtrade = nossos `check_kill_switches` (§4.4) + `kill-switch` API imutável.
- **Hyperopt → evolução:** busca de parâmetros = nosso `challenger_param` (§5.4) — com a correção que o Freqtrade não tem: promoção só por forward OOS + MC com sizing real (§5.4c), nunca só por backtest.
- **Lookahead-analysis → gate:** análise de viés como comando de primeira classe = nosso `data_quality_score` + proibição de look-ahead.
- **Telegram → notificações:** comandos start/stop/status/forceexit = nosso `NotificationChannel` + `kill-switch` manual.

## 3. Guardrails vinculantes
- Dry-run/paper é o **default permanente**; live exige graduação + flag + humano (S14 bloqueado sem chaves).
- Otimização nunca promove por backtest isolado (anti-overfit §5.5: walk-forward + purged + forward OOS).
- `forceexit` manual sempre disponível (botão PANIC §6.6).

## 4. Contrato de integração (status: SPEC-ONLY)
Sem runtime Python acoplado. Adoção = comportamentos: `test-pairlist` (validar curadoria antes de operar), `lookahead-analysis` (gate de viés), `backtesting-show` (artefatos comparáveis ao `BacktestResult`).

## 5. O que NÃO incorporar
Código (GPL-3.0), execução live própria, FreqAI como decisor (só como inspiração de `challenger` adaptativo sob nosso envelope).

## 6. Licença
**GPL-3.0 — spec/comportamento apenas.**
