---
name: ext-hummingbot
description: Hummingbot como taxonomia de execução — venues CLOB/AMM/CLMM (140+), executores (position/DCA/grid/arb/XEMM/TWAP + triple-barrier), Condor (LLM→execução determinística), paper-first, keystore criptografado. Spec-level (Apache-2.0), S14-gated.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/hummingbot/hummingbot (acessado 2026-09-12; 20k★, Apache-2.0, $34B volume/ano reportado)
license: Apache-2.0 — spec-level (execução só em S14 com envelope)
---

# Skill ext-hummingbot — Taxonomia de execução

## 1. Função (evidência do repo)
Framework HFT de market-making cripto: **conectores** padronizados (CLOB CEX spot/perp, CLOB DEX, AMM router/AMM/CLMM via Gateway — Binance/Bybit/OKX/Hyperliquid/Uniswap/Raydium...), **scripts** (ex: `simple_pmm`), **controllers V2** (ex: `pmm_mister`, tunáveis live), **executores** (position com **triple-barrier risk controls**, DCA, grid, arbitrage, XEMM, TWAP, LP), **Condor** (AI harness: LLM decide → execução determinística via API, Telegram/dashboard), `binance_paper_trade` sem chaves, `hbot` CLI scriptável, keystore com senha (`HBOT_PASSWORD`), Docker/Gateway.

## 2. Papel na arquitetura v1.6
- **Taxonomia de venues:** CLOB/AMM/CLMM = vocabulário para nosso `chain`/`source` (cex vs dex) e `slippage_k` por liquidez (`sizing-fixed-point.ts:1`).
- **Executores:** `position_executor` com triple-barrier (TP/SL/time) = nosso `exit-planner.ts` + `maxHoldMinutes` + `takeProfitPct/stopLossPct` (`Config` singleton).
- **Condor = §0.5 industrial:** "LLM-powered decision-making → deterministic trade execution" — precedente externo exato da nossa separação M_lang/M_param.
- **Paper-first:** `binance_paper_trade` sem chaves = nosso paper default + S14 testnet-gated.
- **Keystore:** senha criptografando chaves = nosso AES-256-GCM (`wallet-crypto.ts:1`, `kdf.ts:1`).

## 3. Guardrails vinculantes
- Execução **só** em S14 com `live_trading` flag + `mode.json:1` + humano; até lá, paper/testnet.
- Controllers tunáveis live **nunca** acima dos tetos do `risk_config.json:1` (envelope manda, learner/controller obedece).
- Triple-barrier obrigatório em toda posição direcional (stop/take/time-stop, §4.1 passo 8).

## 4. Contrato de integração (status: SPEC-ONLY, S14-gated)
Sem daemon Python acoplado. Adoção = taxonomia + executores como spec do `exit-planner` + Condor como validação do nosso desenho. Bridge futura só via API com auth + `mode` gate.

## 5. O que NÃO incorporar
Daemon live próprio, market-making alavancado sem envelope, HFT de verdade (latência/colocation fora do escopo: somos swing/paper, não HFT).

## 6. Licença
**Apache-2.0 — spec permitido; execução segue S14, não a licença.**
